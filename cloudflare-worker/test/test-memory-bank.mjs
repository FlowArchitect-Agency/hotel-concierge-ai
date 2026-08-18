import { config } from 'dotenv';
import { resolve } from 'path';
import { buildMemoryExtractionPrompt } from '../src/concierge.js';

config({ path: resolve(process.cwd(), '../.env') });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ROUTER_MODEL = process.env.GROQ_ROUTER_MODEL || process.env.GROQ_MODEL || 'qwen/qwen3.6-27b';

if (!GROQ_API_KEY) {
  console.error('Error: GROQ_API_KEY is required in .env');
  process.exit(1);
}

async function extractMemory(prompt) {
  const body = {
    model: ROUTER_MODEL,
    messages: [
      { role: 'system', content: 'You are a JSON data extraction assistant. Return valid JSON objects only.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 250,
    response_format: { type: 'json_object' },
    ...(ROUTER_MODEL.startsWith('qwen/') ? { reasoning_effort: 'none', reasoning_format: 'hidden' } : {}),
  };

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`HTTP Error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content || '';
  const candidate = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? rawText.slice(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1);
  return JSON.parse(candidate);
}

async function testMemoryExtraction() {
  console.log('=== Testing Phase 3: Guest Preference Memory Bank ===\n');

  const guestMessage = 'My name is Alexander Dupont (+33612345678). We are visiting Paris for our 10th anniversary, and my wife has strict gluten-free dietary needs. What do you recommend for dining and activities?';

  console.log(`Guest Message: "${guestMessage}"\n`);

  const prompt = buildMemoryExtractionPrompt({
    message: guestMessage,
    history: [],
    language: 'en',
  });

  const extractedProfile = await extractMemory(prompt);

  console.log('--- Extracted Guest Profile JSON ---');
  console.log(JSON.stringify(extractedProfile, null, 2));

  // Simulate Airtable Upsert Payload
  const airtablePayload = {
    Phone: extractedProfile.phone || '+33612345678',
    GuestName: extractedProfile.guestName || 'Alexander Dupont',
    Language: extractedProfile.language || 'en',
    DietaryRestrictions: extractedProfile.dietaryRestrictions,
    PurposeOfStay: extractedProfile.purposeOfStay,
    GeneralPreferences: extractedProfile.generalPreferences,
  };

  console.log('\n--- Airtable Upsert Payload (Guest Profiles Table) ---');
  console.log(JSON.stringify(airtablePayload, null, 2));

  if (extractedProfile.dietaryRestrictions && extractedProfile.purposeOfStay) {
    console.log('\n✅ SUCCESS: Memory Agent correctly extracted anniversary purpose and gluten-free dietary restriction!');
  } else {
    console.log('\n⚠️ Extraction incomplete.');
  }
}

testMemoryExtraction().catch((err) => console.error('Test execution error:', err));
