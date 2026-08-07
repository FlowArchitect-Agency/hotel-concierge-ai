import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRequest,
  enforceContract,
  inheritConversationContext,
  matchingServices,
  parseExternalResults,
  parseGuestInput,
  shouldSearchExternal,
} from '../src/concierge.js';
import worker from '../src/index.js';

const records = [
  { fields: { Name: 'Le Jardin \u2014 Chef\u2019s Table', Category: 'restaurant', Description: 'French tasting menu', Active: true, IsPartner: true, PriceEUR: 580 } },
  { fields: { Name: 'Lumi\u00e8re Spa \u2014 Couples Massage', Category: 'spa', Description: 'Side-by-side treatment', Active: true, IsPartner: true, PriceEUR: 420, DurationMins: 75 } },
];

test('Indian cuisine remains a hard constraint across the reported follow-ups', () => {
  for (const message of [
    'okay what about indian restaurant ?',
    'but is it indian ?',
    'no im looking for an indian restaurant',
  ]) {
    const classification = classifyRequest(message);
    const services = matchingServices(records, classification);
    assert.equal(classification.cuisine.id, 'indian');
    assert.equal(services.matching.length, 0);
    assert.equal(services.excluded[0].name, 'Le Jardin \u2014 Chef\u2019s Table');
    const result = enforceContract(
      { reply: 'Le Jardin \u2014 Chef\u2019s Table is perfect.', intent: 'service_request', requests: [{ serviceName: 'Le Jardin \u2014 Chef\u2019s Table' }] },
      { language: 'en', classification, matching: services.matching, excluded: services.excluded, externalOptions: [] },
    );
    assert.match(result.reply, /could not verify a current match/i);
    assert.doesNotMatch(result.reply, /Le Jardin/i);
    assert.equal(result.requests.length, 0);
  }
});

test('Any named cuisine becomes a hard external-search constraint and carries through a photo follow-up', () => {
  const spanish = classifyRequest('I am looking for fancy Spanish restaurants near the Eiffel Tower');
  const malagasy = classifyRequest('Please find a Madagascar restaurant in Paris');
  assert.equal(spanish.cuisine.label, 'Spanish');
  assert.equal(spanish.category, 'restaurant');
  assert.equal(spanish.location, 'Eiffel Tower');
  assert.equal(malagasy.cuisine.label, 'Madagascar');
  assert.equal(matchingServices(records, spanish).matching.length, 0);

  const photoFollowUp = inheritConversationContext(
    classifyRequest('Can you attach pictures so I can see it?'),
    [{ role: 'user', message: 'I am looking for fancy Spanish restaurants near the Eiffel Tower' }],
    'Can you attach pictures so I can see it?',
  );
  assert.equal(photoFollowUp.cuisine.label, 'Spanish');
  assert.equal(photoFollowUp.location, 'Eiffel Tower');
});

test('A final-day request is a web-search itinerary intent, including a terse follow-up', () => {
  const finalDay = classifyRequest('What do you suggest for me? It is my last day in Paris.');
  assert.equal(finalDay.category, 'itinerary');
  assert.equal(finalDay.hasIntent, true);
  assert.equal(shouldSearchExternal(finalDay, []), true);

  const followUp = inheritConversationContext(
    classifyRequest('No, I need a suggestion from you.'),
    [{ role: 'user', message: 'What do you suggest for me? It is my last day in Paris.' }],
    'No, I need a suggestion from you.',
  );
  assert.equal(followUp.category, 'itinerary');
  assert.equal(followUp.hasIntent, true);
});

test('Itinerary cards accept direct attraction pages without restaurant-only rules', () => {
  const classification = classifyRequest('What do you suggest for my last day in Paris?');
  const options = parseExternalResults({ organic_results: [
    { title: "Musee d'Orsay - Paris", description: 'Official museum website in Paris, with visitor information and current exhibitions.', url: 'https://www.musee-orsay.fr/en' },
    { title: 'A Seine cruise in Paris', description: 'Discover Paris from the Seine with an official sightseeing cruise and evening departures.', url: 'https://www.bateaux-mouches.fr/en' },
  ] }, classification);
  assert.equal(options.length, 2);
  assert.ok(options.every((option) => option.websiteUrl && option.imageUrl));
});

test('French search snippets still prove an English Spanish-cuisine request', () => {
  const classification = classifyRequest('Find a Spanish restaurant near the Eiffel Tower');
  const options = parseExternalResults({ organic_results: [
    { title: 'Specialite espagnole a Paris 7e', description: 'Au Derrick Catalan est un restaurant qui permet de decouvrir une specialite espagnole.', url: 'https://www.auderrickcatalan.fr/' },
  ] }, classification);
  assert.equal(options.length, 1);
});

test('External options must prove the requested cuisine', () => {
  const classification = classifyRequest('Find an Indian restaurant');
  const options = parseExternalResults({
    local_results: [
      { title: 'The Dubliner', description: 'Irish pub in Paris' },
      { title: 'Delhi Bazaar', description: 'Indian restaurant in Paris', website: 'https://delhi-bazaar.example' },
    ],
    organic_results: [
      { title: 'Les meilleurs restaurants indiens \u00e0 Paris', description: 'A directory of Indian restaurants', url: 'https://www.timeout.fr/paris/restaurant/indien' },
      { title: 'Restaurant indien \u00e0 Paris', description: 'Bienvenue au Mayfair Garden, restaurant gastronomique indien \u00e0 Paris.', url: 'https://mayfairgarden-paris.fr/fr' },
    ],
  }, classification);
  assert.deepEqual(options.map((option) => option.name), ['Delhi Bazaar', 'Mayfair Garden']);
  assert.deepEqual(Object.keys(options[0]).filter((key) => ['name', 'description', 'websiteUrl', 'imageUrl'].includes(key)), ['name', 'description', 'websiteUrl', 'imageUrl']);
  assert.equal(options[0].websiteUrl, 'https://delhi-bazaar.example/');
});

test('External search excludes generic collections and unrelated pages even when they mention a cuisine', () => {
  const classification = classifyRequest('I need the best Italian restaurant in Paris');
  const options = parseExternalResults({ organic_results: [
    { title: 'Mission Locale de Paris - Accueil', description: 'Italian language support for young people in Paris.', url: 'https://missionlocale.paris/' },
    { title: 'Our Italian restaurants & pizzerias in Paris', description: 'Discover a group of Italian restaurants in Paris.', url: 'https://bigmammagroup.example/paris' },
    { title: "L'Incontro / Italian Restaurant / Paris", description: "Welcome to the official website of L'Incontro in Paris, an Italian restaurant.", url: 'https://lincontro.example/en' },
  ] }, classification);
  assert.deepEqual(options.map((option) => option.name), ["L'Incontro / Italian Restaurant / Paris"]);
});

test('Input rejects unsafe session identifiers and keeps valid web sessions', () => {
  assert.throws(() => parseGuestInput({ message: 'hello', sessionId: "x' OR 1=1" }));
  assert.equal(parseGuestInput({ message: 'hello', sessionId: 'web_test-123' }).userId, 'web:web_test-123');
});

test('Direct file previews receive the explicit null-origin CORS response', async () => {
  const response = await worker.fetch(new Request('https://worker.example/health', {
    headers: { Origin: 'null' },
  }), {}, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'null');
});

test('Read-only endpoint test never writes Airtable and rejects a stale cuisine violation', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    requests.push({ target, method: options.method || 'GET' });
    if (target.includes('/Services')) return Response.json({ records });
    if (target.includes('/Conversations')) return Response.json({ records: [] });
    if (target.includes('/Settings')) return Response.json({ records: [] });
    if (target === 'https://api.groq.com/openai/v1/chat/completions') {
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        reply_text: 'Le Jardin \u2014 Chef\u2019s Table is ideal.', intent: 'service_request', service_type: 'restaurant', requests: [], requires_human: false,
      }) } }] });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'but is it indian ?', sessionId: 'qa_indian', testMode: 'read_only' }),
    }), {
      GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', HOTEL_NAME: 'Hotel', HOTEL_CITY: 'Paris',
    }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.doesNotMatch(body.reply, /Le Jardin/i);
    assert.match(body.reply, /could not verify a current match/i);
    assert.equal(requests.filter((request) => request.method === 'POST' && request.target.includes('api.airtable.com')).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Booking enquiry writes a contactable guest request to Airtable before acknowledging success', async () => {
  const originalFetch = globalThis.fetch;
  let writtenFields;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/Requests') && options.method === 'POST') {
      writtenFields = JSON.parse(options.body).fields;
      return Response.json({ id: 'rec_booking_enquiry', fields: writtenFields });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/booking-enquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({
        guestName: 'Ada Guest',
        email: 'ada@example.com',
        phone: '+33 6 12 34 56 78',
        preferredDate: '2026-08-08',
        preferredTime: '19:30',
        partySize: 2,
        notes: 'A quiet celebration table, please.',
        serviceName: 'Le Jardin Chef\u2019s Table',
        serviceType: 'restaurant',
        sessionId: 'web_booking-test',
        language: 'en',
        consent: true,
      }),
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test' }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(writtenFields.GuestName, 'Ada Guest');
    assert.equal(writtenFields.ServiceType, 'restaurant');
    assert.match(writtenFields.RequestSummary, /Email: ada@example\.com/);
    assert.match(writtenFields.RequestSummary, /Guests: 2/);
    assert.equal(writtenFields.Source, 'partner');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Booking enquiry rejects invalid contact details without writing Airtable', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return Response.json({}); };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/booking-enquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestName: 'Ada', email: 'not-an-email', serviceName: 'Spa', consent: true }),
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test' }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.error, /valid email/i);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Discovery call form records the hotel and contact details in Airtable', async () => {
  const originalFetch = globalThis.fetch;
  let writtenFields;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/leads/Hotel%20Leads') && options.method === 'POST') {
      writtenFields = JSON.parse(options.body).fields;
      return Response.json({ id: 'rec_discovery_lead', fields: writtenFields });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/discovery-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({
        contactName: 'Marcel Hotelier',
        hotelName: 'Maison Etoile',
        email: 'marcel@maison-etoile.example',
        phone: '+33 1 44 55 66 77',
        city: 'Paris',
        roomCount: 63,
        website: 'https://maison-etoile.example',
        message: 'Multilingual WhatsApp enquiries and spa requests.',
        sessionId: 'web_discovery-test',
        consent: true,
      }),
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'project', LEADS_AIRTABLE_BASE_ID: 'leads' }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(writtenFields['Hotel Lead Name'], 'Maison Etoile - Marcel Hotelier');
    assert.equal(writtenFields['Contact Name'], 'Marcel Hotelier');
    assert.equal(writtenFields['Work Email'], 'marcel@maison-etoile.example');
    assert.equal(writtenFields['Hotel Name'], 'Maison Etoile');
    assert.equal(writtenFields['Number of Rooms'], 63);
    assert.equal(writtenFields['Lead Status'], 'New');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Event-stream mode sends transient statuses before one structured final response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/Services')) return Response.json({ records });
    if (target.includes('/Conversations') || target.includes('/Settings')) return Response.json({ records: [] });
    if (target === 'https://api.groq.com/openai/v1/chat/completions') {
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        reply_text: 'A considered answer is ready.', intent: 'service_request', service_type: 'spa', requests: [], requires_human: true,
      }) } }] });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'Please arrange a massage.', sessionId: 'qa_stream', testMode: 'read_only' }),
    }), {
      GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', HOTEL_NAME: 'Hotel', HOTEL_CITY: 'Paris',
    }, { waitUntil() {} });
    const text = await response.text();
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.match(text, /event: status/);
    assert.match(text, /Reviewing the details of your request/);
    assert.match(text, /event: final/);
    assert.match(text, /"recommendations":\[\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('A common curated Italian request returns cards without model or web-search latency', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes('/Services')) {
      return Response.json({ records: [{ fields: {
        Name: 'Il Carpaccio', Category: 'restaurant', SubType: 'Italian fine dining',
        Description: 'Michelin-starred Italian dining in Paris.',
        WebsiteURL: 'https://example.com/il-carpaccio', Active: true, IsPartner: false,
      } }] });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'I would like one excellent Italian restaurant in Paris.', sessionId: 'qa_curated_italian', testMode: 'read_only' }),
    }), {
      GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', HOTEL_NAME: 'Hotel', HOTEL_CITY: 'Paris',
    }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.recommendations.length, 1);
    assert.equal(body.recommendations[0].name, 'Il Carpaccio');
    assert.equal(body.recommendations[0].website_url, 'https://example.com/il-carpaccio');
    assert.match(body.reply, /curated dining guide/i);
    assert.equal(calls.some((url) => url.includes('api.groq.com') || url.includes('app.scrapingbee.com')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('A non-partner Spanish request searches the web and cannot fall back to a French partner', async () => {
  const originalFetch = globalThis.fetch;
  let searchUrl = '';
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/Services')) return Response.json({ records });
    if (target.includes('/Conversations') || target.includes('/Settings')) return Response.json({ records: [] });
    if (target.includes('app.scrapingbee.com')) {
      searchUrl = target;
      return Response.json({ organic_results: [{
        title: 'Casa Alta | Spanish restaurant near Eiffel Tower',
        description: 'Casa Alta is a Spanish restaurant near the Eiffel Tower with an elegant contemporary dining room.',
        url: 'https://casa-alta.example/paris',
      }] });
    }
    if (target === 'https://api.groq.com/openai/v1/chat/completions') {
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        reply_text: 'Le Jardin would be lovely.', intent: 'service_request', service_type: 'restaurant', requests: [], requires_human: false,
      }) } }] });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'I am looking for fancy Spanish restaurants near the Eiffel Tower', sessionId: 'qa_spanish', testMode: 'read_only' }),
    }), {
      GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', SCRAPINGBEE_API_KEY: 'test', HOTEL_NAME: 'Hotel', HOTEL_CITY: 'Paris',
    }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(new URL(searchUrl).searchParams.get('search'), 'Spanish restaurant Paris 7th arrondissement official website');
    assert.equal(body.recommendations.length, 1);
    assert.equal(body.recommendations[0].name, 'Casa Alta | Spanish restaurant near Eiffel Tower');
    assert.ok(body.recommendations[0].image_url);
    assert.doesNotMatch(body.reply, /Le Jardin/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('A last-day Paris request searches attractions and returns a concrete suggestion', async () => {
  const originalFetch = globalThis.fetch;
  let searchUrl = '';
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/Services')) return Response.json({ records });
    if (target.includes('/Conversations') || target.includes('/Settings')) return Response.json({ records: [] });
    if (target.includes('app.scrapingbee.com')) {
      searchUrl = target;
      return Response.json({ organic_results: [
        { title: "Musee d'Orsay - Paris", description: 'Official museum website in Paris, with visitor information and current exhibitions.', url: 'https://www.musee-orsay.fr/en' },
        { title: 'A Seine cruise in Paris', description: 'Discover Paris from the Seine with an official sightseeing cruise and evening departures.', url: 'https://www.bateaux-mouches.fr/en' },
      ] });
    }
    if (target === 'https://api.groq.com/openai/v1/chat/completions') {
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        reply_text: 'I can arrange a bespoke itinerary.', intent: 'service_request', service_type: 'tour', requests: [], requires_human: false,
      }) } }] });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'What do you suggest for me? It is my last day in Paris.', sessionId: 'qa_final_day', testMode: 'read_only' }),
    }), {
      GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', SCRAPINGBEE_API_KEY: 'test', HOTEL_NAME: 'Hotel', HOTEL_CITY: 'Paris',
    }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(new URL(searchUrl).searchParams.get('search'), 'Paris Louvre museum Seine cruise official website');
    assert.equal(body.recommendations.length, 2);
    assert.match(body.reply, /Musee d'Orsay/i);
    assert.doesNotMatch(body.reply, /no specific partner services|bespoke itinerary/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Semantic routing discovers an unfamiliar request without a hand-written category rule', async () => {
  const originalFetch = globalThis.fetch;
  let searchUrl = '';
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/Services')) return Response.json({ records });
    if (target.includes('/Conversations') || target.includes('/Settings')) return Response.json({ records: [] });
    if (target.includes('app.scrapingbee.com')) {
      searchUrl = target;
      return Response.json({ organic_results: [{
        title: 'Vintage couture shopping in Paris',
        description: 'A Paris boutique specialising in curated vintage couture and appointment shopping.',
        url: 'https://vintage-couture.example/paris',
      }] });
    }
    if (target === 'https://api.groq.com/openai/v1/chat/completions') {
      const prompt = JSON.parse(options.body).messages[0].content;
      if (prompt.includes('intent router')) {
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          route: 'external_discovery', category: 'experience', search_query: 'vintage couture shopping Paris',
        }) } }] });
      }
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        reply_text: 'I found a considered option.', intent: 'service_request', service_type: 'experience', requests: [], requires_human: false,
      }) } }] });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'I would love a private vintage couture shopping experience tomorrow.', sessionId: 'qa_unfamiliar', testMode: 'read_only' }),
    }), {
      GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', SCRAPINGBEE_API_KEY: 'test', HOTEL_NAME: 'Hotel', HOTEL_CITY: 'Paris',
    }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(new URL(searchUrl).searchParams.get('search'), 'vintage couture shopping Paris official website');
    assert.equal(body.recommendations.length, 1);
    assert.equal(body.recommendations[0].name, 'Vintage couture shopping in Paris');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Semantic routing answers the actual partner catalogue without an external search', async () => {
  const originalFetch = globalThis.fetch;
  let scraped = false;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/Services')) return Response.json({ records });
    if (target.includes('/Conversations') || target.includes('/Settings')) return Response.json({ records: [] });
    if (target.includes('app.scrapingbee.com')) { scraped = true; throw new Error('Partner catalogue must not scrape.'); }
    if (target === 'https://api.groq.com/openai/v1/chat/completions') {
      const prompt = JSON.parse(options.body).messages[0].content;
      if (prompt.includes('intent router')) {
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          route: 'partner_catalog', category: null, search_query: '',
        }) } }] });
      }
      assert.match(prompt, /Le Jardin/);
      assert.match(prompt, /Lumi.re Spa/);
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        reply_text: 'Our current partners include Le Jardin and Lumiere Spa.', intent: 'faq', service_type: null, requests: [], requires_human: false,
      }) } }] });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'What services do you offer and who are your partners?', sessionId: 'qa_catalogue', testMode: 'read_only' }),
    }), {
      GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', SCRAPINGBEE_API_KEY: 'test', HOTEL_NAME: 'Hotel', HOTEL_CITY: 'Paris',
    }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(scraped, false);
    assert.match(body.reply, /Le Jardin/);
    assert.match(body.reply, /Lumi.re Spa/);
    assert.equal(body.partner_offers.length, 2);
    assert.match(body.partner_offers[0].name, /Le Jardin/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('An empty unfamiliar discovery asks one useful refinement instead of deferring to staff', () => {
  const classification = {
    ...classifyRequest('A midnight ceramics lesson in Paris would be wonderful.'),
    route: 'external_discovery',
    externalDiscovery: true,
    hasIntent: true,
  };
  const result = enforceContract(
    { reply: 'Our team will research this.', intent: 'other', requests: [] },
    { language: 'en', classification, matching: [], excluded: [], externalOptions: [] },
  );
  assert.match(result.reply, /neighbourhood, timing, party size, or budget/i);
  assert.doesNotMatch(result.reply, /team will research/i);
});
