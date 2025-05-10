import express from 'express';
import dotenv from 'dotenv';
import { searchProperties } from './searchProperties.js';

dotenv.config();
const app = express();
app.use(express.json());

app.post('/search-properties', async (req, res) => {
  try {
    const { prompt } = req.body;
    const result = await searchProperties(prompt);
    res.json(result);
  } catch (err) {
    console.error('❌ Fout in API handler:', err);
    res.status(500).json({ error: 'Interne serverfout' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server draait op poort ${PORT}`);
});
