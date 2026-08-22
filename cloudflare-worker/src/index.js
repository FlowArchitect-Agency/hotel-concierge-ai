import {
  buildEvaluatorPrompt,
  buildMemoryExtractionPrompt,
  buildPostCheckoutOutreachPrompt,
  buildPreArrivalOutreachPrompt,
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

const AIRTABLE_SCHEMA = {
  Guests: {
    table: 'tblzYZNa0Z3BbI6BB',
    fields: {
      phone: 'fld5XgQjXrP3CvqUR',
      name: 'fldB9MF2Zh3oN9C4C',
      language: 'fldRhFTWTRO7rGpQf',
      vipStatus: 'fldoYRZA6ig0YGTUm',
      knownPreferences: 'fldCftrTVWTx8wl8e',
      isDemo: 'fldZmbdJKDtwAyOL5',
    },
  },
  Reservations: {
    table: 'tblVOAvaOrbYjg7vG',
    fields: {
      id: 'fldpGGsT2dM8XC0YW',
      guest: 'fldhFLhCro87WibaH',
      checkIn: 'fldx783w7rtBD75jD',
      checkOut: 'fld81RW6bDR7shQWR',
      roomNumber: 'fldF0Y1LwianGcX0r',
      status: 'fldGek8a7krKkLv66',
      isDemo: 'fldnlrFREhOWSQ8Yt',
    },
  },
  Staff: {
    table: 'tblCbZ2uEcJmHAK31',
    fields: {
      name: 'fldh8GYQxVccVaaL4',
      role: 'fldzC231otHnIxPVn',
      whatsAppNumber: 'fldJpwWvvfe20XTEH',
      onDuty: 'fldcLblGxiNTO86hs',
    },
  },
  Requests: {
    table: 'tblpZpF2blAii44MS',
    fields: {
      id: 'fld2QxTOdw9iJIbYL',
      guest: 'fld0NHn9iuB2DwifU',
      assignedStaff: 'fldCawPPdYoCRfDKZ',
      taskDetails: 'fldpNRN1vOUTTL87s',
      status: 'fldS3LtiRsRa4yMC8',
      isDemo: 'fld3ZT2AozREWd3DS',
    },
  },
  Conversations: {
    table: 'tbl6OqURSczymufG5',
    fields: {
      id: 'fldOzKpo2oiAgoaXC',
      guest: 'fldU4RXzl8UPr1ViA',
      sender: 'fldbLaHSnQJGpXiPQ',
      message: 'fldNRantEIy4DYeXy',
      timestamp: 'fldSjp107JhjVYQPY',
      isDemo: 'fldwn2jA6eNyLaSjN',
    },
  },
  Services: {
    table: 'tblp5UppwYbt4nZyQ',
    fields: {
      name: 'fldULLX5B0rxlKWDc',
      price: 'fldmN67wdugIz3XXy',
      hours: 'fldl4Bvd8ulKI80ob',
      details: 'fldofT4KVWCnHOT4X',
      active: 'fldRCfZFA1YSzh7RH',
    },
  },
};

async function getOrCreateGuestRecord(env, { phone, name, language, preferences, isDemo = false }) {
  const phoneKey = String(phone || '').trim();
  if (!phoneKey) return null;
  const G = AIRTABLE_SCHEMA.Guests;
  try {
    const existing = await airtable(env, G.table, {
      params: { filterByFormula: `{${G.fields.phone}} = '${phoneKey}'`, maxRecords: 1 },
    });
    if (existing.records?.[0]) {
      const rec = existing.records[0];
      if (name || preferences || isDemo) {
        await airtable(env, `${G.table}/${rec.id}`, {
          method: 'PATCH',
          fields: {
            [G.fields.name]: name || rec.fields?.[G.fields.name] || undefined,
            [G.fields.knownPreferences]: preferences || rec.fields?.[G.fields.knownPreferences] || undefined,
            ...(isDemo ? { [G.fields.isDemo]: true, Is_Demo: true } : {}),
          },
        }).catch(() => undefined);
      }
      return rec.id;
    }
    const created = await airtable(env, G.table, {
      method: 'POST',
      fields: {
        [G.fields.phone]: phoneKey,
        [G.fields.name]: name || 'Guest',
        [G.fields.language]: language || 'en',
        [G.fields.vipStatus]: 'Standard',
        [G.fields.knownPreferences]: preferences || undefined,
        ...(isDemo ? { [G.fields.isDemo]: true, Is_Demo: true } : {}),
      },
    });
    return created.id;
  } catch (err) {
    console.error('Error fetching/creating guest record:', err);
    return null;
  }
}

async function routeOperationalTaskToOnDutyStaff(env, { taskDetails, guestName, targetRole = 'Housekeeping' }) {
  const S = AIRTABLE_SCHEMA.Staff;
  try {
    const staffRes = await airtable(env, S.table, {
      params: {
        filterByFormula: `AND({${S.fields.onDuty}} = 1, {${S.fields.role}} = '${targetRole}')`,
        maxRecords: 1,
      },
    });
    const staffRec = staffRes.records?.[0];
    if (staffRec) {
      const staffName = staffRec.fields?.[S.fields.name] || 'On-Duty Staff';
      const staffPhone = staffRec.fields?.[S.fields.whatsAppNumber];
      if (staffPhone) {
        const alertText = `🛎️ [HOTEL TASK ALERT]\nGuest: ${guestName || 'Valued Guest'}\nRole: ${targetRole}\nTask: ${taskDetails}\nAssigned: ${staffName}`;
        await sendWhatsAppMessage(env, { phone: staffPhone, text: alertText });
      }
      return staffRec.id;
    }
  } catch (err) {
    console.error('Error routing to on-duty staff:', err);
  }
  return null;
}

async function fetchServices(env) {
  const payload = await airtable(env, AIRTABLE_SCHEMA.Services.table, {
    params: { filterByFormula: `{${AIRTABLE_SCHEMA.Services.fields.active}}=1`, pageSize: 100 },
  }).catch(() => airtable(env, 'Services', { params: { filterByFormula: '{Active}=TRUE()', pageSize: 100 } }));
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
  }).catch(() => ({ records: [] }));
  return (payload.records || []).map((record) => ({
    role: record.fields?.Role === 'assistant' ? 'assistant' : 'user',
    message: String(record.fields?.Message || record.fields?.[AIRTABLE_SCHEMA.Conversations.fields.message] || ''),
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

const CONCIERGE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_reservation',
      description: 'Book or request a reservation for a hotel service, spa, restaurant, or private transfer',
      parameters: {
        type: 'object',
        properties: {
          serviceName: { type: 'string', description: 'Name of the requested service' },
          guestName: { type: 'string', description: 'Full name of the guest' },
          email: { type: 'string', description: 'Contact email address' },
          preferredDate: { type: 'string', description: 'Date of reservation' },
          preferredTime: { type: 'string', description: 'Time of reservation' },
          partySize: { type: 'number', description: 'Number of people' },
        },
        required: ['serviceName', 'guestName', 'email'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_paris_addresses',
      description: 'Search current independently verified Paris venues, museums, or restaurants',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or venue category' },
          cuisine: { type: 'string', description: 'Specific cuisine if applicable' },
        },
        required: ['query'],
      },
    },
  },
];

async function callLLM(env, prompt, { maxTokens = 350, router = false, tools = null } = {}) {
  if (env.GEMINI_API_KEY) {
    try {
      const geminiModel = env.GEMINI_MODEL || 'gemini-1.5-flash';
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${env.GEMINI_API_KEY}`;
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens, temperature: 0.2 },
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (content) return { content, toolCalls: [], providerFailure: '' };
      }
    } catch {
      /* fallback to Groq / OpenAI */
    }
  }

  const apiKey = env.GROQ_API_KEY || env.OPENAI_API_KEY || env.OPENROUTER_API_KEY;
  if (!apiKey) return { content: '', toolCalls: [], providerFailure: 'missing_api_key' };

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
        ...(tools ? { tools, tool_choice: 'auto' } : { response_format: { type: 'json_object' } }),
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
      const message = data.choices?.[0]?.message;
      const content = message?.content || '';
      const toolCalls = message?.tool_calls || [];
      if (content || toolCalls.length) return { content, toolCalls, providerFailure: '' };
      failure = 'empty_response';
    } catch {
      failure = 'request_error';
    }
  }
  return { content: '', toolCalls: [], providerFailure: failure || 'provider_unavailable' };
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
  const phone = input.userId?.replace(/^wa:/, '') || input.phone || '';
  const isDemo = Boolean(input.isDemo || input.is_demo);
  const guestRecordId = await getOrCreateGuestRecord(env, {
    phone,
    name: input.contactName || 'Guest',
    language: input.language,
    isDemo,
  });

  const C = AIRTABLE_SCHEMA.Conversations;
  const R = AIRTABLE_SCHEMA.Requests;

  await Promise.all([
    airtable(env, C.table, {
      method: 'POST',
      fields: {
        UserID: input.userId,
        Channel: input.channel,
        Role: 'user',
        Message: input.message,
        Language: input.language,
        Timestamp: input.receivedAt,
        [C.fields.message]: input.message,
        [C.fields.sender]: 'Guest',
        [C.fields.timestamp]: input.receivedAt,
        ...(guestRecordId ? { [C.fields.guest]: [guestRecordId] } : {}),
        ...(isDemo ? { [C.fields.isDemo]: true, Is_Demo: true } : {}),
      },
    }).catch(() => undefined),
    airtable(env, C.table, {
      method: 'POST',
      fields: {
        UserID: input.userId,
        Channel: input.channel,
        Role: 'assistant',
        Message: outcome.reply,
        Language: input.language,
        Timestamp: time,
        [C.fields.message]: outcome.reply,
        [C.fields.sender]: 'AI',
        [C.fields.timestamp]: time,
        ...(guestRecordId ? { [C.fields.guest]: [guestRecordId] } : {}),
        ...(isDemo ? { [C.fields.isDemo]: true, Is_Demo: true } : {}),
      },
    }).catch(() => undefined),
  ]);

  const requests = outcome.requests.filter((item) => item.summary);
  await Promise.all(
    requests.map(async (item) => {
      const targetRole = /towel|clean|linen|amenity|pillow|blanket|bed/i.test(item.summary) ? 'Housekeeping' : 'Receptionist';
      const staffRecordId = await routeOperationalTaskToOnDutyStaff(env, {
        taskDetails: item.summary,
        guestName: input.contactName || 'Guest',
        targetRole,
      });

      return airtable(env, R.table, {
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
          [R.fields.taskDetails]: item.summary,
          [R.fields.status]: 'new',
          ...(guestRecordId ? { [R.fields.guest]: [guestRecordId] } : {}),
          ...(staffRecordId ? { [R.fields.assignedStaff]: [staffRecordId] } : {}),
          ...(isDemo ? { [R.fields.isDemo]: true, Is_Demo: true } : {}),
        },
      }).catch(() => undefined);
    })
  );
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
  const text = String(input.message || '').toLowerCase();
  const hasExplicitDiningWord = /\b(restaurant|restaurants|restaurante|restaurantes|dining|food|eat|table|michelin|cena|comida|almuerzo|diner|dejeuner|bistrot|bistro|brasserie|tapas|paella|pizza)\b/i.test(text);
  if (!hasExplicitDiningWord) return null;
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
  const guestRecordId = await getOrCreateGuestRecord(env, {
    phone: enquiry.phone || enquiry.email,
    name: enquiry.guestName,
    language: enquiry.language,
  }).catch(() => null);

  const Res = AIRTABLE_SCHEMA.Reservations;
  const Req = AIRTABLE_SCHEMA.Requests;

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
        [Res.fields.checkIn]: enquiry.preferredDate || undefined,
        [Res.fields.status]: 'new',
        ...(guestRecordId ? { [Res.fields.guest]: [guestRecordId] } : {}),
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
      [Req.fields.taskDetails]: details,
      [Req.fields.status]: 'new',
      ...(guestRecordId ? { [Req.fields.guest]: [guestRecordId] } : {}),
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

async function upsertGuestProfile(env, profile) {
  if (!profile || typeof profile !== 'object') return null;
  const phoneKey = String(profile.phone || profile.userId || '').trim();
  if (!phoneKey && !profile.guestName && !profile.dietaryRestrictions && !profile.purposeOfStay && !profile.generalPreferences) {
    return null;
  }
  const key = phoneKey || `web:${profile.sessionId || 'guest'}`;

  // Check if existing profile exists in 'Guest Profiles' table
  try {
    const existing = await airtable(env, 'Guest Profiles', {
      params: {
        filterByFormula: `{Phone} = '${key}'`,
        maxRecords: 1,
      },
    });
    const record = existing.records?.[0];
    if (record) {
      // Merge preferences (no duplicate overwrite)
      const prevDiet = record.fields?.DietaryRestrictions || '';
      const newDiet = [prevDiet, profile.dietaryRestrictions].filter(Boolean).filter((item, pos, self) => self.indexOf(item) === pos).join(', ');

      const prevPurpose = record.fields?.PurposeOfStay || '';
      const newPurpose = profile.purposeOfStay || prevPurpose;

      const prevPref = record.fields?.GeneralPreferences || '';
      const newPref = [prevPref, profile.generalPreferences].filter(Boolean).filter((item, pos, self) => self.indexOf(item) === pos).join('; ');

      return await airtable(env, `Guest Profiles/${record.id}`, {
        method: 'PATCH',
        fields: {
          GuestName: profile.guestName || record.fields?.GuestName || undefined,
          Language: profile.language || record.fields?.Language || 'en',
          DietaryRestrictions: newDiet || undefined,
          PurposeOfStay: newPurpose || undefined,
          GeneralPreferences: newPref || undefined,
        },
      });
    }
  } catch {
    /* proceed to create if search fails */
  }

  // Create new Guest Profile record
  return airtable(env, 'Guest Profiles', {
    method: 'POST',
    fields: {
      Phone: key,
      GuestName: profile.guestName || undefined,
      Language: profile.language || 'en',
      DietaryRestrictions: profile.dietaryRestrictions || undefined,
      PurposeOfStay: profile.purposeOfStay || undefined,
      GeneralPreferences: profile.generalPreferences || undefined,
    },
  });
}

async function extractAndPersistGuestProfile(env, input, history) {
  try {
    const extractPrompt = buildMemoryExtractionPrompt({ message: input.message, history, language: input.language });
    const extractResult = await callLLM(env, extractPrompt, { maxTokens: 250, router: true });
    const profile = parseModelJson(extractResult.content);
    if (profile) {
      profile.userId = input.userId;
      profile.sessionId = input.sessionId;
      await upsertGuestProfile(env, profile);
    }
  } catch {
    /* background task fail-safe */
  }
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
      ctx.waitUntil(
        Promise.all([
          persistConversation(env, input, { reply: instantDining.reply, requests: [] }),
          extractAndPersistGuestProfile(env, input, []),
        ]).catch(() => undefined)
      );
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

  // Phase 2: Reflection & Evaluator Loop
  if (outcome.reply && outcome.intent !== 'smalltalk' && classification.route !== 'greeting') {
    reportStatus('Evaluating luxury service alignment & tone\u2026');
    try {
      const evalPrompt = buildEvaluatorPrompt({ input, draftReply: outcome.reply, classification, facts });
      const evalResult = await callLLM(env, evalPrompt, { maxTokens: 220, router: true });
      const evalJson = parseModelJson(evalResult.content);
      if (evalJson && evalJson.passed === false && evalJson.improved_reply && typeof evalJson.improved_reply === 'string') {
        outcome.reply = evalJson.improved_reply.trim();
      }
    } catch {
      /* fallback gracefully if evaluator loop encounters network error or timeout */
    }
  }

  if (!input.testMode || input.testMode === 'write_verified') {
    ctx.waitUntil(
      Promise.all([
        persistConversation(env, input, outcome),
        extractAndPersistGuestProfile(env, input, history),
      ]).catch(() => undefined)
    );
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

async function handleDemoChat(request, env, ctx) {
  requireSecrets(env);
  const body = await request.json();

  const guestName = compactText(body.guestName || body.contactName, 'Guest Name', { max: 100 }) || 'Demo Guest';
  const language = compactText(body.language, 'Language', { max: 12 }) || 'en';
  const scenario = compactText(body.scenario, 'Scenario', { max: 50 }) || 'pre_arrival';
  const isDemo = body.is_demo !== false;

  let messageText = '';
  if (body.message && typeof body.message === 'string') {
    messageText = body.message.trim();
  } else if (Array.isArray(body.chatHistory) && body.chatHistory.length > 0) {
    const last = body.chatHistory[body.chatHistory.length - 1];
    messageText = String(last.content || last.message || '').trim();
  }

  if (!messageText) {
    if (scenario === 'in_stay') {
      messageText = 'Hello, could we please have additional towels delivered to our room?';
    } else if (scenario === 'checkout_review') {
      messageText = 'We are checking out today. Thank you for the stay!';
    } else {
      messageText = 'Hello, I have an upcoming reservation at Hôtel Lumière Paris.';
    }
  }

  const input = {
    userId: `demo:${encodeURIComponent(guestName).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`,
    contactName: guestName,
    channel: 'whatsapp',
    language,
    message: messageText,
    receivedAt: new Date().toISOString(),
    isDemo: true,
  };

  const outcome = await resolveChat(input, env, ctx);

  let staffAlert = null;
  const actionable = (outcome.requests || []).find((r) => r.summary);
  if (actionable) {
    const role = /towel|clean|linen|amenity|pillow|blanket|bed/i.test(actionable.summary) ? 'Housekeeping' : 'Receptionist';
    staffAlert = {
      role,
      task: actionable.summary,
      status: 'Dispatched to On-Duty Staff',
    };
  }

  let quickReplies = [];
  if (scenario === 'pre_arrival') {
    quickReplies = ['Book Airport Transfer', 'Dining Reservations', 'No, thank you'];
  } else if (scenario === 'in_stay') {
    quickReplies = ['Thank you', 'Request Room Cleaning', 'Speak with Reception'];
  } else if (scenario === 'checkout_review') {
    quickReplies = ['Excellent — 5 Stars', 'Good', 'Leave Private Feedback'];
  }

  return response({
    reply: outcome.reply,
    language: outcome.language || language,
    intent: outcome.intent,
    quickReplies,
    recommendations: outcome.recommendations || [],
    partner_offers: outcome.partner_offers || [],
    requests: outcome.requests || [],
    requires_human: outcome.requires_human || false,
    staffAlert,
  }, 200, request, env);
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

export async function sendWhatsAppMessage(env, { phone, text }) {
  const token = env.WHATSAPP_API_TOKEN;
  const phoneId = env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) {
    console.log(`[WhatsApp Simulation] Outbound message to ${phone}: "${text}"`);
    return { success: true, simulated: true, to: phone, text };
  }
  const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: text },
    }),
  });
  return { success: res.ok, status: res.status, to: phone, text };
}

export async function runScheduledOutreach(env) {
  const results = { preArrivalSent: 0, postCheckoutSent: 0, messages: [] };
  const hotelName = env.HOTEL_NAME || 'Hôtel Lumière Paris';

  try {
    const profileRes = await airtable(env, 'Guest Profiles', {
      params: { maxRecords: 25 },
    });
    const records = profileRes.records || [];

    for (const record of records) {
      const profile = record.fields || {};
      const phone = profile.Phone;
      if (!phone) continue;

      // Pre-Arrival Campaign
      if (profile.PurposeOfStay || profile.GeneralPreferences || profile.DietaryRestrictions) {
        const prePrompt = buildPreArrivalOutreachPrompt({ profile, hotelName });
        const llmRes = await callLLM(env, prePrompt, { maxTokens: 200, router: true });
        const messageText = (llmRes.content || '').replace(/^["']|["']$/g, '').trim();

        if (messageText) {
          const sent = await sendWhatsAppMessage(env, { phone, text: messageText });
          results.preArrivalSent++;
          results.messages.push({ campaign: 'pre_arrival', phone, text: messageText, simulated: Boolean(sent.simulated) });
        }
      }
    }
  } catch (err) {
    results.error = err instanceof Error ? err.message : String(err);
  }

  return results;
}

async function handleWhatsAppWebhook(request, env, ctx) {
  const url = new URL(request.url);

  // Meta Verification Challenge (GET)
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const expectedToken = env.WHATSAPP_VERIFY_TOKEN || 'lumiere_concierge_secret_token_2026';
    if (mode === 'subscribe' && token === expectedToken) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('Verification failed', { status: 403 });
  }

  // Inbound Message from Meta (POST)
  if (request.method === 'POST') {
    const payload = await request.json();
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];

    if (message && message.type === 'text') {
      const fromPhone = message.from;
      const textBody = message.text?.body;
      const contactName = change?.contacts?.[0]?.profile?.name || 'Guest';

      if (fromPhone && textBody) {
        ctx.waitUntil(
          (async () => {
            try {
              const outcome = await resolveChat(
                {
                  message: textBody,
                  userId: `wa:${fromPhone}`,
                  sessionId: `wa:${fromPhone}`,
                  contactName,
                },
                env,
                ctx
              );
              if (outcome?.reply) {
                await sendWhatsAppMessage(env, { phone: fromPhone, text: outcome.reply });
              }
            } catch (err) {
              console.error('Error handling WhatsApp message:', err);
            }
          })()
        );
      }
    }
    return new Response('EVENT_RECEIVED', { status: 200 });
  }

  return new Response('Method not allowed', { status: 405 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) });
    if (request.method === 'GET' && url.pathname === '/health') return response({ ok: true, service: 'conciergeflow-api' }, 200, request, env);
    if (['/webhook', '/api/whatsapp-webhook'].includes(url.pathname)) {
      return await handleWhatsAppWebhook(request, env, ctx);
    }
    if (['GET', 'POST'].includes(request.method) && url.pathname === '/api/test-cron') {
      const result = await runScheduledOutreach(env);
      return response(result, 200, request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/demo-chat') {
      if (rateLimited(request)) return response({ error: 'Too many requests. Please try again shortly.' }, 429, request, env);
      try {
        return await handleDemoChat(request, env, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected service error.';
        return response({ error: message }, 502, request, env);
      }
    }
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
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledOutreach(env));
  },
};
