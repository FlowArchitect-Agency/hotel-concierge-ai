const CATEGORY_RULES = [
  { category: 'spa', words: ['spa', 'massage', 'masaje', 'sauna', 'hammam', 'wellness', 'treatment', 'soin', 'facial', '\u6309\u6469', '\u30de\u30c3\u30b5\u30fc\u30b8'] },
  { category: 'restaurant', words: ['restaurant', 'dinner', 'lunch', 'breakfast', 'table', 'reservation', 'resto', 'd\u00eener', 'd\u00e9jeuner', 'manger', 'food', 'eat', 'cuisine', 'michelin', '\u0645\u0637\u0639\u0645', '\u30ec\u30b9\u30c8\u30e9\u30f3', '\u9910\u5385'] },
  { category: 'transport', words: ['taxi', 'uber', 'chauffeur', 'car', 'driver', 'transfer', 'airport', 'cdg', 'orly', 'pick up', 'pickup', 'navette', 'shuttle'] },
  { category: 'tour', words: ['tour', 'eiffel', 'louvre', 'museum', 'mus\u00e9e', 'cruise', 'croisi\u00e8re', 'seine', 'versailles', 'excursion', 'sightsee', 'guide'] },
  { category: 'experience', words: ['private chef', 'chef', 'sommelier', 'wine tasting', 'd\u00e9gustation', 'after-hours', 'shopping', 'personal shopper', 'photographer', 'proposal', 'anniversary', 'honeymoon'] },
];

// These requests are not an attempt to book one catalogue item. They need a
// real Paris recommendation assembled from current web results.
const ITINERARY_WORDS = [
  'last day', 'final day', 'one day in paris', 'day in paris', 'itinerary',
  'things to do', 'what should i do', 'what do you suggest', 'suggestion',
  'recommendation', 'ideas for today', 'today in paris', 'tonight in paris',
  'dernier jour', 'derniere journee', 'une journee a paris', 'itineraire',
  'que me conseillez-vous', 'que suggerez-vous', 'que faire', 'ultimo dia',
  'ultimo dia en paris', 'itinerario', 'que me recomiendas', 'letzter tag',
  'ein tag in paris', 'reiseroute', 'was empfehlen sie',
];

const CUISINES = [
  { id: 'indian', label: 'Indian', words: ['indian', 'indien', 'indienne', 'indiano', 'indiana', '\u0647\u0646\u062f\u064a', '\u30a4\u30f3\u30c9\u6599\u7406', '\u5370\u5ea6\u83dc'] },
  { id: 'japanese', label: 'Japanese', words: ['japanese', 'japonais', 'japonaise', 'giapponese', 'japones', '\u65e5\u672c\u6599\u7406', 'sushi'] },
  { id: 'italian', label: 'Italian', words: ['italian', 'italien', 'italienne', 'italiano', 'italiana', 'pizza'] },
  { id: 'spanish', label: 'Spanish', words: ['spanish', 'espagnol', 'espagnole', 'espanol', 'espanola', 'tapas', 'paella'] },
  { id: 'bakery', label: 'bakery', words: ['bakery', 'boulangerie', 'patisserie', 'viennoiserie', 'croissant', 'pain au chocolat'] },
  { id: 'vegan', label: 'vegan', words: ['vegan', 'vegetalien', 'vegano', '\u30f4\u30a3\u30fc\u30ac\u30f3'] },
  { id: 'vegetarian', label: 'vegetarian', words: ['vegetarian', 'vegetarien', 'vegetariano', '\u30d9\u30b8\u30bf\u30ea\u30a2\u30f3'] },
  { id: 'thai', label: 'Thai', words: ['thai', 'thailandais', 'tailandese'] },
  { id: 'chinese', label: 'Chinese', words: ['chinese', 'chinois', 'chino', '\u4e2d\u56fd\u6599\u7406', '\u4e2d\u83dc'] },
  { id: 'halal', label: 'halal', words: ['halal', '\u062d\u0644\u0627\u0644'] },
];

const REQUEST_WORDS = ['book', 'reserve', 'need', 'want', 'arrange', 'organize', 'find', 'looking for', 'can you', 'je voudrais', 'r\u00e9server', 'je cherche'];
const GREETINGS = new Set(['hi', 'hello', 'hey', 'salut', 'bonjour', 'bonsoir', 'hola', 'ok', 'okay', 'yes', 'no', 'oui', 'non', 'merci', 'thanks', 'thank you', '\u3053\u3093\u306b\u3061\u306f', '\u306f\u3044', '\u3044\u3044\u3048']);
const CUISINE_FILLER_WORDS = new Set(['i', 'im', 'am', 'looking', 'for', 'a', 'an', 'the', 'some', 'any', 'find', 'need', 'want', 'would', 'like', 'to', 'fancy', 'best', 'top', 'good', 'great', 'nice', 'authentic', 'excellent', 'restaurant', 'restaurants', 'restaurante', 'restaurantes', 'ristorante', 'ristoranti', 'cuisine', 'food', 'dining', 'place', 'places', 'near', 'close', 'around', 'by', 'in', 'at', 'please', 'show', 'me', 'one', 'only', 'just', 'of', 'is', 'that', 'this', 'with', 'and', 'or']);

export function normalized(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function hasTerm(text, value) {
  const term = normalized(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!term) return false;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${term}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text);
}

function scalar(value) {
  return Array.isArray(value) ? value.join(' ') : String(value ?? '');
}

function cuisineLabel(value) {
  return value.replace(/(^|[\s-])\p{L}/gu, (match) => match.toUpperCase());
}

function usableCuisineTerm(value) {
  const candidate = String(value ?? '').trim();
  return candidate.length >= 3 && !CUISINE_FILLER_WORDS.has(normalized(candidate));
}

function inferOpenCuisine(message) {
  const text = normalized(message);
  const marker = /\b(?:restaurants?|restaurantes?|restaurante|ristorante|ristoranti|trattoria|pizzeria|cuisine|food|dining)\b/i.exec(text);
  if (!marker) return null;
  const prefix = text.slice(Math.max(0, marker.index - 72), marker.index);
  const prefixTokens = prefix.match(/[\p{L}][\p{L}'-]*/gu) ?? [];
  const leading = [...prefixTokens].reverse().find(usableCuisineTerm);
  const after = text.slice(marker.index + marker[0].length).match(/^\s+([\p{L}][\p{L}'-]*)/u)?.[1];
  const candidate = leading || (usableCuisineTerm(after) ? after : '');
  if (!candidate) return null;
  return { id: candidate.replace(/[^\p{L}\d]+/gu, '-'), label: cuisineLabel(candidate), words: [candidate] };
}

function inferLocation(message) {
  const match = String(message ?? '').match(/\b(?:near|close to|around|by|pr\u00e8s de|proche de|cerca de)\s+([^?!,.]{3,64})/iu);
  if (!match) return null;
  const location = match[1].trim().replace(/^(?:the|la|le|les)\s+/i, '');
  return location || null;
}

export function inferLanguage(message) {
  const text = String(message ?? '').toLowerCase();
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  if (/\b(hallo|wie geht|ihnen|bitte|danke|guten|morgen|abend)\b/i.test(text)) return 'de';
  if (/\b(avete|disponibilita|cena|stasera|vorrei|ciao|buongiorno|buonasera|grazie|per favore|parla|parlate)\b/i.test(text)) return 'it';
  if (/\b(necesito|aeropuerto|manana|mañana|quiero|reserva|hola|habla|hablas|espagnol|español|espanol|gracias|buenas|dias|días|tardes|noches|por favor|cuanto|cuánto|servicio|hotel|restaurante|tienes|tienen)\b/i.test(text)) return 'es';
  if (/\b(quel|prix|demain|bonjour|bonsoir|salut|merci|parlez|parle|voudrais|reserver|réserver|combien|svp)\b/i.test(text)) return 'fr';
  return 'en';
}

export function parseGuestInput(body) {
  const raw = body && typeof body === 'object' ? body : {};
  const message = String(raw.message ?? raw.text ?? '').trim();
  const sessionId = String(raw.sessionId ?? raw.userId ?? raw.user_id ?? 'anon').trim();
  if (!message || message.length > 1200) throw new Error('A message between 1 and 1200 characters is required.');
  if (!/^[A-Za-z0-9:_-]{1,120}$/.test(sessionId)) throw new Error('Invalid conversation identifier.');
  const testMode = ['read_only', 'write_verified'].includes(String(raw.testMode)) ? String(raw.testMode) : null;
  const channel = raw.channel || 'web';
  const contactName = raw.contactName || raw.guestName || '';
  const language = raw.language || inferLanguage(message);
  const isDemo = Boolean(raw.isDemo || raw.is_demo);
  return {
    message,
    userId: raw.userId?.startsWith('demo:') || raw.userId?.startsWith('wa:') ? raw.userId : `web:${sessionId}`,
    sessionId,
    channel,
    contactName,
    language,
    isDemo,
    testMode,
    testRunId: String(raw.testRunId ?? '').slice(0, 80),
    receivedAt: raw.receivedAt || new Date().toISOString(),
  };
}

export function classifyRequest(message) {
  const text = normalized(message);
  const isLanguageQuery = /\b(hablas?|hablan|hables?|parles?|parlez|speak|speaks|speaking|parla|parlano)\b/i.test(text);
  const scores = new Map();
  for (const rule of CATEGORY_RULES) {
    for (const word of rule.words) {
      if (hasTerm(text, word)) scores.set(rule.category, (scores.get(rule.category) ?? 0) + 1);
    }
  }
  if (ITINERARY_WORDS.some((word) => hasTerm(text, word))) scores.set('itinerary', 1);
  let category = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  let cuisine = CUISINES.find((item) => item.words.some((word) => hasTerm(text, word))) ?? inferOpenCuisine(message);
  
  if (isLanguageQuery) {
    cuisine = null;
    category = null;
  } else if (cuisine) {
    category = 'restaurant';
  }
  
  const trimmed = text.replace(/[!.?\u00a1\u00bf]+$/g, '');
  const isGreeting = GREETINGS.has(trimmed) || trimmed.length <= 2 || isLanguageQuery;
  const hasIntent = !isGreeting && Boolean(category || cuisine || REQUEST_WORDS.some((word) => hasTerm(text, word)));
  return { category, cuisine, location: inferLocation(message), hasIntent };
}

export function inheritConversationContext(classification, history, latestMessage) {
  if (classification.cuisine && classification.category) return classification;
  const latest = normalized(latestMessage);
  const isContinuation = classification.hasIntent || /\b(pictures?|photos?|images?|show|attach|one|best|which|that|details?|more)\b/i.test(latest);
  if (!isContinuation || GREETINGS.has(latest.replace(/[!.?\u00a1\u00bf]+$/g, ''))) return classification;
  const previousGuestMessage = [...(history || [])].reverse().find((item) => item?.role === 'user' && item?.message);
  if (!previousGuestMessage) return classification;
  const prior = classifyRequest(previousGuestMessage.message);
  if (!prior.cuisine && prior.category !== 'itinerary') return classification;
  return {
    ...classification,
    category: classification.category || prior.category,
    cuisine: classification.cuisine || prior.cuisine,
    location: classification.location || prior.location,
    hasIntent: true,
  };
}

export function toService(record) {
  const fields = record?.fields ?? record ?? {};
  return {
    name: String(fields.Name ?? fields.name ?? '').trim(),
    category: String(fields.Category ?? fields.category ?? '').trim(),
    description: scalar(fields.Description ?? fields.description),
    tags: scalar(fields.Tags ?? fields.tags),
    subType: scalar(fields.SubType ?? fields['Sub Type'] ?? fields.sub_type),
    price: fields.PriceEUR ?? fields['Price EUR'] ?? null,
    duration: fields.DurationMins ?? fields['Duration (mins)'] ?? null,
    location: scalar(fields.Location ?? fields.location),
    phone: scalar(fields.PhoneNumber ?? fields['Phone Number']),
    imageUrl: scalar(fields.ImageURL ?? fields['Image URL'] ?? fields.image_url),
    websiteUrl: scalar(fields.WebsiteURL ?? fields['Website URL'] ?? fields.website_url),
    isPartner: fields.IsPartner === true,
    active: fields.Active !== false,
  };
}

export function matchingServices(records, classification) {
  const all = records.map(toService).filter((service) => service.name && service.active);
  if (classification.route === 'partner_catalog') {
    return { all, matching: all, excluded: [] };
  }
  const scoped = classification.category ? all.filter((service) => normalized(service.category) === classification.category) : [];
  if (!classification.cuisine) return { all, matching: scoped, excluded: [] };
  const terms = classification.cuisine.words.map(normalized);
  const matchesCuisine = (service) => terms.some((term) => normalized([service.name, service.category, service.description, service.tags, service.subType].join(' ')).includes(term));
  const matching = scoped.filter(matchesCuisine);
  return { all, matching, excluded: scoped.filter((service) => !matchesCuisine(service)) };
}

export function formatServices(services) {
  if (!services.length) return '(no matching hotel partner service)';
  return services.map((service, index) => {
    const price = service.price === null || service.price === '' ? 'price on request' : `EUR ${Number(service.price).toFixed(0)}`;
    const duration = service.duration ? `, ${service.duration} min` : '';
    return `${index + 1}. ${service.name} (${service.category}) \u2014 ${price}${duration}\n${service.description}`;
  }).join('\n\n');
}

export function shouldSearchExternal(classification, services) {
  if (!classification.hasIntent || ['greeting', 'hotel_faq', 'partner_catalog'].includes(classification.route)) return false;
  // A semantic route can deliberately prefer current external information
  // even when a broad hotel category happens to contain a partner service.
  return Boolean(classification.externalDiscovery) || !services.length;
}

const DIRECTORY_HOSTS = /(^|\.)(tripadvisor|thefork|timeout|reddit|yelp|petitfute|restaurantguru|wanderlog|mappy|pagesjaunes|guide-michelin|google\.|getyourguide|tiqets)\./i;
const NON_VENUE_TERMS = /\b(mission locale|service public|consulate|university|school|emploi|job|directory|annuaire|blog|news|article|forum)\b/i;
const DINING_TERMS = /\b(restaurant|ristorante|trattoria|pizzeria|cuisine|culinaire|gastronom|dining|table)\b/i;
// Google returns French-language cuisine adjectives for Paris searches even
// when a guest writes in English. These aliases preserve the hard cuisine
// constraint rather than discarding valid direct venues such as espagnole or
// malgache listings.
const CUISINE_PROOF_ALIASES = {
  spanish: ['espagnol', 'espagnole', 'espanol', 'espanola', 'iberique'],
  madagascar: ['malagasy', 'malgache'],
  moroccan: ['marocain', 'marocaine'],
  mexican: ['mexicain', 'mexicaine'],
  lebanese: ['libanais', 'libanaise'],
  korean: ['coreen', 'coreenne'],
  vietnamese: ['vietnamien', 'vietnamienne'],
  ethiopian: ['ethiopien', 'ethiopienne'],
  turkish: ['turc', 'turque'],
  greek: ['grec', 'grecque'],
  peruvian: ['peruvien', 'peruvienne'],
  brazilian: ['bresilien', 'bresilienne'],
  portuguese: ['portugais', 'portugaise'],
};
const FALLBACK_RESTAURANT_IMAGES = [
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&q=84',
  'https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=1200&q=84',
  'https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1200&q=84',
];

const FALLBACK_EXPERIENCE_IMAGES = [
  'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1200&q=84',
  'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=1200&q=84',
  'https://images.unsplash.com/photo-1524396309943-e03f5249f002?auto=format&fit=crop&w=1200&q=84',
];

function externalVenueName(result, classification) {
  const title = String(result?.title ?? result?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  // Google occasionally titles a venue's own result only as "Restaurant indien
  // \u00e0 Paris". Prefer the venue name stated in that result's description rather
  // than showing that generic page title to a guest.
  const genericRestaurantTitle = /^restaurant\b/i.test(normalized(title));
  if (!genericRestaurantTitle) return title;

  const description = scalar(result?.description ?? result?.snippet);
  const venue = description.match(/\b(?:bienvenue\s+(?:au|\u00e0 la)|vous trouverez\s+(?:au|\u00e0 la)|welcome to|chez|at|au)\s+([A-Z\u00c0-\u00d6\u00d8-\u00de][\p{L}\d'&.-]*(?:\s+[A-Z\u00c0-\u00d6\u00d8-\u00de][\p{L}\d'&.-]*){0,4})/u)?.[1];
  if (venue) return venue.replace(/\s+/g, ' ').trim().slice(0, 120);
  return title || classification.cuisine?.label || '';
}

function isDirectoryResult(result, name) {
  const url = String(result?.website ?? result?.url ?? '');
  let host = '';
  try { host = new URL(url).hostname; } catch { /* a missing URL is permitted */ }
  const text = `${name} ${scalar(result?.description ?? result?.snippet)}`;
  return DIRECTORY_HOSTS.test(host)
    || NON_VENUE_TERMS.test(text)
    || /\b(best|top|meilleurs?|tripadvisor|thefork|guide)\b/i.test(name)
    || /\b(our|nos|les)\b.*\b(restaurants?|pizzerias?)\b/i.test(name);
}

function validHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function refinedDescription(result, name, classification) {
  const raw = scalar(result?.description ?? result?.snippet).replace(/\s+/g, ' ').trim();
  if (!raw) return `${name} is a current ${classification.cuisine?.label ?? 'restaurant'} address in Paris.`;
  const firstSentence = raw.match(/^(.{35,220}?[.!?])(?:\s|$)/)?.[1] ?? raw;
  return firstSentence.replace(/^\d{1,2}\s+\w+\s+\d{4}\s*[\u2014-]\s*/i, '').slice(0, 220).trim();
}

function candidateImage(result, name, classification) {
  const scraped = validHttpUrl(result?.thumbnail_url ?? result?.image_url ?? result?.image ?? result?.thumbnail);
  if (scraped) return scraped;
  const images = classification.category === 'restaurant' || classification.cuisine
    ? FALLBACK_RESTAURANT_IMAGES
    : FALLBACK_EXPERIENCE_IMAGES;
  const index = [...normalized(name)].reduce((total, character) => total + character.charCodeAt(0), 0) % images.length;
  return images[index];
}

export function parseExternalResults(payload, classification) {
  const seen = new Set();
  const items = [];
  const cuisineTerms = (classification.cuisine?.words ?? []).flatMap((word) => {
    const term = normalized(word);
    return [term, ...(CUISINE_PROOF_ALIASES[term] ?? [])];
  }).map(normalized);
  for (const kind of ['local_results', 'hotel_results', 'organic_results']) {
    for (const result of Array.isArray(payload?.[kind]) ? payload[kind] : []) {
      const name = externalVenueName(result, classification);
      const description = scalar(result?.description ?? result?.snippet);
      const proof = normalized([name, description, result?.category, result?.type, result?.types].map(scalar).join(' '));
      const websiteUrl = validHttpUrl(result?.website ?? result?.url);
      if (!name || seen.has(normalized(name))) continue;
      if (isDirectoryResult(result, name)) continue;
      if (cuisineTerms.length && !cuisineTerms.some((term) => proof.includes(term))) continue;
      // A dining recommendation must be a real restaurant. An itinerary can
      // also use the direct official page for an attraction or experience.
      const isDiscoveryOption = classification.category === 'itinerary' || Boolean(classification.externalDiscovery);
      if (!websiteUrl || (!isDiscoveryOption && !DINING_TERMS.test(`${name} ${description}`))) continue;
      seen.add(normalized(name));
      items.push({
        name,
        description: refinedDescription(result, name, classification),
        websiteUrl,
        imageUrl: candidateImage(result, name, classification),
        rating: result?.review ?? result?.rating ?? null,
        reviewsCount: result?.review_count ?? result?.reviews_count ?? null,
        address: String(result?.address ?? ''),
        snippet: description.slice(0, 260),
        source: 'external_web_search',
      });
    }
  }
  return items.sort((left, right) => Number(right.reviewsCount || 0) - Number(left.reviewsCount || 0)).slice(0, 5);
}

export function formatExternalOptions(options, classification) {
  if (!options.length) return '(no verified external result was returned)';
  const constraint = classification.cuisine
    ? `Required cuisine: ${classification.cuisine.label}`
    : classification.searchQuery
      ? `Guest discovery requirement: ${classification.searchQuery}`
      : 'No named cuisine constraint';
  return `${constraint}\n${options.map((item, index) => `${index + 1}. ${item.name} \u2014 external, non-partner option${item.rating ? `; rating ${item.rating}` : ''}${item.address ? `; ${item.address}` : ''}${item.snippet ? `\n${item.snippet}` : ''}`).join('\n\n')}`;
}

export function parseModelJson(raw) {
  const text = String(raw ?? '').trim();
  const candidate = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    const parsed = JSON.parse(candidate);
    return {
      reply: String(parsed.reply_text ?? parsed.reply ?? '').trim(),
      intent: String(parsed.intent ?? 'other'),
      serviceType: parsed.service_type ?? null,
      requiresHuman: Boolean(parsed.requires_human),
      requests: Array.isArray(parsed.requests) ? parsed.requests.slice(0, 3).map((item) => ({
        serviceName: item?.service_name ?? null,
        source: item?.source === 'external' ? 'external' : 'partner',
        summary: String(item?.summary ?? '').slice(0, 800),
        estValueEur: Number.isFinite(Number(item?.est_value_eur)) ? Number(item.est_value_eur) : null,
        isUpsell: Boolean(item?.is_upsell),
      })) : [],
    };
  } catch {
    return { reply: '', intent: 'other', serviceType: null, requiresHuman: true, requests: [] };
  }
}

const DEFERRED = {
  en: 'I do not have a verified matching recommendation yet. Our hotel team will research a suitable option and confirm the next steps.',
  fr: 'Je n\u2019ai pas encore de recommandation correspondante v\u00e9rifi\u00e9e. Notre \u00e9quipe recherchera une option adapt\u00e9e et confirmera les prochaines \u00e9tapes.',
  es: 'Todav\u00eda no tengo una recomendaci\u00f3n verificada que corresponda. Nuestro equipo buscar\u00e1 una opci\u00f3n adecuada y confirmar\u00e1 los pr\u00f3ximos pasos.',
  de: 'Ich habe noch keine verifizierte passende Empfehlung. Unser Hotelteam wird eine geeignete Option recherchieren und die n\u00e4chsten Schritte best\u00e4tigen.',
  it: 'Non ho ancora una raccomandazione verificata corrispondente. Il nostro team cercher\u00e0 un\u2019opzione adatta e confermer\u00e0 i prossimi passi.',
  ja: '\u6761\u4ef6\u306b\u5408\u3046\u78ba\u8a8d\u6e08\u307f\u306e\u304a\u3059\u3059\u3081\u306f\u307e\u3060\u3042\u308a\u307e\u305b\u3093\u3002\u30db\u30c6\u30eb\u30c1\u30fc\u30e0\u304c\u9069\u3057\u305f\u9078\u629e\u80a2\u3092\u8abf\u3079\u3001\u6b21\u306e\u624b\u9806\u3092\u3054\u6848\u5185\u3057\u307e\u3059\u3002',
  zh: '\u6211\u6682\u65f6\u6ca1\u6709\u7b26\u5408\u6761\u4ef6\u4e14\u7ecf\u8fc7\u9a8c\u8bc1\u7684\u63a8\u8350\u3002\u9152\u5e97\u56e2\u961f\u4f1a\u5bfb\u627e\u5408\u9002\u7684\u9009\u62e9\uff0c\u5e76\u786e\u8ba4\u4e0b\u4e00\u6b65\u3002',
  ar: '\u0644\u0627 \u0623\u0645\u0644\u0643 \u0628\u0639\u062f \u062a\u0648\u0635\u064a\u0629 \u0645\u0648\u062b\u0648\u0642\u0629 \u0648\u0645\u0637\u0627\u0628\u0642\u0629 \u0644\u0644\u0637\u0644\u0628. \u0633\u064a\u0628\u062d\u062b \u0641\u0631\u064a\u0642 \u0627\u0644\u0641\u0646\u062f\u0642 \u0639\u0646 \u062e\u064a\u0627\u0631 \u0645\u0646\u0627\u0633\u0628 \u0648\u064a\u0624\u0643\u062f \u0627\u0644\u062e\u0637\u0648\u0627\u062a \u0627\u0644\u062a\u0627\u0644\u064a\u0629.',
};

const REFINEMENT = {
  en: 'I could not verify a current match for that exact request. Would you like to refine it by neighbourhood, timing, party size, or budget?',
  fr: 'Je n\u2019ai pas pu v\u00e9rifier une adresse actuelle pour cette demande pr\u00e9cise. Souhaitez-vous pr\u00e9ciser le quartier, l\u2019horaire, le nombre de personnes ou le budget ?',
  es: 'No he podido verificar una opci\u00f3n actual para esta solicitud exacta. \u00bfDesea precisarla por zona, horario, n\u00famero de personas o presupuesto?',
  de: 'Ich konnte f\u00fcr diese genaue Anfrage keine aktuelle Option verifizieren. M\u00f6chten Sie Stadtteil, Zeitpunkt, Personenzahl oder Budget eingrenzen?',
  it: 'Non ho potuto verificare un\u2019opzione attuale per questa richiesta precisa. Vuole specificare quartiere, orario, numero di persone o budget?',
  ja: '\u3053\u306e\u3054\u5e0c\u671b\u306b\u4e00\u81f4\u3059\u308b\u73fe\u5728\u78ba\u8a8d\u6e08\u307f\u306e\u5019\u88dc\u3092\u898b\u3064\u3051\u3089\u308c\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u30a8\u30ea\u30a2\u3001\u6642\u9593\u3001\u4eba\u6570\u3001\u307e\u305f\u306f\u3054\u4e88\u7b97\u3092\u6559\u3048\u3066\u3044\u305f\u3060\u3051\u307e\u3059\u304b\u3002',
  zh: '\u6211\u6682\u65f6\u65e0\u6cd5\u6838\u5b9e\u5b8c\u5168\u7b26\u5408\u6b64\u8981\u6c42\u7684\u5f53\u524d\u9009\u9879\u3002\u60a8\u613f\u610f\u8865\u5145\u533a\u57df\u3001\u65f6\u95f4\u3001\u4eba\u6570\u6216\u9884\u7b97\u5417\uff1f',
  ar: '\u0644\u0645 \u0623\u062a\u0645\u0643\u0646 \u0645\u0646 \u0627\u0644\u062a\u062d\u0642\u0642 \u0645\u0646 \u062e\u064a\u0627\u0631 \u062d\u0627\u0644\u064a \u064a\u0637\u0627\u0628\u0642 \u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628 \u062a\u0645\u0627\u0645\u0627\u064b. \u0647\u0644 \u062a\u0648\u062f\u0648\u0646 \u062a\u062d\u062f\u064a\u062f \u0627\u0644\u0645\u0646\u0637\u0642\u0629 \u0623\u0648 \u0627\u0644\u0648\u0642\u062a \u0623\u0648 \u0639\u062f\u062f \u0627\u0644\u0636\u064a\u0648\u0641 \u0623\u0648 \u0627\u0644\u0645\u064a\u0632\u0627\u0646\u064a\u0629\u061f',
};

const EXTERNAL_INTRO = {
  en: 'I found a small selection of current, independently verified addresses. Each is a non-partner recommendation; our concierge team can verify availability once you choose.',
  fr: 'J\u2019ai s\u00e9lectionn\u00e9 quelques adresses actuelles et v\u00e9rifi\u00e9es. Ce sont des recommandations non partenaires ; notre conciergerie v\u00e9rifiera la disponibilit\u00e9 d\u00e8s votre choix.',
  es: 'He seleccionado algunas direcciones actuales y verificadas. Son recomendaciones independientes; nuestro equipo confirmar\u00e1 la disponibilidad cuando elija una.',
  de: 'Ich habe einige aktuelle, unabh\u00e4ngig verifizierte Adressen ausgew\u00e4hlt. Es sind externe Empfehlungen; unser Concierge-Team pr\u00fcft die Verf\u00fcgbarkeit nach Ihrer Wahl.',
  it: 'Ho selezionato alcuni indirizzi attuali e verificati. Sono consigli indipendenti; il nostro concierge verificher\u00e0 la disponibilit\u00e0 quando avr\u00e0 scelto.',
  ja: '\u73fe\u5728\u78ba\u8a8d\u3067\u304d\u308b\u5019\u88dc\u3092\u53b3\u9078\u3057\u307e\u3057\u305f\u3002\u3044\u305a\u308c\u3082\u63d0\u643a\u5916\u306e\u304a\u3059\u3059\u3081\u3067\u3001\u5019\u88dc\u3092\u304a\u9078\u3073\u3044\u305f\u3060\u3051\u308c\u3070\u30b3\u30f3\u30b7\u30a7\u30eb\u30b8\u30e5\u304c\u7a7a\u304d\u72b6\u6cc1\u3092\u78ba\u8a8d\u3057\u307e\u3059\u3002',
  zh: '\u6211\u4e3a\u60a8\u7cbe\u9009\u4e86\u51e0\u5904\u76ee\u524d\u53ef\u6838\u5b9e\u7684\u5730\u5740\u3002\u8fd9\u4e9b\u5747\u4e3a\u975e\u5408\u4f5c\u65b9\u63a8\u8350\uff1b\u60a8\u9009\u5b9a\u540e\uff0c\u793c\u5bbe\u56e2\u961f\u4f1a\u6838\u5b9e\u53ef\u8ba2\u60c5\u51b5\u3002',
  ar: '\u0627\u062e\u062a\u0631\u062a \u0644\u0643\u0645 \u0645\u062c\u0645\u0648\u0639\u0629 \u0635\u063a\u064a\u0631\u0629 \u0645\u0646 \u0627\u0644\u0639\u0646\u0627\u0648\u064a\u0646 \u0627\u0644\u062d\u0627\u0644\u064a\u0629 \u0648\u0627\u0644\u0645\u0648\u062b\u0648\u0642\u0629. \u0625\u0646\u0647\u0627 \u062a\u0648\u0635\u064a\u0627\u062a \u063a\u064a\u0631 \u0634\u0631\u064a\u0643\u0629\u060c \u0648\u0633\u064a\u0624\u0643\u062f \u0641\u0631\u064a\u0642 \u0627\u0644\u0643\u0648\u0646\u0633\u064a\u0631\u062c \u0627\u0644\u062a\u0648\u0627\u0641\u0631 \u0628\u0639\u062f \u0627\u062e\u062a\u064a\u0627\u0631\u0643\u0645.',
};

const EXTERNAL_INTRO_SINGULAR = {
  en: 'I found one current, independently verified match. It is a non-partner recommendation; our concierge team can verify availability when you are ready.',
  fr: 'J\u2019ai trouv\u00e9 une adresse actuelle et v\u00e9rifi\u00e9e. Il s\u2019agit d\u2019une recommandation non partenaire ; notre conciergerie v\u00e9rifiera la disponibilit\u00e9 d\u00e8s que vous le souhaiterez.',
  es: 'He encontrado una direcci\u00f3n actual y verificada. Es una recomendaci\u00f3n independiente; nuestro equipo comprobar\u00e1 la disponibilidad cuando lo desee.',
  de: 'Ich habe eine aktuelle, unabh\u00e4ngig verifizierte Adresse gefunden. Es ist eine externe Empfehlung; unser Concierge-Team pr\u00fcft die Verf\u00fcgbarkeit, sobald Sie m\u00f6chten.',
  it: 'Ho trovato un indirizzo attuale e verificato. \u00c8 una raccomandazione indipendente; il nostro concierge verificher\u00e0 la disponibilit\u00e0 quando lo desidera.',
  ja: '\u73fe\u5728\u78ba\u8a8d\u3067\u304d\u308b\u5019\u88dc\u3092\u4e00\u3064\u898b\u3064\u3051\u307e\u3057\u305f\u3002\u63d0\u643a\u5916\u306e\u304a\u3059\u3059\u3081\u3067\u3059\u304c\u3001\u3054\u5e0c\u671b\u306e\u969b\u306b\u30b3\u30f3\u30b7\u30a7\u30eb\u30b8\u30e5\u304c\u7a7a\u304d\u72b6\u6cc1\u3092\u78ba\u8a8d\u3057\u307e\u3059\u3002',
  zh: '\u6211\u627e\u5230\u4e86\u4e00\u5904\u76ee\u524d\u53ef\u6838\u5b9e\u7684\u5730\u5740\u3002\u8fd9\u662f\u975e\u5408\u4f5c\u65b9\u63a8\u8350\uff1b\u60a8\u51c6\u5907\u597d\u540e\uff0c\u793c\u5bbe\u56e2\u961f\u4f1a\u6838\u5b9e\u53ef\u8ba2\u60c5\u51b5\u3002',
  ar: '\u0648\u062c\u062f\u062a \u0639\u0646\u0648\u0627\u0646\u0627\u064b \u0648\u0627\u062d\u062f\u0627\u064b \u062d\u0627\u0644\u064a\u0627\u064b \u0648\u0645\u0648\u062b\u0648\u0642\u0627\u064b. \u0625\u0646\u0647 \u062a\u0648\u0635\u064a\u0629 \u063a\u064a\u0631 \u0634\u0631\u064a\u0643\u0629\u060c \u0648\u0633\u064a\u0624\u0643\u062f \u0641\u0631\u064a\u0642 \u0627\u0644\u0643\u0648\u0646\u0633\u064a\u0631\u062c \u0627\u0644\u062a\u0648\u0627\u0641\u0631 \u0639\u0646\u062f\u0645\u0627 \u062a\u0643\u0648\u0646\u0648\u0646 \u0645\u0633\u062a\u0639\u062f\u064a\u0646.',
};

function externalIntro(language, count) {
  const collection = count === 1 ? EXTERNAL_INTRO_SINGULAR : EXTERNAL_INTRO;
  return collection[language] ?? collection.en;
}

function itineraryReply(language, options) {
  const first = options[0]?.name;
  const second = options[1]?.name;
  if (!first) return DEFERRED[language] ?? DEFERRED.en;
  if (!second) {
    return `For your final day in Paris, I would make ${first} the centrepiece and leave room for an unhurried lunch and a final evening stroll. I have included the verified details below.`;
  }
  return `For your final day in Paris, I would begin with ${first}, then make time for ${second} at an unhurried pace. I have selected a few current, independently verified details below so you can shape the rest of the day around what appeals most.`;
}

function conciseReply(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  return sentences.slice(0, 2).join(' ').slice(0, 360).trim();
}

export function enforceContract(model, { language, classification, matching, excluded, externalOptions }) {
  const optionNames = externalOptions.map((item) => item.name);
  const excludedNames = excluded.map((item) => item.name);
  const replyText = String(model.reply ?? '').trim();
  const reply = normalized(replyText);
  const mentionsExcluded = Boolean(classification.cuisine && excludedNames.some((name) => reply.includes(normalized(name))));
  const mentionsExternal = optionNames.some((name) => reply.includes(normalized(name)));
  const needsRefinement = Boolean((classification.cuisine || classification.externalDiscovery) && !matching.length && !externalOptions.length);
  let finalReply = conciseReply(replyText);
  let requests = model.requests ?? [];

  if (mentionsExcluded || needsRefinement) {
    finalReply = REFINEMENT[language] ?? REFINEMENT.en;
    requests = [];
  } else if (externalOptions.length) {
    if (!mentionsExternal || !finalReply) {
      finalReply = classification.category === 'itinerary'
        ? itineraryReply(language, externalOptions)
        : externalIntro(language, externalOptions.length);
    }
    requests = requests.filter((item) => optionNames.some((name) => normalized(item.serviceName).includes(normalized(name))));
  }

  if (classification.route !== 'partner_catalog' && classification.hasIntent && matching.length && !matching.some((service) => normalized(finalReply).includes(normalized(service.name)))) {
    const service = matching[0];
    const details = [service.price === null || service.price === '' ? '' : `EUR ${Number(service.price).toFixed(0)}`, service.duration ? `${service.duration} min` : ''].filter(Boolean).join(', ');
    const partnerSuffixes = {
      es: `Opción de socio: ${service.name}${details ? ` (${details})` : ''}. Nuestro equipo verificará la disponibilidad antes de confirmar cualquier solicitud.`,
      fr: `Option partenaire : ${service.name}${details ? ` (${details})` : ''}. Notre équipe vérifiera la disponibilité avant toute confirmation.`,
      de: `Partner-Option: ${service.name}${details ? ` (${details})` : ''}. Unser Team prüft die Verfügbarkeit vor Bestätigung.`,
      it: `Opzione partner: ${service.name}${details ? ` (${details})` : ''}. Il nostro team verificherà la disponibilità prima di confermare.`,
      ja: `提携サービス: ${service.name}${details ? ` (${details})` : ''}。スタッフが空き状況を確認いたします。`,
      zh: `合作方项目：${service.name}${details ? ` (${details})` : ''}。我们的团队将在确认前核实可订情况。`,
      ar: `خيار الشريك: ${service.name}${details ? ` (${details})` : ''}. سيتحقق فريقنا من التوافر قبل التأكيد.`,
      en: `Partner option: ${service.name}${details ? ` (${details})` : ''}. Our team will verify availability before confirming any request.`
    };
    const suffix = partnerSuffixes[language] || partnerSuffixes.en;
    finalReply = finalReply ? `${finalReply}\n\n${suffix}` : suffix;
  }

  return {
    reply: finalReply || (DEFERRED[language] ?? DEFERRED.en),
    intent: model.intent,
    serviceType: model.serviceType,
    requiresHuman: Boolean(model.requiresHuman) || Boolean(classification.cuisine),
    requests: requests.filter((item) => !excludedNames.some((name) => normalized(item.serviceName).includes(normalized(name)))),
    externalOptionNames: optionNames,
    recommendations: externalOptions,
  };
}

export function buildPrompt({ input, classification, history, services, externalOptions, facts }) {
  const historyText = history.length
    ? history.map((item) => `${item.role}: ${item.message}`).join('\n')
    : '(no prior conversation)';
  return `You are the concierge for ${facts.hotelName}. Return JSON only, never Markdown.

Hard rules:
- Reply naturally and fluently in whatever language the guest writes in. Automatically detect the guest's language (Spanish, Japanese, French, German, Italian, Arabic, Chinese, English, etc.) and compose your response entirely in that same language.
- Use only the facts, partner services, and external search results below.
- A required cuisine is absolute. Never recommend a venue unless its own listing explicitly matches that cuisine, even if it appeared earlier in the conversation.
- Partner services are preferred. State a catalog price only when it is supplied below.
- When the guest asks about hotel services or partners, name only the actual partner services supplied below; do not invent a generic catalogue.
- External results are non-partner suggestions. Never invent a price, rating, address, link, or availability. Keep reply_text to one or two elegant sentences; cards are rendered separately by the website.
- For a new or unusual guest request, respond to the actual need and use the verified external cards. Do not defer to staff when cards are available.
- Never state that a booking or availability is confirmed. The hotel team verifies and confirms every request.

Return exactly this JSON shape:
{"reply_text":"string","language_detected":"string","intent":"faq|service_request|smalltalk|other","service_type":"spa|restaurant|tour|transport|experience|other|null","requests":[{"service_name":"string|null","source":"partner|external","summary":"staff action","est_value_eur":null,"is_upsell":false}],"requires_human":true}

GUEST MESSAGE:
${input.message}

REQUIRED CUISINE OR SPECIALTY:
${classification.cuisine?.label ?? 'none'}

CONVERSATION HISTORY:
${historyText}

PARTNER SERVICES:
${formatServices(services)}

EXTERNAL SEARCH RESULTS:
${formatExternalOptions(externalOptions, classification)}

HOTEL FACTS:
${facts.text || '(no additional hotel facts configured)'}`;
}

export function buildEvaluatorPrompt({ input, draftReply, classification, facts }) {
  const hotel = facts?.hotelName || 'Hôtel Lumière Paris';
  return `You are the Head Concierge Evaluator at ${hotel}. Your job is to evaluate and polish the assistant's draft response before it is shown to the guest. Return a valid json object only.

CRITICAL EVALUATION CRITERIA:
1. Luxury 5-Star Tone: Must sound like an elite Paris hotel concierge — polite, warm, discreet, and refined.
2. Anti-Salesy Guardrail: The response must NEVER sound pushy, robotic, or transactional. Building guest trust is paramount.
3. Natural Upsell Opportunities:
   - Check if there is a natural, effortless opportunity to mention one of our core premium hotel services:
     * The Private Chauffeur (Mercedes-Benz S-Class transfer for airport/tours/shopping)
     * The Hotel Spa (Lumière Spa facial or couples massage for wellness)
     * The Rooftop Restaurant (Terrasse Lumière Eiffel Tower view dining & cocktails)
   - IMPORTANT: Only include an upsell if it fits the guest context seamlessly. If forcing an upsell feels unnatural or pushy, APPROVE the draft as-is (passed=true).
4. Language Match: The final text MUST be in the exact same language as the guest's message (${input.language || 'auto'}).

You MUST respond with a raw json object matching this structure:
{
  "passed": true,
  "score": 9,
  "critique": "Draft is warm and naturally offers private chauffeur.",
  "improved_reply": null
}

If passed is false, set improved_reply to a refined luxury concierge text string. If passed is true, set improved_reply to null.

GUEST MESSAGE:
"${input.message}"

DRAFT RESPONSE:
"${draftReply}"`;
}

export function buildMemoryExtractionPrompt({ message, history, language }) {
  const historyText = Array.isArray(history) && history.length
    ? history.map((item) => `${item.role}: ${item.message}`).join('\n')
    : `user: ${message}`;
  return `You are a Data Extraction Assistant for Hôtel Lumière Paris.
Analyze the guest conversation transcript below. Extract permanent guest profile facts. Return a valid json object only.

Schema to return:
{
  "phone": "string|null (phone number or WhatsApp ID if mentioned, e.g. +33612345678)",
  "guestName": "string|null (guest name if mentioned)",
  "language": "${language || 'en'}",
  "dietaryRestrictions": "string|null (e.g. Gluten-free, Vegan, Nut allergy, Halal, Kosher)",
  "purposeOfStay": "string|null (e.g. 10th Anniversary, Birthday, Business, Honeymoon)",
  "generalPreferences": "string|null (e.g. Loves seafood, prefers Eiffel Tower views, asked about museum tours)"
}

CONVERSATION TRANSCRIPT:
${historyText}
user: ${message}`;
}

export function buildPreArrivalOutreachPrompt({ profile, hotelName = 'Hôtel Lumière Paris' }) {
  return `You are the Head Concierge at ${hotelName}.
Write a personalized, warm pre-arrival welcome message to be sent via WhatsApp to a guest arriving in 48 hours.

GUEST PROFILE:
- Name: ${profile.GuestName || 'Valued Guest'}
- Language: ${profile.Language || 'en'}
- Purpose of Stay: ${profile.PurposeOfStay || 'Paris Getaway'}
- Dietary Restrictions: ${profile.DietaryRestrictions || 'None specified'}
- Preferences: ${profile.GeneralPreferences || 'Luxury experience'}

RULES:
- Compose the message in the guest's language (${profile.Language || 'en'}).
- Warm, personal, 5-star Paris luxury concierge tone.
- Naturally offer a relevant premium hotel service (e.g., Private Mercedes Chauffeur airport transfer, Lumière Spa reservation, or Eiffel View rooftop dinner table).
- Keep it concise, friendly, and under 4 sentences.
- Return raw text string only (no JSON, no markdown formatting).`;
}

export function buildPostCheckoutOutreachPrompt({ profile, hotelName = 'Hôtel Lumière Paris' }) {
  return `You are the Head Concierge at ${hotelName}.
Write a polite, personal post-checkout thank you message to be sent via WhatsApp to a guest who checked out earlier today.

GUEST PROFILE:
- Name: ${profile.GuestName || 'Valued Guest'}
- Language: ${profile.Language || 'en'}
- Purpose of Stay: ${profile.PurposeOfStay || 'Stay'}

RULES:
- Compose the message in the guest's language (${profile.Language || 'en'}).
- Express sincere gratitude for staying at ${hotelName}.
- Politely ask how their stay was and invite them to leave a review or share any private feedback directly with the team.
- Warm, discreet, and refined tone. Keep under 4 sentences.
- Return raw text string only (no JSON, no markdown formatting).`;
}
