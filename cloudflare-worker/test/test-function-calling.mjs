import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '../.env') });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.6-27b';

if (!GROQ_API_KEY) {
  console.error('Error: GROQ_API_KEY is required in .env');
  process.exit(1);
}

const CONCIERGE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_reservation',
      description: 'Book or request a reservation for a hotel service, spa, restaurant, or private transfer',
      parameters: {
        type: 'object',
        properties: {
          serviceName: { type: 'string', description: 'Name of the requested service' },
          guestName: { type: 'string', description: 'Full name of the guest' },
          email: { type: 'string', description: 'Contact email address' },
          preferredDate: { type: 'string', description: 'Date of reservation' },
          preferredTime: { type: 'string', description: 'Time of reservation' },
          partySize: { type: 'number', description: 'Number of people' },
        },
        required: ['serviceName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_paris_addresses',
      description: 'Search current independently verified Paris venues, museums, or restaurants',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or venue category' },
          cuisine: { type: 'string', description: 'Specific cuisine if applicable' },
        },
        required: ['query'],
      },
    },
  },
];

async function runTest() {
  console.log('--- Testing Function Calling (Tool Use) ---');
  console.log('User Prompt: "Can I book a table for 2 tonight at the hotel restaurant?"\n');

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: 'You are the private AI concierge for Hôtel Lumière Paris. Use available tools when guests express reservation intent.' },
      { role: 'user', content: 'Can I book a table for 2 tonight at the hotel restaurant?' },
    ],
    tools: CONCIERGE_TOOLS,
    tool_choice: 'auto',
    temperature: 0.1,
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
    console.error('HTTP Error:', response.status, await response.text());
    process.exit(1);
  }

  const data = await response.json();
  const choice = data.choices?.[0]?.message;

  console.log('Model Response Content:', choice?.content || '(No direct text, tool call triggered)');
  console.log('\n--- Tool Calls Output ---');
  console.log(JSON.stringify(choice?.tool_calls, null, 2));

  if (choice?.tool_calls?.some(t => t.function?.name === 'create_reservation')) {
    console.log('\n✅ SUCCESS: Native function calling correctly identified create_reservation intent!');
  } else {
    console.log('\n⚠️ No tool call triggered.');
  }
}

runTest().catch((err) => console.error('Execution error:', err));
