import assert from 'node:assert/strict';
import test from 'node:test';
import { runExternalSearch } from '../src/tools/external-search/index.js';
import { runGuestRequest } from '../src/tools/guest-request.js';
import { runHotelFacts } from '../src/tools/hotel-facts.js';
import { runHotelServices } from '../src/tools/hotel-services.js';
import { runHumanTakeover } from '../src/tools/human-takeover.js';
import { createToolExecutor } from '../src/tools/index.js';
import { searchScrapingBee } from '../src/tools/external-search/providers/scrapingbee.js';

const facts = {
  hotelName: 'Hôtel Lumière Paris',
  text: '- Check-in: 15:00\n- Breakfast: 07:00–10:30',
  entries: [{ key: 'Check-in', value: '15:00' }, { key: 'Breakfast hours', value: '07:00–10:30' }],
};
const records = [
  { fields: { Name: 'Couples Massage', Category: 'spa', Active: true, IsPartner: true, PriceEUR: 220, Description: 'Private treatment', ImageURL: 'https://hotel.example/spa.jpg' } },
  { fields: { Name: 'Hammam Ritual', Category: 'spa', Active: true, IsPartner: true, PriceEUR: 180, Description: 'Wellness ritual' } },
  { fields: { Name: 'Le Jardin', Category: 'restaurant', Active: true, IsPartner: true, PriceEUR: 320, Description: 'French restaurant' } },
];

test('hotel_facts returns verified matching data and explicit missing/source failures', async () => {
  const found = await runHotelFacts({ input: { category: 'breakfast' }, source: facts });
  assert.equal(found.status, 'success');
  assert.deepEqual(found.data.facts, [{ key: 'Breakfast hours', value: '07:00–10:30' }]);
  assert.equal((await runHotelFacts({ input: { category: 'parking' }, source: facts })).status, 'not_found');
  assert.equal((await runHotelFacts({ input: { category: 'general' }, source: null })).status, 'unavailable');
});

test('hotel_services filters verified catalogues without inventing service fields', async () => {
  const spa = await runHotelServices({ input: { categories: ['spa'] }, records });
  assert.equal(spa.status, 'success');
  assert.equal(spa.data.services.length, 2);
  assert.equal(spa.data.services[0].price_eur, 220);
  assert.equal(spa.data.services[0].image_url, 'https://hotel.example/spa.jpg');
  assert.equal((await runHotelServices({ input: { categories: ['transport'] }, records })).status, 'no_results');
  assert.equal((await runHotelServices({ input: { categories: ['spa'] }, records: null })).status, 'unavailable');
});

test('ScrapingBee adapter normalizes auth, timeout, and malformed provider failures without leaking details', async () => {
  const auth = await searchScrapingBee({ env: { SCRAPINGBEE_API_KEY: 'redacted' }, query: 'jazz', fetchImpl: async () => new Response('', { status: 401 }) });
  assert.deepEqual({ status: auth.status, code: auth.error_code }, { status: 'unavailable', code: 'provider_auth_or_quota' });
  const malformed = await searchScrapingBee({ env: { SCRAPINGBEE_API_KEY: 'redacted' }, query: 'jazz', fetchImpl: async () => new Response('not-json') });
  assert.deepEqual({ status: malformed.status, code: malformed.error_code }, { status: 'error', code: 'provider_malformed_response' });
  const timedOut = await searchScrapingBee({ env: { SCRAPINGBEE_API_KEY: 'redacted' }, query: 'jazz', fetchImpl: async () => { const error = new Error('no connection'); error.name = 'AbortError'; throw error; } });
  assert.deepEqual({ status: timedOut.status, code: timedOut.error_code }, { status: 'error', code: 'provider_timeout' });
});

test('external_search verifies relevance, removes duplicates, preserves cuisine and can fall back', async () => {
  const payload = {
    organic_results: [
      { title: 'Bombay Palace', description: 'Indian restaurant in Paris with classic Indian cuisine.', url: 'https://bombay.example/' },
      { title: 'Bombay Palace', description: 'Indian restaurant duplicate.', url: 'https://bombay.example/menu' },
      { title: 'Generic Paris directory', description: 'Find the best Indian restaurants', url: 'https://tripadvisor.example/indian' },
      { title: 'Le Jardin', description: 'French restaurant in Paris', url: 'https://lejardin.example/' },
    ],
  };
  const unavailable = async () => ({ provider: 'primary', status: 'unavailable', error_code: 'provider_auth_or_quota', payload: null });
  const fallback = async () => ({ provider: 'fallback', status: 'success', error_code: null, payload });
  const result = await runExternalSearch({
    input: { query: 'Indian restaurant in Paris', category: 'restaurant', language: 'en', location: 'Paris', constraints: ['cuisine'] },
    env: { EXTERNAL_SEARCH_PROVIDER: 'primary', EXTERNAL_SEARCH_FALLBACK_PROVIDER: 'fallback' },
    context: { city: 'Paris', classification: { category: 'restaurant', cuisine: { label: 'Indian', words: ['indian'] } } },
    providers: { primary: unavailable, fallback },
  });
  assert.equal(result.status, 'success');
  assert.equal(result.meta.fallback_used, true);
  assert.equal(result.data.results.length, 1);
  assert.equal(result.data.results[0].name, 'Bombay Palace');
  assert.equal(result.data.results[0].source_provider, 'fallback');
  assert.equal(result.data.results[0].verified, true);
  const empty = await runExternalSearch({
    input: { query: 'jazz', category: 'experience', language: 'en', location: '', constraints: [] },
    env: { EXTERNAL_SEARCH_PROVIDER: 'empty' }, context: { city: 'Paris', classification: { category: 'experience' } },
    providers: { empty: async () => ({ provider: 'empty', status: 'success', payload: { organic_results: [] } }) },
  });
  assert.equal(empty.status, 'no_results');
});

test('guest_request is truthful in valid, invalid, read-only, success and backend-failure paths', async () => {
  let creates = 0;
  const executor = createToolExecutor({ mode: 'read_only' });
  const [invalid, readOnly] = await executor.execute([
    { tool: 'guest_request', input: { type: 'Other', summary: 'not allowed' } },
    { tool: 'guest_request', input: { type: 'Maintenance', summary: 'Room is cold', party_size: 2 } },
  ]);
  assert.equal(invalid.status, 'invalid');
  assert.equal(readOnly.status, 'read_only');
  assert.equal(creates, 0);
  const success = await runGuestRequest({ input: { type: 'Maintenance', summary: 'Room is cold' }, create: async () => { creates += 1; return { id: 'req_1' }; } });
  assert.equal(success.status, 'success');
  assert.equal(success.data.request_id, 'req_1');
  const failure = await runGuestRequest({ input: { type: 'Maintenance', summary: 'Room is cold' }, create: async () => { throw new Error('database unavailable'); } });
  assert.equal(failure.status, 'error');
  assert.equal(failure.error_code, 'request_write_failed');
});

test('human_takeover preserves staff ownership and is truthful in read-only and failure states', async () => {
  assert.equal((await runHumanTakeover({ input: { reason: 'Guest asks for a person' }, conversationOwner: 'staff' })).status, 'success');
  assert.equal((await runHumanTakeover({ input: { reason: 'Guest asks for a person' }, mode: 'read_only' })).status, 'read_only');
  assert.equal((await runHumanTakeover({ input: { reason: 'Sensitive complaint' }, takeOver: async () => ({ owner: 'ai' }) })).error_code, 'handoff_unconfirmed');
});
