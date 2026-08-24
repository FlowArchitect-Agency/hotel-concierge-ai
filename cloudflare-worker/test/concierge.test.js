import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRequest,
  enforceContract,
  inheritConversationContext,
  matchingServices,
  parseExternalResults,
  parseGuestInput,
  inferLanguage,
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

test('Natural plural room and hotel-reservation language is routed to the hotel inventory', () => {
  assert.equal(classifyRequest('I would like to reserve two rooms for three nights for two people.').category, 'accommodation');
  assert.equal(classifyRequest('I want to reserve in your hotel.').category, 'accommodation');
});

test('Language switching recognises Spanish requests, including the common espangol spelling', () => {
  assert.equal(inferLanguage('habla espangol ?'), 'es');
  assert.equal(inferLanguage('can you answer in Spanish?'), 'es');
  assert.equal(parseGuestInput({ message: 'can you answer in Spanish?', sessionId: 'qa_language_switch' }).languageRequested, true);
  assert.equal(parseGuestInput({ message: 'I need a taxi', sessionId: 'qa_spanish_preference', preferredLanguage: 'es' }).language, 'en');
  assert.equal(parseGuestInput({ message: 'hello', sessionId: 'qa_english_greeting', preferredLanguage: 'fr' }).language, 'en');
  assert.equal(parseGuestInput({ message: 'spa tomorrow', sessionId: 'qa_ambiguous_preference', preferredLanguage: 'es' }).language, 'es');
  assert.equal(inferLanguage('I need a Spanish restaurant in Paris'), 'en');
});

test('A Spanish switch request receives a Spanish answer without requiring a model call', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Language switching should not make a network request.'); };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'habla espangol ?', sessionId: 'qa_es_switch', testMode: 'read_only' }),
    }), {}, { waitUntil() {} });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.language, 'es');
    assert.match(body.reply, /responder\u00e9 en espa\u00f1ol/i);
    assert.doesNotMatch(body.reply, /how may i assist/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test('Demo chat accepts only the GitHub Pages origin and marks every demo record in Airtable', async () => {
  const origin = 'https://flowarchitect-agency.github.io';
  const preflight = await worker.fetch(new Request('https://worker.example/api/demo-chat', {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
  }), { DEMO_ALLOWED_ORIGIN: origin }, { waitUntil() {} });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');

  const blocked = await worker.fetch(new Request('https://worker.example/api/demo-chat', {
    method: 'OPTIONS',
    headers: { Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'POST' },
  }), { DEMO_ALLOWED_ORIGIN: origin }, { waitUntil() {} });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);

  const originalFetch = globalThis.fetch;
  const scheduled = [];
  const guestWrites = [];
  const conversationWrites = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    const fields = options.body ? JSON.parse(options.body).fields : null;
    if (target.includes('/Guests') && (options.method || 'GET') === 'GET') return Response.json({ records: [] });
    if (target.includes('/Guests') && options.method === 'POST') {
      guestWrites.push(fields);
      return Response.json({ id: 'rec_demo_guest', fields });
    }
    if (target.includes('/Conversations') && options.method === 'POST') {
      conversationWrites.push(fields);
      return Response.json({ id: `rec_demo_${conversationWrites.length}`, fields });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/demo-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': '203.0.113.25' },
      body: JSON.stringify({
        guestName: 'Demo Guest',
        language: 'English',
        scenario: 'pre-arrival',
        is_demo: true,
        sessionId: 'demo_unit_test',
        chatHistory: [{ role: 'user', content: 'hello' }],
      }),
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', DEMO_ALLOWED_ORIGIN: origin }, {
      waitUntil(promise) { scheduled.push(promise); },
    });
    const body = await response.json();
    await Promise.all(scheduled);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(body.demo, true);
    assert.equal(body.is_demo, true);
    assert.match(body.reply, /welcome/i);
    assert.deepEqual(body.staff_alerts, []);
    assert.equal(guestWrites[0].Is_Demo, true);
    assert.equal(guestWrites[0].GuestName, 'Demo Guest');
    assert.equal(conversationWrites.length, 2);
    assert.ok(conversationWrites.every((fields) => fields.Is_Demo === true));

    const unsafeDemo = await worker.fetch(new Request('https://worker.example/api/demo-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': '203.0.113.26' },
      body: JSON.stringify({ guestName: 'Demo Guest', language: 'English', scenario: 'pre-arrival', is_demo: false, chatHistory: [{ role: 'user', content: 'hello' }] }),
    }), { DEMO_ALLOWED_ORIGIN: origin }, { waitUntil() {} });
    assert.equal(unsafeDemo.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function signWhatsAppPayload(payload, secret) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `sha256=${[...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function signTwilioPayload(url, entries, secret) {
  const grouped = new Map();
  for (const [key, value] of entries) {
    const values = grouped.get(key) || [];
    values.push(value);
    grouped.set(key, values);
  }
  let payload = url;
  for (const key of [...grouped.keys()].sort()) {
    for (const value of grouped.get(key).sort()) payload += `${key}${value}`;
  }
  const cryptoKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function settleWaitUntil(queue) {
  while (queue.length) await Promise.all(queue.splice(0));
}

test('WhatsApp webhook verifies only the configured Meta handshake token', async () => {
  const env = { WA_WEBHOOK_VERIFY_TOKEN: 'qa-whatsapp-verify-token' };
  const success = await worker.fetch(new Request('https://worker.example/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=qa-whatsapp-verify-token&hub.challenge=challenge-123'), env, { waitUntil() {} });
  const rejected = await worker.fetch(new Request('https://worker.example/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123'), env, { waitUntil() {} });
  assert.equal(success.status, 200);
  assert.equal(await success.text(), 'challenge-123');
  assert.equal(rejected.status, 403);
});

test('WhatsApp text messages use the concierge, preserve WhatsApp history, and reply once', async () => {
  const originalFetch = globalThis.fetch;
  const secret = 'qa-whatsapp-app-secret';
  const outbound = [];
  const writes = [];
  const pending = [];
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { messages: [{
      from: '33612345678', id: 'wamid.qa-hello-1', type: 'text', text: { body: 'hola' },
    }] } }] }],
  };
  const rawBody = JSON.stringify(payload);
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('https://api.airtable.com/')) {
      writes.push(JSON.parse(options.body));
      return Response.json({ id: 'rec_qa' });
    }
    if (target.startsWith('https://graph.facebook.com/')) {
      outbound.push(JSON.parse(options.body));
      return Response.json({ messages: [{ id: 'wamid.qa-reply-1' }] });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const env = {
      WA_WEBHOOK_VERIFY_TOKEN: 'qa-whatsapp-verify-token',
      WA_APP_SECRET: secret,
      WA_ACCESS_TOKEN: 'qa-access-token',
      WA_PHONE_NUMBER_ID: '123456789',
      AIRTABLE_API_KEY: 'qa-airtable-token',
      AIRTABLE_BASE_ID: 'app_qa',
    };
    const request = new Request('https://worker.example/webhooks/whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': await signWhatsAppPayload(rawBody, secret),
      },
      body: rawBody,
    });
    const context = { waitUntil(promise) { pending.push(Promise.resolve(promise)); } };
    const response = await worker.fetch(request, env, context);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'EVENT_RECEIVED');
    await settleWaitUntil(pending);
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0].to, '33612345678');
    assert.match(outbound[0].text.body, /bienvenido/i);
    assert.equal(writes.length, 2);
    assert.ok(writes.every((write) => write.fields.UserID === 'whatsapp:33612345678'));
    assert.ok(writes.every((write) => write.fields.Channel === 'whatsapp'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('WhatsApp webhook refuses a payload with an invalid Meta signature', async () => {
  const request = new Request('https://worker.example/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256:not-a-valid-signature' },
    body: JSON.stringify({ object: 'whatsapp_business_account' }),
  });
  const response = await worker.fetch(request, {
    WA_APP_SECRET: 'qa-whatsapp-app-secret', WA_ACCESS_TOKEN: 'qa-access-token', WA_PHONE_NUMBER_ID: '123456789',
  }, { waitUntil() {} });
  assert.equal(response.status, 401);
});

test('Twilio WhatsApp Sandbox messages use the concierge and return signed TwiML', async () => {
  const originalFetch = globalThis.fetch;
  const writes = [];
  const secret = 'qa-twilio-auth-token';
  const url = 'https://worker.example/webhooks/twilio';
  const entries = [
    ['Body', 'hola'], ['From', 'whatsapp:+33612345678'], ['MessageSid', 'SMqa-twilio-hello-1'],
  ];
  globalThis.fetch = async (target, options = {}) => {
    if (String(target).startsWith('https://api.airtable.com/')) {
      writes.push(JSON.parse(options.body));
      return Response.json({ id: 'rec_qa' });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const request = new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Twilio-Signature': await signTwilioPayload(url, entries, secret),
      },
      body: new URLSearchParams(entries),
    });
    const response = await worker.fetch(request, {
      TWILIO_AUTH_TOKEN: secret,
      AIRTABLE_API_KEY: 'qa-airtable-token',
      AIRTABLE_BASE_ID: 'app_qa',
    }, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/xml; charset=utf-8');
    assert.match(await response.text(), /<Response><Message>.*bienvenido/i);
    assert.equal(writes.length, 2);
    assert.ok(writes.every((write) => write.fields.UserID === 'whatsapp:33612345678'));
    assert.ok(writes.every((write) => write.fields.Channel === 'whatsapp'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Twilio webhook refuses an invalid signature', async () => {
  const response = await worker.fetch(new Request('https://worker.example/webhooks/twilio', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': 'invalid',
    },
    body: new URLSearchParams({ Body: 'hello', From: 'whatsapp:+33612345678', MessageSid: 'SMqa-invalid' }),
  }), { TWILIO_AUTH_TOKEN: 'qa-twilio-auth-token' }, { waitUntil() {} });
  assert.equal(response.status, 401);
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
        is_demo: true,
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
    assert.equal(writtenFields.Is_Demo, true);
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
      body: JSON.stringify({ message: 'No, I would rather keep the Italian preference and want one excellent Italian restaurant in Paris.', sessionId: 'qa_curated_italian', testMode: 'read_only' }),
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

test('A reservation for the hotel restaurant stays within the preferred collection', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes('/Services')) return Response.json({ records });
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'I want to reserve a table at your restaurant for four people at 10 PM.', sessionId: 'qa_hotel_restaurant', testMode: 'read_only' }),
    }), {
      GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', SCRAPINGBEE_API_KEY: 'test', HOTEL_NAME: 'Hotel', HOTEL_CITY: 'Paris',
    }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.intent, 'partner_request');
    assert.equal(body.recommendations.length, 0);
    assert.equal(body.partner_offers.length, 1);
    assert.equal(body.partner_offers[0].name, 'Le Jardin \u2014 Chef\u2019s Table');
    assert.equal(body.partner_offers[0].source, 'partner');
    assert.match(body.reply, /preferred collection/i);
    assert.equal(calls.some((url) => url.includes('api.groq.com') || url.includes('app.scrapingbee.com')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('An unmatched cuisine is offered a hotel alternative before any external search', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes('/Services')) return Response.json({ records });
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'I would like an Italian restaurant.', sessionId: 'qa_hotel_alternative', testMode: 'read_only' }),
    }), {
      GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', SCRAPINGBEE_API_KEY: 'test', HOTEL_NAME: 'Hotel', HOTEL_CITY: 'Paris',
    }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.intent, 'hotel_alternative');
    assert.equal(body.partner_offers[0].name, 'Le Jardin \u2014 Chef\u2019s Table');
    assert.match(body.reply, /do not currently have an Italian option/i);
    assert.equal(calls.some((url) => url.includes('api.groq.com') || url.includes('app.scrapingbee.com')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('A services question returns every hotel partner in a dedicated collection without model latency', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes('/Services')) return Response.json({ records });
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'What services does your hotel offer?', sessionId: 'qa_hotel_collection', testMode: 'read_only' }),
    }), {
      GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', SCRAPINGBEE_API_KEY: 'test', HOTEL_NAME: 'Hotel', HOTEL_CITY: 'Paris',
    }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.intent, 'partner_catalog');
    assert.equal(body.hotel_collection.length, 2);
    assert.deepEqual(body.hotel_collection.map((offer) => offer.name), ['Le Jardin \u2014 Chef\u2019s Table', 'Lumi\u00e8re Spa \u2014 Couples Massage']);
    assert.equal(calls.some((url) => url.includes('api.groq.com') || url.includes('app.scrapingbee.com')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('An English catalogue question with a mobile spelling mistake overrides an older French preference', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes('/Services')) return Response.json({ records });
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'what serivces do you have ?', sessionId: 'qa_catalogue_typo', preferredLanguage: 'fr', testMode: 'read_only' }),
    }), {
      GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', SCRAPINGBEE_API_KEY: 'test', HOTEL_NAME: 'Hotel', HOTEL_CITY: 'Paris',
    }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.language, 'en');
    assert.equal(body.intent, 'partner_catalog');
    assert.equal(body.partner_offers.length, 0);
    assert.deepEqual(body.hotel_collection.map((offer) => offer.name), ['Le Jardin — Chef’s Table', 'Lumière Spa — Couples Massage']);
    assert.match(body.reply, /full preferred collection/i);
    assert.equal(calls.some((url) => url.includes('api.groq.com') || url.includes('app.scrapingbee.com')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('A room booking request opens Airtable-backed room offers without model or web-search latency', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const roomRecords = [
    { fields: { Name: 'Lumière Classic King', Category: 'accommodation', Description: 'A quiet king room', Active: true, IsPartner: true, PriceEUR: 420 } },
    { fields: { Name: 'Lumière Eiffel View Deluxe', Category: 'accommodation', Description: 'A view of the Eiffel Tower', Active: true, IsPartner: true, PriceEUR: 680 } },
  ];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes('/Services')) return Response.json({ records: roomRecords });
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'I want to book a hotel room for five nights.', sessionId: 'qa_room_fast', testMode: 'read_only' }),
    }), {
      GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', HOTEL_NAME: 'Hotel', HOTEL_CITY: 'Paris',
    }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.intent, 'partner_request');
    assert.deepEqual(body.partner_offers.map((offer) => offer.name), ['Lumière Classic King', 'Lumière Eiffel View Deluxe']);
    assert.match(body.reply, /preferred collection/i);
    assert.equal(calls.some((url) => url.includes('api.groq.com') || url.includes('app.scrapingbee.com')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Room enquiry writes dates, arrival time, and contact details to Airtable', async () => {
  const originalFetch = globalThis.fetch;
  let writtenFields;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/Requests') && options.method === 'POST') {
      writtenFields = JSON.parse(options.body).fields;
      return Response.json({ id: 'rec_room_enquiry', fields: writtenFields });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/room-enquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({
        firstName: 'Adele', lastName: 'Guest', email: 'adele@example.com', phone: '+33 6 12 34 56 78',
        checkIn: '2026-09-12', checkOut: '2026-09-17', arrivalTime: '18:30', adults: 2, children: 0, rooms: 1,
        serviceName: 'Lumière Eiffel View Deluxe', preference: 'Quiet king room', notes: 'QA room enquiry - delete after verification.', sessionId: 'web_room-test', language: 'en', is_demo: true, consent: true,
      }),
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test' }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(writtenFields.GuestName, 'Adele Guest');
    assert.equal(writtenFields.ServiceType, 'other');
    assert.equal(writtenFields.Source, 'hotel_room_enquiry');
    assert.equal(writtenFields.Is_Demo, true);
    assert.equal(writtenFields.ServiceRef, 'Lumière Eiffel View Deluxe');
    assert.match(writtenFields.RequestSummary, /for Lumière Eiffel View Deluxe/);
    assert.match(writtenFields.RequestSummary, /2026-09-12 to 2026-09-17/);
    assert.match(writtenFields.RequestSummary, /Preferred arrival time: 18:30/);
    assert.match(writtenFields.RequestSummary, /Rooms requested: 1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Room enquiry rejects a checkout date that does not follow check-in', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return Response.json({}); };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/room-enquiry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Ada', lastName: 'Guest', email: 'ada@example.com', phone: '+33 6 00 00 00 00',
        checkIn: '2026-09-17', checkOut: '2026-09-17', consent: true,
      }),
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test' }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.error, /after check-in/i);
    assert.equal(called, false);
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
      body: JSON.stringify({ message: 'No, I want to keep the Spanish restaurant request near the Eiffel Tower.', sessionId: 'qa_spanish', testMode: 'read_only' }),
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
    assert.equal(body.hotel_collection[0].name, 'Le Jardin \u2014 Chef\u2019s Table');
    assert.equal(body.hotel_collection[1].name, 'Lumi\u00e8re Spa \u2014 Couples Massage');
    assert.equal(body.partner_offers.length, 0);
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

test('Sentiment Override: Frustrated guest or manager request immediately triggers escape hatch without upselling', async () => {
  const originalFetch = globalThis.fetch;
  const writtenTables = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('api.airtable.com')) {
      if (options.body) {
        writtenTables.push({ url: target, fields: JSON.parse(options.body).fields });
      }
      return Response.json({ records: [], id: 'rec_sentiment_test' });
    }
    throw new Error(`Unexpected call: ${url}`);
  };
  const scheduled = [];
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/demo-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({
        guestName: 'Angry Guest',
        language: 'English',
        scenario: 'in-stay',
        is_demo: true,
        sessionId: 'demo_angry_guest',
        chatHistory: [{ role: 'user', content: 'This service is terrible and unacceptable. I want to speak to the manager right now!' }],
      }),
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', DEMO_ALLOWED_ORIGIN: 'https://flowarchitect-agency.github.io' }, {
      waitUntil(p) { scheduled.push(p); },
    });
    const data = await response.json();
    await Promise.all(scheduled);
    assert.equal(response.status, 200);
    assert.equal(data.escape_hatch_triggered, true);
    assert.equal(data.requires_human, true);
    assert.match(data.reply, /apologize/i);
    assert.match(data.reply, /Duty Manager|front desk/i);
    assert.doesNotMatch(data.reply, /Partner option/i);
    assert.doesNotMatch(data.reply, /upgrade/i);
    assert.ok(data.staff_alerts.length > 0);
    assert.equal(data.staff_alerts[0].role, 'Duty Manager / Front Desk');
    assert.ok(writtenTables.length > 0);
    assert.ok(writtenTables.every((entry) => entry.fields.Is_Demo === true));
    const guestWrite = writtenTables.find((w) => w.url.includes('/Guests'));
    assert.equal(guestWrite?.fields.GuestName, 'Angry Guest');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Rich Media: Spa or menu query returns PDF brochure document card metadata', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('api.airtable.com')) {
      return Response.json({ records: [{ id: 'rec_spa', fields: { Name: 'Lumière Spa Massage', Category: 'spa', PriceEUR: 220, Active: true, IsPartner: true } }] });
    }
    if (target.includes('api.groq.com')) {
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        reply_text: 'Here is our Lumière Spa brochure with our full wellness and massage menu.',
        intent: 'service_request',
        service_type: 'spa',
        requests: [],
        requires_human: false,
      }) } }] });
    }
    throw new Error(`Unexpected call: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/demo-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({
        guestName: 'Spa Guest',
        language: 'English',
        scenario: 'in-stay',
        is_demo: true,
        sessionId: 'demo_spa_guest',
        chatHistory: [{ role: 'user', content: 'Could you send me the spa menu and treatments brochure?' }],
      }),
    }), {
      GROQ_API_KEY: 'test',
      AIRTABLE_API_KEY: 'test',
      AIRTABLE_BASE_ID: 'test',
      DEMO_ALLOWED_ORIGIN: 'https://flowarchitect-agency.github.io',
      HOTEL_NAME: 'Hôtel Lumière',
      HOTEL_CITY: 'Paris',
    }, {
      waitUntil() {},
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.ok(data.media);
    assert.equal(data.media.type, 'document');
    assert.equal(data.media.format, 'PDF');
    assert.match(data.media.filename, /Spa/i);
    assert.match(data.media.url, /Lumiere_Spa_Wellness_Menu\.pdf/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Operational requests: Physical items (towels/water) alert Housekeeping with zero upselling', async () => {
  const originalFetch = globalThis.fetch;
  const writtenTables = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('api.airtable.com')) {
      if (options.body) {
        writtenTables.push({ url: target, fields: JSON.parse(options.body).fields });
      }
      return Response.json({ records: [], id: 'rec_operational_test' });
    }
    throw new Error(`Unexpected call: ${url}`);
  };
  const scheduled = [];
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/demo-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://flowarchitect-agency.github.io',
        'CF-Connecting-IP': '203.0.113.88',
      },
      body: JSON.stringify({
        guestName: 'In-Stay Guest',
        language: 'English',
        scenario: 'in-stay',
        is_demo: true,
        sessionId: 'demo_in_stay_towels',
        chatHistory: [{ role: 'user', content: 'Could you please bring extra towels and bottles of water to room 302?' }],
      }),
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', DEMO_ALLOWED_ORIGIN: 'https://flowarchitect-agency.github.io' }, {
      waitUntil(p) { scheduled.push(p); },
    });
    const data = await response.json();
    await Promise.all(scheduled);
    assert.equal(response.status, 200);
    assert.match(data.reply, /logged your request|delivered to your room|team/i);
    assert.doesNotMatch(data.reply, /Partner option/i);
    assert.doesNotMatch(data.reply, /upgrade/i);
    assert.ok(data.staff_alerts.length > 0);
    assert.equal(data.staff_alerts[0].role, 'Housekeeping team');
    const requestWrite = writtenTables.find((w) => w.url.includes('/Requests'));
    assert.ok(requestWrite);
    assert.equal(requestWrite.fields.GuestName, 'In-Stay Guest');
    assert.equal(requestWrite.fields.Is_Demo, true);
    assert.equal(requestWrite.fields.IsUpsell, false);
    assert.equal(requestWrite.fields.ServiceType, 'Housekeeping');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Post-Checkout Positive: 5-star review returns thank you and Google Review link without complaint ticket', async () => {
  const originalFetch = globalThis.fetch;
  const writtenTables = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('api.airtable.com')) {
      if (options.body) {
        writtenTables.push({ url: target, fields: JSON.parse(options.body).fields });
      }
      return Response.json({ records: [], id: 'rec_positive_checkout' });
    }
    throw new Error(`Unexpected call: ${url}`);
  };
  const scheduled = [];
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/demo-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://flowarchitect-agency.github.io',
        'CF-Connecting-IP': '203.0.113.88',
      },
      body: JSON.stringify({
        guestName: 'Delighted Guest',
        language: 'English',
        scenario: 'post_checkout',
        is_demo: true,
        sessionId: 'demo_post_checkout_pos',
        chatHistory: [{ role: 'user', content: 'Loved it! Everything was wonderful, 5 stars!' }],
      }),
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', DEMO_ALLOWED_ORIGIN: 'https://flowarchitect-agency.github.io' }, {
      waitUntil(p) { scheduled.push(p); },
    });
    const data = await response.json();
    await Promise.all(scheduled);
    assert.equal(response.status, 200);
    assert.match(data.reply, /Thank you so much, Delighted Guest/i);
    assert.match(data.reply, /https:\/\/g\.page\/r\/hotel-lumiere-paris\/review/);
    assert.equal(data.requires_human, false);
    assert.equal(data.escape_hatch_triggered, false);
    assert.ok(data.media && data.media.url.includes('g.page'));
    const requestWrite = writtenTables.find((w) => w.url.includes('/Requests'));
    assert.equal(requestWrite, undefined, 'No complaint request record should be created for positive reviews');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Post-Checkout Negative: Complaining guest triggers General Manager escalation without public review link', async () => {
  const originalFetch = globalThis.fetch;
  const writtenTables = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('api.airtable.com')) {
      if (options.body) {
        writtenTables.push({ url: target, fields: JSON.parse(options.body).fields });
      }
      return Response.json({ records: [], id: 'rec_negative_checkout' });
    }
    throw new Error(`Unexpected call: ${url}`);
  };
  const scheduled = [];
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/demo-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://flowarchitect-agency.github.io',
        'CF-Connecting-IP': '203.0.113.88',
      },
      body: JSON.stringify({
        guestName: 'Unhappy Guest',
        language: 'English',
        scenario: 'post_checkout',
        is_demo: true,
        sessionId: 'demo_post_checkout_neg',
        chatHistory: [{ role: 'user', content: 'The room was noisy and service was terrible.' }],
      }),
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', DEMO_ALLOWED_ORIGIN: 'https://flowarchitect-agency.github.io' }, {
      waitUntil(p) { scheduled.push(p); },
    });
    const data = await response.json();
    await Promise.all(scheduled);
    assert.equal(response.status, 200);
    assert.match(data.reply, /sincerely apologize/i);
    assert.match(data.reply, /General Manager/i);
    assert.doesNotMatch(data.reply, /g\.page|tripadvisor|google review/i);
    assert.equal(data.requires_human, true);
    assert.equal(data.escape_hatch_triggered, true);
    assert.equal(data.media, null);
    assert.ok(data.staff_alerts.length > 0);
    assert.equal(data.staff_alerts[0].role, 'General Manager');
    const requestWrite = writtenTables.find((w) => w.url.includes('/Requests'));
    assert.ok(requestWrite, 'General Manager request record must be created');
    assert.equal(requestWrite.fields.GuestName, 'Unhappy Guest');
    assert.equal(requestWrite.fields.Is_Demo, true);
    assert.equal(requestWrite.fields.ServiceType, 'General Manager');
    assert.match(requestWrite.fields.RequestSummary, /URGENT POST-CHECKOUT SERVICE RECOVERY/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


