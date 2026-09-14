import assert from 'node:assert/strict';
import test from 'node:test';
import { searchParisDirectory } from '../src/tools/external-search/directory.js';
import { runExternalSearch } from '../src/tools/external-search/index.js';

const names = (query) => searchParisDirectory({ query }).map((item) => item.name);

test('the directory answers a covered request without calling live search', async () => {
  let liveCalls = 0;
  const result = await runExternalSearch({
    input: { query: 'Any good cocktail bar for tonight?', category: 'experience' },
    env: { PARIS_DIRECTORY: 'on', SCRAPINGBEE_API_KEY: 'k' },
    providers: { scrapingbee: async () => { liveCalls += 1; return { provider: 'scrapingbee', status: 'success', payload: {} }; } },
  });
  assert.equal(result.status, 'success');
  assert.equal(result.meta.provider_used, 'paris_directory');
  assert.equal(liveCalls, 0);
  assert.ok(result.data.results.every((item) => item.name && item.website_url));
});

test('live search still runs when the directory has nothing that fits', async () => {
  let liveCalls = 0;
  await runExternalSearch({
    input: { query: 'A Peruvian restaurant in Montmartre', category: 'restaurant' },
    env: { PARIS_DIRECTORY: 'on', SCRAPINGBEE_API_KEY: 'k' },
    providers: { scrapingbee: async () => { liveCalls += 1; return { provider: 'scrapingbee', status: 'success', payload: {} }; } },
  });
  assert.equal(liveCalls, 1);
});

test('a named cuisine or place is never swapped for a generic list', () => {
  assert.deepEqual(names('A Peruvian restaurant please'), []);
  assert.deepEqual(names('Korean food nearby'), []);
  const marais = searchParisDirectory({ query: 'romantic dinner in Le Marais' });
  assert.ok(marais.length > 0);
  assert.ok(marais.every((item) => /7500[34]/.test(item.address)), 'Marais results stay in the 3rd/4th');
});

test('a neighbourhood that sounds like a venue type does not change the request', () => {
  const italianNearOpera = searchParisDirectory({ query: 'Italian near the Opera' });
  assert.ok(italianNearOpera.length > 0);
  assert.ok(italianNearOpera.every((item) => !/opera|ballet/i.test(item.name)));
});

test('directory results never carry unverified phone numbers, hours or prices', () => {
  for (const item of searchParisDirectory({ query: 'best cocktail bar' })) {
    assert.equal(JSON.stringify(item).match(/\+33|\d{1,2}:\d{2}/), null);
  }
});

test('a named place inside a broad group returns only that place', () => {
  const versailles = searchParisDirectory({ query: 'a day trip to Versailles' });
  assert.ok(versailles.length > 0);
  assert.ok(versailles.every((item) => /versailles/i.test(`${item.name} ${item.description}`)));
  // "Louvre" is a museum on its own, but only a location next to "dinner".
  assert.ok(searchParisDirectory({ query: 'dinner near the Louvre' }).every((item) => !/mus[eé]e/i.test(item.name)));
});

test('"world class museums" finds museums with a museum photo, not cooking classes', () => {
  // Live demo: "yes world class musuems works good" returned five cooking
  // schools under a restaurant photo -- "class" matched, "museums" did not.
  const results = searchParisDirectory({ query: 'yes world class musuems works good', searchQuery: 'world-class museums in Paris' });
  assert.ok(results.length > 0);
  assert.ok(results.every((item) => /mus[eé]e|museum|centre pompidou|louvre|gallery/i.test(`${item.name} ${item.description}`)), results.map((item) => item.name).join(', '));
  assert.ok(results.every((item) => item.imageUrl && !item.imageUrl.includes('1414235077428')), 'museum cards must not carry the restaurant photo');
});
