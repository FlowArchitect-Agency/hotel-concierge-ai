import {
  buildPrompt,
  classifyRequest,
  enforceContract,
  inheritConversationContext,
  matchingServices,
  parseExternalResults,
  parseGuestInput,
  parseModelJson,
  shouldSearchExternal,
} from './concierge.js';

const RECENT_REQUESTS = new Map();

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return '*';
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) return origin;
  if (origin === 'null') return 'null';
  const configured = env.ALLOWED_ORIGIN || 'https://flowarchitect-agency.github.io';
  if (origin === configured) return origin;
  return origin;
}

function cors(request, env, contentType = 'application/json; charset=utf-8') {
  const origin = allowedOrigin(request, env);
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { 'Access-Control-Allow-Origin': '*' }),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-Requested-With',
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  };
}

function response(body, status, request, env) {
  return new Response(JSON.stringify(body), { status, headers: cors(request, env) });
}

function rateLimited(request) {
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const timestamps = (RECENT_REQUESTS.get(key) || []).filter((value) => now - value < 60_000);
  timestamps.push(now);
  RECENT_REQUESTS.set(key, timestamps);
  return timestamps.length > 20;
}

function requireSecrets(env) {
  const missing = ['GROQ_API_KEY', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID'].filter((name) => !env[name]);
  if (missing.length) throw new Error(`Service configuration is incomplete: ${missing.join(', ')}`);
}

function requireAirtable(env) {
  const missing = ['AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID'].filter((name) => !env[name]);
  if (missing.length) throw new Error(`Service configuration is incomplete: ${missing.join(', ')}`);
}

function requireLeadsAirtable(env) {
  const missing = ['AIRTABLE_API_KEY', 'LEADS_AIRTABLE_BASE_ID'].filter((name) => !env[name]);
  if (missing.length) throw new Error(`Lead capture configuration is incomplete: ${missing.join(', ')}`);
}

async function airtable(env, table, { method = 'GET', params, fields, baseId = env.AIRTABLE_BASE_ID } = {}) {
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const result = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: fields ? JSON.stringify({ fields }) : undefined,
  });
  if (!result.ok) throw new Error(`Airtable ${table} request failed (${result.status}).`);
  return result.json();
}

async function fetchServices(env) {
  const payload = await airtable(env, 'Services', {
    params: { filterByFormula: '{Active}=TRUE()', pageSize: 100 },
  });
  return payload.records || [];
}

async function fetchHistory(env, userId) {
  const safeUser = userId.replace(/'/g, "\\'");
  const payload = await airtable(env, 'Conversations', {
    params: {
      filterByFormula: `{UserID}='${safeUser}'`,
      'sort[0][field]': 'Timestamp',
      'sort[0][direction]': 'desc',
      maxRecords: 12,
    },
  });
  return (payload.records || []).map((record) => ({
    role: record.fields?.Role === 'assistant' ? 'assistant' : 'user',
    message: String(record.fields?.Message || ''),
  })).filter((item) => item.message).reverse();
}

async function fetchFacts(env) {
  const fallback = `- Hotel: ${env.HOTEL_NAME || 'H\u00f4tel Lumi\u00e8re Paris'}\n- City: ${env.HOTEL_CITY || 'Paris'}`;
  try {
    const payload = await airtable(env, 'Settings', { params: { pageSize: 50 } });
    const lines = (payload.records || []).map((record) => {
      const fields = record.fields || {};
      return fields.Key ? `- ${fields.Key}: ${fields.Value ?? ''}` : '';
    }).filter(Boolean);
    return { hotelName: env.HOTEL_NAME || 'H\u00f4tel Lumi\u00e8re Paris', text: lines.join('\n') || fallback };
  } catch {
    return { hotelName: env.HOTEL_NAME || 'H\u00f4tel Lumi\u00e8re Paris', text: fallback };
  }
}

function locationSearchHint(location) {
  const value = String(location || '').trim();
  if (/eiffel tower|tour eiffel/i.test(value)) return 'Paris 7th arrondissement';
  return value;
}

async function googleSearch(env, query, classification) {
  const url = new URL('https://app.scrapingbee.com/api/v1/store/google');
  url.searchParams.set('search', query);
  url.searchParams.set('country_code', 'fr');
  url.searchParams.set('language', 'en');
  url.searchParams.set('light_request', 'true');
  try {
    const result = await fetch(url, { headers: { Authorization: `Bearer ${env.SCRAPINGBEE_API_KEY}` } });
    if (!result.ok) return [];
    return parseExternalResults(await result.json(), classification);
  } catch {
    return [];
  }
}

async function externalSearch(env, input, classification) {
  if (!env.SCRAPINGBEE_API_KEY) return [];
  const city = env.HOTEL_CITY || 'Paris';
  const location = locationSearchHint(classification.location);
  // Keep purpose-built searches for cuisines and final-day itineraries: they
  // carry stronger constraints than a general semantic summary. The planner
  // supplies a query only for genuinely unfamiliar discovery requests.
  const plannedQuery = !classification.cuisine && classification.category !== 'itinerary'
    ? String(classification.searchQuery || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 180)
    : '';
  const primaryQuery = plannedQuery
    ? `${plannedQuery} official website`
    : classification.cuisine
      ? `${classification.cuisine.label} restaurant ${location || city} official website`
      : classification.category === 'itinerary'
        ? `${city} Louvre museum Seine cruise official website`
        : `${classification.category || 'local service'} ${city} official website`;
  const options = await googleSearch(env, primaryQuery, classification);
  if (options.length) return options;

  // A combined itinerary query can occasionally return no useful result from
  // a changing search index. Retry with a broader, guest-safe itinerary
  // phrasing before asking the guest to refine a perfectly clear request.
  if (classification.category === 'itinerary') {
    return googleSearch(env, `${city} museum visit and Seine cruise official website`, classification);
  }

  // Google results are volatile. If a narrowly located cuisine search yields
  // no directly verifiable venue, retry once with the same strict cuisine but
  // city-wide scope instead of telling the guest we found nothing.
  if (classification.cuisine && location) {
    return googleSearch(env, `${classification.cuisine.label} restaurant ${city} official website`, classification);
  }
  return [];
}

function preferenceForOneRecommendation(message) {
  const text = String(message ?? '').toLowerCase();
  return /\b(the best|best one|only one|just one|one that'?s best|one excellent)\b/.test(text);
}

async function callLLM(env, prompt, { maxTokens = 350, router = false } = {}) {
  if (env.GEMINI_API_KEY) {
    try {
      const geminiModel = env.GEMINI_MODEL || 'gemini-1.5-flash';
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${env.GEMINI_API_KEY}`;
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens, temperature: 0.2 }
        })
      });
      if (response.ok) {
        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (content) return { content, providerFailure: '' };
      }
    } catch {
      /* fallback to Groq / OpenAI */
    }
  }

  const apiKey = env.GROQ_API_KEY || env.OPENAI_API_KEY || env.OPENROUTER_API_KEY;
  if (!apiKey) return { content: '', providerFailure: 'missing_api_key' };

  const baseUrl = env.GROQ_API_KEY
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : (env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions');

  const models = [
    router ? (env.GROQ_ROUTER_MODEL || env.GROQ_MODEL || 'qwen/qwen3.6-27b') : (env.GROQ_MODEL || 'qwen/qwen3.6-27b'),
    env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b',
  ].filter((model, index, values) => model && values.indexOf(model) === index);

  let failure = '';
  for (const model of models) {
    try {
      const body = {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        ...(model.startsWith('qwen/') ? { reasoning_effort: 'none', reasoning_format: 'hidden' } : {}),
      };
      const result = await fetch(baseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!result.ok) {
        failure = `http_${result.status}`;
        continue;
      }
      const data = await result.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) return { content, providerFailure: '' };
      failure = 'empty_response';
    } catch {
      failure = 'request_error';
    }
  }
  return { content: '', providerFailure: failure || 'provider_unavailable' };
}
const callGroq = callLLM;

const ROUTES = new Set(['greeting', 'hotel_faq', 'partner_catalog', 'partner_request', 'external_discovery', 'conversation']);
const SERVICE_CATEGORIES = new Set(['spa', 'restaurant', 'transport', 'tour', 'experience', 'itinerary']);
const BOOKABLE_SERVICE_TYPES = new Set(['spa', 'restaurant', 'transport', 'tour', 'experience']);

function routerJson(raw) {
  const text = String(raw || '').trim();
  const candidate = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    const parsed = JSON.parse(candidate);
    const route = ROUTES.has(parsed.route) ? parsed.route : null;
    if (!route) return null;
    const category = SERVICE_CATEGORIES.has(parsed.category) ? parsed.category : null;
    const query = String(parsed.search_query || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 180);
    return { route, category, searchQuery: query };
  } catch {
    return null;
  }
}

function routerPrompt(input, history) {
  const recentHistory = (history || []).slice(-6).map((item) => `${item.role}: ${item.message}`).join('\n') || '(no prior conversation)';
  return `You are the intent router for a five-star hotel concierge in Paris. Return JSON only, never answer the guest.

Classify every message using exactly one route:
- greeting: a simple greeting, thanks, acknowledgement, or casual small talk.
- hotel_faq: a question that can be answered only from hotel facts supplied later, such as check-in or hotel amenities.
- partner_catalog: asking what the hotel offers, asking if this is all the hotel provides, or asking for the list of partner services/offers.
- partner_request: clearly asking to reserve or arrange a conventional hotel service.
- external_discovery: asking for a recommendation, itinerary, venue, activity, event, shopping, transportation, food, nightlife, or any unusual/new need that requires current information beyond a known hotel catalogue.
- conversation: only when none of the above applies.

Critical rule: do not require a keyword match. If the guest wants help finding, choosing, suggesting, planning, seeing, buying, celebrating, or doing something in Paris, use external_discovery even if the request is unusual or written in another language. Follow-up requests inherit the earlier guest need from history.

Return exactly:
{"route":"greeting|hotel_faq|partner_catalog|partner_request|external_discovery|conversation","category":"spa|restaurant|transport|tour|experience|itinerary|null","search_query":"a concise Paris web-search query or empty string"}

For external_discovery, search_query must describe the guest's exact need, include Paris when appropriate, and contain no instruction or commentary. Otherwise return an empty search_query.

RECENT CONVERSATION:
${recentHistory}

LATEST GUEST MESSAGE:
${input.message}`;
}

async function enrichSemanticRoute(env, input, history, classification) {
  const basicGreeting = !classification.hasIntent && !String(input.message || '').trim().includes(' ');
  if (basicGreeting) return classification;
  const provider = await callGroq(env, routerPrompt(input, history), { maxTokens: 180, router: true });
  const route = routerJson(provider.content);
  if (!route) return classification;
  const externalDiscovery = route.route === 'external_discovery';
  const actionable = !['greeting', 'conversation'].includes(route.route);
  return {
    ...classification,
    category: classification.category || route.category,
    hasIntent: actionable || classification.hasIntent,
    route: route.route,
    externalDiscovery,
    searchQuery: externalDiscovery ? route.searchQuery : '',
  };
}

async function persistConversation(env, input, outcome) {
  const time = new Date().toISOString();
  await Promise.all([
    airtable(env, 'Conversations', {
      method: 'POST',
      fields: { UserID: input.userId, Channel: input.channel, Role: 'user', Message: input.message, Language: input.language, Timestamp: input.receivedAt },
    }),
    airtable(env, 'Conversations', {
      method: 'POST',
      fields: { UserID: input.userId, Channel: input.channel, Role: 'assistant', Message: outcome.reply, Language: input.language, Timestamp: time },
    }),
  ]);
  const requests = outcome.requests.filter((item) => item.summary);
  await Promise.all(requests.map((item) => airtable(env, 'Requests', {
    method: 'POST',
    fields: {
      UserID: input.userId,
      Channel: input.channel,
      ServiceType: outcome.serviceType || 'other',
      RequestSummary: item.summary,
      Source: item.source === 'external' ? 'external' : 'partner',
      ServiceRef: item.serviceName || '',
      Status: 'new',
      EstValueEUR: item.estValueEur ?? undefined,
      IsUpsell: Boolean(item.isUpsell),
      Language: input.language,
      HandoverAt: time,
    },
  })));
}

const PARTNER_CARD_IMAGES = {
  spa: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1200&q=85',
  restaurant: 'https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?auto=format&fit=crop&w=1200&q=85',
  transport: 'https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&w=1200&q=85',
  tour: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1200&q=85',
  experience: 'https://images.unsplash.com/photo-1522093007474-d86e9bf7ba6f?auto=format&fit=crop&w=1200&q=85',
};

function partnerOffers(services) {
  return services.filter((service) => service.isPartner).slice(0, 5).map((service) => ({
    name: service.name,
    description: String(service.description || 'A considered experience from the hotel\u2019s preferred collection.').slice(0, 240),
    category: service.category || 'experience',
    price_eur: Number.isFinite(Number(service.price)) ? Number(service.price) : null,
    duration_mins: Number.isFinite(Number(service.duration)) ? Number(service.duration) : null,
    location: service.location || '',
    image_url: service.imageUrl || PARTNER_CARD_IMAGES[service.category] || PARTNER_CARD_IMAGES.experience,
  }));
}

const CURATED_DINING_IMAGES = {
  italian: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=1200&q=84',
  spanish: 'https://images.unsplash.com/photo-1533777324565-a040eb52facd?auto=format&fit=crop&w=1200&q=84',
  bakery: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1200&q=84',
};

const CURATED_DINING_INTRO = {
  en: 'I have selected a few excellent Paris addresses from our curated dining guide. They are independent recommendations, and our concierge will verify availability once you choose.',
  fr: 'J\u2019ai s\u00e9lectionn\u00e9 quelques excellentes adresses parisiennes dans notre guide de tables. Ce sont des recommandations ind\u00e9pendantes ; notre conciergerie v\u00e9rifiera la disponibilit\u00e9 d\u00e8s votre choix.',
  es: 'He seleccionado algunas excelentes direcciones parisinas de nuestra guia gastronomica. Son recomendaciones independientes y nuestro concierge verificara la disponibilidad cuando elija una.',
  de: 'Ich habe einige ausgezeichnete Pariser Adressen aus unserem kuratierten Dining Guide ausgewahlt. Es sind unabhangige Empfehlungen; unser Concierge pruft die Verfugbarkeit, sobald Sie eine auswahlen.',
  it: 'Ho selezionato alcuni ottimi indirizzi parigini dalla nostra guida gastronomica curata. Sono consigli indipendenti e il nostro concierge verifichera la disponibilita quando ne scegliera uno.',
  ja: '\u30d1\u30ea\u306e\u53b3\u9078\u30c0\u30a4\u30cb\u30f3\u30b0\u30ac\u30a4\u30c9\u304b\u3089\u3001\u3059\u3070\u3089\u3057\u3044\u5019\u88dc\u3092\u3044\u304f\u3064\u304b\u9078\u3073\u307e\u3057\u305f\u3002\u3053\u308c\u3089\u306f\u72ec\u7acb\u3057\u305f\u63a8\u8350\u3067\u3001\u3054\u5e0c\u671b\u306e\u5019\u88dc\u304c\u6c7a\u307e\u308a\u6b21\u7b2c\u3001\u30b3\u30f3\u30b7\u30a7\u30eb\u30b8\u30e5\u304c\u7a7a\u304d\u72b6\u6cc1\u3092\u78ba\u8a8d\u3057\u307e\u3059\u3002',
  zh: '\u6211\u4ece\u7cbe\u9009\u7684\u5df4\u9ece\u7f8e\u98df\u6307\u5357\u4e2d\u4e3a\u60a8\u9009\u4e86\u51e0\u5bb6\u4f18\u79c0\u9910\u5385\u3002\u5b83\u4eec\u662f\u72ec\u7acb\u63a8\u8350\uff0c\u60a8\u9009\u5b9a\u540e\u793c\u5bbe\u56e2\u961f\u4f1a\u786e\u8ba4\u53ef\u9884\u8ba2\u60c5\u51b5\u3002',
  ar: '\u0627\u062e\u062a\u0631\u062a \u0644\u0643\u0645 \u0628\u0639\u0636 \u0627\u0644\u0639\u0646\u0627\u0648\u064a\u0646 \u0627\u0644\u0645\u0645\u064a\u0632\u0629 \u0641\u064a \u0628\u0627\u0631\u064a\u0633 \u0645\u0646 \u062f\u0644\u064a\u0644\u0646\u0627 \u0627\u0644\u0645\u0646\u0633\u0642. \u0647\u0630\u0647 \u062a\u0648\u0635\u064a\u0627\u062a \u0645\u0633\u062a\u0642\u0644\u0629\u060c \u0648\u0633\u064a\u062a\u062d\u0642\u0642 \u0627\u0644\u0643\u0648\u0646\u0633\u064a\u0631\u062c \u0645\u0646 \u0627\u0644\u062a\u0648\u0641\u0631 \u0628\u0639\u062f \u0627\u062e\u062a\u064a\u0627\u0631\u0643\u0645.',
};

function isSafeWebsiteUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function curatedDiningResponse(input, classification, services) {
  if (classification.category !== 'restaurant' || !classification.cuisine || classification.location) return null;
  const eligible = services.filter((service) => !service.isPartner && isSafeWebsiteUrl(service.websiteUrl));
  if (!eligible.length) return null;
  const cards = (preferenceForOneRecommendation(input.message) ? eligible.slice(0, 1) : eligible.slice(0, 3)).map((service) => ({
    name: service.name,
    description: String(service.description || `A curated ${classification.cuisine.label} address in Paris.`).slice(0, 240),
    website_url: isSafeWebsiteUrl(service.websiteUrl),
    image_url: isSafeWebsiteUrl(service.imageUrl) || CURATED_DINING_IMAGES[classification.cuisine.id] || PARTNER_CARD_IMAGES.restaurant,
  }));
  if (!cards.length) return null;
  return {
    reply: CURATED_DINING_INTRO[input.language] || CURATED_DINING_INTRO.en,
    language: input.language,
    intent: 'service_request',
    external_option_names: cards.map((card) => card.name),
    recommendations: cards,
    partner_offers: [],
    provider_failure: '',
    requires_human: true,
  };
}

function compactText(value, field, { required = false, max = 500 } = {}) {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !text) throw new Error(`${field} is required.`);
  if (text.length > max) throw new Error(`${field} is too long.`);
  return text;
}

function parseBookingEnquiry(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid booking enquiry.');
  const guestName = compactText(body.guestName, 'Guest name', { required: true, max: 100 });
  const email = compactText(body.email, 'Email address', { required: true, max: 160 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please provide a valid email address.');
  const serviceName = compactText(body.serviceName, 'Service', { required: true, max: 160 });
  const serviceType = BOOKABLE_SERVICE_TYPES.has(String(body.serviceType || '').toLowerCase())
    ? String(body.serviceType).toLowerCase()
    : 'other';
  const sessionId = compactText(body.sessionId, 'Session', { max: 110 });
  if (sessionId && !/^[a-zA-Z0-9_-]{4,110}$/.test(sessionId)) throw new Error('Invalid session identifier.');
  const partySize = Number(body.partySize);
  const safePartySize = Number.isInteger(partySize) && partySize >= 1 && partySize <= 20 ? partySize : null;
  const preferredDate = compactText(body.preferredDate, 'Preferred date', { max: 32 });
  const preferredTime = compactText(body.preferredTime, 'Preferred time', { max: 32 });
  const phone = compactText(body.phone, 'Phone number', { max: 60 });
  const notes = compactText(body.notes, 'Notes', { max: 600 });
  if (body.consent !== true) throw new Error('Consent is required to send a concierge enquiry.');
  return {
    guestName,
    email,
    serviceName,
    serviceType,
    userId: `web:${sessionId || `enquiry_${crypto.randomUUID()}`}`,
    partySize: safePartySize,
    preferredDate,
    preferredTime,
    phone,
    notes,
    language: compactText(body.language, 'Language', { max: 12 }) || 'en',
  };
}

async function persistBookingEnquiry(env, enquiry) {
  try {
    await airtable(env, 'Reservations', {
      method: 'POST',
      fields: {
        GuestName: enquiry.guestName,
        Email: enquiry.email,
        Phone: enquiry.phone || '',
        ServiceName: enquiry.serviceName,
        ServiceType: enquiry.serviceType,
        PreferredDate: enquiry.preferredDate || null,
        PreferredTime: enquiry.preferredTime || '',
        PartySize: enquiry.partySize || null,
        Notes: enquiry.notes || '',
        Status: 'new',
        SessionID: enquiry.userId,
        Language: enquiry.language || 'en',
      },
    });
  } catch (err) {
    console.warn('Writing to Reservations table failed; proceeding with Requests fallback:', err);
  }
  const details = [
    `Booking enquiry for ${enquiry.serviceName}.`,
    `Email: ${enquiry.email}.`,
    enquiry.phone && `Phone: ${enquiry.phone}.`,
    enquiry.preferredDate && `Preferred date: ${enquiry.preferredDate}.`,
    enquiry.preferredTime && `Preferred time: ${enquiry.preferredTime}.`,
    enquiry.partySize && `Guests: ${enquiry.partySize}.`,
    enquiry.notes && `Notes: ${enquiry.notes}`,
  ].filter(Boolean).join(' ');
  return airtable(env, 'Requests', {
    method: 'POST',
    fields: {
      UserID: enquiry.userId,
      Channel: 'web',
      GuestName: enquiry.guestName,
      ServiceType: enquiry.serviceType,
      RequestSummary: details,
      Source: 'partner',
      ServiceRef: enquiry.serviceName,
      Status: 'new',
      IsUpsell: true,
      Language: enquiry.language,
      HandoverAt: new Date().toISOString(),
    },
  });
}

function parseDiscoveryLead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid discovery request.');
  const contactName = compactText(body.contactName, 'Your name', { required: true, max: 100 });
  const hotelName = compactText(body.hotelName, 'Hotel name', { required: true, max: 160 });
  const email = compactText(body.email, 'Work email', { required: true, max: 160 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please provide a valid work email.');
  const phone = compactText(body.phone, 'Phone number', { required: true, max: 60 });
  const city = compactText(body.city, 'City', { required: true, max: 100 });
  const website = compactText(body.website, 'Hotel website', { max: 240 });
  if (website) {
    try {
      const parsed = new URL(website);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('protocol');
    } catch {
      throw new Error('Please provide a valid hotel website URL.');
    }
  }
  const roomCountText = compactText(body.roomCount, 'Number of rooms', { max: 5 });
  const roomCount = roomCountText ? Number(roomCountText) : null;
  if (roomCount !== null && (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > 5000)) throw new Error('Number of rooms must be between 1 and 5000.');
  const sessionId = compactText(body.sessionId, 'Session', { max: 110 });
  if (sessionId && !/^[a-zA-Z0-9_-]{4,110}$/.test(sessionId)) throw new Error('Invalid session identifier.');
  if (body.consent !== true) throw new Error('Consent is required to send a discovery request.');
  return {
    contactName,
    hotelName,
    email,
    phone,
    city,
    website,
    roomCount,
    message: compactText(body.message, 'Message', { max: 900 }),
    userId: `web:${sessionId || `discovery_${crypto.randomUUID()}`}`,
  };
}

async function persistDiscoveryLead(env, lead) {
  return airtable(env, 'Hotel Leads', {
    method: 'POST',
    baseId: env.LEADS_AIRTABLE_BASE_ID,
    fields: {
      'Hotel Lead Name': `${lead.hotelName} - ${lead.contactName}`.slice(0, 255),
      'Contact Name': lead.contactName,
      'Work Email': lead.email,
      'Hotel Name': lead.hotelName,
      'Phone Number': lead.phone,
      City: lead.city,
      'Number of Rooms': lead.roomCount ?? undefined,
      'Hotel Website': lead.website || undefined,
      'Concierge Service Needs': lead.message || undefined,
      'Lead Status': 'New',
    },
  });
}

async function resolveChat(body, env, ctx, reportStatus = () => undefined) {
  requireSecrets(env);
  const input = parseGuestInput(body);
  let classification = classifyRequest(input.message);
  reportStatus('Reviewing the details of your request\u2026');
  const serviceRecords = await fetchServices(env);
  const initialServiceSet = matchingServices(serviceRecords, classification);
  const instantDining = curatedDiningResponse(input, classification, initialServiceSet.matching);
  if (instantDining) {
    if (!input.testMode || input.testMode === 'write_verified') {
      ctx.waitUntil(persistConversation(env, input, { reply: instantDining.reply, requests: [] }).catch(() => undefined));
    }
    return instantDining;
  }
  const [history, facts] = await Promise.all([fetchHistory(env, input.userId), fetchFacts(env)]);
  classification = inheritConversationContext(classification, history, input.message);
  reportStatus('Considering the most suitable next step\u2026');
  classification = await enrichSemanticRoute(env, input, history, classification);
  const serviceSet = matchingServices(serviceRecords, classification);
  const partnerMatches = serviceSet.matching.filter((service) => service.isPartner);
  const promptServices = classification.route === 'partner_catalog'
    ? serviceSet.all.filter((service) => service.isPartner)
    : partnerMatches;
  let externalOptions = [];
  if (shouldSearchExternal(classification, partnerMatches)) {
    reportStatus('Searching current Paris addresses\u2026');
    externalOptions = await externalSearch(env, input, classification);
    if (preferenceForOneRecommendation(input.message)) externalOptions = externalOptions.slice(0, 1);
    reportStatus('Curating only independently verified matches\u2026');
  } else {
    reportStatus('Reviewing the hotel\u2019s preferred collection\u2026');
  }
  reportStatus('Preparing a considered recommendation\u2026');
  const prompt = buildPrompt({ input, classification, history, services: promptServices, externalOptions, facts });
  const provider = await callGroq(env, prompt);
  const model = parseModelJson(provider.content);
  const outcome = enforceContract(model, {
    language: input.language,
    classification,
    matching: promptServices,
    excluded: serviceSet.excluded,
    externalOptions,
  });

  if (!input.testMode || input.testMode === 'write_verified') {
    ctx.waitUntil(persistConversation(env, input, outcome).catch(() => undefined));
  }
  return {
    reply: outcome.reply,
    language: input.language,
    intent: outcome.intent,
    external_option_names: outcome.externalOptionNames,
    recommendations: outcome.recommendations.map((item) => ({
      name: item.name,
      description: item.description,
      website_url: item.websiteUrl,
      image_url: item.imageUrl,
    })),
    partner_offers: partnerOffers(promptServices),
    provider_failure: provider.providerFailure,
    requires_human: outcome.requiresHuman,
  };
}

async function handleJsonChat(request, env, ctx) {
  const body = await request.json();
  return response(await resolveChat(body, env, ctx), 200, request, env);
}

async function handleBookingEnquiry(request, env) {
  requireAirtable(env);
  const enquiry = parseBookingEnquiry(await request.json());
  await persistBookingEnquiry(env, enquiry);
  return response({
    ok: true,
    message: 'Your enquiry has been recorded for the concierge team.',
  }, 201, request, env);
}

async function handleDiscoveryLead(request, env) {
  requireLeadsAirtable(env);
  const lead = parseDiscoveryLead(await request.json());
  await persistDiscoveryLead(env, lead);
  return response({
    ok: true,
    message: 'Your discovery request has been recorded.',
  }, 201, request, env);
}

function sseEvent(payload) {
  return `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

async function streamChat(request, env, ctx) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (payload) => controller.enqueue(encoder.encode(sseEvent(payload)));
      try {
        emit({ type: 'status', message: 'Receiving your request\u2026' });
        const body = await request.json();
        const result = await resolveChat(body, env, ctx, (message) => emit({ type: 'status', message }));
        emit({ type: 'final', ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected service error.';
        emit({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      ...cors(request, env, 'text/event-stream; charset=utf-8'),
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) });
    if (request.method === 'GET' && url.pathname === '/health') return response({ ok: true, service: 'conciergeflow-api' }, 200, request, env);
    if (request.method === 'POST' && ['/api/chat', '/concierge/inbound'].includes(url.pathname)) {
      if (rateLimited(request)) return response({ error: 'Too many requests. Please try again shortly.' }, 429, request, env);
      try {
        if ((request.headers.get('Accept') || '').includes('text/event-stream')) return await streamChat(request, env, ctx);
        return await handleJsonChat(request, env, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected service error.';
        return response({ error: message }, /required|Invalid|message/i.test(message) ? 400 : 502, request, env);
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/booking-enquiry') {
      if (rateLimited(request)) return response({ error: 'Too many requests. Please try again shortly.' }, 429, request, env);
      try {
        return await handleBookingEnquiry(request, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected service error.';
        return response({ error: message }, /required|Invalid|valid|long|Consent/i.test(message) ? 400 : 502, request, env);
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/discovery-lead') {
      if (rateLimited(request)) return response({ error: 'Too many requests. Please try again shortly.' }, 429, request, env);
      try {
        return await handleDiscoveryLead(request, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected service error.';
        return response({ error: message }, /required|Invalid|valid|long|Consent|between/i.test(message) ? 400 : 502, request, env);
      }
    }
    return response({ error: 'Not found.' }, 404, request, env);
  },
};
