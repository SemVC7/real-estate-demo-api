import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Intentiedetectie
async function detectIntent(userPrompt) {
  const systemPrompt = `
Je bent een slimme intentiedetector. Geef dit JSON-formaat terug:
{
  "taal": "nl" of "en" of "de" of "es" of "fr" of "it" of "pt" of "ru" of "no",
  "intentie": "algemene vraag" of "vastgoedzoekopdracht",
  "filters": {
    "min_slaapkamers": getal of null,
    "min_badkamers": getal of null,
    "zwembad": getal of null,
    "max_prijs": getal of null,
    "locatie": tekst of null
  }
}
Begrijp Nederlands, Engels, Duits, Spaans, Frans, Italiaans, Portugees, Russisch, Noors.

User prompt:
"${userPrompt}"
`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    temperature: 0,
  });

  const answer = completion.choices[0].message.content;
  const jsonStart = answer.indexOf('{');
  const jsonEnd = answer.lastIndexOf('}');
  const jsonString = answer.slice(jsonStart, jsonEnd + 1);
  return JSON.parse(jsonString);
}

// Ophalen embedding van de userprompt
async function getEmbedding(text) {
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-ada-002',
    input: text,
  });
  return embeddingResponse.data[0].embedding;
}

// Vertalen en samenvatten tekst
async function summarizeAndTranslate(text, targetLanguage) {
  if (!text) return '';
  const prompt = `Vat de volgende tekst samen in maximaal 4 zinnen en vertaal het naar ${targetLanguage}: ${text}`;
  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
  });
  return completion.choices[0].message.content.trim();
}

async function callAssistant(userPrompt) {
  const thread = await openai.beta.threads.create();

  await openai.beta.threads.messages.create(thread.id, {
    role: 'user',
    content: userPrompt,
  });

  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: 'asst_L4uKbR2GpJ3zhBmjKTxTrk1Q',
  });

  let runStatus;
  do {
    runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    if (runStatus.status !== 'completed') {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } while (runStatus.status !== 'completed');

  const messages = await openai.beta.threads.messages.list(thread.id);

  const assistantMessage = messages.data.find((msg) => msg.role === 'assistant');
  return assistantMessage?.content[0]?.text?.value || 'Sorry, ik heb geen antwoord kunnen genereren.';
}

// Main search functie
export async function searchProperties(userPrompt) {
  const intentData = await detectIntent(userPrompt);
  console.log('🎯 Intentiedetectie:', intentData);

  if (intentData.intentie !== 'vastgoedzoekopdracht') {
    const assistantResponse = await callAssistant(userPrompt);
    return {
      type: 'agent',
      message: assistantResponse,
    };
  }

  const queryEmbedding = await getEmbedding(userPrompt);

  const { data, error } = await supabase.rpc('match_properties', {
    match_count: 3,
    match_threshold: 0.8,
    max_price: intentData.filters.max_prijs || null,
    min_baths: intentData.filters.min_badkamers || 1,
    min_beds: intentData.filters.min_slaapkamers || 1,
    pool_required: intentData.filters.zwembad || 0,
    query_embedding: queryEmbedding,
  });

  if (error) {
    console.error('❌ Fout bij ophalen van matches:', error);
    return { type: 'error', message: 'Er ging iets fout bij het ophalen van de panden.' };
  }

  // Per pand een berichtobject maken
const message = await Promise.all(
  data.map(async (item) => {
    const beschrijving = await summarizeAndTranslate(item.description, intentData.taal);
    const caption = `🏡 ${item.ref}\n📍 ${item.town}, ${item.province}, ${item.country}\n💰 ${item.price} ${item.currency}\n🛌 ${item.beds} | 🛁 ${item.baths} | 🏊 ${item.pool === 1 ? 'Ja' : 'Nee'}\n✨ ${beschrijving}\n🔗 ${item.url_en}`;
    return {
      caption,
      imageUrl: Array.isArray(item.image_url) ? item.image_url[0] : item.image_url,
    };
  })
);

  return { type: 'properties', message };
}
