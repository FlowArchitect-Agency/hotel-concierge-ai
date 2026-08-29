import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  classifyRequest,
  detectMediaBrochure,
  ESCALATION_REPLIES,
  enforceContract,
  inheritConversationContext,
  isOperationalRequest,
  matchingServices,
  normalizeServiceType,
  operationalServiceType,
  OPERATIONAL_REPLIES,
  parseExternalResults,
  parseGuestInput,
  inferLanguage,
  postCheckoutNegativeReply,
  shouldSearchExternal,
} from '../src/concierge.js';
import {
  buildDiscoveryBriefDocumentModel,
  buildDiscoveryBriefPdf,
  sanitizeDiscoveryBriefFilename,
} from '../src/discovery-brief-pdf.js';
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

test('A short booking confirmation retains a transport category from the same session', () => {
  const continued = inheritConversationContext(
    classifyRequest('Yes, book it for 2 people.'),
    [{ role: 'user', message: 'Can we get an airport transfer from CDG?' }],
    'Yes, book it for 2 people.',
  );
  assert.equal(continued.category, 'transport');
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

test('Score-based language detection follows the current guest message, including a minor French typo', () => {
  assert.equal(inferLanguage('a quelle heure vous fermez ?'), 'fr');
  assert.equal(inferLanguage('a qulle heure vous ferme ?'), 'fr');
  assert.equal(inferLanguage('vous êtes ouverts toute la nuit ?'), 'fr');
  assert.equal(inferLanguage('what time do you close?'), 'en');
  assert.equal(inferLanguage('¿A qué hora cierra?'), 'es');
  assert.equal(inferLanguage('هل أنتم مفتوحون طوال الليل؟'), 'ar');
  assert.equal(inferLanguage('スパは何時に開きますか？'), 'ja');
});

test('A clear current-message language switch overrides stored memory while an ambiguous turn may use it', () => {
  assert.equal(parseGuestInput({ message: 'Bonjour, à quelle heure est le petit déjeuner ?', sessionId: 'qa_language_fr', preferredLanguage: 'en' }).language, 'fr');
  assert.equal(parseGuestInput({ message: 'Actually, what time does the spa open?', sessionId: 'qa_language_en', preferredLanguage: 'fr' }).language, 'en');
  assert.equal(parseGuestInput({ message: '¿A qué hora cierra?', sessionId: 'qa_language_es', preferredLanguage: 'en' }).language, 'es');
  assert.equal(parseGuestInput({ message: 'spa tomorrow', sessionId: 'qa_language_memory', preferredLanguage: 'fr' }).language, 'fr');
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
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io', 'CF-Connecting-IP': '203.0.113.89' },
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
    assert.equal(writtenFields.ServiceType, 'Dining');
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

function hotelDiscoveryBriefPayload(overrides = {}) {
  const base = {
    submissionType: 'hotel_discovery_brief',
    contactName: 'Claire Martin',
    role: 'General Manager',
    email: 'claire@maison-etoile.example',
    phone: '+33 1 44 55 66 77',
    hotelName: 'Maison Étoile',
    website: 'https://maison-etoile.example',
    roomCount: 63,
    propertyCount: 2,
    pmsSystem: 'Mews',
    whatsAppBusiness: 'Not sure',
    sessionId: 'web_hotel-brief-test',
    consent: true,
    discovery: {
      serviceUsage: '10–25%',
      requestedServices: ['Airport transfers', 'Spa & wellness'],
      requestedServicesOther: '',
      lowServiceReasons: ['Guests may not know the services exist'],
      lowServiceReasonsOther: '',
      bookingSources: { directWebsite: 35, bookingCom: 40, expedia: '', otherOtas: 10, agenciesCorporate: 10, other: 5 },
      bookingSourcesNotSure: false,
      bookingOtherDetail: 'Other travel partners',
      preArrivalContact: 'Sometimes',
      preArrivalMethods: ['Email', 'WhatsApp'],
      preArrivalMethodsOther: '',
      discoveryChannels: ['Reception staff', 'Hotel website'],
      discoveryChannelsOther: '',
      servicesToPromote: 'Spa rituals and airport transfers.',
      internationalOrigins: ['United Kingdom', 'United States'],
      languageDifficulty: 'Regularly',
      difficultLanguages: 'English and Mandarin',
      repeatedQuestions: ['Breakfast hours', 'Transport / airport'],
      repeatedQuestionsOther: '',
      requestHandling: ['Reception calls the appropriate department', 'WhatsApp staff group'],
      requestHandlingOther: '',
      responseSpeed: '5–15 minutes',
      escalationProcess: 'The duty manager is called for VIP requests.',
      postCheckoutContact: 'Sometimes',
      postCheckoutMethods: ['Email', 'Review platform link'],
      postCheckoutMethodsOther: '',
      managementInsights: ['Most requested services', 'Staff workload'],
      managementInsightsOther: '',
      improvementGoals: ['Increase ancillary-service revenue', 'Improve multilingual communication'],
      improvementGoalsOther: '',
      presentationFocus: 'Please show how ConciergeFlow handles pre-arrival service discovery.',
    },
  };
  return { ...base, ...overrides, discovery: { ...base.discovery, ...(overrides.discovery || {}) } };
}

test('Hotel Discovery Brief serializes the full Sales Brief into the existing Airtable lead field', async () => {
  const originalFetch = globalThis.fetch;
  let writtenFields;
  let upload;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/leads/Hotel%20Leads') && options.method === 'POST') {
      writtenFields = JSON.parse(options.body).fields;
      return Response.json({ id: 'rec_hotel_discovery_brief', fields: writtenFields });
    }
    if (String(url).includes('/rec_hotel_discovery_brief/fld_discovery_pdf/uploadAttachment') && options.method === 'POST') {
      upload = JSON.parse(options.body);
      return Response.json({ id: 'rec_hotel_discovery_brief', fields: { 'Discovery Brief PDF': [{ filename: upload.filename }] } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/discovery-lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' }, body: JSON.stringify(hotelDiscoveryBriefPayload()),
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'project', LEADS_AIRTABLE_BASE_ID: 'leads', DISCOVERY_BRIEF_PDF_FIELD_ID: 'fld_discovery_pdf' }, { waitUntil() {} });
    assert.equal(response.status, 201);
    assert.equal(writtenFields['Hotel Lead Name'], 'Maison Étoile - Claire Martin');
    assert.equal(writtenFields['Number of Rooms'], 63);
    assert.match(writtenFields['Concierge Service Needs'], /^Hotel Discovery Brief/m);
    assert.match(writtenFields['Concierge Service Needs'], /Brief language: English/);
    assert.match(writtenFields['Concierge Service Needs'], /Contact: Claire Martin · General Manager/);
    assert.match(writtenFields['Concierge Service Needs'], /Airport transfers, Spa & wellness/);
    assert.match(writtenFields['Concierge Service Needs'], /Please show how ConciergeFlow handles pre-arrival service discovery/);
    assert.equal(upload.filename, 'ConciergeFlow_Discovery_Brief_Maison_Etoile.pdf');
    assert.equal(upload.contentType, 'application/pdf');
    assert.match(upload.file, /^[A-Za-z0-9+/]+=*$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Hotel Discovery Brief validates required work email before Airtable is called', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('Airtable must not be called.'); };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/discovery-lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' }, body: JSON.stringify(hotelDiscoveryBriefPayload({ email: 'not-an-email' })),
    }), { AIRTABLE_API_KEY: 'test', LEADS_AIRTABLE_BASE_ID: 'leads' }, { waitUntil() {} });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /valid work email/i);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Hotel Discovery Brief rejects every selected Other value without its specification before Airtable is called', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('Airtable must not be called.'); };
  const incompleteAnswers = [
    { pmsSystem: 'Other', pmsOther: '' },
    { discovery: { requestedServices: ['Other'], requestedServicesOther: '' } },
    { discovery: { lowServiceReasons: ['Other'], lowServiceReasonsOther: '' } },
    { discovery: { bookingSources: { other: 15 }, bookingOtherDetail: '' } },
    { discovery: { preArrivalContact: 'Yes', preArrivalMethods: ['Other'], preArrivalMethodsOther: '' } },
    { discovery: { discoveryChannels: ['Other'], discoveryChannelsOther: '' } },
    { discovery: { repeatedQuestions: ['Other'], repeatedQuestionsOther: '' } },
    { discovery: { requestHandling: ['Other'], requestHandlingOther: '' } },
    { discovery: { postCheckoutContact: 'Yes', postCheckoutMethods: ['Other'], postCheckoutMethodsOther: '' } },
    { discovery: { managementInsights: ['Other'], managementInsightsOther: '' } },
    { discovery: { improvementGoals: ['Other'], improvementGoalsOther: '' } },
  ];
  try {
    for (const overrides of incompleteAnswers) {
      const response = await worker.fetch(new Request('https://worker.example/api/discovery-lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' }, body: JSON.stringify(hotelDiscoveryBriefPayload(overrides)),
      }), { AIRTABLE_API_KEY: 'test', LEADS_AIRTABLE_BASE_ID: 'leads' }, { waitUntil() {} });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /required when Other is selected/i);
    }
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Hotel Discovery Brief serializes multiple Other specifications without changing canonical choices', async () => {
  const originalFetch = globalThis.fetch;
  let writtenFields;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/leads/Hotel%20Leads') && options.method === 'POST') {
      writtenFields = JSON.parse(options.body).fields;
      return Response.json({ id: 'rec_other_brief' });
    }
    if (target.includes('/rec_other_brief/fld_discovery_pdf/uploadAttachment') && options.method === 'POST') return Response.json({ id: 'rec_other_brief', fields: {} });
    throw new Error(`Unexpected request: ${target}`);
  };
  const payload = hotelDiscoveryBriefPayload({
    locale: 'fr',
    pmsSystem: 'Other',
    pmsOther: 'Custom PMS',
    discovery: {
      requestedServices: ['Airport transfers', 'Other'], requestedServicesOther: 'Private chauffeur service',
      lowServiceReasons: ['Other'], lowServiceReasonsOther: 'Seasonal guest mix',
      bookingSources: { other: 15 }, bookingOtherDetail: 'Luxury travel advisors',
      preArrivalContact: 'Yes', preArrivalMethods: ['Other'], preArrivalMethodsOther: 'Guest portal',
      discoveryChannels: ['Other'], discoveryChannelsOther: 'Concierge QR card',
      repeatedQuestions: ['Other'], repeatedQuestionsOther: 'Luggage storage',
      requestHandling: ['Other'], requestHandlingOther: 'Internal radio system',
      postCheckoutContact: 'Yes', postCheckoutMethods: ['Other'], postCheckoutMethodsOther: 'CRM journey',
      managementInsights: ['Other'], managementInsightsOther: 'Return guest conversion',
      improvementGoals: ['Other'], improvementGoalsOther: 'Strengthen VIP recognition',
    },
  });
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/discovery-lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' }, body: JSON.stringify(payload),
    }), { AIRTABLE_API_KEY: 'test', LEADS_AIRTABLE_BASE_ID: 'leads', DISCOVERY_BRIEF_PDF_FIELD_ID: 'fld_discovery_pdf' }, { waitUntil() {} });
    assert.equal(response.status, 201);
    assert.match(writtenFields['Concierge Service Needs'], /Other — Private chauffeur service/);
    assert.match(writtenFields['Concierge Service Needs'], /Other — Internal radio system/);
    assert.match(writtenFields['Concierge Service Needs'], /Other — Strengthen VIP recognition/);
    const lead = { ...payload, roomCount: Number(payload.roomCount), discovery: { ...payload.discovery, bookingSources: { Other: 15 } } };
    const model = buildDiscoveryBriefDocumentModel(lead);
    const operations = model.sections.find((section) => section.title === '5. OPERATIONS');
    assert.ok(operations.questions.some((item) => Array.isArray(item.answer) && item.answer.includes('Other - Internal radio system')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Hotel Discovery Brief accepts supported locales and rejects invalid locale values before Airtable is called', async () => {
  const originalFetch = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/leads/Hotel%20Leads') && options.method === 'POST') {
      writes.push(JSON.parse(options.body).fields);
      return Response.json({ id: 'rec_locale_brief' });
    }
    if (String(url).includes('/rec_locale_brief/fld_discovery_pdf/uploadAttachment') && options.method === 'POST') return Response.json({ id: 'rec_locale_brief', fields: {} });
    throw new Error(`Unexpected request: ${url}`);
  };
  const env = { AIRTABLE_API_KEY: 'test', LEADS_AIRTABLE_BASE_ID: 'leads', DISCOVERY_BRIEF_PDF_FIELD_ID: 'fld_discovery_pdf' };
  try {
    const french = await worker.fetch(new Request('https://worker.example/api/discovery-lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' }, body: JSON.stringify(hotelDiscoveryBriefPayload({ locale: 'fr' })),
    }), env, { waitUntil() {} });
    assert.equal(french.status, 201);
    assert.match(writes[0]['Concierge Service Needs'], /Brief language: French/);

    globalThis.fetch = async () => { throw new Error('Airtable must not be called for an invalid locale.'); };
    const invalid = await worker.fetch(new Request('https://worker.example/api/discovery-lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' }, body: JSON.stringify(hotelDiscoveryBriefPayload({ locale: 'de' })),
    }), env, { waitUntil() {} });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /Locale must be en, fr, or es/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Hotel Discovery Brief rejects oversized free text and accepts empty conditional answers', async () => {
  const originalFetch = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/leads/Hotel%20Leads') && options.method === 'POST') {
      writes.push(JSON.parse(options.body).fields);
      return Response.json({ id: 'rec_optional_brief' });
    }
    if (String(url).includes('/rec_optional_brief/fld_discovery_pdf/uploadAttachment') && options.method === 'POST') {
      return Response.json({ id: 'rec_optional_brief', fields: {} });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const env = { AIRTABLE_API_KEY: 'test', LEADS_AIRTABLE_BASE_ID: 'leads', DISCOVERY_BRIEF_PDF_FIELD_ID: 'fld_discovery_pdf' };
  try {
    const oversized = await worker.fetch(new Request('https://worker.example/api/discovery-lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' }, body: JSON.stringify(hotelDiscoveryBriefPayload({ discovery: { presentationFocus: 'x'.repeat(901) } })),
    }), env, { waitUntil() {} });
    assert.equal(oversized.status, 400);
    assert.match((await oversized.json()).error, /Presentation focus is too long/i);

    const optional = hotelDiscoveryBriefPayload({ phone: '', website: '', roomCount: '', propertyCount: '', pmsSystem: '', whatsAppBusiness: '', discovery: {
      serviceUsage: '', requestedServices: [], lowServiceReasons: [], bookingSources: {}, preArrivalContact: 'No', preArrivalMethods: ['Email'], discoveryChannels: [], internationalOrigins: [], languageDifficulty: '', repeatedQuestions: [], requestHandling: [], responseSpeed: '', postCheckoutContact: 'No', postCheckoutMethods: ['Email'], managementInsights: [], improvementGoals: [], presentationFocus: '',
    } });
    const accepted = await worker.fetch(new Request('https://worker.example/api/discovery-lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' }, body: JSON.stringify(optional),
    }), env, { waitUntil() {} });
    assert.equal(accepted.status, 201);
    assert.equal(writes.length, 1);
    assert.doesNotMatch(writes[0]['Concierge Service Needs'], /Pre-arrival channels/);
    assert.doesNotMatch(writes[0]['Concierge Service Needs'], /Post-checkout channels/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Hotel Discovery Brief PDF creates a sanitized, multi-page internal sales document from the extended brief', async () => {
  const payload = hotelDiscoveryBriefPayload({
    hotelName: 'Hôtel Lumière / Paris',
    discovery: {
      presentationFocus: `Demonstrate the full ConciergeFlow journey. ${'Detailed operational context '.repeat(900)}`,
    },
  });
  const lead = {
    ...payload,
    roomCount: Number(payload.roomCount),
    discovery: {
      ...payload.discovery,
      bookingSources: {
        'Direct hotel website': 35,
        'Booking.com': 40,
        'Expedia / Hotels.com': null,
        'Other OTAs': 10,
        'Travel agencies / corporate': 10,
        Other: 5,
      },
    },
  };
  const pdf = await buildDiscoveryBriefPdf(lead, { submittedAt: new Date('2026-08-28T19:06:00Z') });
  assert.equal(pdf.filename, 'ConciergeFlow_Discovery_Brief_Hotel_Lumiere_Paris.pdf');
  assert.ok(pdf.bytes.length > 2_000);
  assert.equal(new TextDecoder().decode(pdf.bytes.slice(0, 4)), '%PDF');
  assert.ok(pdf.pageCount > 1);
  assert.ok(pdf.model.sections.some((section) => section.title === '5. OPERATIONS'));
  assert.ok(pdf.model.sections[0].questions.some((item) => item.question === 'Brief language' && item.answer === 'English'));
  const frenchModel = buildDiscoveryBriefDocumentModel({ ...lead, locale: 'fr' }, new Date('2026-08-28T19:06:00Z'));
  assert.ok(frenchModel.sections[0].questions.some((item) => item.question === 'Brief language' && item.answer === 'French'));
  assert.match(pdf.model.notes.join('\n'), /multilingual guest communication/i);
  assert.match(pdf.model.notes.join('\n'), /post-stay feedback/i);
});

test('Hotel Discovery Brief PDF omits inapplicable conditional questions and preserves multi-select answers', () => {
  const payload = hotelDiscoveryBriefPayload({ discovery: {
    preArrivalContact: 'No',
    preArrivalMethods: ['Email'],
    postCheckoutContact: 'No',
    postCheckoutMethods: ['Email'],
    requestedServices: ['Airport transfers', 'Spa & wellness'],
  } });
  const model = buildDiscoveryBriefDocumentModel({ ...payload, discovery: { ...payload.discovery, bookingSources: {} } }, new Date('2026-08-28T19:06:00Z'));
  const booking = model.sections.find((section) => section.title === '3. BOOKINGS & COMMUNICATION');
  const operations = model.sections.find((section) => section.title === '5. OPERATIONS');
  const revenue = model.sections.find((section) => section.title === '2. GUEST SERVICES & REVENUE');
  assert.ok(!booking.questions.some((item) => item.question === 'Pre-arrival communication channels'));
  assert.ok(!operations.questions.some((item) => item.question === 'Post-checkout contact methods'));
  assert.deepEqual(revenue.questions.find((item) => item.question === 'Most requested services').answer, ['Airport transfers', 'Spa & wellness']);
  assert.equal(sanitizeDiscoveryBriefFilename('Maison Étoile TEST'), 'ConciergeFlow_Discovery_Brief_Maison_Etoile_TEST.pdf');
});

test('Hotel Discovery Brief preserves the lead if direct attachment upload fails', async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  let leadWrites = 0;
  let uploadAttempts = 0;
  console.error = () => {};
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/leads/Hotel%20Leads') && options.method === 'POST') {
      leadWrites += 1;
      return Response.json({ id: 'rec_attachment_failure' });
    }
    if (target.includes('/rec_attachment_failure/fld_discovery_pdf/uploadAttachment') && options.method === 'POST') {
      uploadAttempts += 1;
      return new Response('Attachment storage rejected the upload.', { status: 500 });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/discovery-lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' }, body: JSON.stringify(hotelDiscoveryBriefPayload()),
    }), { AIRTABLE_API_KEY: 'test', LEADS_AIRTABLE_BASE_ID: 'leads', DISCOVERY_BRIEF_PDF_FIELD_ID: 'fld_discovery_pdf' }, { waitUntil() {} });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /recorded, but the PDF could not be attached/i);
    assert.equal(leadWrites, 1);
    assert.equal(uploadAttempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test('Legacy discovery submissions remain compatible and do not create PDFs', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).includes('/leads/Hotel%20Leads') && options.method === 'POST') return Response.json({ id: 'rec_legacy_discovery' });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/discovery-lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ contactName: 'Legacy Contact', hotelName: 'Legacy Hotel', email: 'legacy@example.test', phone: '+33 1 00 00 00 00', city: 'Paris', roomCount: 40, message: 'Please contact us.', consent: true, sessionId: 'legacy_discovery_test' }),
    }), { AIRTABLE_API_KEY: 'test', LEADS_AIRTABLE_BASE_ID: 'leads', DISCOVERY_BRIEF_PDF_FIELD_ID: 'fld_discovery_pdf' }, { waitUntil() {} });
    assert.equal(response.status, 201);
    assert.equal(calls.length, 1);
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

test('A confirmed restaurant reservation becomes a preferred-collection request', async () => {
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
    assert.equal(body.intent, 'service_request');
    assert.equal(body.recommendations.length, 0);
    assert.equal(body.partner_offers.length, 0);
    assert.match(body.reply, /recorded your request for Le Jardin/i);
    assert.equal(calls.some((url) => url.includes('api.groq.com') || url.includes('app.scrapingbee.com')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('A direct partner booking persists its value in Airtable Revenue', async () => {
  const originalFetch = globalThis.fetch;
  const scheduled = [];
  let requestFields;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/Services')) return Response.json({ records: [{
      fields: { Name: 'Lumière Spa — Couples Massage', Category: 'spa', PriceEUR: 220, Active: true, IsPartner: true },
    }] });
    if (target.includes('/Requests') && options.method === 'POST') {
      requestFields = JSON.parse(options.body).fields;
      return Response.json({ id: 'rec_revenue_request', fields: requestFields });
    }
    if (target.includes('api.airtable.com')) return Response.json({ records: [], id: 'rec_fixture' });
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({
        message: 'Please book a couples massage for 2 people.', sessionId: 'qa_booking_revenue', guestName: 'Revenue Guest', isDemo: true, testMode: 'write_verified',
      }),
    }), {
      GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', HOTEL_NAME: 'Hotel', HOTEL_CITY: 'Paris',
    }, { waitUntil(promise) { scheduled.push(promise); } });
    await Promise.all(scheduled);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.intent, 'service_request');
    assert.equal(requestFields?.ServiceType, 'Spa & Wellness');
    assert.equal(requestFields?.Revenue, 220);
    assert.equal(Object.hasOwn(requestFields, 'EstValueEUR'), false);
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

test('A services question returns a concise catalogue introduction with structured collection data', async () => {
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
    assert.equal(body.catalogue_count, 2);
    assert.equal(body.hotel_collection.length, 2);
    assert.equal(body.partner_offers.length, 0);
    assert.equal(body.recommendations.length, 0);
    assert.match(body.reply, /rooms, dining, spa/i);
    assert.equal(body.media, null);
    assert.deepEqual(body.quickReplies, ['Rooms & Suites', 'Dining', 'Spa & Wellness']);
    assert.equal(calls.some((url) => url.includes('api.groq.com') || url.includes('app.scrapingbee.com')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('The complete 12-service catalogue stays structured instead of becoming a text dump', async () => {
  const catalogueRecords = Array.from({ length: 12 }, (_, index) => {
    const categories = ['accommodation', 'spa', 'restaurant', 'transport', 'tour', 'experience'];
    const category = categories[index % categories.length];
    return {
      fields: {
        Name: `${category} service ${index + 1}`,
        Category: category,
        Description: `A ${category} offering.`,
        Active: true,
        IsPartner: true,
      },
    };
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes('/Services')) return Response.json({ records: catalogueRecords });
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'Please show every hotel service you offer.', sessionId: 'qa_full_catalogue', testMode: 'read_only' }),
    }), {
      GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', HOTEL_NAME: 'Hotel', HOTEL_CITY: 'Paris',
    }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.intent, 'partner_catalog');
    assert.equal(body.catalogue_count, 12);
    assert.equal(body.catalogue_categories, 6);
    assert.equal(body.hotel_collection.length, 12);
    assert.equal(body.partner_offers.length, 0);
    assert.equal(body.recommendations.length, 0);
    assert.match(body.reply, /what would you like to explore first/i);
    assert.equal(body.media, null);
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
    assert.equal(body.hotel_collection.length, 2);
    assert.match(body.reply, /what would you like to explore first/i);
    assert.equal(body.media, null);
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
    assert.match(body.reply, /hôtel lumière collection/i);
    assert.equal(calls.some((url) => url.includes('api.groq.com') || url.includes('app.scrapingbee.com')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Specific hotel categories take precedence over the broad collection and never attach the general directory', async () => {
  const categoryRecords = [
    { fields: { Name: 'Courtyard Junior Suite', Category: 'accommodation', Description: 'A calm courtyard suite.', Active: true, IsPartner: true } },
    { fields: { Name: 'Le Jardin', Category: 'restaurant', Description: 'Seasonal dining.', Active: true, IsPartner: true } },
    { fields: { Name: 'Lumière Spa Ritual', Category: 'spa', Description: 'Wellness treatment.', Active: true, IsPartner: true } },
    { fields: { Name: 'CDG Arrival Transfer', Category: 'transport', Description: 'Private arrival transfer.', Active: true, IsPartner: true } },
    { fields: { Name: 'Private Louvre Visit', Category: 'experience', Description: 'A private Paris experience.', Active: true, IsPartner: true } },
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/Services')) return Response.json({ records: categoryRecords });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    for (const [message, category] of [
      ['Show me your rooms and suites.', 'accommodation'],
      ['What dining experiences are available at Hôtel Lumière?', 'restaurant'],
      ['Do you offer airport transfers?', 'transport'],
      ['What private experiences do you offer?', 'experience'],
    ]) {
      const response = await worker.fetch(new Request('https://worker.example/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
        body: JSON.stringify({ message, sessionId: `qa_category_${category}`, testMode: 'read_only' }),
      }), { GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test' }, { waitUntil() {} });
      const body = await response.json();
      assert.equal(body.intent, 'partner_request');
      assert.ok(body.partner_offers.length > 0);
      assert.ok(body.partner_offers.every((offer) => offer.category === category));
      assert.equal(body.media, null);
      assert.equal(body.reply.includes('complete digital directory'), false);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Explicit brochure wording retains the verified general directory media', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/Services')) return Response.json({ records });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'Send me the hotel brochure.', sessionId: 'qa_directory', testMode: 'read_only' }),
    }), { GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test' }, { waitUntil() {} });
    const body = await response.json();
    assert.equal(body.intent, 'partner_catalog');
    assert.equal(body.media?.filename, 'Lumiere_Guest_Directory_2026.pdf');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Stay planning is conversational and never becomes an external exact-match failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Stay planning should not fetch services, Groq, or external search.'); };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({ message: 'Help me plan a stay at Hôtel Lumière in Paris.', sessionId: 'qa_stay_planning', testMode: 'read_only' }),
    }), {}, { waitUntil() {} });
    const body = await response.json();
    assert.equal(body.intent, 'stay_planning');
    assert.match(body.reply, /happy to help plan your stay/i);
    assert.doesNotMatch(body.reply, /could not verify/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Pre-arrival catalogue engagement exposes one safe follow-up and suppresses it for staff ownership or a decline', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/Services')) return Response.json({ records });
    throw new Error(`Unexpected request: ${url}`);
  };
  const requestBody = (overrides = {}) => JSON.stringify({
    message: 'View Services',
    sessionId: 'qa_prearrival_followup',
    scenario: 'pre-arrival',
    chatHistory: [{ role: 'assistant', content: 'Welcome to Hôtel Lumière.' }],
    testMode: 'read_only',
    ...overrides,
  });
  try {
    const makeRequest = (body) => worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' }, body,
    }), { GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test' }, { waitUntil() {} });
    const eligible = await (await makeRequest(requestBody())).json();
    assert.deepEqual(eligible.next_step, { type: 'guest_follow_up', key: 'first_time_paris', text: 'By the way, is this your first time in Paris?', delay_ms: 1800 });
    const staffOwned = await (await makeRequest(requestBody({ conversationOwner: 'staff' }))).json();
    assert.equal(staffOwned.next_step, null);
    const declined = await (await makeRequest(requestBody({ message: 'View Services, but no thanks, I am busy.' }))).json();
    assert.equal(declined.next_step, null);
    const alreadyAsked = await (await makeRequest(requestBody({ chatHistory: [{ role: 'assistant', content: 'By the way, is this your first time in Paris?' }] }))).json();
    assert.equal(alreadyAsked.next_step, null);
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
    assert.equal(writtenFields.ServiceType, 'Concierge');
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

test('A catalog request never searches externally or exposes structured booking controls', async () => {
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
    assert.equal(body.hotel_collection.length, 2);
    assert.equal(body.partner_offers.length, 0);
    assert.equal(body.recommendations.length, 0);
    assert.match(body.reply, /what would you like to explore first/i);
    assert.equal(body.media, null);
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
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io', 'CF-Connecting-IP': '203.0.113.90' },
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
    assert.equal(data.staff_alerts[0].role, 'General Manager');
    assert.ok(writtenTables.length > 0);
    assert.ok(writtenTables.every((entry) => entry.fields.Is_Demo === true));
    const guestWrite = writtenTables.find((w) => w.url.includes('/Guests'));
    assert.equal(guestWrite?.fields.GuestName, 'Angry Guest');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Spa menu requests return only spa offers and the spa brochure', async () => {
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
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io', 'CF-Connecting-IP': '203.0.113.87' },
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
    assert.equal(data.status, undefined);
    assert.equal(data.intent, 'partner_request');
    assert.match(data.reply, /spa & wellness/i);
    assert.equal(data.media?.filename, 'Lumiere_Spa_Wellness_Menu.pdf');
    assert.equal(data.hotel_collection, undefined);
    assert.equal(data.partner_offers.length, 1);
    assert.equal(data.recommendations.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Operational requests: Physical items (towels/water) prepare a Housekeeping request with zero upselling', async () => {
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
    assert.match(data.reply, /prepared your request|request queue/i);
    assert.doesNotMatch(data.reply, /notified|dispatched|received by/i);
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

test('Operational routing deterministically separates Housekeeping from Maintenance', () => {
  for (const message of [
    'Please bring extra towels and clean the room.',
    'Could I have fresh linen and toiletries?',
  ]) {
    assert.equal(isOperationalRequest(message), true);
    assert.equal(operationalServiceType(message), 'Housekeeping');
  }
  for (const message of [
    'The air conditioning is not working.',
    'There is a plumbing leak by the sink.',
    'Our door lock is broken and the electrical outlet has stopped working.',
  ]) {
    assert.equal(isOperationalRequest(message), true);
    assert.equal(operationalServiceType(message), 'Maintenance');
  }
});

test('Operational requests: maintenance issues prepare a Maintenance request', async () => {
  const originalFetch = globalThis.fetch;
  const writtenTables = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('api.airtable.com')) {
      if (options.body) writtenTables.push({ url: target, fields: JSON.parse(options.body).fields });
      return Response.json({ records: [], id: 'rec_maintenance_test' });
    }
    throw new Error(`Unexpected call: ${url}`);
  };
  const scheduled = [];
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/demo-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({
        guestName: 'Maintenance Guest',
        language: 'English',
        scenario: 'in-stay',
        is_demo: true,
        sessionId: 'demo_in_stay_ac',
        chatHistory: [{ role: 'user', content: 'The air conditioning is broken in room 402.' }],
      }),
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', DEMO_ALLOWED_ORIGIN: 'https://flowarchitect-agency.github.io' }, {
      waitUntil(promise) { scheduled.push(promise); },
    });
    const data = await response.json();
    await Promise.all(scheduled);
    assert.equal(response.status, 200);
    assert.equal(data.requests?.[0]?.service_type, 'Maintenance');
    assert.doesNotMatch(data.reply, /notified|dispatched|received by/i);
    const requestWrite = writtenTables.find((entry) => entry.url.includes('/Requests'));
    assert.equal(requestWrite?.fields.ServiceType, 'Maintenance');
    assert.equal(requestWrite?.fields.IsUpsell, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Operational, escalation, and recovery copy does not claim a human was notified or dispatched', () => {
  const replies = [
    ...Object.values(OPERATIONAL_REPLIES),
    ...Object.values(ESCALATION_REPLIES),
    postCheckoutNegativeReply('Truth Test', 'en'),
  ];
  for (const reply of replies) {
    assert.doesNotMatch(reply, /staff (?:were|was)?\s*notified|team (?:were|was)?\s*notified|has been notified|have notified|alerted|received your request|stepping in|dispatched/i);
  }
});

test('Media contract returns only shipped brochures with verified metadata', () => {
  const workerRoot = fileURLToPath(new URL('..', import.meta.url));
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const directoryPath = `${repoRoot}Lumiere_Guest_Directory_2026.pdf`;
  const spaPath = `${repoRoot}Lumiere_Spa_Wellness_Menu.pdf`;
  assert.equal(existsSync(directoryPath), true);
  assert.equal(existsSync(spaPath), true);
  assert.equal(statSync(directoryPath).size, 27339632);
  assert.equal(statSync(spaPath).size, 1063);
  assert.ok(workerRoot, 'The Worker test path should resolve deterministically.');

  const directory = detectMediaBrochure('Please send the hotel directory PDF.');
  const spa = detectMediaBrochure('Please send the spa menu.', 'spa');
  assert.deepEqual([directory?.filename, directory?.size, directory?.pages], ['Lumiere_Guest_Directory_2026.pdf', '27.3 MB', '10 pages']);
  assert.deepEqual([spa?.filename, spa?.size, spa?.pages], ['Lumiere_Spa_Wellness_Menu.pdf', '1.1 KB', '1 page']);
  assert.equal(detectMediaBrochure('Please send the dining menu brochure.', 'restaurant'), null);
  assert.equal(detectMediaBrochure('Please send the suites collection brochure.', 'accommodation'), null);
});

test('Every booking ticket receives a valid ServiceType instead of Other', async () => {
  const originalFetch = globalThis.fetch;
  let requestFields;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/Requests') && options.body) requestFields = JSON.parse(options.body).fields;
    if (target.includes('api.airtable.com')) return Response.json({ id: 'rec_booking_type' });
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/booking-enquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io', 'CF-Connecting-IP': '203.0.113.86' },
      body: JSON.stringify({
        guestName: 'Type Test Guest', email: 'type-test@example.com', serviceName: 'Custom request',
        serviceType: 'other', source: 'partner', consent: true, sessionId: 'qa_booking_service_type',
      }),
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test' }, { waitUntil() {} });
    assert.equal(response.status, 201);
    assert.equal(requestFields?.ServiceType, 'Concierge');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Service type normalization permits only the seven dashboard buckets', () => {
  assert.deepEqual([
    normalizeServiceType('housekeeping'),
    normalizeServiceType('AC repair'),
    normalizeServiceType('Spa'),
    normalizeServiceType('airport transfer'),
    normalizeServiceType('restaurant'),
    normalizeServiceType('front desk'),
    normalizeServiceType('escalation'),
    normalizeServiceType('totally unknown category'),
  ], [
    'Housekeeping',
    'Maintenance',
    'Spa & Wellness',
    'Transport',
    'Dining',
    'Concierge',
    'General Manager',
    'Concierge',
  ]);
});

test('Manager metrics use operational tickets times fifteen saved minutes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/Requests')) {
      return Response.json({ records: [
        { fields: { ServiceType: 'Housekeeping' } },
        { fields: { ServiceType: 'Maintenance' } },
        { fields: { ServiceType: 'Dining' } },
        { fields: { ServiceType: 'Concierge' } },
        { fields: { ServiceType: 'Housekeeping', Is_Demo: true } },
      ] });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/manager/metrics', {
      headers: { Origin: 'https://flowarchitect-agency.github.io' },
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test' }, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      operational_tickets: 2,
      minutes_saved: 30,
      hours_saved: 0.5,
      minutes_per_ticket: 15,
      formula: 'operational tickets × 15 minutes ÷ 60',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Airtable rate limiting uses bounded Retry-After retries', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    if (!String(url).includes('/Requests')) throw new Error(`Unexpected request: ${url}`);
    calls += 1;
    return new Response(JSON.stringify({ error: { type: 'RATE_LIMITED' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '0' },
    });
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/manager/metrics', {
      headers: { Origin: 'https://flowarchitect-agency.github.io' },
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test' }, { waitUntil() {} });
    assert.equal(response.status, 502);
    assert.equal(calls, 3, 'Airtable retries must stop at the configured attempt bound.');
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

test('Post-Checkout Negative: recovery is prepared without suppressing neutral public review access', async () => {
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
    assert.match(data.reply, /prepared a private service-recovery request/i);
    assert.doesNotMatch(data.reply, /escalated|manager.*reviewing|notified/i);
    assert.equal(data.requires_human, true);
    assert.equal(data.escape_hatch_triggered, true);
    assert.ok(data.media?.url.includes('g.page'));
    assert.deepEqual(data.quickReplies, ['Leave Google Review', 'Share on TripAdvisor']);
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

test('Booking Intent Negation: Guest refusal with service keyword aborts booking sequence without false positive requests', async () => {
  const originalFetch = globalThis.fetch;
  const writtenTables = [];
  const scheduled = [];
  try {
    globalThis.fetch = async (url, options = {}) => {
      const target = typeof url === 'string' ? url : url.url || '';
      if (options.method === 'POST') {
        writtenTables.push({ url: target, fields: JSON.parse(options.body).fields });
        return new Response(JSON.stringify({ id: 'rec_neg_test', fields: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (target.includes('/Services')) {
        return new Response(JSON.stringify({ records: [
          { id: 'rec1', fields: { ServiceName: 'Montmartre Walking Food Tour', Category: 'Tour', Partner: true, Active: true, Price: 280 } },
          { id: 'rec2', fields: { ServiceName: 'Lumière Spa — Couples Massage', Category: 'Spa', Partner: true, Active: true, Price: 420 } }
        ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (target.includes('api.groq.com')) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            reply_text: 'Understood! Exploring Paris on foot is a wonderful way to experience the city. Let me know if you would like any neighborhood walking tips.',
            language_detected: 'English',
            intent: 'smalltalk',
            service_type: 'Concierge',
            requests: [],
            requires_human: false
          }) } }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const response = await worker.fetch(new Request('https://worker.example/api/demo-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({
        guestName: 'Browsing Guest',
        language: 'English',
        scenario: 'in-stay',
        is_demo: true,
        sessionId: 'demo_refusal_session',
        chatHistory: [
          { role: 'assistant', content: 'We offer the Montmartre Walking Food Tour or Versailles Private Day Trip.' },
          { role: 'user', content: 'Ah okay. No, I do not want to book any private tours or chauffeurs, just going to explore on my own.' }
        ],
      }),
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', GROQ_API_KEY: 'test', DEMO_ALLOWED_ORIGIN: 'https://flowarchitect-agency.github.io' }, {
      waitUntil(p) { scheduled.push(p); },
    });

    const data = await response.json();
    await Promise.all(scheduled);
    assert.equal(response.status, 200);
    assert.doesNotMatch(data.reply, /I have recorded your request for Montmartre/i);
    assert.doesNotMatch(data.reply, /I have recorded your request for/i);
    const requestWrites = writtenTables.filter((w) => w.url.includes('/Requests'));
    assert.equal(requestWrites.length, 0, 'No booking requests should be created when guest refuses');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Graceful Failure Handling: downstream failures do not fabricate a staff handoff', async () => {
  const originalFetch = globalThis.fetch;
  const scheduled = [];
  try {
    globalThis.fetch = async () => {
      throw new Error('Network timeout connecting to upstream service');
    };

    const response = await worker.fetch(new Request('https://worker.example/api/demo-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowarchitect-agency.github.io' },
      body: JSON.stringify({
        guestName: 'Stuck Guest',
        language: 'English',
        scenario: 'in-stay',
        is_demo: true,
        sessionId: 'demo_failure_session',
        chatHistory: [
          { role: 'user', content: 'What are the top museum tours today?' }
        ],
      }),
    }), { AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', GROQ_API_KEY: 'test', DEMO_ALLOWED_ORIGIN: 'https://flowarchitect-agency.github.io' }, {
      waitUntil(p) { scheduled.push(p); },
    });

    const data = await response.json();
    await Promise.all(scheduled);
    assert.equal(response.status, 200);
    assert.match(data.reply, /experiencing a brief system delay/i);
    assert.match(data.reply, /could not prepare your request/i);
    assert.doesNotMatch(data.reply, /notified the front desk|dispatched|received/i);
    assert.equal(data.requires_human, false);
    assert.equal(data.escape_hatch_triggered, false);
    assert.deepEqual(data.staff_alerts, []);
    assert.deepEqual(data.requests, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
