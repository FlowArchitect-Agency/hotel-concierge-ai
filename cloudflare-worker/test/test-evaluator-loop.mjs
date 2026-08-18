import { config } from 'dotenv';
import { resolve } from 'path';
import { buildEvaluatorPrompt, parseModelJson } from '../src/concierge.js';

config({ path: resolve(process.cwd(), '../.env') });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ROUTER_MODEL = process.env.GROQ_ROUTER_MODEL || process.env.GROQ_MODEL || 'qwen/qwen3.6-27b';

if (!GROQ_API_KEY) {
  console.error('Error: GROQ_API_KEY is required in .env');
  process.exit(1);
}

async function callEvaluator(prompt) {
  const body = {
    model: ROUTER_MODEL,
    messages: [
      { role: 'system', content: 'You are a JSON evaluator assistant. Return JSON objects only.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 300,
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

async function testEvaluator() {
  console.log('=== Testing Phase 2: Reflection & Evaluator Loop ===\n');

  const testCases = [
    {
      name: 'CDG Airport Transfer (Chauffeur Upsell)',
      input: { message: 'We land at CDG airport tomorrow afternoon. How can we get to Hôtel Lumière?', language: 'en' },
      draftReply: 'You can take a taxi or train from the airport to our location in Paris.',
    },
    {
      name: 'Tired Muscles / Spa Request (Hotel Spa Upsell)',
      input: { message: 'We have been walking all day and our feet are exhausted. What relaxation do you have at the hotel?', language: 'en' },
      draftReply: 'You can rest in your suite room or take a walk in the garden.',
    },
    {
      name: 'Eiffel Tower View Drinks (Rooftop Upsell)',
      input: { message: 'Where can we get an amazing view of the Eiffel Tower for cocktails tonight?', language: 'en' },
      draftReply: 'There are many rooftop bars across Paris where you can see the tower.',
    },
    {
      name: 'Anti-Salesy Guardrail (Simple Checkout Question)',
      input: { message: 'What time is checkout tomorrow morning?', language: 'en' },
      draftReply: 'Check-out time at Hôtel Lumière Paris is 12:00 PM. Our reception team can hold your luggage if you wish to explore Paris further.',
    },
  ];

  for (const testCase of testCases) {
    console.log(`\n📌 [TestCase] ${testCase.name}`);
    console.log(`Guest Message: "${testCase.input.message}"`);
    console.log(`Draft Reply: "${testCase.draftReply}"`);

    const evalPrompt = buildEvaluatorPrompt({
      input: testCase.input,
      draftReply: testCase.draftReply,
      classification: { route: 'conversation' },
      facts: { hotelName: 'Hôtel Lumière Paris' },
    });

    const evalResult = await callEvaluator(evalPrompt);

    console.log('\n--- Evaluator Output ---');
    console.log(JSON.stringify(evalResult, null, 2));

    if (evalResult?.passed === false && evalResult?.improved_reply) {
      console.log('\n✨ [Evaluator Action] Draft refined with subtle luxury upsell:');
      console.log(`👉 "${evalResult.improved_reply}"`);
    } else if (evalResult?.passed === true) {
      console.log('\n✅ [Evaluator Action] Approved as natural & non-salesy.');
    }
  }
}

testEvaluator().catch((err) => console.error('Test execution failed:', err));
