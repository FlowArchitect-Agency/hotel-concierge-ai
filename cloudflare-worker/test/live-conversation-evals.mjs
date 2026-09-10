/**
 * Safe live conversational evaluation. It uses the configured Groq model and
 * real read-only catalogue/facts reads, but every Worker turn is explicitly
 * testMode: read_only and rejects any attempted waitUntil write.
 *
 * This script never invokes a public endpoint, WhatsApp, booking, or enquiry
 * route. It is deliberately excluded from npm test because it spends model
 * and search-provider credits.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const origin = 'https://flowarchitect-agency.github.io';

function loadPrivateEnv() {
  const values = {};
  for (const line of fs.readFileSync(path.join(projectRoot, '.env'), 'utf8').split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  for (const key of ['GROQ_API_KEY', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID']) {
    assert.ok(values[key] && !/^(your_|replace-with)/i.test(values[key]), `${key} is required in private local configuration.`);
  }
  return {
    ...values,
    ALLOWED_ORIGIN: origin,
    HOTEL_CITY: values.HOTEL_CITY || 'Paris',
    HOTEL_NAME: values.HOTEL_NAME || 'Hôtel Lumière Paris',
    GROQ_MODEL: values.GROQ_MODEL || 'qwen/qwen3.6-27b',
    GROQ_FALLBACK_MODEL: values.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b',
  };
}

const env = loadPrivateEnv();
console.log('Starting safe live conversation evaluation…');
const originalFetch = globalThis.fetch;
let groqCalls = 0;
let searchCalls = 0;
let lastGroqRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

globalThis.fetch = async (input, init) => {
  const target = String(input);
  if (target.includes('api.groq.com/openai/v1/chat/completions')) {
    // Keep this evaluator below the configured account's token-per-minute
    // ceiling. This is test-only pacing; production request behavior is not
    // altered. A retry repeats the identical read-only model request.
    const sincePrevious = Date.now() - lastGroqRequestAt;
    if (sincePrevious < 9_000) await sleep(9_000 - sincePrevious);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      groqCalls += 1;
      lastGroqRequestAt = Date.now();
      const response = await originalFetch(input, init);
      if (response.status !== 429 || attempt === 2) return response;
      const message = await response.clone().text();
      const retrySeconds = Number(message.match(/try again in\s+([\d.]+)s/i)?.[1]);
      await sleep((Number.isFinite(retrySeconds) ? retrySeconds * 1_000 : 9_000) + 800);
    }
  }
  if (target.includes('app.scrapingbee.com')) searchCalls += 1;
  return originalFetch(input, init);
};

function readOnlyContext() {
  return {
    waitUntil() {
      throw new Error('Live read-only evaluation attempted to schedule a write.');
    },
  };
}

function noFalseConfirmation(reply) {
  return !/\b(?:booking is confirmed|availability is confirmed|your booking is confirmed)\b/i.test(String(reply || ''));
}

function hasBadFallback(reply) {
  return /could not verify a current match|whenever you are ready|failed to fetch|system delay/i.test(String(reply || ''));
}

async function sendTurn(message, history, sessionId) {
  const response = await worker.fetch(new Request('https://worker.local/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      message,
      sessionId,
      scenario: 'pre-arrival',
      chatHistory: history,
      testMode: 'read_only',
      testRunId: 'live_conversation_eval',
    }),
  }), env, readOnlyContext());
  return { response, body: await response.json() };
}

const scenarios = [
  {
    name: 'exact returning-visitor regression',
    turns: [
      { message: 'View Services', catalogue: true },
      { assistantOnly: 'By the way, is this your first time in Paris?' },
      { message: 'No, why?', reply: /tailor|already know Paris|first-time sights/i },
      { message: 'What?', reply: /returning guest|first-time sights|hotel experience/i },
      { message: 'What do you suggest?', reply: /wellness|dinner|Paris experience/i, noSearch: true },
    ],
  },
  {
    name: 'romantic hotel follow-up uses the live model',
    turns: [
      { message: 'View Services', catalogue: true },
      { message: 'What about something romantic?', model: true, hotel: true, noSearch: true },
    ],
  },
  {
    name: 'quiet artistic evening stays hotel-first',
    turns: [
      { message: 'View Services', catalogue: true },
      { message: 'I would love a quiet, artistic Paris evening.', model: true, hotel: true, noSearch: true },
    ],
  },
  {
    name: 'celebratory choice remains coherent after catalogue',
    turns: [
      { message: 'View Services', catalogue: true },
      { message: 'Could you help me choose something celebratory?', model: true, hotel: true, noSearch: true },
    ],
  },
  {
    name: 'French hotel-context recommendation',
    turns: [
      { message: 'Montrez-moi les services de l’hôtel.', catalogue: true, language: 'fr' },
      { message: 'Je voudrais quelque chose de romantique.', model: true, hotel: true, noSearch: true, language: 'fr' },
    ],
  },
  {
    name: 'Spanish hotel-context recommendation',
    turns: [
      { message: 'Muéstrame los servicios del hotel.', catalogue: true, language: 'es' },
      { message: 'Me gustaría algo especial y tranquilo.', model: true, hotel: true, noSearch: true, language: 'es' },
    ],
  },
  {
    name: 'last-day request deliberately searches current Paris options',
    turns: [
      { message: 'Hello', reply: /welcome|assist/i },
      { message: 'What do you suggest for my last day in Paris?', model: true, search: true },
    ],
  },
  {
    name: 'jazz bar is clearly external discovery',
    turns: [
      { message: 'Good evening', reply: /welcome|assist/i },
      { message: 'Find me a jazz bar tonight.', model: true, search: true },
    ],
  },
  {
    name: 'external cuisine request retains its constraint',
    turns: [
      // These are deliberately deterministic: a direct request should not
      // need a model call before the Worker can protect its location/cuisine
      // constraint and start a verified external search.
      { message: 'I would like an Italian restaurant near the Eiffel Tower.', hotel: true },
      { message: 'No, please look outside the hotel for Italian food near the Eiffel Tower.', search: true },
    ],
  },
  {
    name: 'unstructured preference remains a hotel conversation',
    turns: [
      { message: 'View Services', catalogue: true },
      { message: 'We want the evening to feel considered, not formulaic. What would you suggest?', model: true, hotel: true, noSearch: true },
    ],
  },
  {
    name: 'thoughtful preference is model-backed and hotel-first',
    turns: [
      { message: 'View Services', catalogue: true },
      { message: 'Before we decide, could you help us weigh something quiet against something celebratory?', model: true, hotel: true, noSearch: true },
    ],
  },
  {
    name: 'proposal idea uses verified hotel collection before discovery',
    turns: [
      { message: 'View Services', catalogue: true },
      // Proposal is a recognised hotel-experience category, so the direct
      // verified-card response is intentionally deterministic.
      { message: 'I am planning a proposal and want it to feel intimate.', hotel: true, noSearch: true },
    ],
  },
  {
    name: 'open-ended shared-moment preference is model-backed and hotel-first',
    turns: [
      { message: 'View Services', catalogue: true },
      { message: 'Our plans are flexible, but we would like one gracious moment together. Where would you start?', model: true, hotel: true, noSearch: true },
    ],
  },
];

const results = [];
try {
  for (const [index, scenario] of scenarios.entries()) {
    console.log(`Evaluating ${index + 1}/${scenarios.length}: ${scenario.name}`);
    const history = [];
    const turns = [];
    for (const turn of scenario.turns) {
      if (turn.assistantOnly) {
        history.push({ role: 'assistant', message: turn.assistantOnly });
        continue;
      }
      const groqBefore = groqCalls;
      const searchBefore = searchCalls;
      const { response, body } = await sendTurn(turn.message, history, `live_conversation_eval_${Date.now()}_${index}`);
      const usedModel = groqCalls > groqBefore;
      const searched = searchCalls > searchBefore;
      assert.equal(response.status, 200, `${scenario.name}: ${turn.message} returned ${response.status}`);
      assert.ok(String(body.reply || '').trim().length >= 18, `${scenario.name}: response was too short to be useful`);
      assert.equal(body.provider_failure || '', '', `${scenario.name}: configured model/provider failed`);
      assert.ok(noFalseConfirmation(body.reply), `${scenario.name}: fabricated confirmation`);
      // A clear external request may honestly have no currently verifiable
      // result. That narrow case is not an unrelated fallback; it is safer
      // than inventing a venue. Every hotel-context turn still rejects it.
      const factualExternalNoMatch = Boolean(turn.search && searched && !(body.recommendations || []).length && /could not verify a current match/i.test(String(body.reply || '')));
      assert.equal(hasBadFallback(body.reply) && !factualExternalNoMatch, false, `${scenario.name}: unrelated fallback response`);
      if (turn.model) assert.equal(usedModel, true, `${scenario.name}: expected a live Groq call`);
      if (turn.search) assert.equal(searched, true, `${scenario.name}: expected current external discovery`);
      if (turn.noSearch) assert.equal(searched, false, `${scenario.name}: ambiguous hotel context triggered external discovery`);
      if (turn.catalogue) assert.ok((body.hotel_collection || []).length > 0, `${scenario.name}: expected verified hotel catalogue`);
      if (turn.hotel) assert.ok((body.partner_offers || []).length > 0, `${scenario.name}: expected verified hotel options`);
      if (turn.language) assert.equal(body.language, turn.language, `${scenario.name}: wrong response language`);
      if (turn.reply) assert.match(String(body.reply || ''), turn.reply, `${scenario.name}: response did not answer the guest`);
      history.push({ role: 'user', message: turn.message }, { role: 'assistant', message: body.reply });
      turns.push({ guest: turn.message, reply: body.reply, usedModel, searched, language: body.language });
    }
    results.push({ name: scenario.name, turns });
  }
  assert.ok(results.length >= 10, 'The live suite must cover at least 10 conversational scenarios.');
  assert.ok(groqCalls >= 10, 'The live suite must exercise at least 10 configured Groq calls.');
  const exact = results.find((result) => result.name === 'exact returning-visitor regression');
  assert.ok(exact?.turns.at(-1)?.reply && !/could not verify a current match/i.test(exact.turns.at(-1).reply));
  console.log(`LIVE MODEL SCENARIOS: ${results.length}/${scenarios.length} passed`);
  console.log(`LIVE MODEL CALLS: ${groqCalls}`);
  console.log('EXACT FAILED TRANSCRIPT:');
  for (const turn of exact.turns) console.log(`Guest: ${turn.guest}\nAssistant: ${turn.reply}\n`);
} finally {
  globalThis.fetch = originalFetch;
}
