import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';
import { classifyRequest } from '../src/concierge.js';

const origin = 'https://flowarchitect-agency.github.io';
const env = {
  GROQ_API_KEY: 'test',
  AIRTABLE_API_KEY: 'test',
  AIRTABLE_BASE_ID: 'test',
  SCRAPINGBEE_API_KEY: 'test',
  HOTEL_NAME: 'Hôtel Lumière Paris',
  HOTEL_CITY: 'Paris',
};

function readOnlyContext() {
  return {
    waitUntil() {
      throw new Error('A read-only conversation test must not schedule a write.');
    },
  };
}

async function chat({ message, chatHistory = [] }) {
  const response = await worker.fetch(new Request('https://worker.example/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      message,
      sessionId: 'qa_conversation_context',
      scenario: 'pre-arrival',
      chatHistory,
      testMode: 'read_only',
    }),
  }), env, readOnlyContext());
  return { response, body: await response.json() };
}

const firstTimeQuestion = 'By the way, is this your first time in Paris?';

test('No, why answers the first-time Paris question instead of declining assistance', async () => {
  const { response, body } = await chat({
    message: 'No, why?',
    chatHistory: [{ role: 'assistant', content: firstTimeQuestion }],
  });
  assert.equal(response.status, 200);
  assert.match(body.reply, /tailor|already know Paris|first-time sights/i);
  assert.doesNotMatch(body.reply, /whenever you are ready/i);
});

test('A plain No remains a returning-visitor answer when it follows the first-time question', async () => {
  const { body } = await chat({
    message: 'No',
    chatHistory: [{ role: 'assistant', content: firstTimeQuestion }],
  });
  assert.match(body.reply, /already know Paris|returning|first-time sights/i);
  assert.doesNotMatch(body.reply, /How may I assist you/i);
});

test('What do you suggest is not unconditionally classified as an itinerary', () => {
  const generic = classifyRequest('What do you suggest?');
  const finalDay = classifyRequest('What do you suggest for my last day in Paris?');
  assert.notEqual(generic.category, 'itinerary');
  assert.equal(finalDay.category, 'itinerary');
});

test('A spa follow-up stays with verified hotel options instead of triggering external discovery', async () => {
  const originalFetch = globalThis.fetch;
  let externalSearches = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/Services')) {
      return Response.json({ records: [{ fields: {
        Name: 'Lumière Spa — Couples Massage', Category: 'spa', IsPartner: true, Active: true,
        Description: 'A private couples massage.', PriceEUR: 220, DurationMins: 90,
      } }] });
    }
    if (target.includes('/Settings')) return Response.json({ records: [] });
    if (target.includes('scrapingbee')) {
      externalSearches += 1;
      return Response.json({ organic_results: [] });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const { response, body } = await chat({
      message: 'What do you suggest?',
      chatHistory: [{ role: 'user', content: 'I would like a couples massage.' }],
    });
    assert.equal(response.status, 200);
    assert.equal(externalSearches, 0);
    assert.equal(body.intent, 'partner_request');
    assert.equal(body.partner_offers.length, 1);
    assert.equal(body.partner_offers[0].name, 'Lumière Spa — Couples Massage');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('An explicit external jazz-bar request still uses external discovery', async () => {
  const originalFetch = globalThis.fetch;
  let externalSearches = 0;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/Services')) return Response.json({ records: [] });
    if (target.includes('/Settings')) return Response.json({ records: [] });
    if (target.includes('api.groq.com')) {
      const prompt = JSON.parse(options.body).messages?.[0]?.content || '';
      assert.match(prompt, /intent router/i);
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        route: 'external_discovery', category: 'experience', search_query: 'jazz bar Paris tonight official website',
      }) } }] });
    }
    if (target.includes('scrapingbee')) {
      externalSearches += 1;
      return Response.json({ organic_results: [{
        title: 'Blue Note Paris | Jazz bar',
        description: 'Live jazz in Paris tonight.',
        url: 'https://blue-note.example/paris',
      }] });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const { response, body } = await chat({ message: 'Find me a jazz bar tonight.' });
    assert.equal(response.status, 200);
    assert.equal(externalSearches, 1);
    assert.equal(body.recommendations.length, 1);
    assert.equal(body.recommendations[0].name, 'Blue Note Paris | Jazz bar');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
