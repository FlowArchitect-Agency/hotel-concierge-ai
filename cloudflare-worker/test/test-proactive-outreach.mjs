import { config } from 'dotenv';
import { resolve } from 'path';
import { buildPostCheckoutOutreachPrompt, buildPreArrivalOutreachPrompt } from '../src/concierge.js';

config({ path: resolve(process.cwd(), '../.env') });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ROUTER_MODEL = process.env.GROQ_ROUTER_MODEL || process.env.GROQ_MODEL || 'qwen/qwen3.6-27b';

if (!GROQ_API_KEY) {
  console.error('Error: GROQ_API_KEY is required in .env');
  process.exit(1);
}

async function generateOutreachText(prompt) {
  const body = {
    model: ROUTER_MODEL,
    messages: [
      { role: 'system', content: 'You are the private Head Concierge at Hôtel Lumière Paris. Output plain text messages only.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 200,
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
  return (data.choices?.[0]?.message?.content || '').replace(/^["']|["']$/g, '').trim();
}

async function testProactiveOutreach() {
  console.log('=== Testing Phase 4: Proactive Outreach Automation ===\n');

  // Test Case A: Pre-Arrival Upsell Campaign
  const preArrivalProfile = {
    Phone: '+33612345678',
    GuestName: 'Alexander Dupont',
    Language: 'en',
    PurposeOfStay: '10th Anniversary',
    DietaryRestrictions: 'Gluten-free',
    GeneralPreferences: 'Interested in luxury Seine cruise & rooftop dining',
  };

  console.log('📌 [Campaign A] Pre-Arrival Upsell Message (48h before arrival)');
  console.log(`Guest Profile: ${preArrivalProfile.GuestName} (${preArrivalProfile.PurposeOfStay}, ${preArrivalProfile.DietaryRestrictions})`);

  const prePrompt = buildPreArrivalOutreachPrompt({ profile: preArrivalProfile, hotelName: 'Hôtel Lumière Paris' });
  const preArrivalMessage = await generateOutreachText(prePrompt);

  console.log('\n--- Generated WhatsApp Pre-Arrival Message ---');
  console.log(`"${preArrivalMessage}"`);

  // Test Case B: Post-Checkout Review Router Campaign
  const postCheckoutProfile = {
    Phone: '+33687654321',
    GuestName: 'Marie Laurent',
    Language: 'fr',
    PurposeOfStay: 'Honeymoon',
  };

  console.log('\n📌 [Campaign B] Post-Checkout Review Router Message (Same-day checkout)');
  console.log(`Guest Profile: ${postCheckoutProfile.GuestName} (${postCheckoutProfile.PurposeOfStay}, French language)`);

  const postPrompt = buildPostCheckoutOutreachPrompt({ profile: postCheckoutProfile, hotelName: 'Hôtel Lumière Paris' });
  const postCheckoutMessage = await generateOutreachText(postPrompt);

  console.log('\n--- Generated WhatsApp Post-Checkout Message ---');
  console.log(`"${postCheckoutMessage}"`);

  // Simulate WhatsApp Cloud API Payload Structure
  console.log('\n--- WhatsApp Cloud API Outbound Payload Example ---');
  const whatsappPayload = {
    messaging_product: 'whatsapp',
    to: preArrivalProfile.Phone,
    type: 'text',
    text: { body: preArrivalMessage },
  };
  console.log(JSON.stringify(whatsappPayload, null, 2));

  console.log('\n✅ SUCCESS: Proactive Outreach Automation pipeline generated 5-star WhatsApp campaign messages!');
}

testProactiveOutreach().catch((err) => console.error('Outreach test error:', err));
