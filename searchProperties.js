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
  "intentie": "duurste", "goedkoopste" of "specifiek",
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

// Vertalen tekst
async function translateText(text, targetLanguage) {
  if (!text) return '';
  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: `Vertaal de volgende tekst naar ${targetLanguage}:` },
      { role: 'user', content: text },
    ],
    temperature: 0,
  });
  return completion.choices[0].message.content.trim();
}

// Main search functie
export async function searchProperties(userPrompt) {
  const intentData = await detectIntent(userPrompt);
  console.log('🎯 Intentiedetectie:', intentData);

  if (intentData.intentie !== 'specifiek') {
    return {
      type: 'agent',
      message: 'Ik beantwoord dit rechtstreeks met de AI-agent prompt.',
    };
  }

  const queryEmbedding = await getEmbedding(userPrompt);

  const { data, error } = await supabase.rpc('match_properties', {
    match_count: 2,
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

  // Vertalen resultaten
  const results = await Promise.all(
    data.map(async (item) => {
      const beschrijving = await translateText(item.description, intentData.taal);
      const features = item.features && item.features.length > 0
        ? await translateText(item.features.join(', '), intentData.taal)
        : '';

      return {
        ref: item.ref,
        prijs: `${item.price} ${item.currency}`,
        locatie: `${item.town}, ${item.province}, ${item.country}`,
        slaapkamers: item.beds,
        badkamers: item.baths,
        zwembad: item.pool === 1 ? 'Ja' : 'Nee',
        woonoppervlakte: item.built_area,
        url: item.url_en,
        beschrijving: beschrijving,
        features: features,
        afbeelding: Array.isArray(item.image_url) ? item.image_url[0] : item.image_url,
      };
    })
  );

  results.forEach((property, index) => {
    console.log(`\n🏠 Resultaat ${index + 1}`);
    console.log(`Ref: ${property.ref}`);
    console.log(`URL: ${property.url}`);
    console.log(`Prijs: ${property.prijs}`);
    console.log(`Locatie: ${property.locatie}`);
    console.log(`Slaapkamers: ${property.slaapkamers}`);
    console.log(`Badkamers: ${property.badkamers}`);
    console.log(`Woonoppervlakte: ${property.woonoppervlakte}`);
    console.log(`Zwembad: ${property.zwembad}`);
    console.log(`Beschrijving: ${property.beschrijving}`);
    console.log(`Kenmerken: ${property.features}`);
    console.log(`Afbeelding: ${property.afbeelding}\n`);
  });

  return { type: 'properties', results };
}

// Voorbeeld:
// const userInput = 'Je recherche une appartement à Alicante, le budget est de 175000 et je veux 2 chambres';
// searchProperties(userInput);
