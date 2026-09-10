// Semantic-controller qualification for candidate provider/model pairs.
//
// This exists because the gateway refuses to use a fallback model without
// per-provider, per-purpose evidence (src/llm/model-qualification.js), and the
// primary model's free daily token budget is small enough that a real failover
// target matters. It deliberately uses the PRODUCTION prompt builder and the
// PRODUCTION strict parser, so a model only passes if it would actually work
// in the pipeline -- not merely if it can emit some JSON.
//
// Usage:
//   NVIDIA_API_KEY=... OPENROUTER_API_KEY=... node controller-qualification.mjs [out.json]

import { writeFileSync } from 'node:fs';
import { buildSemanticControllerPrompt, parseSemanticControllerOutput } from '../../src/semantic-controller.js';

const OUT = process.argv[2] || 'controller-qualification.json';
// Reasoning models (nemotron, minimax, deepseek) emit their chain-of-thought as
// text BEFORE the JSON object. At 700 tokens they were cut off mid-sentence and
// every plan was scored invalid -- a measurement artefact, not a model failure.
// Production's default of 350 (src/llm/schemas.js) is lower still.
const MAX_TOKENS = Number(process.env.QUALIFY_MAX_TOKENS || 2500);
const KEYS = { openrouter: process.env.OPENROUTER_API_KEY, nvidia: process.env.NVIDIA_API_KEY };
const URLS = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
};

// nvidia/nemotron-3-super-120b-a12b:free was dropped after a first pass: it
// produced 15/15 unparseable plans against the production prompt (despite
// handling a toy JSON prompt fine) and returned intermittent upstream 404s.
// nvidia/nemotron-3-ultra-550b-a55b:free was also dropped: 7/15 with five
// unparseable plans against the production prompt, i.e. it fails exactly when
// a fallback would be needed.
const CANDIDATES = (process.env.QUALIFY_ONLY
  ? process.env.QUALIFY_ONLY.split(',').map((s) => s.split('|'))
  : [
    ['nvidia', 'minimaxai/minimax-m3'],
    ['nvidia', 'deepseek-ai/deepseek-v4-pro-0813'],
    ['openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free'],
  ]);

const CAPABILITIES = ['hotel_facts', 'hotel_services', 'external_search', 'guest_request', 'human_takeover'];
const h = (role, message) => ({ role, message });

// Each case: the guest turn, the conversation it lands in, and the fields a
// correct plan must have. Chosen to cover the routing decisions that actually
// change guest-visible behaviour, including the two regression areas this
// product has repeatedly broken on: negation/topic-reset and multi-intent.
const CASES = [
  { id: 'book-direct', message: 'I would like to book the couples massage for Saturday.', history: [],
    expect: { interactionType: ['booking_request', 'guest_request'], category: 'spa' } },
  { id: 'faq-facts', message: 'What time is breakfast served?', history: [],
    expect: { interactionType: ['hotel_facts', 'conversation', 'hotel_service'] } },
  { id: 'complaint', message: 'This is completely unacceptable, my room is filthy.', history: [],
    expect: { interactionType: ['complaint'], needsHuman: true } },
  { id: 'operational', message: 'Can I get extra towels please?', history: [],
    expect: { interactionType: ['operational_request', 'guest_request'], category: 'housekeeping' } },
  { id: 'external', message: 'Can you recommend a good Italian restaurant near the hotel, not in the hotel?', history: [],
    expect: { interactionType: ['external_discovery'], external: true } },
  { id: 'followup-vague', message: 'What do you suggest?',
    history: [h('user', 'Tell me about the spa.'), h('assistant', 'We offer the Signature Hammam Ritual and a Couples Massage.')],
    expect: { interactionType: ['hotel_service', 'conversation'], category: 'spa' } },
  { id: 'negation-reset', message: 'Actually forget the spa idea, what about dinner?',
    history: [h('user', 'Tell me about the spa.'), h('assistant', 'We offer the Signature Hammam Ritual and a Couples Massage.')],
    expect: { interactionType: ['hotel_service', 'conversation'], category: 'restaurant' } },
  { id: 'reject-option', message: 'No, not that one. The Versailles one.',
    history: [h('user', 'I was thinking about a day trip.'), h('assistant', 'The VIP Louvre After-Hours Private Tour is available.')],
    expect: { interactionType: ['hotel_service', 'booking_request'], category: ['tour', 'experience'] } },
  { id: 'multi-intent', message: 'What time is breakfast, and can you book me a massage for 3pm?', history: [],
    expect: { interactionType: ['booking_request', 'guest_request', 'hotel_service', 'hotel_facts'] } },
  { id: 'cancel', message: 'Actually cancel the massage, I do not want it anymore.',
    history: [h('user', 'Book the couples massage.'), h('assistant', 'I have recorded your request for the Couples Massage.')],
    expect: { interactionType: ['cancellation', 'guest_request', 'conversation'] } },
  { id: 'smalltalk', message: 'How are you today?', history: [],
    expect: { interactionType: ['conversation'] } },
  { id: 'fabrication-trap', message: 'Book the Eiffel Tower sunset helicopter tour.', history: [],
    expect: { interactionType: ['booking_request', 'guest_request', 'external_discovery', 'conversation', 'clarification'] } },
  { id: 'fr', message: 'Je voudrais réserver un massage pour deux personnes.', history: [], language: 'fr',
    expect: { interactionType: ['booking_request', 'guest_request', 'hotel_service'], category: 'spa', language: 'fr' } },
  { id: 'es', message: '¿Cuánto cuesta la cena en la azotea?', history: [], language: 'es',
    expect: { interactionType: ['hotel_service', 'hotel_facts', 'hotel_catalogue', 'conversation'], language: 'es' } },
  { id: 'typo', message: 'i wnat to bok teh masage plz', history: [],
    expect: { interactionType: ['booking_request', 'guest_request', 'hotel_service'], category: 'spa' } },
];

const asList = (v) => (Array.isArray(v) ? v : [v]);

function scoreCase(plan, expect) {
  const misses = [];
  if (!plan.valid) return ['plan_invalid'];
  if (expect.interactionType && !asList(expect.interactionType).includes(plan.interactionType)) {
    misses.push(`interactionType=${plan.interactionType}`);
  }
  if (expect.category) {
    const got = plan.serviceCategory || null;
    if (!asList(expect.category).includes(got)) misses.push(`category=${got}`);
  }
  if (expect.needsHuman && !plan.toolNeeds?.humanTakeover && !plan.needsHuman) misses.push('needsHuman=false');
  if (expect.external && !plan.toolNeeds?.externalSearch) misses.push('externalSearch=false');
  if (expect.language && plan.language && plan.language !== expect.language) misses.push(`language=${plan.language}`);
  return misses;
}

// Free tiers rate-limit aggressively (NVIDIA 429s after ~2 rapid calls). Retry
// with backoff so the score measures the MODEL's ability, not the provider's
// throttle. A 429 that survives every retry is reported separately as a
// capacity finding rather than being scored as a wrong answer.
async function callModel(provider, model, prompt) {
  let wait = 6000;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(URLS[provider], {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEYS[provider]}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: MAX_TOKENS, temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (res.ok) {
      const json = await res.json();
      return json?.choices?.[0]?.message?.content ?? '';
    }
    const body = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 4) throw new Error(`HTTP ${res.status}: ${body.slice(0, 90)}`);
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 45000);
  }
  throw new Error('unreachable');
}

const report = { generatedAt: new Date().toISOString(), candidates: [] };

for (const [provider, model] of CANDIDATES) {
  if (!KEYS[provider]) { console.log(`\n### ${provider} / ${model} -- no API key, skipped`); continue; }
  console.log(`\n### ${provider} / ${model}`);
  const rows = [];
  let pass = 0;
  let hardFail = 0;

  for (const c of CASES) {
    const input = { message: c.message, language: c.language || 'en' };
    const prompt = buildSemanticControllerPrompt({ input, history: c.history, context: {}, capabilities: CAPABILITIES });
    let misses = ['no_response'];
    let err = null;
    try {
      const raw = await callModel(provider, model, prompt);
      const plan = parseSemanticControllerOutput(raw, { language: input.language });
      misses = scoreCase(plan, c.expect);
      if (!plan.valid) hardFail += 1;
    } catch (e) { err = String(e.message).slice(0, 110); misses = ['error']; hardFail += 1; }

    const ok = !err && misses.length === 0;
    if (ok) pass += 1;
    rows.push({ id: c.id, ok, misses, err });
    console.log(`  ${ok ? 'ok  ' : 'MISS'} ${c.id.padEnd(17)} ${err ? err : misses.join(' ')}`);
    await new Promise((r) => setTimeout(r, Number(process.env.QUALIFY_GAP_MS || 8000)));
  }

  const rate = pass / CASES.length;
  report.candidates.push({ provider, model, pass, total: CASES.length, rate, hardFail, rows });
  console.log(`  --> ${pass}/${CASES.length} (${(rate * 100).toFixed(0)}%), unparseable plans: ${hardFail}`);
}

writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('\n================ SUMMARY ================');
for (const c of report.candidates.sort((a, b) => b.rate - a.rate)) {
  console.log(`${String((c.rate * 100).toFixed(0)).padStart(3)}%  ${c.pass}/${c.total}  invalid=${c.hardFail}  ${c.provider}/${c.model}`);
}
console.log(`\nsaved: ${OUT}`);
