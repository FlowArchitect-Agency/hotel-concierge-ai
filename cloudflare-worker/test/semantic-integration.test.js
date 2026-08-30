import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';

const origin = 'https://flowarchitect-agency.github.io';
const env = {
  GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', SCRAPINGBEE_API_KEY: 'unavailable-test-key',
  HOTEL_NAME: 'Hôtel Lumière Paris', HOTEL_CITY: 'Paris',
};
const services = [
  { fields: { Name: 'Lumière Spa — Couples Massage', Category: 'spa', IsPartner: true, Active: true, Description: 'A private couples massage.', PriceEUR: 220, DurationMins: 90 } },
  { fields: { Name: "Le Jardin — Chef's Table", Category: 'restaurant', IsPartner: true, Active: true, Description: 'An intimate dinner.', PriceEUR: 320, DurationMins: 150 } },
];

function controllerPlan(overrides = {}) {
  return {
    interaction_type: 'conversation', guest_goal: 'continue the current discussion', context_summary: 'Use the recent guest context.',
    service_category: null, reference_target: 'previous_question', needs_hotel_facts: false, needs_hotel_services: false,
    needs_external_search: false, needs_guest_request: false, needs_human: false, language: 'en', confidence: 0.94,
    clarification_needed: false, clarification_reason: '', topic_changed: false, ...overrides,
  };
}

async function readOnlyChat({ message, history = [], plan, reply = 'I can help with that in a way that fits the conversation.', onPrompt = () => undefined }) {
  const originalFetch = globalThis.fetch;
  let controllerCalls = 0;
  let responseCalls = 0;
  let searchCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/Services')) return Response.json({ records: services });
    if (target.includes('/Settings')) return Response.json({ records: [] });
    if (target.includes('api.groq.com')) {
      const prompt = JSON.parse(options.body).messages?.[0]?.content || '';
      onPrompt(prompt);
      if (/semantic conversation controller/i.test(prompt)) {
        controllerCalls += 1;
        return Response.json({ choices: [{ message: { content: JSON.stringify(plan) } }] });
      }
      responseCalls += 1;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ reply_text: reply, intent: 'other', service_type: 'Concierge', requests: [], requires_human: false }) } }] });
    }
    if (target.includes('scrapingbee')) {
      searchCalls += 1;
      return Response.json({ organic_results: [] });
    }
    throw new Error(`Unexpected network request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId: `semantic_${Math.random().toString(36).slice(2)}`, chatHistory: history, testMode: 'read_only', testRunId: 'semantic_integration' }),
    }), env, { waitUntil() { throw new Error('read-only semantic test scheduled a write'); } });
    return { response, body: await response.json(), controllerCalls, responseCalls, searchCalls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('controller resolves a first-time-Paris answer from previous assistant context', async () => {
  let sawPreviousQuestion = false;
  const result = await readOnlyChat({
    message: 'No, why?',
    history: [{ role: 'assistant', message: 'Is this your first time in Paris?' }],
    plan: controllerPlan({ context_summary: 'The guest says this is not their first time and asks why the question was asked.' }),
    reply: 'Only so I can tailor the ideas to someone who already knows Paris. Would you prefer something quieter, more local, or celebratory?',
    onPrompt: (prompt) => { sawPreviousQuestion ||= /IMMEDIATELY PREVIOUS ASSISTANT MESSAGE:[\s\S]*first time in Paris/i.test(prompt); },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.controllerCalls, 1);
  assert.equal(result.responseCalls, 1);
  assert.equal(result.searchCalls, 0);
  assert.equal(sawPreviousQuestion, true);
  assert.match(result.body.reply, /tailor|already knows Paris/i);
});

test('controller keeps a vague spa follow-up hotel-first without external discovery', async () => {
  const result = await readOnlyChat({
    message: 'What would you suggest if we want something quieter?',
    history: [{ role: 'assistant', message: 'Our spa has a couples massage and a hammam ritual.' }],
    plan: controllerPlan({ interaction_type: 'hotel_service', service_category: 'spa', reference_target: 'previous_service', needs_hotel_services: true, context_summary: 'The guest is refining the spa discussion.' }),
    reply: 'For a quieter moment, the couples massage would be a lovely place to begin. Shall I prepare a request for the concierge team?',
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.searchCalls, 0);
  assert.equal(result.body.intent, 'partner_request');
  assert.equal(result.body.partner_offers[0].name, 'Lumière Spa — Couples Massage');
});

test('external-search failure is passed to response generation without a hotel substitution', async () => {
  const result = await readOnlyChat({
    message: 'Actually forget that — what can we do at 2 a.m.?',
    history: [{ role: 'assistant', message: 'I can arrange a couples massage this evening.' }],
    plan: controllerPlan({ interaction_type: 'external_discovery', service_category: 'itinerary', reference_target: 'topic_reset', needs_external_search: true, topic_changed: true, context_summary: 'The guest has changed topic and needs live late-night Paris information.' }),
    reply: 'I cannot verify live late-night options at the moment, but if you tell me your neighbourhood I can help narrow the kind of place to look for.',
  });
  assert.equal(result.response.status, 200);
  assert.ok(result.searchCalls >= 1);
  assert.equal(result.body.recommendations.length, 0);
  assert.equal(result.body.partner_offers.length, 0);
  assert.doesNotMatch(result.body.reply, /Couples Massage|Partner option/i);
  assert.match(result.body.reply, /cannot verify live late-night options/i);
});
