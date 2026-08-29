import {
  buildPrompt,
  classifyRequest,
  detectMediaBrochure,
  enforceContract,
  ESCALATION_REPLIES,
  inheritConversationContext,
  isEscalation,
  isOperationalRequest,
  isPostCheckoutNegative,
  isPostCheckoutPositive,
  isPostCheckoutScenario,
  matchingServices,
  operationalServiceType,
  OPERATIONAL_REPLIES,
  parseExternalResults,
  parseGuestInput,
  parseModelJson,
  normalizeServiceType,
  normalized,
  postCheckoutNegativeReply,
  postCheckoutPositiveReply,
  shouldSearchExternal,
} from './concierge.js';
import { buildDiscoveryBriefPdf } from './discovery-brief-pdf.js';

const RECENT_REQUESTS = new Map();
const RECENT_WHATSAPP_MESSAGES = new Map();
const SERVICE_CACHE_TTL_MS = 120_000;
const WHATSAPP_MESSAGE_TTL_MS = 24 * 60 * 60 * 1_000;
const WHATSAPP_GRAPH_VERSION = 'v24.0';
let serviceCache = { records: null, expiresAt: 0, pending: null };

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = new Set([
    env.ALLOWED_ORIGIN || 'https://flowarchitect-agency.github.io',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    // A direct file:// preview has the browser Origin value "null". The
    // endpoint is intentionally public and rate-limited, so permit this
    // narrow development origin without broadening access to arbitrary sites.
    'null',
  ]);
  return allowed.has(origin) ? origin : '';
}

function cors(request, env, contentType = 'application/json; charset=utf-8') {
  const origin = allowedOrigin(request, env);
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  };
}

function demoAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const configuredOrigin = env.DEMO_ALLOWED_ORIGIN || env.ALLOWED_ORIGIN || 'https://flowarchitect-agency.github.io';
  return origin === configuredOrigin ? origin : '';
}

function demoCors(request, env, contentType = 'application/json; charset=utf-8') {
  const origin = demoAllowedOrigin(request, env);
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  };
}

function response(body, status, request, env) {
  return new Response(JSON.stringify(body), { status, headers: cors(request, env) });
}

function demoResponse(body, status, request, env) {
  return new Response(JSON.stringify(body), { status, headers: demoCors(request, env) });
}

function webhookResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function twimlResponse(message = '', status = 200) {
  const escaped = String(message || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${escaped ? `<Message>${escaped}</Message>` : ''}</Response>`, {
    status,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function rateLimited(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for');
  if (!ip) return false;
  const now = Date.now();
  const timestamps = (RECENT_REQUESTS.get(ip) || []).filter((value) => now - value < 60_000);
  timestamps.push(now);
  RECENT_REQUESTS.set(ip, timestamps);
  return timestamps.length > 60;
}

function missingWhatsAppSecrets(env, { inbound = false } = {}) {
  const names = inbound
    ? ['WA_APP_SECRET', 'WA_ACCESS_TOKEN', 'WA_PHONE_NUMBER_ID']
    : ['WA_WEBHOOK_VERIFY_TOKEN'];
  return names.filter((name) => !env[name]);
}

function missingTwilioSecrets(env) {
  return ['TWILIO_AUTH_TOKEN'].filter((name) => !env[name]);
}

function constantTimeEqual(left, right) {
  const first = String(left || '');
  const second = String(right || '');
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
}

async function verifyWhatsAppSignature(rawBody, header, appSecret) {
  const supplied = String(header || '').replace(/^sha256=/i, '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(supplied) || !appSecret) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return constantTimeEqual(expected, supplied);
}

function twilioSignaturePayload(url, entries) {
  const grouped = new Map();
  for (const [key, value] of entries) {
    if (typeof value !== 'string') continue;
    const values = grouped.get(key) || [];
    values.push(value);
    grouped.set(key, values);
  }
  let payload = String(url);
  for (const key of [...grouped.keys()].sort()) {
    for (const value of grouped.get(key).sort()) payload += `${key}${value}`;
  }
  return payload;
}

async function verifyTwilioSignature(url, entries, header, authToken) {
  const supplied = String(header || '').trim();
  if (!supplied || !authToken) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(twilioSignaturePayload(url, entries)));
  const expected = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return constantTimeEqual(expected, supplied);
}

function rememberWhatsAppMessage(messageId, source = 'meta') {
  const id = String(messageId || '').trim();
  if (!id) return true;
  const key = `${source}:${id}`;
  const now = Date.now();
  for (const [knownId, receivedAt] of RECENT_WHATSAPP_MESSAGES) {
    if (now - receivedAt > WHATSAPP_MESSAGE_TTL_MS) RECENT_WHATSAPP_MESSAGES.delete(knownId);
  }
  if (RECENT_WHATSAPP_MESSAGES.has(key)) return false;
  RECENT_WHATSAPP_MESSAGES.set(key, now);
  return true;
}

function inboundWhatsAppTexts(payload) {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  return entries.flatMap((entry) => (Array.isArray(entry?.changes) ? entry.changes : []))
    .filter((change) => change?.field === 'messages')
    .flatMap((change) => Array.isArray(change?.value?.messages) ? change.value.messages : [])
    .filter((message) => message?.type === 'text' && message?.text?.body && message?.from)
    .map((message) => ({
      id: String(message.id || ''),
      from: String(message.from).replace(/\D/g, ''),
      text: String(message.text.body).trim(),
    }))
    .filter((message) => message.from && message.text && message.text.length <= 1200);
}

function whatsappReplyText(result) {
  const lines = [String(result.reply || '').trim()];
  const catalogue = Array.isArray(result.hotel_collection) ? result.hotel_collection : [];
  if (catalogue.length) {
    const categories = new Map();
    for (const offer of catalogue) {
      const category = String(offer?.category || 'experience').replace(/\b\w/g, (letter) => letter.toUpperCase());
      if (!categories.has(category)) categories.set(category, []);
      categories.get(category).push(String(offer?.name || '').trim());
    }
    for (const [category, names] of categories) {
      const entries = names.filter(Boolean).map((name) => `• ${name}`).join('\n');
      if (entries) lines.push(`${category}\n${entries}`);
    }
  }
  const offers = Array.isArray(result.partner_offers) ? result.partner_offers : [];
  const recommendations = Array.isArray(result.recommendations) ? result.recommendations : [];
  const cards = catalogue.length ? [] : [...offers, ...recommendations].slice(0, 5);
  for (const card of cards) {
    const details = [card.name, card.description, card.website_url || card.websiteUrl]
      .filter(Boolean)
      .join('\n');
    if (details) lines.push(details);
  }
  // The API reply uses standard Markdown; WhatsApp's text formatter uses one
  // asterisk for bold. Catalogue replies are text-only, never interactive.
  return lines.filter(Boolean).join('\n\n').replace(/\*\*([^*]+)\*\*/g, '*$1*')
    || 'Thank you for your message. Our concierge will be pleased to assist you.';
}

async function sendWhatsAppText(env, recipient, text) {
  const version = /^v\d+\.\d+$/.test(String(env.WA_GRAPH_API_VERSION || ''))
    ? env.WA_GRAPH_API_VERSION
    : WHATSAPP_GRAPH_VERSION;
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(env.WA_PHONE_NUMBER_ID)}/messages`;
  const sent = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: { preview_url: false, body: text },
    }),
  });
  if (!sent.ok) throw new Error(`WhatsApp message delivery failed (${sent.status}).`);
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

const AIRTABLE_MAX_ATTEMPTS = 3;
const AIRTABLE_RETRY_BASE_MS = 250;
const AIRTABLE_MAX_RETRY_AFTER_MS = 3_000;

function airtableRetryDelayMs(retryAfter, attempt) {
  const numericSeconds = Number(retryAfter);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.min(Math.round(numericSeconds * 1_000), AIRTABLE_MAX_RETRY_AFTER_MS);
  }
  const retryAt = Date.parse(String(retryAfter || ''));
  if (Number.isFinite(retryAt)) {
    return Math.min(Math.max(retryAt - Date.now(), 0), AIRTABLE_MAX_RETRY_AFTER_MS);
  }
  return Math.min(AIRTABLE_RETRY_BASE_MS * (2 ** attempt), AIRTABLE_MAX_RETRY_AFTER_MS);
}

function waitForAirtableRetry(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function airtable(env, table, { method = 'GET', params, fields, recordId = '', baseId = env.AIRTABLE_BASE_ID } = {}) {
  const recordPath = recordId ? `/${encodeURIComponent(recordId)}` : '';
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}${recordPath}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  for (let attempt = 0; attempt < AIRTABLE_MAX_ATTEMPTS; attempt += 1) {
    const result = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: fields ? JSON.stringify({ fields, typecast: true }) : undefined,
    });
    if (result.ok) return result.json();
    if (result.status !== 429 || attempt === AIRTABLE_MAX_ATTEMPTS - 1) {
      throw new Error(`Airtable ${table} request failed (${result.status}).`);
    }
    await waitForAirtableRetry(airtableRetryDelayMs(result.headers.get('Retry-After'), attempt));
  }
  throw new Error(`Airtable ${table} request failed after ${AIRTABLE_MAX_ATTEMPTS} attempts.`);
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function uploadAirtableAttachment(env, { recordId, fieldId, filename, bytes, baseId = env.LEADS_AIRTABLE_BASE_ID }) {
  if (!fieldId) throw new Error('Discovery Brief PDF field configuration is incomplete.');
  const url = `https://content.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(recordId)}/${encodeURIComponent(fieldId)}/uploadAttachment`;
  for (let attempt = 0; attempt < AIRTABLE_MAX_ATTEMPTS; attempt += 1) {
    const result = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename,
        contentType: 'application/pdf',
        file: bytesToBase64(bytes),
      }),
    });
    if (result.ok) return result.json();
    if (result.status !== 429 || attempt === AIRTABLE_MAX_ATTEMPTS - 1) {
      throw new Error(`Airtable discovery brief attachment upload failed (${result.status}).`);
    }
    await waitForAirtableRetry(airtableRetryDelayMs(result.headers.get('Retry-After'), attempt));
  }
  throw new Error(`Airtable discovery brief attachment upload failed after ${AIRTABLE_MAX_ATTEMPTS} attempts.`);
}

async function fetchServices(env, { bypassCache = false } = {}) {
  const now = Date.now();
  if (!bypassCache && Array.isArray(serviceCache.records) && serviceCache.expiresAt > now) return serviceCache.records;
  if (!bypassCache && serviceCache.pending) return serviceCache.pending;

  // Airtable paginates after 100 records. A catalogue request must never be
  // limited to the first page: every active partner service belongs in the
  // guest-facing collection.
  const request = (async () => {
    const records = [];
    let offset = '';
    do {
      const payload = await airtable(env, 'Services', {
        params: {
          filterByFormula: '{Active}=TRUE()',
          pageSize: 100,
          ...(offset ? { offset } : {}),
        },
      });
      records.push(...(payload.records || []));
      offset = String(payload.offset || '');
    } while (offset);
    return records;
  })();

  if (!bypassCache) serviceCache.pending = request;
  try {
    const records = await request;
    if (!bypassCache) serviceCache = { records, expiresAt: Date.now() + SERVICE_CACHE_TTL_MS, pending: null };
    return records;
  } catch (error) {
    if (!bypassCache) serviceCache.pending = null;
    throw error;
  }
}

const OPERATIONAL_REQUEST_TYPES = new Set(['housekeeping', 'maintenance']);
const MINUTES_SAVED_PER_OPERATIONAL_TICKET = 15;

async function fetchManagerMetrics(env) {
  const records = [];
  let offset = '';
  do {
    const payload = await airtable(env, 'Requests', {
      params: {
        pageSize: 100,
        // Keep demo traffic out of the production aggregate before it reaches
        // the response calculation; the in-memory check below remains a
        // defensive guard for legacy or inconsistent Airtable rows.
        filterByFormula: 'NOT({Is_Demo})',
        ...(offset ? { offset } : {}),
      },
    });
    records.push(...(payload.records || []));
    offset = String(payload.offset || '');
  } while (offset);

  const operationalTickets = records.filter((record) => {
    if (record?.fields?.Is_Demo === true) return false;
    const serviceType = String(record?.fields?.ServiceType || '').trim().toLowerCase();
    return OPERATIONAL_REQUEST_TYPES.has(serviceType);
  }).length;
  const minutesSaved = operationalTickets * MINUTES_SAVED_PER_OPERATIONAL_TICKET;
  return {
    operational_tickets: operationalTickets,
    minutes_saved: minutesSaved,
    hours_saved: Number((minutesSaved / 60).toFixed(2)),
    minutes_per_ticket: MINUTES_SAVED_PER_OPERATIONAL_TICKET,
    formula: 'operational tickets × 15 minutes ÷ 60',
  };
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

async function fetchRequestsForUser(env, userId) {
  const safeUser = userId.replace(/'/g, "\\'");
  const records = [];
  let offset = '';
  do {
    const payload = await airtable(env, 'Requests', {
      params: {
        filterByFormula: `{UserID}='${safeUser}'`,
        pageSize: 100,
        ...(offset ? { offset } : {}),
      },
    });
    records.push(...(payload.records || []));
    offset = String(payload.offset || '');
  } while (offset);
  return records;
}

function demoFlagFields(input) {
  return (input && (input.isDemo || input.is_demo || input.demo)) ? { Is_Demo: true } : {};
}

async function upsertGuest(env, input) {
  const isDemo = Boolean(input?.isDemo || input?.is_demo || input?.demo);
  const rawName = String(input?.guestName || input?.guest_name || input?.name || '').trim();
  if (!rawName && !isDemo) return;
  const guestName = rawName || (isDemo ? 'Demo Guest' : 'Guest');
  const safeUser = String(input?.userId || '').replace(/'/g, "\\'");
  if (!safeUser) return;

  const fields = {
    UserID: input.userId,
    GuestName: guestName,
    Language: input.language || 'English',
    ...(isDemo ? { Is_Demo: true } : {}),
  };

  try {
    const existing = await airtable(env, 'Guests', {
      params: {
        filterByFormula: `{UserID}='${safeUser}'`,
        maxRecords: 1,
      },
    });
    const recordId = existing?.records?.[0]?.id;
    if (recordId) return await airtable(env, 'Guests', { method: 'PATCH', recordId, fields });
    return await airtable(env, 'Guests', { method: 'POST', fields });
  } catch (err) {
    console.error('Error upserting guest in Airtable:', err);
  }
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

const SIMPLE_GREETINGS = new Set(['hi', 'hello', 'hey', 'salut', 'bonjour', 'bonsoir', 'hola', 'ciao', 'hallo']);
const GREETING_REPLIES = {
  en: 'Bonjour and welcome to H\u00f4tel Lumi\u00e8re Paris. How may I assist you with your stay today?',
  fr: 'Bonsoir et bienvenue \u00e0 l\u2019H\u00f4tel Lumi\u00e8re Paris. Comment puis-je vous aider pendant votre s\u00e9jour ?',
  es: 'Bienvenido al H\u00f4tel Lumi\u00e8re Paris. \u00bfC\u00f3mo puedo ayudarle durante su estancia?',
  it: 'Benvenuto all\u2019H\u00f4tel Lumi\u00e8re Paris. Come posso assisterla durante il suo soggiorno?',
  de: 'Willkommen im H\u00f4tel Lumi\u00e8re Paris. Wie darf ich Ihnen bei Ihrem Aufenthalt behilflich sein?',
};

const LANGUAGE_SWITCH_REPLIES = {
  en: 'Of course. I will continue in English. How may I assist you?',
  fr: 'Bien s\u00fbr. Je continuerai en fran\u00e7ais. Comment puis-je vous aider ?',
  es: 'Por supuesto. A partir de ahora le responder\u00e9 en espa\u00f1ol. \u00bfC\u00f3mo puedo ayudarle?',
  it: 'Certamente. Da questo momento le risponder\u00f2 in italiano. Come posso aiutarla?',
  de: 'Sehr gern. Ab jetzt antworte ich Ihnen auf Deutsch. Wie darf ich Ihnen helfen?',
  ar: '\u0628\u0627\u0644\u0637\u0628\u0639. \u0633\u0623\u0631\u062f \u0639\u0644\u064a\u0643\u0645 \u0645\u0646 \u0627\u0644\u0622\u0646 \u0641\u0635\u0627\u0639\u062f\u0627\u064b \u0628\u0627\u0644\u0639\u0631\u0628\u064a\u0629. \u0643\u064a\u0641 \u064a\u0645\u0643\u0646\u0646\u064a \u0645\u0633\u0627\u0639\u062f\u062a\u0643\u0645\u061f',
  ja: '\u3082\u3061\u308d\u3093\u3067\u3059\u3002\u4eca\u5f8c\u306f\u65e5\u672c\u8a9e\u3067\u304a\u624b\u4f1d\u3044\u3057\u307e\u3059\u3002\u3054\u5e0c\u671b\u3092\u304a\u805e\u304b\u305b\u304f\u3060\u3055\u3044\u3002',
  zh: '\u5f53\u7136\u53ef\u4ee5\u3002\u4ece\u73b0\u5728\u8d77\u6211\u5c06\u7528\u4e2d\u6587\u4e3a\u60a8\u670d\u52a1\u3002\u8bf7\u95ee\u5982\u4f55\u5e2e\u52a9\u60a8\uff1f',
};

function simpleGreetingResponse(input) {
  const message = String(input.message || '').trim().toLocaleLowerCase().replace(/[!.?\s]+$/g, '');
  if (!SIMPLE_GREETINGS.has(message)) return null;
  return {
    reply: GREETING_REPLIES[input.language] || GREETING_REPLIES.en,
    language: input.language,
    intent: 'smalltalk',
    external_option_names: [],
    recommendations: [],
    partner_offers: [],
    provider_failure: '',
    requires_human: false,
  };
}

function languagePreferenceResponse(input) {
  if (!input.languageRequested) return null;
  return {
    reply: LANGUAGE_SWITCH_REPLIES[input.language] || LANGUAGE_SWITCH_REPLIES.en,
    language: input.language,
    intent: 'language_preference',
    external_option_names: [],
    recommendations: [],
    partner_offers: [],
    provider_failure: '',
    requires_human: false,
  };
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

async function callGroq(env, prompt, { maxTokens = 350, router = false } = {}) {
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
      const result = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
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

const ROUTES = new Set(['greeting', 'hotel_faq', 'partner_catalog', 'partner_request', 'external_discovery', 'conversation']);
const SERVICE_CATEGORIES = new Set(['accommodation', 'spa', 'restaurant', 'transport', 'tour', 'experience', 'itinerary']);

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
- partner_catalog: asking what the hotel offers or who its partners are.
- partner_request: clearly asking to reserve or arrange a conventional hotel service.
- stay_planning: asking for broad help to organize a hotel stay, trip, or weekend without asking to find a specific external venue.
- external_discovery: asking for a recommendation, itinerary, venue, activity, event, shopping, transportation, food, nightlife, or any unusual/new need that requires current information beyond a known hotel catalogue.
- conversation: only when none of the above applies.

Critical rule: do not require a keyword match. If the guest wants help finding, choosing, suggesting, planning, seeing, buying, celebrating, or doing something in Paris, use external_discovery even if the request is unusual or written in another language. Follow-up requests inherit the earlier guest need from history.

Return exactly:
{"route":"greeting|hotel_faq|partner_catalog|partner_request|stay_planning|external_discovery|conversation","category":"accommodation|spa|restaurant|transport|tour|experience|itinerary|null","search_query":"a concise Paris web-search query or empty string"}

For external_discovery, search_query must describe the guest's exact need, include Paris when appropriate, and contain no instruction or commentary. Otherwise return an empty search_query.

RECENT CONVERSATION:
${recentHistory}

LATEST GUEST MESSAGE:
${input.message}`;
}

async function enrichSemanticRoute(env, input, history, classification) {
  if (classification.route === 'stay_planning') return classification;
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

function mapServiceTypeForRequests(type) {
  return normalizeServiceType(type);
}

function cancellationTarget(message) {
  const text = normalized(message);
  if (/\b(taxi|transfer|chauffeur|shuttle|airport|car)\b/.test(text)) return 'Transport';
  if (/\b(spa|wellness|massage|treatment|hammam|sauna)\b/.test(text)) return 'Spa & Wellness';
  if (/\b(restaurant|dining|dinner|lunch|breakfast|food)\b/.test(text)) return 'Dining';
  return null;
}

function isCancellationMessage(message) {
  return /\b(cancel|cancellation|cancelled|canceled|call off|do not want|don't want|no longer need)\b/i.test(String(message || ''));
}

async function cancelRequests(env, userId, target) {
  if (!target) return { cancelled: 0, alreadyCancelled: 0 };
  const matching = (await fetchRequestsForUser(env, userId)).filter((record) => (
    mapServiceTypeForRequests(record?.fields?.ServiceType) === target
  ));
  const alreadyCancelled = matching.filter((record) => /^(cancelled|canceled)$/i.test(String(record?.fields?.Status || ''))).length;
  const open = matching.filter((record) => !/^(cancelled|canceled)$/i.test(String(record?.fields?.Status || '')));
  await Promise.all(open.map((record) => airtable(env, 'Requests', {
    method: 'PATCH',
    recordId: record.id,
    fields: { Status: 'cancelled' },
  })));
  return { cancelled: open.length, alreadyCancelled };
}

async function persistConversation(env, input, outcome) {
  const time = new Date().toISOString();
  const guestName = String(input?.guestName || input?.guest_name || input?.name || '').trim() || (input?.isDemo || input?.is_demo ? 'Demo Guest' : 'Guest');
  const flags = demoFlagFields(input);

  await Promise.all([
    upsertGuest(env, input).catch(() => undefined),
    airtable(env, 'Conversations', {
      method: 'POST',
      fields: {
        UserID: input.userId,
        Channel: input.channel,
        Role: 'user',
        'Guest Name': guestName,
        Message: input.message,
        Language: input.language,
        Timestamp: input.receivedAt,
        ...flags,
      },
    }).catch(() => undefined),
    airtable(env, 'Conversations', {
      method: 'POST',
      fields: {
        UserID: input.userId,
        Channel: input.channel,
        Role: 'assistant',
        'Guest Name': guestName,
        Message: outcome.reply,
        Language: input.language,
        Timestamp: time,
        ...flags,
      },
    }).catch(() => undefined),
  ]);
  const requests = outcome.requests.filter((item) => item.summary);
  await Promise.all(requests.map((item) => airtable(env, 'Requests', {
    method: 'POST',
    fields: {
      UserID: input.userId,
      Channel: input.channel,
      GuestName: guestName,
      ServiceType: mapServiceTypeForRequests(outcome.serviceType),
      RequestSummary: item.summary,
      Source: item.source === 'external' ? 'external' : 'partner',
      ServiceRef: item.serviceName || '',
      Status: 'new',
      Revenue: item.estValueEur ?? undefined,
      IsUpsell: Boolean(item.isUpsell),
      Language: input.language,
      HandoverAt: time,
      ...flags,
    },
  }).catch((err) => console.error('Error creating request in Airtable:', err))));
}

const PARTNER_CARD_IMAGES = {
  spa: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=700&q=84',
  restaurant: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=700&q=84',
  transport: 'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=700&q=84',
  tour: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=700&q=84',
  experience: 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=700&q=84',
};

function partnerOffers(services, { limit = 5 } = {}) {
  const partnerServices = services.filter((service) => service.isPartner);
  const selected = Number.isInteger(limit) ? partnerServices.slice(0, limit) : partnerServices;
  return selected.map((service) => ({
    name: service.name,
    description: String(service.description || 'A considered experience from the hotel\u2019s preferred collection.').slice(0, 240),
    category: service.category || 'experience',
    price_eur: Number.isFinite(Number(service.price)) ? Number(service.price) : null,
    duration_mins: Number.isFinite(Number(service.duration)) ? Number(service.duration) : null,
    location: service.location || '',
    image_url: service.imageUrl || PARTNER_CARD_IMAGES[service.category] || PARTNER_CARD_IMAGES.experience,
    source: 'partner',
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

const CATALOGUE_CATEGORY_META = {
  spa: { label: 'Spa & Wellness', emoji: '\uD83E\uDDD6' },
  restaurant: { label: 'Dining', emoji: '\uD83C\uDF7D\uFE0F' },
  transport: { label: 'Transport', emoji: '\uD83D\uDE98' },
  accommodation: { label: 'Rooms & Suites', emoji: '\uD83D\uDECF\uFE0F' },
  tour: { label: 'Tours', emoji: '\uD83C\uDFDB\uFE0F' },
  experience: { label: 'Experiences', emoji: '\u2728' },
};

function catalogueCategoryMeta(category) {
  const key = String(category || '').trim().toLowerCase();
  return CATALOGUE_CATEGORY_META[key] || {
    label: key.replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Concierge Experiences',
    emoji: '\u2728',
  };
}

const SERVICE_METADATA = {
  'Le Jardin — Chef\'s Table (2 Michelin)': {
    emoji: '🍽️',
    desc: '2-Michelin starred gastronomy with a 7-course seasonal tasting symphony.',
    highlights: 'Kitchen-side VIP table, rare Grand Cru wine pairings, and hand-dived scallops.',
  },
  'Terrasse Lumière — Rooftop Dinner': {
    emoji: '🗼',
    desc: 'Panoramic rooftop dining overlooking the illuminated Eiffel Tower.',
    highlights: 'Candlelit terrace table, 3-course dinner, vintage champagne, and hourly light show.',
  },
  'Private Chauffeur — CDG/ORY Transfer': {
    emoji: '🚘',
    desc: 'Seamless first-class airport transfer in a Mercedes-Maybach S-Class.',
    highlights: 'Airside gate greeting, real-time flight tracking, chilled Evian, and luggage handling.',
  },
  'Private Chauffeur — Half-Day Disposal': {
    emoji: '🛍️',
    desc: '4 hours of dedicated executive chauffeur on continuous standby.',
    highlights: 'Unlimited stops for Avenue Montaigne shopping, gallery viewings, and doorstep waiting.',
  },
  'Lumière Spa — Couples Massage': {
    emoji: '🧖',
    desc: 'Dual botanical massage in our private subterranean candlelit sanctuary.',
    highlights: 'Private double suite, organic aromatherapy oils, volcanic hot stones, and fresh macarons.',
  },
  'Lumière Spa — Signature Hammam Ritual': {
    emoji: '🧼',
    desc: 'Ancient thermal hydrotherapy on heated Carrara marble.',
    highlights: 'Eucalyptus steam mist, traditional black soap scrub, Kessa glove exfoliation, and Rhassoul clay wrap.',
  },
  'VIP Louvre After-Hours Private Tour': {
    emoji: '🖼️',
    desc: 'Exclusive access to the Musée du Louvre behind closed doors past 6 PM.',
    highlights: 'Art historian curator escort, private viewing of the Mona Lisa in complete solitude, and Napoleon III apartments.',
  },
  'Versailles Private Day Trip': {
    emoji: '🏰',
    desc: 'An 8-hour royal journey to the Sun King Louis XIV\'s iconic palace.',
    highlights: 'Private chauffeur transport, VIP skip-the-line Hall of Mirrors, Grand Trianon, and Marie Antoinette\'s Hamlet.',
  },
};

function cleanServiceEntry(service, index) {
  const meta = SERVICE_METADATA[service.name] || {
    emoji: '✨',
    desc: service.description || 'Exclusive luxury hotel experience.',
    highlights: 'Dedicated personalized concierge coordination.',
  };
  const price = Number.isFinite(Number(service.price_eur || service.price)) ? `€${Number(service.price_eur || service.price).toFixed(0)}` : '';
  const duration = Number.isFinite(Number(service.duration_mins)) && Number(service.duration_mins) > 0 ? `${service.duration_mins} min` : '';
  const metaRate = [price, duration].filter(Boolean).join(' · ');

  return [
    `${index + 1}. ${meta.emoji} ${service.name}`,
    `Quick description: ${meta.desc}`,
    `Things you will find there: ${meta.highlights}`,
    metaRate ? `Rate & duration: ${metaRate}` : '',
  ].filter(Boolean).join('\n');
}

function buildCleanDirectoryMessage(collection, language = 'en') {
  const header = '✨ Hôtel Lumière Paris — Signature Collection\n\nHere is our complete digital directory and experiences brochure. Below is our full list of curated privileges:\n\n';
  const entries = collection.map((service, index) => cleanServiceEntry(service, index)).join('\n\n');
  const footer = '\n\nPlease let me know if you would like to reserve any service or experience, and our concierge team will arrange everything for you.';
  return header + entries + footer;
}

function catalogueText(collection) {
  return buildCleanDirectoryMessage(collection);
}

const HOTEL_PARTNER_REQUEST_REPLIES = {
  en: 'For your request, I recommend beginning with the hotel’s preferred collection below. Select the experience you prefer and the concierge will record your details for final availability confirmation.',
  fr: 'Pour votre demande, je vous recommande de commencer par la collection privilégiée de l’hôtel ci-dessous. Sélectionnez l’expérience de votre choix et la conciergerie recueillera vos détails avant la confirmation finale de disponibilité.',
  es: 'Para su solicitud, le recomiendo empezar por la colección preferida del hotel que aparece a continuación. Seleccione la experiencia que prefiera y el concierge registrará sus datos antes de confirmar la disponibilidad final.',
  it: 'Per la sua richiesta, le consiglio di iniziare dalla collezione selezionata dell’hotel qui sotto. Scelga l’esperienza che preferisce e il concierge registrerà i suoi dati prima della conferma finale della disponibilità.',
  de: 'Für Ihre Anfrage empfehle ich Ihnen, mit der ausgewählten Hotelkollektion unten zu beginnen. Wählen Sie Ihre bevorzugte Option; unser Concierge erfasst dann Ihre Angaben zur endgültigen Verfügbarkeitsbestätigung.',
  ar: 'بالنسبة إلى طلبكم، أوصي بالبدء بمجموعة الفندق المختارة أدناه. اختاروا الخيار المفضل وسيسجل الكونسيرج تفاصيلكم قبل التأكيد النهائي للتوفر.',
  ja: 'ご希望には、まず下記のホテル厳選コレクションからお選びいただくことをおすすめします。ご希望の選択肢を選ぶと、コンシェルジュが最終的な空き状況確認のために情報をお伺いします。',
  zh: '针对您的需求，建议先从下方的酒店精选系列中选择。您选定后，礼宾团队将记录您的详情并进行最终可用性确认。',
};
const HOTEL_ALTERNATIVE_REPLIES = {
  en: ({ cuisine, options }) => `We do not currently have a ${cuisine} option in the hotel’s preferred collection. For a considered experience through the hotel, I would recommend ${options}. You may reserve it below. If you would rather keep the ${cuisine} preference, tell me and I will look externally.`,
  es: ({ cuisine, options }) => `Actualmente no contamos con una opción ${cuisine} en la colección preferida del hotel. Para una experiencia organizada por el hotel, le recomiendo ${options}. Puede solicitarla a continuación. Si prefiere mantener la opción ${cuisine}, dígamelo y buscaré una dirección externa.`,
  fr: ({ cuisine, options }) => `Nous n’avons pas actuellement d’option ${cuisine} dans la collection privilégiée de l’hôtel. Pour une expérience organisée par l’hôtel, je vous recommande ${options}. Vous pouvez faire une demande ci-dessous. Si vous souhaitez conserver la préférence ${cuisine}, dites-le-moi et je chercherai une adresse extérieure.`,
};

function hotelPartnerReply(language) {
  return HOTEL_PARTNER_REQUEST_REPLIES[language] || HOTEL_PARTNER_REQUEST_REPLIES.en;
}

function hotelAlternativeReply(language, cuisine, options) {
  if (!HOTEL_ALTERNATIVE_REPLIES[language] || language === 'en') {
    const article = /^[aeiou]/i.test(cuisine) ? 'an' : 'a';
    return `We do not currently have ${article} ${cuisine} option in the hotel’s preferred collection. For a considered experience through the hotel, I would recommend ${options}. You may reserve it below. If you would rather keep the ${cuisine} preference, tell me and I will look externally.`;
  }
  const build = HOTEL_ALTERNATIVE_REPLIES[language] || HOTEL_ALTERNATIVE_REPLIES.en;
  return build({ cuisine, options });
}

function isHotelCollectionQuestion(message, classification = {}) {
  const text = String(message || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  // A category question must never become a full directory just because it
  // contains a broad noun such as "experiences".  Only unmistakably broad
  // phrasing opens the complete collection.
  const explicitDirectory = /\b(?:complete|full|entire|digital)\s+(?:directory|catalog(?:ue)?|brochure)\b|\b(?:send|show|view)\s+(?:me\s+)?(?:the\s+)?(?:hotel\s+)?(?:directory|brochure)\b/;
  const explicitEverything = /\b(?:all|every|complete|full|entire)\s+(?:of\s+)?(?:your|the|our)?\s*(?:services?|experiences?|offerings?|collection|catalog(?:ue)?)\b|\bshow\s+me\s+everything\b|\bwhat\s+(?:services?\s+and\s+)?experiences?\s+(?:are|do)\b/;
  const compactBroad = /^(?:view\s+services?|services?|catalog(?:ue)?|directory|show\s+everything)$/i.test(text.trim());
  const genericServiceQuestion = /\b(?:what|which|show|see|view|browse|open|list|send|do|does|can)\b[^?.!]{0,72}\b(?:services?|serivces?|sevrices?|servcies?|amenities|offerings?|partners?)\b/;
  const broadHotelOffer = /\bwhat\s+(?:do|can)\s+(?:you|the hotel)\s+(?:offer|arrange|provide)\b/;
  const categorySpecific = Boolean(classification.category || classification.cuisine);
  if (categorySpecific && !explicitDirectory.test(text) && !explicitEverything.test(text)) return false;
  return explicitDirectory.test(text) || explicitEverything.test(text) || genericServiceQuestion.test(text) || broadHotelOffer.test(text) || compactBroad;
}

function explicitDirectoryRequest(message) {
  const text = normalized(message);
  return /\b(?:directory|brochure|digital guide|full catalog(?:ue)?|complete catalog(?:ue)?)\b/i.test(text);
}

const HOTEL_CATEGORY_LABELS = {
  accommodation: 'Rooms & Suites',
  restaurant: 'Dining',
  spa: 'Spa & Wellness',
  transport: 'Transport',
  tour: 'Paris experiences',
  experience: 'Private experiences',
};

function hotelCategoryReply(language, category, count) {
  const label = HOTEL_CATEGORY_LABELS[category] || 'hotel experiences';
  const copies = {
    en: `We have ${count} ${label.toLowerCase()} option${count === 1 ? '' : 's'} in the Hôtel Lumière collection. Here ${count === 1 ? 'is' : 'are'} the relevant choice${count === 1 ? '' : 's'}.`,
    fr: `Nous avons ${count} option${count === 1 ? '' : 's'} ${label === 'Dining' ? 'de restauration' : `dans ${label}`} dans la collection de l’Hôtel Lumière. Voici les choix correspondants.`,
    es: `Tenemos ${count} opcion${count === 1 ? '' : 'es'} de ${label} en la colección de Hôtel Lumière. Aquí tiene las opciones correspondientes.`,
    it: `Abbiamo ${count} opzion${count === 1 ? 'e' : 'i'} ${label} nella collezione dell’Hôtel Lumière. Ecco le scelte pertinenti.`,
    de: `Wir haben ${count} passende ${label}-Option${count === 1 ? '' : 'en'} in der Hôtel-Lumière-Kollektion. Hier sind die relevanten Auswahlmöglichkeiten.`,
  };
  return copies[language] || copies.en;
}

function historyEntries(input) {
  return Array.isArray(input.chatHistory) ? input.chatHistory : [];
}

function hasFollowUpKey(input, key) {
  const pattern = key === 'first_time_paris'
    ? /first time in paris|premiere fois a paris|primera vez en paris|erste(?:r)? (?:besuch|mal) in paris/i
    : new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return historyEntries(input).some((item) => pattern.test(normalized(item?.message || item?.content || '')));
}

function shouldOfferFirstTimeFollowUp(input) {
  const scenario = String(input.scenario || '').replace(/_/g, '-').toLowerCase();
  const text = normalized(input.message);
  const declined = /\b(?:no thanks|no thank you|not now|busy|later|leave me alone|no,? thank)\b/i.test(text);
  return scenario === 'pre-arrival'
    && input.conversationOwner !== 'staff'
    && !declined
    && !hasFollowUpKey(input, 'first_time_paris');
}

function firstTimeParisNextStep(input) {
  if (!shouldOfferFirstTimeFollowUp(input)) return null;
  const text = {
    en: 'By the way, is this your first time in Paris?',
    fr: 'Au fait, est-ce votre première fois à Paris ?',
    es: 'Por cierto, ¿es su primera vez en París?',
    it: 'A proposito, è la sua prima volta a Parigi?',
    de: 'Darf ich fragen: Ist es Ihr erster Besuch in Paris?',
  };
  return { type: 'guest_follow_up', key: 'first_time_paris', text: text[input.language] || text.en, delay_ms: 1800 };
}

function stayPlanningResponse(input, classification) {
  if (classification.route !== 'stay_planning') return null;
  const replies = {
    en: 'Absolutely. I’d be happy to help plan your stay. Would you like to begin with dining, experiences, wellness, or a little of everything?',
    fr: 'Bien sûr. Je serais ravi de vous aider à préparer votre séjour. Souhaitez-vous commencer par la gastronomie, les expériences, le bien-être ou un peu de tout ?',
    es: 'Por supuesto. Estaré encantado de ayudarle a planificar su estancia. ¿Prefiere empezar por gastronomía, experiencias, bienestar o un poco de todo?',
    it: 'Certamente. Sarò lieto di aiutarla a pianificare il soggiorno. Vuole iniziare da ristorazione, esperienze, benessere o un po’ di tutto?',
    de: 'Sehr gern. Ich helfe Ihnen bei der Planung Ihres Aufenthalts. Möchten Sie mit Dining, Erlebnissen, Wellness oder einer Mischung beginnen?',
  };
  return {
    reply: replies[input.language] || replies.en,
    language: input.language,
    intent: 'stay_planning',
    external_option_names: [],
    recommendations: [],
    partner_offers: [],
    provider_failure: '',
    requires_human: false,
  };
}

function relationshipFollowUpResponse(input) {
  const history = historyEntries(input);
  const wasAskedFirstTime = history.some((item) => /first time in paris|première fois à paris|primera vez en par[ií]s/i.test(String(item?.message || item?.content || '')));
  if (!wasAskedFirstTime || input.conversationOwner === 'staff') return null;
  const text = normalized(input.message);
  if (/\b(?:no|non|nope|not now|busy|later|pas maintenant)\b/i.test(text)) {
    return { reply: input.language === 'fr' ? 'Bien sûr. Je reste à votre disposition quand vous le souhaiterez.' : 'Of course. I’ll be here whenever you are ready.', language: input.language, intent: 'stay_planning', external_option_names: [], recommendations: [], partner_offers: [], provider_failure: '', requires_human: false };
  }
  if (!/\b(?:yes|yeah|yep|oui|si|sí|certo|ja|first)\b/i.test(text)) return null;
  const replies = {
    en: 'Wonderful. Do you already have plans for your stay, or would you like a few ideas from us?',
    fr: 'Merveilleux. Avez-vous déjà des projets pour votre séjour, ou souhaitez-vous quelques idées de notre part ?',
    es: 'Qué bien. ¿Ya tiene planes para su estancia o le gustaría recibir algunas ideas?',
    it: 'Che bello. Ha già dei programmi per il soggiorno o desidera qualche idea da parte nostra?',
    de: 'Wunderbar. Haben Sie schon Pläne für Ihren Aufenthalt, oder möchten Sie ein paar Ideen von uns?',
  };
  return { reply: replies[input.language] || replies.en, language: input.language, intent: 'stay_planning', external_option_names: [], recommendations: [], partner_offers: [], provider_failure: '', requires_human: false };
}

function guestInsistsOnExternal(message) {
  const text = String(message || '').trim().toLowerCase();
  return /^(?:no|non|nope|rather|instead|actually|but)\b/i.test(text)
    || /\b(not your|not the hotel|outside the hotel|outside|external option|somewhere else|don't want to eat at the hotel|dont want to eat at the hotel|do not want to eat at the hotel|not at the hotel|local cafe|local bakery|local bakery or cafe|nearby cafe|nearby bakery|bakery or cafe|bakery|boulangerie|cafe|pastry shop|explore on my own|on my own)\b/i.test(text);
}

function categoryPartnerServices(services, category) {
  return services.filter((service) => service.isPartner && String(service.category || '').toLowerCase() === category);
}

function hasBookingIntent(message) {
  const text = normalized(message);

  // 1. Strict Negation Checks (e.g. 'do not want to book', 'no tours', 'no thanks', 'not looking for', 'skip')
  if (
    /\b(do not|don't|dont|not|no|never|skip|refuse|pass on|without|neither|nor)\s+(?:want|need|wish|interested in|looking for|require)?\s*(?:to\s+)?(?:book|reserve|hire|order|take|get|schedule)\b/i.test(text) ||
    /\b(?:no|not looking for|no need for|skip the|pass on the|without any)\s+(?:private\s+)?(?:tours?|chauffeurs?|taxis?|transfers?|massages?|spa|tables?|reservations?|bookings?|services?)\b/i.test(text) ||
    /\b(?:no\s+thanks?|no\s+thank\s+you|not\s+interested|not\s+for\s+me|not\s+for\s+us|on my own|on our own|explore on my own|explore on our own)\b/i.test(text)
  ) {
    return false;
  }

  // 2. Retrospective memory queries (e.g. 'what time did I book')
  if (/\b(what time|when|did i|did we|which time|what day|how much|remind me)\b/.test(text)) {
    return false;
  }

  // 3. Positive booking keywords
  return /\b(book|reserve|confirm|yes)\b/.test(text);
}

function preferredBookingService(services, category, message) {
  const candidates = categoryPartnerServices(services, category);
  if (!candidates.length) return null;
  const text = normalized(message);
  const matching = candidates.find((service) => {
    const name = normalized(service.name);
    return (text.includes('couples') && name.includes('couples'))
      || (text.includes('massage') && name.includes('massage'))
      || (text.includes('airport') && name.includes('airport'))
      || (text.includes('cdg') && name.includes('cdg'));
  });
  return matching || candidates[0];
}

function partnerBookingOutcome(input, classification, services) {
  if (!hasBookingIntent(input.message)) return null;
  const category = String(classification.category || '').toLowerCase();
  if (!['spa', 'restaurant', 'transport', 'tour', 'experience'].includes(category)) return null;
  const service = preferredBookingService(services, category, input.message);
  if (!service) return null;
  const partySize = input.message.match(/\b(\d{1,2})\s*(?:people|guests?|persons?)\b/i)?.[1];
  return {
    reply: `I have recorded your request for ${service.name}${partySize ? ` for ${partySize} guests` : ''}. Our concierge team will verify availability and confirm the details with you shortly.`,
    intent: 'service_request',
    serviceType: category,
    requiresHuman: true,
    escapeHatchTriggered: false,
    requests: [{
      serviceName: service.name,
      source: 'partner',
      summary: `Booking request for ${service.name}${partySize ? ` for ${partySize} guests` : ''}. Guest message: "${input.message}"`,
      estValueEur: Number.isFinite(Number(service.price)) ? Number(service.price) : null,
      isUpsell: true,
    }],
    externalOptionNames: [],
    recommendations: [],
  };
}

async function cancellationOutcome(env, input, classification, services) {
  if (!isCancellationMessage(input.message)) return null;
  const target = cancellationTarget(input.message);
  if (!target) return null;

  const writesAllowed = !input.testMode || input.testMode === 'write_verified';
  const state = writesAllowed
    ? await cancelRequests(env, input.userId, target)
    : { cancelled: 0, alreadyCancelled: 0 };
  const targetLabel = target === 'Transport' ? 'taxi transfer' : target.toLowerCase();
  const cancellationReply = state.cancelled
    ? `Your ${targetLabel} request has been cancelled.`
    : state.alreadyCancelled
      ? `Yes — your ${targetLabel} request remains cancelled.`
      : `I could not find an active ${targetLabel} request to cancel.`;
  const newBooking = partnerBookingOutcome(input, classification, services);

  return {
    reply: newBooking ? `${cancellationReply} ${newBooking.reply}` : cancellationReply,
    intent: newBooking?.intent || 'service_request',
    serviceType: newBooking?.serviceType || target,
    requiresHuman: Boolean(newBooking?.requiresHuman),
    escapeHatchTriggered: false,
    requests: newBooking?.requests || [],
    externalOptionNames: [],
    recommendations: [],
  };
}

function hotelCatalogueResponse(input, classification, services) {
  const collection = partnerOffers(services, { limit: null });
  const categoryCount = new Set(collection.map((service) => service.category)).size;
  const replies = {
    en: 'Of course. We can help with rooms, dining, spa & wellness, transfers, and private Paris experiences. What would you like to explore first?',
    fr: 'Bien sûr. Nous pouvons vous aider avec les chambres, la gastronomie, le spa & bien-être, les transferts et les expériences privées à Paris. Que souhaitez-vous découvrir en premier ?',
    es: 'Por supuesto. Podemos ayudarle con habitaciones, gastronomía, spa y bienestar, traslados y experiencias privadas en París. ¿Qué le gustaría explorar primero?',
    it: 'Certamente. Possiamo aiutarla con camere, ristorazione, spa e benessere, trasferimenti ed esperienze private a Parigi. Cosa desidera esplorare per primo?',
    de: 'Sehr gern. Wir helfen mit Zimmern, Dining, Spa & Wellness, Transfers und privaten Pariser Erlebnissen. Was möchten Sie zuerst entdecken?',
  };

  return {
    reply: replies[input.language] || replies.en,
    language: input.language,
    intent: 'partner_catalog',
    external_option_names: [],
    recommendations: [],
    partner_offers: [],
    hotel_collection: collection,
    catalogue_count: collection.length,
    catalogue_categories: categoryCount,
    provider_failure: '',
    requires_human: false,
    media: explicitDirectoryRequest(input.message) ? detectMediaBrochure('hotel directory') : null,
    quickReplies: ['Rooms & Suites', 'Dining', 'Spa & Wellness'],
    next_step: firstTimeParisNextStep(input),
  };
}

function hotelFirstResponse(input, classification, services) {
  const text = normalized(input.message);
  if (/\b(what time|when did|did i|did we|which time|what day|how much did|remind me|what was)\b/.test(text)) {
    return null;
  }
  if (classification?.wantsExternal || guestInsistsOnExternal(input.message)) {
    return null;
  }
  if (isHotelCollectionQuestion(input.message, classification)) {
    return hotelCatalogueResponse(input, classification, services);
  }

  const hotelServiceCategories = new Set(['restaurant', 'spa', 'accommodation', 'transport', 'tour', 'experience']);
  if (!hotelServiceCategories.has(classification.category)) return null;
  const hotelOptions = categoryPartnerServices(services, classification.category);
  if (!hotelOptions.length) return null;
  // A spa menu can use its own verified brochure. Narrow dining and room
  // questions deliberately stay card-first and never receive the general
  // directory as a side effect.
  const media = classification.category === 'spa' ? detectMediaBrochure(input.message, classification.category) : null;

  if (classification.cuisine && !guestInsistsOnExternal(input.message)) {
    const offeredNames = hotelOptions.slice(0, 2).map((service) => service.name).join(' / ');
    return {
      reply: hotelAlternativeReply(input.language, classification.cuisine.label, offeredNames),
      language: input.language,
      intent: 'hotel_alternative',
      external_option_names: [],
      recommendations: [],
      partner_offers: partnerOffers(hotelOptions),
      provider_failure: '',
      requires_human: true,
      media,
    };
  }

  if (classification.cuisine && guestInsistsOnExternal(input.message)) return null;
  return {
    reply: hotelCategoryReply(input.language, classification.category, hotelOptions.length),
    language: input.language,
    intent: 'partner_request',
    external_option_names: [],
    recommendations: [],
    partner_offers: partnerOffers(hotelOptions),
    provider_failure: '',
    requires_human: true,
    media,
  };
}

const ROOM_BOOKING_INTRO = {
  en: 'I would be delighted to help with your stay. Choose your dates and preferred arrival time below, and our reservations team will return with the best available room options.',
  fr: 'Je serais ravi de vous aider pour votre sejour. Choisissez vos dates et votre heure d\u2019arrivee ci-dessous, et notre equipe reservations reviendra vers vous avec les meilleures options de chambres disponibles.',
  es: 'Sera un placer ayudarle con su estancia. Elija sus fechas y hora de llegada preferida a continuacion, y nuestro equipo de reservas le respondera con las mejores opciones de habitacion disponibles.',
  de: 'Gern helfe ich Ihnen bei Ihrem Aufenthalt. Wahlen Sie unten Ihre Daten und Ihre bevorzugte Ankunftszeit; unser Reservierungsteam meldet sich mit den besten verfugbaren Zimmeroptionen bei Ihnen.',
  it: 'Saro lieto di aiutarla con il suo soggiorno. Scelga qui sotto le date e l\u2019orario di arrivo preferito; il nostro team prenotazioni tornera da lei con le migliori opzioni di camera disponibili.',
  ja: '\u3054\u6ede\u5728\u306e\u304a\u624b\u4f1d\u3044\u3092\u3044\u305f\u3057\u307e\u3059\u3002\u4e0b\u3067\u65e5\u4ed8\u3068\u3054\u5e0c\u671b\u306e\u5230\u7740\u6642\u9593\u3092\u304a\u9078\u3073\u304f\u3060\u3055\u3044\u3002\u4e88\u7d04\u30c1\u30fc\u30e0\u304c\u6700\u9069\u306a\u5ba2\u5ba4\u30aa\u30d7\u30b7\u30e7\u30f3\u3092\u3054\u6848\u5185\u3057\u307e\u3059\u3002',
  zh: '\u6211\u5f88\u4e50\u610f\u534f\u52a9\u60a8\u5b89\u6392\u4f4f\u5bbf\u3002\u8bf7\u5728\u4e0b\u65b9\u9009\u62e9\u60a8\u7684\u65e5\u671f\u548c\u5e0c\u671b\u62b5\u8fbe\u65f6\u95f4\uff0c\u6211\u4eec\u7684\u9884\u8ba2\u56e2\u961f\u5c06\u4e3a\u60a8\u63d0\u4f9b\u6700\u9002\u5408\u7684\u53ef\u7528\u5ba2\u623f\u9009\u9879\u3002',
  ar: '\u064a\u0633\u0639\u062f\u0646\u064a \u0623\u0646 \u0623\u0633\u0627\u0639\u062f\u0643\u0645 \u0641\u064a \u0625\u0642\u0627\u0645\u062a\u0643\u0645. \u0627\u062e\u062a\u0627\u0631\u0648\u0627 \u0627\u0644\u062a\u0648\u0627\u0631\u064a\u062e \u0648\u0648\u0642\u062a \u0627\u0644\u0648\u0635\u0648\u0644 \u0627\u0644\u0645\u0641\u0636\u0644 \u0623\u062f\u0646\u0627\u0647\u060c \u0648\u0633\u064a\u0639\u0648\u062f \u0641\u0631\u064a\u0642 \u0627\u0644\u062d\u062c\u0648\u0632\u0627\u062a \u0625\u0644\u064a\u0643\u0645 \u0628\u0623\u0641\u0636\u0644 \u062e\u064a\u0627\u0631\u0627\u062a \u0627\u0644\u063a\u0631\u0641 \u0627\u0644\u0645\u062a\u0627\u062d\u0629.',
};

function isRoomBookingRequest(message, classification) {
  if (classification.category !== 'accommodation') return false;
  const text = String(message || '').toLowerCase();
  if (/\broom\s+service\b/i.test(text)) return false;
  return /\b(book|reserve|want|need|looking for|stay|night|nights|room|suite|check[ -]?in)\b/i.test(text)
    || /\b(chambre|habitacion|zimmer|camera)\b/i.test(text);
}

function roomBookingResponse(input, classification) {
  if (!isRoomBookingRequest(input.message, classification)) return null;
  return {
    reply: ROOM_BOOKING_INTRO[input.language] || ROOM_BOOKING_INTRO.en,
    language: input.language,
    intent: 'room_enquiry',
    external_option_names: [],
    recommendations: [],
    partner_offers: [],
    room_booking: true,
    provider_failure: '',
    requires_human: true,
  };
}

function isSafeWebsiteUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function curatedDiningResponse(input, classification, services) {
  if (classification.category !== 'restaurant' || !classification.cuisine || classification.location || !guestInsistsOnExternal(input.message)) return null;
  const eligible = services.filter((service) => !service.isPartner && isSafeWebsiteUrl(service.websiteUrl));
  if (!eligible.length) return null;
  const cards = (preferenceForOneRecommendation(input.message) ? eligible.slice(0, 1) : eligible.slice(0, 3)).map((service) => ({
    name: service.name,
    description: String(service.description || `A curated ${classification.cuisine.label} address in Paris.`).slice(0, 240),
    website_url: isSafeWebsiteUrl(service.websiteUrl),
    image_url: isSafeWebsiteUrl(service.imageUrl) || CURATED_DINING_IMAGES[classification.cuisine.id] || PARTNER_CARD_IMAGES.restaurant,
    service_type: 'restaurant',
    source: 'external',
    booking_enabled: true,
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

const HOTEL_DISCOVERY_OPTIONS = Object.freeze({
  pms: ['Mews', 'OPERA / OPERA Cloud', 'FOLS', 'Misterbooking', 'Infhotik', 'Cloudbeds', 'Amenitiz', 'Thaïs', 'Other', 'Not sure'],
  yesNoNotSure: ['Yes', 'No', 'Not sure'],
  serviceUsage: ['Less than 10%', '10–25%', '25–50%', 'More than 50%', 'Not sure'],
  requestedServices: ['Airport transfers', 'Restaurant / dining', 'Spa & wellness', 'Room upgrades', 'Early check-in / late checkout', 'Tours & local experiences', 'Room service', 'Other'],
  lowServiceReasons: ['Guests may not know the services exist', 'Guests discover them too late', 'Staff do not always have time to promote them', 'Most communication happens by email', 'Language barriers', 'Guests prefer arranging things independently', 'Other'],
  preArrivalContact: ['Yes', 'Sometimes', 'No'],
  contactMethods: ['Email', 'Booking.com / OTA messaging', 'WhatsApp', 'SMS', 'Phone', 'Hotel app', 'Other'],
  discoveryChannels: ['Reception staff', 'Hotel website', 'Booking confirmation email', 'Pre-arrival emails', 'Printed brochures', 'In-room materials / QR codes', 'WhatsApp / SMS', 'Hotel app', 'Guests usually ask themselves', 'Other'],
  languageDifficulty: ['Never', 'Occasionally', 'Regularly', 'Very often'],
  repeatedQuestions: ['Breakfast hours', 'Wi-Fi', 'Check-in / checkout', 'Transport / airport', 'Restaurant recommendations', 'Hotel services', 'Spa', 'Directions / local recommendations', 'Room questions', 'Other'],
  requestHandling: ['Reception handles them directly', 'Reception calls the appropriate department', 'Internal phone / radio', 'WhatsApp staff group', 'Hotel/PMS task-management system', 'Written notes', 'Other'],
  responseSpeed: ['Almost immediately', 'Under 5 minutes', '5–15 minutes', 'More than 15 minutes', 'It varies significantly'],
  managementInsights: ['Most common guest questions', 'Most requested services', 'Guest complaints', 'Response times', 'Service / ancillary revenue', 'Guest preferences', 'Staff workload', 'Other'],
  improvementGoals: ['Increase ancillary-service revenue', 'Reduce repetitive reception work', 'Improve guest response time', 'Improve multilingual communication', 'Improve guest satisfaction', 'Generate more guest feedback / reviews', 'Better understand guest needs', 'Improve pre-arrival communication', 'Other'],
});

function discoveryChoice(value, field, options, { required = false } = {}) {
  const choice = compactText(value, field, { required, max: 120 });
  if (choice && !options.includes(choice)) throw new Error(`Invalid ${field.toLowerCase()}.`);
  return choice;
}

function discoveryList(value, field, options, { maxItems = 12 } = {}) {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be a list.`);
  if (value.length > maxItems) throw new Error(`${field} has too many selections.`);
  const selections = [...new Set(value.map((item) => compactText(item, field, { max: 120 })).filter(Boolean))];
  if (selections.some((item) => !options.includes(item))) throw new Error(`Invalid ${field.toLowerCase()} selection.`);
  return selections;
}

function discoveryInteger(value, field, { max = 5000 } = {}) {
  const text = compactText(value, field, { max: 6 });
  if (!text) return null;
  const numeric = Number(text);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > max) throw new Error(`${field} must be between 1 and ${max}.`);
  return numeric;
}

function discoveryPercentage(value, field) {
  const text = compactText(value, field, { max: 6 });
  if (!text) return null;
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) throw new Error(`${field} must be between 0 and 100.`);
  return Math.round(numeric * 10) / 10;
}

function salesBriefLines(label, value) {
  if (Array.isArray(value)) return value.length ? `${label}: ${value.join(', ')}` : '';
  if (value === null || value === undefined || value === '') return '';
  return `${label}: ${value}`;
}

function buildHotelDiscoverySalesBrief(lead) {
  const { discovery } = lead;
  const shares = Object.entries(discovery.bookingSources)
    .filter(([, value]) => value !== null)
    .map(([source, value]) => `${source}: ${value}%`);
  const groups = [
    ['Hotel Discovery Brief', [
      `Hotel: ${lead.hotelName}`,
      `Contact: ${lead.contactName}${lead.role ? ` · ${lead.role}` : ''}`,
      `Email: ${lead.email}`,
      salesBriefLines('Phone', lead.phone),
      salesBriefLines('Website', lead.website),
      salesBriefLines('Rooms', lead.roomCount),
      salesBriefLines('Properties operated', discovery.propertyCount),
      salesBriefLines('PMS / reservation system', discovery.pmsSystem === 'Other' && discovery.pmsOther ? `Other — ${discovery.pmsOther}` : discovery.pmsSystem),
      salesBriefLines('WhatsApp Business', discovery.whatsAppBusiness),
    ]],
    ['Guest services & revenue', [
      salesBriefLines('Guests using additional services', discovery.serviceUsage),
      salesBriefLines('Most requested services', discovery.requestedServices),
      salesBriefLines('Other frequent requests', discovery.requestedServicesOther),
      salesBriefLines('Reasons for lower service usage', discovery.lowServiceReasons),
      salesBriefLines('Other reason', discovery.lowServiceReasonsOther),
    ]],
    ['Bookings & communication', [
      salesBriefLines('Reservation mix', shares),
      discovery.bookingSourcesNotSure ? 'Reservation mix: Not sure' : '',
      salesBriefLines('Proactive pre-arrival contact', discovery.preArrivalContact),
      salesBriefLines('Pre-arrival channels', discovery.preArrivalMethods),
      salesBriefLines('How paid services are discovered', discovery.discoveryChannels),
      salesBriefLines('Services to promote more often', discovery.servicesToPromote),
    ]],
    ['Guests & language', [
      salesBriefLines('International guest origins', discovery.internationalOrigins),
      salesBriefLines('Language difficulty', discovery.languageDifficulty),
      salesBriefLines('Languages creating difficulty', discovery.difficultLanguages),
    ]],
    ['Front desk & operations', [
      salesBriefLines('Repeated reception questions', discovery.repeatedQuestions),
      salesBriefLines('How requests are handled', discovery.requestHandling),
      salesBriefLines('Response time during busy periods', discovery.responseSpeed),
      salesBriefLines('Complaint / VIP escalation', discovery.escalationProcess),
      salesBriefLines('Post-checkout feedback contact', discovery.postCheckoutContact),
      salesBriefLines('Post-checkout channels', discovery.postCheckoutMethods),
    ]],
    ['Management goals', [
      salesBriefLines('Management wants to understand', discovery.managementInsights),
      salesBriefLines('Priorities to improve', discovery.improvementGoals),
      salesBriefLines('Presentation focus requested', discovery.presentationFocus),
    ]],
  ];
  return groups.map(([heading, lines]) => {
    const content = lines.filter(Boolean).map((line) => `• ${line}`).join('\n');
    return content ? `${heading}\n${content}` : '';
  }).filter(Boolean).join('\n\n').slice(0, 12_000);
}

const DEMO_LANGUAGES = new Map([
  ['english', 'en'], ['en', 'en'],
  ['french', 'fr'], ['français', 'fr'], ['francais', 'fr'], ['fr', 'fr'],
  ['spanish', 'es'], ['español', 'es'], ['espanol', 'es'], ['es', 'es'],
  ['japanese', 'ja'], ['日本語', 'ja'], ['ja', 'ja'],
]);
const DEMO_SCENARIOS = new Set(['pre-arrival', 'pre_arrival', 'in-stay', 'in_stay', 'checkout', 'post-checkout', 'post_checkout']);

function parseDemoChatPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid demo chat payload.');
  if (body.is_demo !== true) throw new Error('The demo endpoint requires is_demo to be true.');

  const guestName = compactText(body.guestName, 'Guest name', { required: true, max: 100 });
  const languageInput = compactText(body.language, 'Language', { required: true, max: 32 }).toLocaleLowerCase();
  const language = DEMO_LANGUAGES.get(languageInput);
  if (!language) throw new Error('Invalid demo language.');

  const rawScenario = compactText(body.scenario, 'Scenario', { required: true, max: 48 });
  if (!DEMO_SCENARIOS.has(rawScenario)) throw new Error('Invalid demo scenario.');
  const scenario = rawScenario.toLowerCase();

  if (!Array.isArray(body.chatHistory) || body.chatHistory.length < 1 || body.chatHistory.length > 24) {
    throw new Error('chatHistory must contain between 1 and 24 messages.');
  }
  const chatHistory = body.chatHistory.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid chatHistory item at position ${index + 1}.`);
    const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : '';
    if (!role) throw new Error(`Invalid chatHistory role at position ${index + 1}.`);
    const message = compactText(item.content ?? item.message, `chatHistory item ${index + 1}`, { required: true, max: 1200 });
    return { role, message };
  });
  const latestMessage = [...chatHistory].reverse().find((item) => item.role === 'user')?.message;
  if (!latestMessage) throw new Error('chatHistory must include a guest message.');

  const suppliedSessionId = compactText(body.sessionId, 'Demo session', { max: 110 });
  const sessionId = suppliedSessionId || `demo_${crypto.randomUUID()}`;
  if (!/^[A-Za-z0-9:_-]{4,120}$/.test(sessionId)) throw new Error('Invalid demo session identifier.');

  return {
    message: latestMessage,
    sessionId,
    channel: 'web',
    preferredLanguage: language,
    guestName,
    scenario,
    is_demo: true,
    chatHistory,
    conversationOwner: compactText(body.conversationOwner, 'Conversation owner', { max: 24 }).toLowerCase() === 'staff' ? 'staff' : 'ai',
  };
}

function parseBookingEnquiry(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid booking enquiry.');
  const guestName = compactText(body.guestName, 'Guest name', { required: true, max: 100 });
  const email = compactText(body.email, 'Email address', { required: true, max: 160 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please provide a valid email address.');
  const serviceName = compactText(body.serviceName, 'Service', { required: true, max: 160 });
  // Preserve the submitted label only long enough for the single strict
  // normalizer at persistence time to map it into a dashboard bucket.
  const serviceType = compactText(body.serviceType, 'Service type', { max: 80 });
  const source = String(body.source || '').toLowerCase() === 'external' ? 'external' : 'partner';
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
    source,
    userId: `web:${sessionId || `enquiry_${crypto.randomUUID()}`}`,
    partySize: safePartySize,
    preferredDate,
    preferredTime,
    phone,
    notes,
    language: compactText(body.language, 'Language', { max: 12 }) || 'en',
    isDemo: body.is_demo === true,
  };
}

async function persistBookingEnquiry(env, enquiry) {
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
      ServiceType: mapServiceTypeForRequests(enquiry.serviceType),
      RequestSummary: details,
      Source: enquiry.source,
      ServiceRef: enquiry.serviceName,
      Status: 'new',
      IsUpsell: true,
      Language: enquiry.language,
      HandoverAt: new Date().toISOString(),
      ...(enquiry.isDemo ? { Is_Demo: true } : {}),
    },
  });
}

function parseRoomEnquiry(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid room enquiry.');
  const firstName = compactText(body.firstName, 'First name', { required: true, max: 60 });
  const lastName = compactText(body.lastName, 'Last name', { required: true, max: 60 });
  const email = compactText(body.email, 'Email address', { required: true, max: 160 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please provide a valid email address.');
  const phone = compactText(body.phone, 'Phone number', { required: true, max: 60 });
  const checkIn = compactText(body.checkIn, 'Check-in date', { required: true, max: 10 });
  const checkOut = compactText(body.checkOut, 'Check-out date', { required: true, max: 10 });
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (!validDate(checkIn) || !validDate(checkOut)) throw new Error('Please provide valid check-in and check-out dates.');
  if (checkOut <= checkIn) throw new Error('Check-out must be after check-in.');
  const arrivalTime = compactText(body.arrivalTime, 'Arrival time', { max: 5 });
  if (arrivalTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(arrivalTime)) throw new Error('Please provide a valid arrival time.');
  const parseCount = (value, field, { min, max, fallback }) => {
    const text = compactText(value, field, { max: 3 });
    if (!text) return fallback;
    const count = Number(text);
    if (!Number.isInteger(count) || count < min || count > max) throw new Error(`${field} must be between ${min} and ${max}.`);
    return count;
  };
  const adults = parseCount(body.adults, 'Adults', { min: 1, max: 12, fallback: 1 });
  const children = parseCount(body.children, 'Children', { min: 0, max: 10, fallback: 0 });
  const rooms = parseCount(body.rooms, 'Rooms', { min: 1, max: 5, fallback: 1 });
  const serviceName = compactText(body.serviceName, 'Selected room', { max: 160 }) || 'Hotel room stay';
  const preference = compactText(body.preference, 'Room preference', { max: 80 });
  const notes = compactText(body.notes, 'Notes', { max: 600 });
  const sessionId = compactText(body.sessionId, 'Session', { max: 110 });
  if (sessionId && !/^[a-zA-Z0-9_-]{4,110}$/.test(sessionId)) throw new Error('Invalid session identifier.');
  if (body.consent !== true) throw new Error('Consent is required to send a room enquiry.');
  return {
    firstName,
    lastName,
    email,
    phone,
    checkIn,
    checkOut,
    arrivalTime,
    adults,
    children,
    rooms,
    serviceName,
    preference,
    notes,
    userId: `web:${sessionId || `room_${crypto.randomUUID()}`}`,
    language: compactText(body.language, 'Language', { max: 12 }) || 'en',
    isDemo: body.is_demo === true,
  };
}

async function persistRoomEnquiry(env, enquiry) {
  const details = [
    `Room stay enquiry for ${enquiry.serviceName}: ${enquiry.checkIn} to ${enquiry.checkOut}.`,
    `Email: ${enquiry.email}.`,
    `Phone: ${enquiry.phone}.`,
    enquiry.arrivalTime && `Preferred arrival time: ${enquiry.arrivalTime}.`,
    `Adults: ${enquiry.adults}.`,
    `Children: ${enquiry.children}.`,
    `Rooms requested: ${enquiry.rooms}.`,
    enquiry.preference && `Room preference: ${enquiry.preference}.`,
    enquiry.notes && `Notes: ${enquiry.notes}`,
  ].filter(Boolean).join(' ');
  return airtable(env, 'Requests', {
    method: 'POST',
    fields: {
      UserID: enquiry.userId,
      Channel: 'web',
      GuestName: `${enquiry.firstName} ${enquiry.lastName}`,
      ServiceType: mapServiceTypeForRequests('Front Desk'),
      RequestSummary: details,
      Source: 'hotel_room_enquiry',
      ServiceRef: enquiry.serviceName,
      Status: 'new',
      IsUpsell: false,
      Language: enquiry.language,
      HandoverAt: new Date().toISOString(),
      ...(enquiry.isDemo ? { Is_Demo: true } : {}),
    },
  });
}

function parseLegacyDiscoveryLead(body) {
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

function parseHotelDiscoveryBrief(body) {
  const contactName = compactText(body.contactName, 'Contact name', { required: true, max: 100 });
  const role = compactText(body.role, 'Role / job title', { required: true, max: 100 });
  const hotelName = compactText(body.hotelName, 'Hotel name', { required: true, max: 160 });
  const email = compactText(body.email, 'Work email', { required: true, max: 160 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please provide a valid work email.');
  const phone = compactText(body.phone, 'Phone number', { max: 60 });
  const website = compactText(body.website, 'Hotel website', { max: 240 });
  if (website) {
    try {
      const parsed = new URL(website);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('protocol');
    } catch {
      throw new Error('Please provide a valid hotel website URL.');
    }
  }
  const sessionId = compactText(body.sessionId, 'Session', { max: 110 });
  if (sessionId && !/^[a-zA-Z0-9_-]{4,110}$/.test(sessionId)) throw new Error('Invalid session identifier.');
  if (body.consent !== true) throw new Error('Consent is required to send a hotel discovery brief.');
  const answers = body.discovery;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('Invalid hotel discovery answers.');

  const bookingSources = {
    'Direct hotel website': discoveryPercentage(answers.bookingSources?.directWebsite, 'Direct hotel website share'),
    'Booking.com': discoveryPercentage(answers.bookingSources?.bookingCom, 'Booking.com share'),
    'Expedia / Hotels.com': discoveryPercentage(answers.bookingSources?.expedia, 'Expedia / Hotels.com share'),
    'Other OTAs': discoveryPercentage(answers.bookingSources?.otherOtas, 'Other OTAs share'),
    'Travel agencies / corporate': discoveryPercentage(answers.bookingSources?.agenciesCorporate, 'Travel agencies / corporate share'),
    Other: discoveryPercentage(answers.bookingSources?.other, 'Other reservations share'),
  };
  const discovery = {
    propertyCount: discoveryInteger(body.propertyCount, 'Number of properties operated', { max: 1000 }),
    pmsSystem: discoveryChoice(body.pmsSystem, 'PMS / reservation system', HOTEL_DISCOVERY_OPTIONS.pms),
    pmsOther: compactText(body.pmsOther, 'Other PMS / reservation system', { max: 100 }),
    whatsAppBusiness: discoveryChoice(body.whatsAppBusiness, 'WhatsApp Business', HOTEL_DISCOVERY_OPTIONS.yesNoNotSure),
    serviceUsage: discoveryChoice(answers.serviceUsage, 'Service usage', HOTEL_DISCOVERY_OPTIONS.serviceUsage),
    requestedServices: discoveryList(answers.requestedServices, 'Requested services', HOTEL_DISCOVERY_OPTIONS.requestedServices, { maxItems: 8 }),
    requestedServicesOther: compactText(answers.requestedServicesOther, 'Other requested services', { max: 300 }),
    lowServiceReasons: discoveryList(answers.lowServiceReasons, 'Service usage reasons', HOTEL_DISCOVERY_OPTIONS.lowServiceReasons, { maxItems: 7 }),
    lowServiceReasonsOther: compactText(answers.lowServiceReasonsOther, 'Other service usage reason', { max: 300 }),
    bookingSources,
    bookingSourcesNotSure: answers.bookingSourcesNotSure === true,
    preArrivalContact: discoveryChoice(answers.preArrivalContact, 'Pre-arrival contact', HOTEL_DISCOVERY_OPTIONS.preArrivalContact),
    preArrivalMethods: discoveryList(answers.preArrivalMethods, 'Pre-arrival contact methods', HOTEL_DISCOVERY_OPTIONS.contactMethods, { maxItems: 7 }),
    discoveryChannels: discoveryList(answers.discoveryChannels, 'Service discovery channels', HOTEL_DISCOVERY_OPTIONS.discoveryChannels, { maxItems: 10 }),
    servicesToPromote: compactText(answers.servicesToPromote, 'Services to promote', { max: 500 }),
    internationalOrigins: discoveryList(answers.internationalOrigins, 'International guest origins', Array.isArray(answers.internationalOrigins) ? answers.internationalOrigins : [], { maxItems: 12 }),
    languageDifficulty: discoveryChoice(answers.languageDifficulty, 'Language difficulty', HOTEL_DISCOVERY_OPTIONS.languageDifficulty),
    difficultLanguages: compactText(answers.difficultLanguages, 'Languages creating difficulty', { max: 300 }),
    repeatedQuestions: discoveryList(answers.repeatedQuestions, 'Repeated reception questions', HOTEL_DISCOVERY_OPTIONS.repeatedQuestions, { maxItems: 10 }),
    requestHandling: discoveryList(answers.requestHandling, 'Request handling methods', HOTEL_DISCOVERY_OPTIONS.requestHandling, { maxItems: 7 }),
    responseSpeed: discoveryChoice(answers.responseSpeed, 'Response time', HOTEL_DISCOVERY_OPTIONS.responseSpeed),
    escalationProcess: compactText(answers.escalationProcess, 'Complaint / VIP escalation', { max: 600 }),
    postCheckoutContact: discoveryChoice(answers.postCheckoutContact, 'Post-checkout contact', HOTEL_DISCOVERY_OPTIONS.preArrivalContact),
    postCheckoutMethods: discoveryList(answers.postCheckoutMethods, 'Post-checkout contact methods', HOTEL_DISCOVERY_OPTIONS.contactMethods.concat(['OTA platform', 'Review platform link']), { maxItems: 7 }),
    managementInsights: discoveryList(answers.managementInsights, 'Management insights', HOTEL_DISCOVERY_OPTIONS.managementInsights, { maxItems: 8 }),
    improvementGoals: discoveryList(answers.improvementGoals, 'Improvement priorities', HOTEL_DISCOVERY_OPTIONS.improvementGoals, { maxItems: 3 }),
    presentationFocus: compactText(answers.presentationFocus, 'Presentation focus', { max: 900 }),
  };
  if (discovery.pmsSystem !== 'Other') discovery.pmsOther = '';
  if (!['Yes', 'Sometimes'].includes(discovery.preArrivalContact)) discovery.preArrivalMethods = [];
  if (!['Yes', 'Sometimes'].includes(discovery.postCheckoutContact)) discovery.postCheckoutMethods = [];
  return {
    contactName,
    role,
    hotelName,
    email,
    phone,
    city: '',
    website,
    roomCount: discoveryInteger(body.roomCount, 'Number of rooms', { max: 5000 }),
    message: discovery.presentationFocus,
    discovery,
    userId: `web:${sessionId || `hotel_brief_${crypto.randomUUID()}`}`,
  };
}

function parseDiscoveryLead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid discovery request.');
  if (body.submissionType === 'hotel_discovery_brief') return parseHotelDiscoveryBrief(body);
  return parseLegacyDiscoveryLead(body);
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
      'Phone Number': lead.phone || undefined,
      City: lead.city || undefined,
      'Number of Rooms': lead.roomCount ?? undefined,
      'Hotel Website': lead.website || undefined,
      // Hotel Leads already has a long-text field for service needs. For the
      // extended brief it holds the complete, human-readable Sales Brief so an
      // Airtable Automation can email the exact submitted context without a
      // second lead pipeline or unverified schema fields.
      'Concierge Service Needs': lead.discovery ? buildHotelDiscoverySalesBrief(lead) : (lead.message || undefined),
      'Lead Status': 'New',
    },
  });
}

function staffRoleFor(serviceType) {
  const type = mapServiceTypeForRequests(serviceType);
  if (type === 'General Manager') return 'General Manager';
  return {
    Housekeeping: 'Housekeeping team',
    Maintenance: 'Maintenance team',
    'Spa & Wellness': 'Spa team',
    Transport: 'Guest relations',
    Dining: 'Restaurant reservations',
    Concierge: 'Concierge desk',
  }[type] || 'Concierge desk';
}

function staffAlertsFromOutcome(outcome) {
  // Compatibility routing metadata for the simulator and existing clients.
  // It identifies the intended queue only; it is not evidence that a person
  // was notified, received the request, or has begun work.
  return (outcome.requests || []).filter((item) => item.summary).slice(0, 3).map((item) => ({
    role: staffRoleFor(outcome.serviceType),
    summary: item.summary,
    service_name: item.serviceName || '',
    service_type: mapServiceTypeForRequests(outcome.serviceType),
  }));
}

// This is a presentation-safe reflection of the request objects that are
// already persisted by persistConversation. It deliberately carries no
// Airtable record IDs or staff data, and keeps the public chat contract
// additive for clients that do not use the operational surface.
function requestSummariesFromOutcome(outcome) {
  return (outcome?.requests || []).filter((item) => item?.summary).slice(0, 3).map((item) => ({
    service_name: String(item.serviceName || ''),
    service_type: mapServiceTypeForRequests(outcome.serviceType),
    source: item.source === 'external' ? 'external' : 'partner',
    summary: String(item.summary || ''),
    est_value_eur: Number.isFinite(Number(item.estValueEur)) ? Number(item.estValueEur) : null,
    is_upsell: Boolean(item.isUpsell),
  }));
}

function chatResponseFromOutcome(outcome, classification, language, partnerOfferList = [], providerFailure = '', customMedia = null, inputMessage = '') {
  const media = customMedia || detectMediaBrochure(inputMessage || outcome?.reply || classification?.category || '', classification?.category);
  const nextStep = outcome?.nextStep && outcome.nextStep.type === 'guest_follow_up' && typeof outcome.nextStep.text === 'string'
    ? {
      type: 'guest_follow_up',
      key: String(outcome.nextStep.key || '').slice(0, 80),
      text: outcome.nextStep.text.slice(0, 220),
      delay_ms: Math.min(3_000, Math.max(1_500, Number(outcome.nextStep.delayMs || outcome.nextStep.delay_ms || 1_800))),
    }
    : null;
  return {
    reply: outcome.reply,
    language,
    intent: outcome.intent,
    external_option_names: outcome.externalOptionNames,
    recommendations: outcome.recommendations.map((item) => ({
      name: item.name,
      description: item.description,
      website_url: item.websiteUrl,
      image_url: item.imageUrl,
      service_type: mapServiceTypeForRequests(classification.category),
      source: 'external',
      booking_enabled: true,
    })),
    partner_offers: partnerOfferList,
    provider_failure: providerFailure,
    requires_human: Boolean(outcome.requiresHuman || outcome.escapeHatchTriggered),
    escape_hatch_triggered: Boolean(outcome.escapeHatchTriggered),
    media: media || detectMediaBrochure(outcome.reply || '', classification.category),
    staff_alerts: staffAlertsFromOutcome(outcome),
    requests: requestSummariesFromOutcome(outcome),
    ...(nextStep ? { next_step: nextStep } : {}),
  };
}

function reviewLinkMedia() {
  return {
    type: 'link',
    title: 'Hôtel Lumière Paris — Google Reviews',
    url: 'https://g.page/r/hotel-lumiere-paris/review',
    description: 'Share your experience publicly, if you wish. · Google Maps',
    thumbnail: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=700&q=84',
  };
}

function postCheckoutResponse(input) {
  if (!isPostCheckoutScenario(input)) return null;
  const isNeg = isPostCheckoutNegative(input.message);
  const isPos = isPostCheckoutPositive(input.message);

  if (isNeg) {
    const reply = postCheckoutNegativeReply(input.guestName, input.language);
    const outcome = {
      reply,
      intent: 'complaint',
      serviceType: 'General Manager',
      requiresHuman: true,
      escapeHatchTriggered: true,
      requests: [{
        serviceName: 'Post-Checkout Private Service Recovery',
        source: 'partner',
        summary: `URGENT POST-CHECKOUT SERVICE RECOVERY: Guest feedback: "${input.message}"`,
        isUpsell: false,
      }],
      externalOptionNames: [],
      recommendations: [],
    };
    const res = chatResponseFromOutcome(outcome, { category: 'general_manager', hasEscalation: true }, input.language, [], '', reviewLinkMedia(), input.message);
    res.quickReplies = ['Leave Google Review', 'Share on TripAdvisor'];
    return res;
  }

  if (isPos) {
    const reply = postCheckoutPositiveReply(input.guestName, input.language);
    const outcome = {
      reply,
      intent: 'feedback',
      serviceType: 'concierge',
      requiresHuman: false,
      escapeHatchTriggered: false,
      requests: [],
      externalOptionNames: [],
      recommendations: [],
    };
    const res = chatResponseFromOutcome(outcome, { category: 'review', isPositive: true }, input.language, [], '', reviewLinkMedia(), input.message);
    res.quickReplies = ['Leave Google Review', 'Share on TripAdvisor'];
    return res;
  }

  return null;
}

function escalationResponse(input) {
  if (!isEscalation(input.message)) return null;
  const reply = ESCALATION_REPLIES[input.language] ?? ESCALATION_REPLIES.en;
  const outcome = {
    reply,
    intent: 'complaint',
    serviceType: 'escalation',
    requiresHuman: true,
    escapeHatchTriggered: true,
    requests: [{
      serviceName: 'Guest Service Recovery Request',
      source: 'partner',
      summary: `URGENT: Guest requested manager / severe complaint: "${input.message}"`,
      isUpsell: false,
    }],
    externalOptionNames: [],
    recommendations: [],
  };
  return chatResponseFromOutcome(outcome, { category: 'escalation', hasEscalation: true }, input.language);
}

function operationalResponse(input) {
  if (!isOperationalRequest(input.message)) return null;
  const serviceType = operationalServiceType(input.message);
  const reply = OPERATIONAL_REPLIES[input.language] ?? OPERATIONAL_REPLIES.en;
  const outcome = {
    reply,
    intent: 'service_request',
    serviceType,
    requiresHuman: true,
    requests: [{
      serviceName: serviceType === 'Maintenance' ? 'Maintenance Request' : 'Housekeeping Request',
      source: 'partner',
      summary: `${serviceType} request: "${input.message}"`,
      isUpsell: false,
    }],
    externalOptionNames: [],
    recommendations: [],
  };
  return chatResponseFromOutcome(outcome, { category: serviceType.toLowerCase(), isOperational: true, hasIntent: true }, input.language, [], '', null, input.message);
}

async function resolveChat(body, env, ctx, reportStatus = () => undefined) {
  let input;
  try {
    input = parseGuestInput(body);
  } catch (err) {
    throw err;
  }

  try {
    const instantPostCheckout = postCheckoutResponse(input);
    if (instantPostCheckout) {
      if (!input.testMode || input.testMode === 'write_verified') {
        const isNeg = instantPostCheckout.intent === 'complaint' || instantPostCheckout.escape_hatch_triggered;
        ctx.waitUntil(persistConversation(env, input, {
          reply: instantPostCheckout.reply,
          serviceType: isNeg ? 'General Manager' : 'concierge',
          requests: isNeg ? [{
            serviceName: 'Post-Checkout Private Service Recovery',
            source: 'partner',
            summary: `URGENT POST-CHECKOUT SERVICE RECOVERY: Guest feedback: "${input.message}"`,
            isUpsell: false,
          }] : [],
        }).catch(() => undefined));
      }
      return instantPostCheckout;
    }
    const instantEscalation = escalationResponse(input);
    if (instantEscalation) {
      if (!input.testMode || input.testMode === 'write_verified') {
        ctx.waitUntil(persistConversation(env, input, {
          reply: instantEscalation.reply,
          serviceType: 'General Manager',
          requests: [{
            serviceName: 'Guest Service Recovery Request',
            source: 'partner',
            summary: `URGENT: Guest requested manager / severe complaint: "${input.message}"`,
            isUpsell: false,
          }],
        }).catch(() => undefined));
      }
      return instantEscalation;
    }
    const instantOperational = operationalResponse(input);
    if (instantOperational) {
      if (!input.testMode || input.testMode === 'write_verified') {
        const serviceType = operationalServiceType(input.message);
        ctx.waitUntil(persistConversation(env, input, {
          reply: instantOperational.reply,
          serviceType,
          requests: [{
            serviceName: serviceType === 'Maintenance' ? 'Maintenance Request' : 'Housekeeping Request',
            source: 'partner',
            summary: `${serviceType} request: "${input.message}"`,
            isUpsell: false,
          }],
        }).catch(() => undefined));
      }
      return instantOperational;
    }
    let classification = classifyRequest(input.message);
    reportStatus('Reviewing the details of your request\u2026');
    const instantGreeting = simpleGreetingResponse(input);
    if (instantGreeting) {
      if (!input.testMode || input.testMode === 'write_verified') {
        ctx.waitUntil(persistConversation(env, input, { reply: instantGreeting.reply, requests: [] }).catch(() => undefined));
      }
      return instantGreeting;
    }
    const languagePreference = languagePreferenceResponse(input);
    if (languagePreference) {
      if (!input.testMode || input.testMode === 'write_verified') {
        ctx.waitUntil(persistConversation(env, input, { reply: languagePreference.reply, requests: [] }).catch(() => undefined));
      }
      return languagePreference;
    }
    const relationshipFollowUp = relationshipFollowUpResponse(input);
    if (relationshipFollowUp) {
      if (!input.testMode || input.testMode === 'write_verified') {
        ctx.waitUntil(persistConversation(env, input, { reply: relationshipFollowUp.reply, requests: [] }).catch(() => undefined));
      }
      return relationshipFollowUp;
    }
    const instantStayPlanning = stayPlanningResponse(input, classification);
    if (instantStayPlanning) {
      if (!input.testMode || input.testMode === 'write_verified') {
        ctx.waitUntil(persistConversation(env, input, { reply: instantStayPlanning.reply, requests: [] }).catch(() => undefined));
      }
      return instantStayPlanning;
    }
    requireSecrets(env);
    const serviceRecords = await fetchServices(env, { bypassCache: Boolean(input.testMode) }).catch((err) => {
      console.error('Failed to fetch services from Airtable:', err);
      return [];
    });
    const initialServiceSet = matchingServices(serviceRecords, classification);
    const instantCancellation = await cancellationOutcome(env, input, classification, initialServiceSet.all);
    if (instantCancellation) {
      if (!input.testMode || input.testMode === 'write_verified') {
        ctx.waitUntil(persistConversation(env, input, instantCancellation).catch(() => undefined));
      }
      return chatResponseFromOutcome(instantCancellation, classification, input.language, [], '', null, input.message);
    }
    const instantDirectBooking = partnerBookingOutcome(input, classification, initialServiceSet.all);
    if (instantDirectBooking) {
      if (!input.testMode || input.testMode === 'write_verified') {
        ctx.waitUntil(persistConversation(env, input, instantDirectBooking).catch(() => undefined));
      }
      return chatResponseFromOutcome(instantDirectBooking, classification, input.language);
    }
    const instantHotelFirst = hotelFirstResponse(input, classification, initialServiceSet.all);
    if (instantHotelFirst) {
      if (!input.testMode || input.testMode === 'write_verified') {
        ctx.waitUntil(persistConversation(env, input, { reply: instantHotelFirst.reply, requests: [] }).catch(() => undefined));
      }
      return instantHotelFirst;
    }
    const instantDining = curatedDiningResponse(input, classification, initialServiceSet.matching);
    if (instantDining) {
      if (!input.testMode || input.testMode === 'write_verified') {
        ctx.waitUntil(persistConversation(env, input, { reply: instantDining.reply, requests: [] }).catch(() => undefined));
      }
      return instantDining;
    }
    const [history, facts] = await Promise.all([
      input.chatHistory ? Promise.resolve(input.chatHistory) : fetchHistory(env, input.userId).catch(() => []),
      fetchFacts(env).catch(() => ({ hotelName: env.HOTEL_NAME || 'H\u00f4tel Lumi\u00e8re Paris', hotelCity: env.HOTEL_CITY || 'Paris', text: '' })),
    ]);
    classification = inheritConversationContext(classification, history, input.message);
    reportStatus('Considering the most suitable next step\u2026');
    classification = await enrichSemanticRoute(env, input, history, classification).catch(() => classification);
    const serviceSet = matchingServices(serviceRecords, classification);
    // Semantic routing can recognize catalogue wording that the fast phrase
    // matcher did not. Keep this path deterministic as well, so it returns the
    // complete collection rather than a model-selected subset.
    if (classification.route === 'partner_catalog') {
      const catalogue = hotelCatalogueResponse(input, classification, serviceSet.all);
      if (catalogue) {
        if (!input.testMode || input.testMode === 'write_verified') {
          ctx.waitUntil(persistConversation(env, input, { reply: catalogue.reply, requests: [] }).catch(() => undefined));
        }
        return catalogue;
      }
    }
    const directBooking = partnerBookingOutcome(input, classification, serviceSet.all);
    if (directBooking) {
      if (!input.testMode || input.testMode === 'write_verified') {
        ctx.waitUntil(persistConversation(env, input, directBooking).catch(() => undefined));
      }
      return chatResponseFromOutcome(directBooking, classification, input.language);
    }
    const partnerMatches = serviceSet.matching.filter((service) => service.isPartner);
    const promptServices = classification.route === 'partner_catalog'
      ? serviceSet.all.filter((service) => service.isPartner)
      : partnerMatches;
    let externalOptions = [];
    if (shouldSearchExternal(classification, partnerMatches)) {
      reportStatus('Searching current Paris addresses\u2026');
      externalOptions = await externalSearch(env, input, classification).catch(() => []);
      if (preferenceForOneRecommendation(input.message)) externalOptions = externalOptions.slice(0, 1);
      reportStatus('Curating only independently verified matches\u2026');
    } else {
      reportStatus('Reviewing the hotel\u2019s preferred collection\u2026');
    }
    if (classification.externalDiscovery && externalOptions.length) {
      const outcome = enforceContract(
        { reply: '', intent: 'service_request', serviceType: classification.category, requiresHuman: true, requests: [] },
        { language: input.language, classification, matching: promptServices, excluded: serviceSet.excluded, externalOptions, inputMessage: input.message },
      );
      if (!input.testMode || input.testMode === 'write_verified') {
        ctx.waitUntil(persistConversation(env, input, outcome).catch(() => undefined));
      }
      return chatResponseFromOutcome(outcome, classification, input.language);
    }
    reportStatus('Preparing a considered recommendation\u2026');
    const prompt = buildPrompt({ input, classification, history, services: promptServices, externalOptions, facts });
    const provider = await callGroq(env, prompt).catch((err) => ({ content: '', providerFailure: err.message || 'groq_error' }));
    const model = parseModelJson(provider.content);
    const outcome = enforceContract(model, {
      language: input.language,
      classification,
      matching: promptServices,
      excluded: serviceSet.excluded,
      externalOptions,
      inputMessage: input.message,
      providerFailure: provider.providerFailure,
    });

    if (!input.testMode || input.testMode === 'write_verified') {
      ctx.waitUntil(persistConversation(env, input, outcome).catch(() => undefined));
    }
    return chatResponseFromOutcome(outcome, classification, input.language, partnerOffers(promptServices), provider.providerFailure, null, input.message);
  } catch (error) {
    console.error('Graceful fallback in resolveChat:', error);
    const fallbackReply = 'I apologize, but I am experiencing a brief system delay and could not prepare your request. Please try again shortly or contact the front desk directly for immediate assistance.';
    const fallbackOutcome = {
      reply: fallbackReply,
      intent: 'service_unavailable',
      serviceType: 'Concierge',
      requiresHuman: false,
      escapeHatchTriggered: false,
      requests: [],
      externalOptionNames: [],
      recommendations: [],
    };
    if (!input.testMode || input.testMode === 'write_verified') {
      ctx.waitUntil(persistConversation(env, input, fallbackOutcome).catch(() => undefined));
    }
    return {
      reply: fallbackReply,
      language: input?.language || 'en',
      intent: 'service_unavailable',
      service_type: 'Concierge',
      requires_human: false,
      escape_hatch_triggered: false,
      external_option_names: [],
      recommendations: [],
      partner_offers: [],
      staff_alerts: [],
      requests: [],
    };
  }
}

async function handleJsonChat(request, env, ctx) {
  const body = await request.json();
  return response(await resolveChat(body, env, ctx), 200, request, env);
}

async function handleDemoChat(request, env, ctx) {
  if (!demoAllowedOrigin(request, env)) return demoResponse({ error: 'Origin is not allowed.' }, 403, request, env);
  let input;
  try {
    input = parseDemoChatPayload(await request.json());
  } catch (validationErr) {
    return demoResponse({ error: validationErr.message }, 400, request, env);
  }

  try {
    const result = await resolveChat(input, env, ctx);
    return demoResponse({
      ...result,
      requires_human: Boolean(result?.requires_human || result?.requiresHuman || result?.escape_hatch_triggered),
      escape_hatch_triggered: Boolean(result?.escape_hatch_triggered || result?.escapeHatchTriggered),
      staff_alerts: result?.staff_alerts || [],
      demo: true,
      is_demo: true,
    }, 200, request, env);
  } catch (error) {
    console.error('Error in handleDemoChat execution:', error);
    return demoResponse({
      reply: 'I apologize, but I am experiencing a brief system delay and could not prepare your request. Please try again shortly or contact the front desk directly for immediate assistance.',
      language: input?.language || 'en',
      intent: 'service_unavailable',
      serviceType: 'Concierge',
      requires_human: false,
      escape_hatch_triggered: false,
      staff_alerts: [],
      requests: [],
      demo: true,
      is_demo: true,
    }, 200, request, env);
  }
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

async function handleRoomEnquiry(request, env) {
  requireAirtable(env);
  const enquiry = parseRoomEnquiry(await request.json());
  await persistRoomEnquiry(env, enquiry);
  return response({
    ok: true,
    message: 'Your room enquiry has been recorded for the reservations team.',
  }, 201, request, env);
}

async function handleDiscoveryLead(request, env) {
  requireLeadsAirtable(env);
  const lead = parseDiscoveryLead(await request.json());
  const record = await persistDiscoveryLead(env, lead);
  if (lead.discovery) {
    try {
      if (!record?.id) throw new Error('Airtable did not return the new lead record ID.');
      const pdf = await buildDiscoveryBriefPdf(lead);
      await uploadAirtableAttachment(env, {
        recordId: record.id,
        fieldId: env.DISCOVERY_BRIEF_PDF_FIELD_ID,
        filename: pdf.filename,
        bytes: pdf.bytes,
      });
    } catch (error) {
      console.error('Hotel Discovery Brief PDF attachment failed after lead persistence.', error);
      throw new Error('Your discovery brief was recorded, but the PDF could not be attached. Please contact FlowArchitect Agency.');
    }
  }
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

async function handleWhatsAppMessage(message, env, ctx) {
  const result = await resolveChat({
    message: message.text,
    sessionId: message.from,
    channel: 'whatsapp',
  }, env, ctx);
  await sendWhatsAppText(env, message.from, whatsappReplyText(result));
}

async function handleWhatsAppWebhook(request, env, ctx) {
  const missing = missingWhatsAppSecrets(env, { inbound: true });
  if (missing.length) return webhookResponse('WhatsApp connector is not configured.', 503);

  const rawBody = await request.text();
  const validSignature = await verifyWhatsAppSignature(
    rawBody,
    request.headers.get('X-Hub-Signature-256'),
    env.WA_APP_SECRET,
  );
  if (!validSignature) return webhookResponse('Invalid webhook signature.', 401);

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return webhookResponse('Invalid webhook payload.', 400);
  }

  for (const message of inboundWhatsAppTexts(payload)) {
    if (!rememberWhatsAppMessage(message.id)) continue;
    ctx.waitUntil(handleWhatsAppMessage(message, env, ctx).catch((error) => {
      console.error('WhatsApp concierge reply failed:', error instanceof Error ? error.message : error);
    }));
  }
  // Meta expects a fast acknowledgement. The actual concierge work and reply
  // continue through waitUntil so guests do not see duplicate responses when
  // Meta retries a slow webhook delivery.
  return webhookResponse('EVENT_RECEIVED');
}

async function handleTwilioWebhook(request, env, ctx) {
  if (missingTwilioSecrets(env).length) return webhookResponse('Twilio connector is not configured.', 503);

  const formData = await request.formData();
  const entries = [...formData.entries()].filter(([, value]) => typeof value === 'string');
  const validSignature = await verifyTwilioSignature(
    request.url,
    entries,
    request.headers.get('X-Twilio-Signature'),
    env.TWILIO_AUTH_TOKEN,
  );
  if (!validSignature) return webhookResponse('Invalid webhook signature.', 401);

  const from = String(formData.get('From') || '').replace(/\D/g, '');
  const message = String(formData.get('Body') || '').trim();
  const messageId = String(formData.get('MessageSid') || '');
  if (!from || !message || message.length > 1200 || !rememberWhatsAppMessage(messageId, 'twilio')) return twimlResponse();

  try {
    const result = await resolveChat({
      message,
      sessionId: from,
      channel: 'whatsapp',
    }, env, ctx);
    return twimlResponse(whatsappReplyText(result));
  } catch {
    return twimlResponse('I’m sorry, I could not complete that request just now. Please try again in a moment.');
  }
}

function verifyWhatsAppWebhook(url, env) {
  if (missingWhatsAppSecrets(env).length) return webhookResponse('WhatsApp connector is not configured.', 503);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && challenge && constantTimeEqual(token, env.WA_WEBHOOK_VERIFY_TOKEN)) {
    return webhookResponse(challenge);
  }
  return webhookResponse('Webhook verification failed.', 403);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && url.pathname === '/api/demo-chat') {
      return new Response(null, { status: demoAllowedOrigin(request, env) ? 204 : 403, headers: demoCors(request, env) });
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) });
    if (request.method === 'GET' && url.pathname === '/health') return response({ ok: true, service: 'conciergeflow-api' }, 200, request, env);
    if (request.method === 'GET' && url.pathname === '/api/manager/metrics') {
      try {
        requireAirtable(env);
        return response(await fetchManagerMetrics(env), 200, request, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load manager metrics.';
        return response({ error: message }, 502, request, env);
      }
    }
    if (url.pathname === '/webhooks/whatsapp' && request.method === 'GET') return verifyWhatsAppWebhook(url, env);
    if (url.pathname === '/webhooks/whatsapp' && request.method === 'POST') return handleWhatsAppWebhook(request, env, ctx);
    if (url.pathname === '/webhooks/twilio' && request.method === 'POST') return handleTwilioWebhook(request, env, ctx);
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
    if (request.method === 'POST' && url.pathname === '/api/demo-chat') {
      if (rateLimited(request)) return demoResponse({ error: 'Too many requests. Please try again shortly.' }, 429, request, env);
      try {
        return await handleDemoChat(request, env, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected service error.';
        return demoResponse({ error: message }, /required|Invalid|chatHistory|demo|Guest|Language|Scenario/i.test(message) ? 400 : 502, request, env);
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
    if (request.method === 'POST' && url.pathname === '/api/room-enquiry') {
      if (rateLimited(request)) return response({ error: 'Too many requests. Please try again shortly.' }, 429, request, env);
      try {
        return await handleRoomEnquiry(request, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected service error.';
        return response({ error: message }, /required|Invalid|valid|after|between|long|Consent/i.test(message) ? 400 : 502, request, env);
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
