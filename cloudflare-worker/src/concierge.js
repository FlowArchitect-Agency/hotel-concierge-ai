const CATEGORY_RULES = [
  { category: 'accommodation', words: ['hotel room', 'hotel rooms', 'room booking', 'book a room', 'reserve a room', 'reserve in your hotel', 'book your hotel', 'hotel stay', 'stay at your hotel', 'overnight stay', 'accommodation', 'suite', 'suites', 'guest room', 'guest rooms', 'rooms', 'room', 'nights', 'night', 'chambre', 'chambres', 'habitacion', 'habitaciones', 'habitation', 'camera', 'zimmer', 'check-in', 'check in', 'check-out', 'check out'] },
  { category: 'spa', words: ['spa', 'massage', 'masaje', 'sauna', 'hammam', 'wellness', 'treatment', 'soin', 'facial', '\u6309\u6469', '\u30de\u30c3\u30b5\u30fc\u30b8'] },
  { category: 'restaurant', words: ['restaurant', 'dining', 'dinner', 'lunch', 'breakfast', 'table', 'reservation', 'resto', 'd\u00eener', 'd\u00e9jeuner', 'manger', 'food', 'eat', 'cuisine', 'michelin', '\u0645\u0637\u0639\u0645', '\u30ec\u30b9\u30c8\u30e9\u30f3', '\u9910\u5385'] },
  { category: 'transport', words: ['taxi', 'uber', 'chauffeur', 'car', 'driver', 'transfer', 'airport', 'cdg', 'orly', 'pick up', 'pickup', 'navette', 'shuttle'] },
  { category: 'tour', words: ['tour', 'eiffel', 'louvre', 'museum', 'mus\u00e9e', 'cruise', 'croisi\u00e8re', 'seine', 'versailles', 'excursion', 'sightsee', 'guide'] },
  { category: 'experience', words: ['private experience', 'private experiences', 'experience', 'experiences', 'private chef', 'chef', 'sommelier', 'wine tasting', 'd\u00e9gustation', 'after-hours', 'shopping', 'personal shopper', 'photographer', 'proposal', 'anniversary', 'honeymoon'] },
];

// These requests are not an attempt to book one catalogue item. They need a
// real Paris recommendation assembled from current web results.
const ITINERARY_WORDS = [
  'last day', 'final day', 'one day in paris', 'day in paris', 'itinerary',
  'things to do in paris', 'what should i do in paris', 'what should i do tomorrow',
  'ideas for today', 'today in paris', 'tonight in paris',
  'dernier jour', 'derniere journee', 'une journee a paris', 'itineraire',
  'que faire a paris', 'que faire demain', 'ultimo dia', 'ultimo dia en paris',
  'itinerario', 'que hacer en paris', 'que hacer manana', 'letzter tag',
  'ein tag in paris', 'reiseroute', 'was kann ich in paris tun',
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
const CUISINE_FILLER_WORDS = new Set(['i', 'im', 'am', 'looking', 'for', 'a', 'an', 'the', 'some', 'any', 'find', 'need', 'want', 'would', 'like', 'to', 'book', 'reserve', 'reservation', 'fancy', 'best', 'top', 'good', 'great', 'nice', 'authentic', 'excellent', 'what', 'which', 'where', 'when', 'do', 'does', 'are', 'your', 'our', 'hotel', 'table', 'restaurant', 'restaurants', 'restaurante', 'restaurantes', 'ristorante', 'ristoranti', 'cuisine', 'food', 'dining', 'experience', 'experiences', 'available', 'place', 'places', 'near', 'close', 'around', 'by', 'in', 'at', 'please', 'show', 'me', 'one', 'only', 'just', 'of', 'is', 'that', 'this', 'with', 'and', 'or']);

export function normalized(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Airtable dashboard buckets are deliberately narrower than the catalogue
// taxonomy. Keep this conversion next to the model contract so every caller
// can turn unpredictable model output into an approved, stable value.
export const SERVICE_TYPE_BUCKETS = Object.freeze([
  'Housekeeping',
  'Maintenance',
  'Spa & Wellness',
  'Transport',
  'Dining',
  'Concierge',
  'General Manager',
]);

export function normalizeServiceType(value) {
  const type = normalized(value).replace(/[^a-z0-9]+/g, ' ').trim();
  if (!type) return 'Concierge';

  if (/\b(general manager|manager|gm|escalation|complaint|service recovery)\b/.test(type)) return 'General Manager';
  if (/\b(maintenance|repair|engineering|plumbing|electrical|air conditioning|ac issue|broken)\b/.test(type)) return 'Maintenance';
  if (/\b(housekeeping|operational|cleaning|laundry|towels?|amenities|room delivery)\b/.test(type)) return 'Housekeeping';
  if (/\b(spa|wellness|massage|treatment|hammam|sauna|facial)\b/.test(type)) return 'Spa & Wellness';
  if (/\b(transport|transfer|taxi|chauffeur|shuttle|airport)\b/.test(type)) return 'Transport';
  if (/\b(dining|restaurant|food|breakfast|lunch|dinner|room service|catering)\b/.test(type)) return 'Dining';

  // Tours, experiences, accommodation and Front Desk requests are managed by
  // the concierge team. Unknown provider output must never reach Airtable.
  return 'Concierge';
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

const SUPPORTED_REPLY_LANGUAGES = new Set(['en', 'fr', 'es', 'it', 'de', 'ar', 'ja', 'zh']);
const REPLY_LANGUAGE_ALIASES = {
  es: ['spanish', 'espanol', 'espangol', 'espagnol'],
  fr: ['french', 'francais', 'francese'],
  it: ['italian', 'italiano', 'italien'],
  de: ['german', 'deutsch', 'allemand'],
  ar: ['arabic', 'arabe', 'arab'],
  ja: ['japanese', 'japonais', 'giapponese'],
  zh: ['chinese', 'chinois', 'chino', 'mandarin'],
  en: ['english', 'anglais', 'ingles'],
};
const LANGUAGE_REQUEST_WORDS = /\b(speak|answer|reply|respond|write|language|habla|hablas|responde|contesta|escribe|parla|parli|parlez|repond|repondez|sprechen|sprichst|antworten)\b/i;

export function requestedResponseLanguage(message) {
  const text = normalized(message);
  const asksForLanguage = LANGUAGE_REQUEST_WORDS.test(text);
  for (const [language, aliases] of Object.entries(REPLY_LANGUAGE_ALIASES)) {
    const mentionsLanguage = aliases.some((alias) => new RegExp(`\\b${alias}\\b`, 'i').test(text));
    const bareLanguageRequest = aliases.some((alias) => new RegExp(`\\b${alias}\\s*(?:please|por favor)?[!?.,]*$`, 'i').test(text));
    if (mentionsLanguage && (asksForLanguage || bareLanguageRequest)) return language;
  }
  return '';
}

// Lightweight language scoring keeps the current turn in control.  It is
// intentionally small and deterministic: this is not translation, just a
// reliable way to select the appropriate reply language before the model is
// called.  Phrases receive a little more weight than isolated function words
// and a one-character typo is tolerated for useful longer words.
const LATIN_LANGUAGE_SIGNALS = {
  en: {
    phrases: ['what time', 'do you close', 'are you open', 'can you help', 'i would like', 'help me plan', 'hello'],
    words: ['what', 'time', 'close', 'open', 'please', 'would', 'could', 'thanks', 'hello', 'breakfast', 'stay'],
  },
  fr: {
    phrases: ['a quelle heure', 'vous etes ouverts', 'toute la nuit', 'je voudrais', 'pouvez vous', 'aidez moi', 'montrez moi', 'que suggerez vous', 'que recommandez vous', 'non pourquoi', 'bonjour', 'bonsoir'],
    words: ['quelle', 'heure', 'ferme', 'fermez', 'ouverts', 'ouverte', 'vous', 'montrez', 'options', 'suggerez', 'recommandez', 'pourquoi', 'bonjour', 'bonsoir', 'demain', 'sejour', 'petit', 'dejeuner', 'merci'],
  },
  es: {
    phrases: ['a que hora', 'pueden ayudarme', 'me gustaria', 'muestrame las opciones', 'que sugieres', 'que recomiendas', 'no por que', 'por que', 'por favor', 'hola'],
    words: ['que', 'hora', 'cierra', 'abierto', 'abierta', 'muestrame', 'opciones', 'servicios', 'restaurante', 'cual', 'sugieres', 'recomiendas', 'hola', 'necesito', 'quiero', 'masaje', 'manana', 'estancia', 'desayuno', 'gracias'],
  },
  it: {
    phrases: ['a che ora', 'mi piacerebbe', 'potete aiutarmi', 'ciao'],
    words: ['che', 'ora', 'chiude', 'aperto', 'aperta', 'ciao', 'vorrei', 'posso', 'domani', 'soggiorno', 'colazione', 'grazie'],
  },
  de: {
    phrases: ['wie spat', 'haben sie', 'konnen sie helfen', 'hallo', 'guten tag'],
    words: ['wie', 'spat', 'geschlossen', 'geoffnet', 'hallo', 'bitte', 'danke', 'ihnen', 'morgen', 'aufenthalt', 'fruhstuck'],
  },
};

function languageTokens(text) {
  return normalized(text).match(/[\p{L}]{2,}/gu) || [];
}

function editDistanceAtMostOne(left, right) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return true;
}

function scoreLatinLanguage(message, language) {
  const text = normalized(message);
  const phraseText = text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const tokens = languageTokens(message);
  const signals = LATIN_LANGUAGE_SIGNALS[language];
  let score = 0;
  for (const phrase of signals.phrases) {
    if (phraseText.includes(phrase)) score += 3;
  }
  for (const word of signals.words) {
    if (tokens.includes(word)) {
      score += 1;
      continue;
    }
    // Do not fuzzy-match very short terms: they create false positives across
    // languages.  Longer conversational words carry enough signal to help a
    // mobile typo such as "qulle" for "quelle".
    if (word.length >= 5 && tokens.some((token) => token.length >= 4 && editDistanceAtMostOne(token, word))) score += 0.8;
  }
  return score;
}

export function inferLanguage(message) {
  const requested = requestedResponseLanguage(message);
  if (requested) return requested;
  const text = normalized(message);
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  const scores = Object.fromEntries(Object.keys(LATIN_LANGUAGE_SIGNALS).map((language) => [language, scoreLatinLanguage(message, language)]));
  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  const [language, score] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;
  // English is the safe default.  A non-English answer needs either several
  // converging words or a distinctive phrase, never one shared word alone.
  if (language !== 'en' && score >= 2 && score > runnerUp) return language;
  return 'en';
}

// A saved language is useful for short, ambiguous follow-ups ("spa tomorrow"),
// but it must never override a clearly written new message.  In particular,
// an English guest should not keep receiving French merely because their
// previous message was French.
function hasExplicitEnglishSignal(message) {
  const text = normalized(message);
  return /\b(?:hello|hi|hey|what|which|where|when|why|how|can|could|would|should|do|does|did|is|are|am|i|we|you|my|your|please|thanks|thank)\b/.test(text);
}

function recentHistoryLanguage(history) {
  if (!Array.isArray(history)) return '';
  for (const item of [...history].reverse().slice(0, 8)) {
    const language = inferLanguage(item?.message ?? item?.content ?? '');
    if (language !== 'en') return language;
  }
  return '';
}

export function parseGuestInput(body) {
  const raw = body && typeof body === 'object' ? body : {};
  const message = String(raw.message ?? raw.text ?? '').trim();
  const sessionId = String(raw.sessionId ?? raw.userId ?? raw.user_id ?? 'anon').trim();
  const channel = String(raw.channel ?? 'web').trim().toLowerCase() === 'whatsapp' ? 'whatsapp' : 'web';
  if (!message || message.length > 1200) throw new Error('A message between 1 and 1200 characters is required.');
  if (!/^[A-Za-z0-9:_-]{1,120}$/.test(sessionId)) throw new Error('Invalid conversation identifier.');
  const testMode = ['read_only', 'write_verified'].includes(String(raw.testMode)) ? String(raw.testMode) : null;
  const requestedLanguage = requestedResponseLanguage(message);
  const detectedLanguage = inferLanguage(message);
  const preferredLanguage = String(raw.preferredLanguage ?? '').trim().toLowerCase();
  const historyLanguage = recentHistoryLanguage(raw.chatHistory);
  const language = requestedLanguage || (detectedLanguage !== 'en' || hasExplicitEnglishSignal(message)
    ? detectedLanguage
    : (SUPPORTED_REPLY_LANGUAGES.has(preferredLanguage) ? preferredLanguage : (historyLanguage || detectedLanguage)));
  const guestName = String(raw.guestName ?? raw.guest_name ?? raw.name ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 100);
  const isDemo = raw.is_demo === true || raw.isDemo === true || raw.demo === true;
  return {
    message,
    // Keep one, clearly namespaced history per guest and channel. WhatsApp
    // provides a stable wa_id, so its conversation can continue naturally
    // without being mixed with an unrelated browser session.
    userId: `${channel}:${sessionId}`,
    sessionId,
    channel,
    language,
    languageRequested: Boolean(requestedLanguage),
    testMode,
    testRunId: String(raw.testRunId ?? '').slice(0, 80),
    guestName: guestName || (isDemo ? 'Demo Guest' : ''),
    isDemo,
    is_demo: isDemo,
    chatHistory: Array.isArray(raw.chatHistory) ? raw.chatHistory : null,
    scenario: String(raw.scenario ?? '').trim().slice(0, 48),
    conversationOwner: String(raw.conversationOwner ?? raw.conversation_owner ?? 'ai').trim().toLowerCase() === 'staff' ? 'staff' : 'ai',
    receivedAt: new Date().toISOString(),
  };
}

const ESCALATION_TERMS = [
  'manager', 'director', 'general manager', 'gm', 'front desk', 'reception', 'receptionist', 'duty manager',
  'human', 'person', 'real person', 'agent', 'representative', 'talk to someone', 'speak to someone', 'speak with someone', 'talk with someone',
  'angry', 'furious', 'upset', 'terrible', 'horrible', 'awful', 'unacceptable', 'disaster', 'disgusted',
  'complaint', 'complain', 'complaining', 'refund', 'dirty', 'scam', 'ridiculous', 'worst',
  'incompetent', 'unhappy', 'frustrated', 'frustrating', 'lawyer', 'sue', 'police', 'emergency',
  'noise', 'noisy', 'loud', 'drilling', 'disturbance', 'cannot sleep', 'cant sleep', 'cant work', 'cannot work',
  'directeur', 'directrice', 'responsable', 'direction', 'receptionniste',
  'en colere', 'furieux', 'furieuse', 'inadmissible', 'catastrophe', 'scandaleux', 'scandale',
  'plainte', 'reclamation', 'remboursement', 'sale', 'casse', 'decu', 'degoute', 'pire hotel',
  'bruit', 'bruyant', 'tapage',
  'gerente', 'enojado', 'enojada', 'inaceptable', 'queja', 'reclamacion', 'reembolso', 'sucio', 'roto',
  'ruido', 'ruidosa', 'no puedo dormir'
];

export function isEscalation(message) {
  const text = normalized(message);
  return ESCALATION_TERMS.some((term) => hasTerm(text, term));
}

export const ESCALATION_REPLIES = {
  en: 'I sincerely apologize for the frustration and inconvenience caused. I have prepared a priority service-recovery request for the hotel’s request queue. If you need immediate assistance, please contact the front desk directly.',
  fr: 'Je vous présente toutes mes excuses pour ce désagrément. J’ai préparé une demande prioritaire de rétablissement du service pour la file de demandes de l’hôtel. Si vous avez besoin d’une aide immédiate, veuillez contacter directement la réception.',
  es: 'Le pido sinceras disculpas por los inconvenientes. He preparado una solicitud prioritaria de recuperación del servicio para la cola de solicitudes del hotel. Si necesita ayuda inmediata, contacte directamente con recepción.',
  de: 'Ich entschuldige mich aufrichtig für die Unannehmlichkeiten. Ich habe eine priorisierte Anfrage zur Servicewiederherstellung für die Anfragewarteschlange des Hotels vorbereitet. Wenn Sie sofort Hilfe benötigen, wenden Sie sich bitte direkt an die Rezeption.',
  it: 'Le porgo le mie più sincere scuse per il disagio. Ho preparato una richiesta prioritaria di ripristino del servizio per la coda delle richieste dell’hotel. Per assistenza immediata, contatti direttamente la reception.',
  ja: 'ご不便とご不快な思いをおかけし、心より深くお詫び申し上げます。ホテルのリクエストキューに、優先度の高いサービス回復依頼を作成しました。お急ぎの場合は、直接フロントデスクへご連絡ください。',
  zh: '对于给您带来的不便与困扰，我致以最真诚的歉意。我已为酒店请求队列准备了一项优先服务恢复请求。如需即时协助，请直接联系前台。',
  ar: 'أعتذر بشدة عن الإزعاج والاستياء الذي واجهتموه. لقد أعددت طلباً ذا أولوية لاستعادة الخدمة ضمن قائمة طلبات الفندق. إذا كنتم تحتاجون إلى مساعدة فورية، يرجى التواصل مباشرةً مع مكتب الاستقبال.',
};

export function detectMediaBrochure(message, category = null) {
  const text = normalized(message);
  if (isEscalation(message) || /\b(noisy|terrible|bad service|horrible|complaint|dirty|manager)\b/i.test(text)) {
    return null;
  }
  const asksForBrochure = /\b(menu|carte|brochure|pdf|catalog|catalogue|directory|guide|treatments?|pricing|tarifs?|tarifs|services list|list of services|view services|our services|carte des soins|soins|massages?)\b/i.test(text)
    || /\b(?:show|see|view|send|have|list|what|all)\s+(?:me\s+)?(?:the\s+)?(?:services?|collection)\b/i.test(text);
  const isSpa = category === 'spa' || /\b(spa|massage|sauna|hammam|wellness|facial|soin)\b/i.test(text);
  const isDining = category === 'restaurant' || /\b(dinner|lunch|breakfast|food|carte|dining|restaurant|wine|cocktail|room service)\b/i.test(text);
  const isRooms = category === 'accommodation' || /\b(room|suite|chambre|habitacion|stay)\b/i.test(text);

  const asksForFullDirectory = /\b(catalog|catalogue|directory|all services|view services|full collection)\b/i.test(text);

  if (asksForBrochure || isSpa) {
    if (isSpa && !asksForFullDirectory) {
      return {
        type: 'document',
        format: 'PDF',
        title: 'Hôtel Lumière — Spa & Wellness Brochure',
        filename: 'Lumiere_Spa_Wellness_Menu.pdf',
        size: '1.1 KB',
        pages: '1 page',
        url: 'https://flowarchitect-agency.github.io/hotel-concierge-ai/Lumiere_Spa_Wellness_Menu.pdf',
        thumbnail: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=700&q=84',
      };
    }
    // These optional brochures are not shipped with the site. Returning null
    // lets the existing text/card renderer respond without a broken document.
    if ((isDining || isRooms) && !asksForFullDirectory) return null;
    return {
      type: 'document',
      format: 'PDF',
      title: 'Hôtel Lumière — Digital Directory & Experiences Brochure 2026',
      filename: 'Lumiere_Guest_Directory_2026.pdf',
      size: '27.3 MB',
      pages: '10 pages',
      url: 'https://flowarchitect-agency.github.io/hotel-concierge-ai/Lumiere_Guest_Directory_2026.pdf',
      thumbnail: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=700&q=84',
    };
  }
  return null;
}

const HOUSEKEEPING_TERMS = [
  'towel', 'towels', 'towl', 'towls', 'serviette', 'serviettes', 'toalla', 'toallas', 'handtuch', 'asciugamano', 'タオル',
  'pillow', 'pillows', 'pilow', 'pilows', 'oreiller', 'oreillers', 'almohada', 'almohadas', 'kissen', 'cuscino', '枕',
  'blanket', 'blankets', 'duvet', 'couverture', 'couvertures', 'manta', 'mantas', 'decke', 'coperta', '毛布',
  'bedsheet', 'bedsheets', 'linen', 'linens', 'drap', 'draps', 'sabana', 'sabanas', 'シーツ',
  'water', 'bottled water', 'bottle of water', 'eau', 'bouteille d\'eau', 'agua', 'botella de agua', 'wasser', 'acqua', '水', 'お水',
  'toiletries', 'shampoo', 'conditioner', 'soap', 'body wash', 'lotion', 'toothbrush', 'toothpaste', 'shaver', 'razor',
  'shampoing', 'savon', 'gel douche', 'brosse a dents', 'dentifrice', 'champú', 'jabon', 'cepillo de dientes',
  'slippers', 'chaussons', 'pantuflas', 'hausschuhe', 'スリッパ',
  'bathrobe', 'bathrobes', 'robe', 'peignoir', 'peignoirs', 'albornoz', 'bademantel', 'バスローブ',
  'iron', 'ironing board', 'fer a repasser', 'plancha', 'アイロン',
  'hair dryer', 'hairdryer', 'seche-cheveux', 'secador', 'ドライヤー',
  'trash', 'bin', 'poubelle', 'basura', 'ゴミ',
  'clean my room', 'clean the room', 'housekeeping', 'make up the room', 'nettoyer la chambre', 'menage', 'limpiar la habitacion', '清掃',
];

const MAINTENANCE_TERMS = [
  'air conditioning', 'ac', 'aircon', 'a/c', 'heating', 'heater', 'climatisation', 'clim', 'chauffage', 'aire acondicionado', 'calefaccion', 'エアコン',
  'leak', 'leaking', 'clogged', 'light bulb', 'bulb', 'tv remote', 'key card', 'door lock', 'safe', 'plumbing', 'maintenance', 'electrical', 'electricity', 'power outage', 'outlet', 'socket', 'wiring', 'broken equipment', 'broken', 'not working',
  'en panne', 'ne marche pas', 'fuite', 'bouche', 'ampoule', 'telecommande', 'carte cle', 'serrure',
  'no funciona', 'fuga', 'atascado', 'bombilla', 'mando', 'tarjeta', 'cerradura',
];

const OPERATIONAL_TERMS = [
  ...HOUSEKEEPING_TERMS,
  ...MAINTENANCE_TERMS,
  'luggage', 'bags', 'baggage', 'valise', 'valises', 'bagages', 'maleta', 'maletas', '荷物',
];

export function isOperationalRequest(message) {
  const text = normalized(message);
  const isTransport = /\b(transfer|shuttle|airport|aeroport|cdg|orly|flight|vol|landed|atterri|taxi|uber|mercedes|chauffeur)\b/i.test(text);
  if (isTransport) return false;
  return OPERATIONAL_TERMS.some((term) => hasTerm(text, term));
}

// Operational routing is intentionally deterministic. The model can help
// phrase a response, but it never chooses the department written to Airtable.
export function operationalServiceType(message) {
  const text = normalized(message);
  return MAINTENANCE_TERMS.some((term) => hasTerm(text, term)) ? 'Maintenance' : 'Housekeeping';
}

export const OPERATIONAL_REPLIES = {
  en: 'I have prepared your request for the hotel’s request queue. If it is time-sensitive, please contact the front desk directly.',
  fr: 'J’ai préparé votre demande pour la file de demandes de l’hôtel. Si votre besoin est urgent, veuillez contacter directement la réception.',
  es: 'He preparado su solicitud para la cola de solicitudes del hotel. Si es urgente, contacte directamente con recepción.',
  de: 'Ich habe Ihre Anfrage für die Anfragewarteschlange des Hotels vorbereitet. Wenn sie zeitkritisch ist, wenden Sie sich bitte direkt an die Rezeption.',
  it: 'Ho preparato la sua richiesta per la coda delle richieste dell’hotel. Se è urgente, contatti direttamente la reception.',
  ja: 'ホテルのリクエストキューにご依頼を作成しました。お急ぎの場合は、直接フロントデスクへご連絡ください。',
  zh: '我已为您的需求准备了酒店请求队列。如属紧急情况，请直接联系前台。',
  ar: 'لقد أعددت طلبكم ضمن قائمة طلبات الفندق. إذا كان الأمر عاجلاً، يرجى التواصل مباشرةً مع مكتب الاستقبال.',
};

export const POST_CHECKOUT_POSITIVE_TERMS = [
  'loved it', 'great stay', 'wonderful', '5 star', '5 stars', 'five star', 'five stars', 'amazing',
  'excellent', 'perfect', 'superb', 'fantastic', 'pleasure', 'enjoyed', 'recommend', 'loved', 'great',
  'parfait', 'merveilleux', 'tres bon', 'super', 'genial', 'adore', 'excellent sejour',
  'encanto', 'maravilloso', 'excelente', 'buena estancia', '5 estrellas',
  '素晴らしい', '最高', '快適', '満足', '5つ星'
];

export const POST_CHECKOUT_NEGATIVE_TERMS = [
  'noisy', 'room was noisy', 'noise', 'bruit', 'bruyant', 'ruido', 'ruidosa', 'うるさい', '騒音',
  'terrible', 'horrible', 'bad', 'poor', 'awful', 'disappointed', 'disappointing', 'issue', 'issues',
  'problem', 'problems', 'complaint', 'dirty', 'smell', 'rude', 'unacceptable', 'worst', 'broken',
  'decevant', 'mauvais', 'catastrophe', 'inadmissible', 'probleme', 'problemes', 'reclamation',
  'malo', 'pesimo', 'inaceptable', 'queja', 'problemas',
  '最悪', '問題', '不満', '汚い', '故障'
];

export function isPostCheckoutNegative(message) {
  const text = normalized(message);
  return isEscalation(message) || POST_CHECKOUT_NEGATIVE_TERMS.some((term) => hasTerm(text, term));
}

export function isPostCheckoutPositive(message) {
  const text = normalized(message);
  return POST_CHECKOUT_POSITIVE_TERMS.some((term) => hasTerm(text, term));
}

export function isPostCheckoutScenario(input) {
  const scenario = String(input?.scenario || '').trim().toLowerCase().replace(/_/g, '-');
  return scenario === 'post-checkout' || scenario === 'checkout';
}

export function postCheckoutPositiveReply(guestName, language) {
  const name = guestName || 'Guest';
  const replies = {
    en: `Thank you so much, ${name}! We are thrilled to hear you had a wonderful stay with us at Hôtel Lumière. If you have a moment, we would be truly grateful if you could share your review with fellow travelers: https://g.page/r/hotel-lumiere-paris/review`,
    fr: `Merci infiniment, ${name} ! Nous sommes ravis d'apprendre que votre séjour à l'Hôtel Lumière a été parfait. Si vous avez un instant, nous serions honorés si vous pouviez partager votre avis : https://g.page/r/hotel-lumiere-paris/review`,
    es: `¡Muchísimas gracias, ${name}! Nos alegra enormemente saber que disfrutó de su estancia en Hôtel Lumière. Si dispone de un momento, le agradeceríamos que compartiera su opinión: https://g.page/r/hotel-lumiere-paris/review`,
    ja: `${name}様、温かいお言葉をいただき心より御礼申し上げます。オテル・リュミエールでのご滞在をご満喫いただけて大変光栄です。よろしければレビューをご投稿いただけますと幸いです：https://g.page/r/hotel-lumiere-paris/review`,
    de: `Vielen Dank, ${name}! Wir freuen uns sehr, dass Sie einen wunderbaren Aufenthalt im Hôtel Lumière hatten. Wir würden uns freuen, wenn Sie Ihre Bewertung teilen: https://g.page/r/hotel-lumiere-paris/review`,
    it: `Grazie di cuore, ${name}! Siamo lieti che il suo soggiorno all'Hôtel Lumière sia stato splendido. Se desidera, può condividere la sua recensione qui: https://g.page/r/hotel-lumiere-paris/review`,
    zh: `非常感谢您，${name}！很高兴得知您在卢米埃尔酒店度过了愉快的时光。如果您方便，欢迎在此分享您的入住体验：https://g.page/r/hotel-lumiere-paris/review`,
    ar: `شكراً جزيلاً لكم، ${name}! يسعدنا جداً أن إقامتكم في فندق لوميير كانت مميزة. نكون ممتنين لو شاركتم تجربتكم معنا: https://g.page/r/hotel-lumiere-paris/review`,
  };
  return replies[language] ?? replies.en;
}

export function postCheckoutNegativeReply(guestName, language) {
  const name = guestName || 'Guest';
  const replies = {
    en: `Dear ${name}, we sincerely apologize that your experience fell short of our high standards. I have prepared a private service-recovery request for the hotel’s request queue. If you need immediate assistance, please contact the hotel directly.`,
    fr: `Cher/Chère ${name}, nous vous présentons nos excuses les plus sincères pour cette expérience qui ne reflète pas nos standards d'excellence. J’ai préparé une demande privée de rétablissement du service pour la file de demandes de l’hôtel. Si vous avez besoin d’une aide immédiate, veuillez contacter directement l’hôtel.`,
    es: `Estimado/a ${name}, le pedimos sinceras disculpas porque su experiencia no estuvo a la altura de nuestros estándares. He preparado una solicitud privada de recuperación del servicio para la cola de solicitudes del hotel. Si necesita ayuda inmediata, contacte directamente con el hotel.`,
    ja: `${name}様、ご期待に沿うご滞在を提供できず、深くお詫び申し上げます。ホテルのリクエストキューに、非公開のサービス回復依頼を作成しました。お急ぎの場合は、直接ホテルへご連絡ください。`,
    de: `Sehr geehrte(r) ${name}, wir entschuldigen uns aufrichtig für diese Erfahrung. Ich habe eine private Anfrage zur Servicewiederherstellung für die Anfragewarteschlange des Hotels vorbereitet. Wenn Sie sofort Hilfe benötigen, wenden Sie sich bitte direkt an das Hotel.`,
    it: `Gentile ${name}, le porgiamo le nostre più sincere scuse. Ho preparato una richiesta privata di ripristino del servizio per la coda delle richieste dell’hotel. Per assistenza immediata, contatti direttamente l’hotel.`,
    zh: `尊敬的 ${name}，对于未能给您带来满意的入住体验，我们致以最深切的歉意。我已为酒店请求队列准备了一项私密服务恢复请求。如需即时协助，请直接联系酒店。`,
    ar: `عزيزنا ${name}، نعتذر بشدة لأن تجربتكم لم تكن بالمستوى المطلوب. لقد أعددت طلباً خاصاً لاستعادة الخدمة ضمن قائمة طلبات الفندق. إذا كنتم تحتاجون إلى مساعدة فورية، يرجى التواصل مباشرةً مع الفندق.`,
  };
  return replies[language] ?? replies.en;
}

export function guestInsistsOnExternal(message) {
  const text = String(message || '').trim().toLowerCase();
  const startsCorrection = /^(?:no|non|nope|rather|instead|actually|but)\b/i.test(text);
  const namesSpecificCuisine = CUISINES.some((cuisine) => cuisine.words.some((word) => hasTerm(text, word)));
  // A conversational correction often starts with "no", "actually", or
  // "instead". It is only an external preference when the guest names an
  // outside-the-hotel option or preserves a specific cuisine constraint;
  // otherwise history can retain the hotel context.
  return /\b(not your|not the hotel|outside the hotel|outside|external option|somewhere else|don't want to eat at the hotel|dont want to eat at the hotel|do not want to eat at the hotel|not at the hotel|local cafe|local bakery|local bakery or cafe|nearby cafe|nearby bakery|bakery or cafe|bakery|boulangerie|cafe|pastry shop|explore on my own|on my own)\b/i.test(text)
    || startsCorrection && (namesSpecificCuisine || /\b(?:keep|find|search|recommend)\b[^.!?]{0,80}\b(?:restaurant|cuisine|venue|address|place|bar|club)\b/i.test(text));
}

export function hasNegation(message) {
  const text = normalized(message);
  if (
    /\b(do not|don't|dont|not|no|never|skip|refuse|pass on|without|neither|nor)\s+(?:want|need|wish|interested in|looking for|require)?\s*(?:to\s+)?(?:book|reserve|hire|order|take|get|schedule)\b/i.test(text) ||
    /\b(?:no|not looking for|no need for|skip the|pass on the|without any)\s+(?:private\s+)?(?:tours?|chauffeurs?|taxis?|transfers?|massages?|spa|tables?|reservations?|bookings?|services?)\b/i.test(text) ||
    /\b(?:no\s+thanks?|no\s+thank\s+you|not\s+interested|not\s+for\s+me|not\s+for\s+us|on my own|on our own|explore on my own|explore on our own)\b/i.test(text)
  ) {
    return true;
  }
  return false;
}

export function classifyRequest(message) {
  const text = normalized(message);
  const hasEscalation = isEscalation(message);
  const isOperational = isOperationalRequest(message);
  const wantsExternal = guestInsistsOnExternal(message);
  const scores = new Map();
  for (const rule of CATEGORY_RULES) {
    for (const word of rule.words) {
      if (hasTerm(text, word)) scores.set(rule.category, (scores.get(rule.category) ?? 0) + 1);
    }
  }
  if (ITINERARY_WORDS.some((word) => hasTerm(text, word))) scores.set('itinerary', 1);
  const isStayPlanning = /\b(help\s+(?:me|us)\s+(?:plan|organize)|plan\s+(?:my|our|a)\s+(?:stay|weekend|trip)|organize\s+(?:my|our|a)\s+(?:stay|trip)|before\s+(?:we|i)\s+arrive|during\s+(?:my|our)\s+stay|not\s+sure\s+what\s+to\s+do)\b/i.test(text)
    || /\b(aidez[- ]moi|organiser\s+(?:mon|notre)\s+sejour|planifier\s+(?:mon|notre)\s+sejour)\b/i.test(text);
  let category = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const cuisine = CUISINES.find((item) => item.words.some((word) => hasTerm(text, word))) ?? inferOpenCuisine(message);
  if (cuisine) category = 'restaurant';
  if (isOperational) category = 'housekeeping';
  const trimmed = text.replace(/[!.?\u00a1\u00bf]+$/g, '');
  const isGreeting = GREETINGS.has(trimmed) || trimmed.length <= 2;
  const hasIntent = !isGreeting && Boolean(category || cuisine || isStayPlanning || hasEscalation || isOperational || wantsExternal || REQUEST_WORDS.some((word) => hasTerm(text, word)));
  return { category, cuisine, location: inferLocation(message), hasIntent, hasEscalation, isOperational, wantsExternal, isStayPlanning, route: isStayPlanning ? 'stay_planning' : '', rawMessage: message };
}

export function inheritConversationContext(classification, history, latestMessage) {
  if (classification.cuisine && classification.category) return classification;
  const latest = normalized(latestMessage);
  const hasRecentCatalogueContext = [...(history || [])].slice(-8).some((item) => {
    const text = normalized(item?.message || item?.content || '');
    return /\b(?:view|show|all|what)\b[^.!?]{0,48}\b(?:services?|collection|offerings?)\b/.test(text)
      || /\b(?:rooms?|dining|spa|wellness|transfers?|private experiences?)\b/.test(text) && /\b(?:explore|offer|help)\b/.test(text);
  });
  // A short reply only becomes actionable when it has a nearby conversational
  // anchor. This deliberately keeps generic wording such as "what do you
  // suggest?" out of the external-search path until we know what it refers to.
  const isContinuation = classification.hasIntent
    || /\b(pictures?|photos?|images?|show|attach|one|best|which|that|details?|more|suggest|recommend|what about|something else|another|different|yes please|not that|flight|lands?|landing|arrival|arrive|quel(?:le)?|quels?|quelle?\s+option|quoi d autre|autre chose|suggerez|recommandez|cual|cu[aá]l|que sugieres|que recomienda|otra cosa|algo mas|si por favor)\b/i.test(latest)
    || (hasRecentCatalogueContext && !classification.category && !classification.cuisine && !classification.wantsExternal);
  if (!isContinuation || GREETINGS.has(latest.replace(/[!.?\u00a1\u00bf]+$/g, ''))) return classification;
  const priorGuestMessages = [...(history || [])]
    .reverse()
    .filter((item) => item?.role === 'user' && String(item?.message || item?.content || '').trim());
  const prior = priorGuestMessages
    .map((item) => classifyRequest(item.message || item.content))
    .find((item) => item.category || item.cuisine);
  // Short confirmations such as "yes, book it" must retain any recently
  // established service category, including transport and wellness.
  if (prior?.category || prior?.cuisine) {
    // "No, something else" is a conversational refinement, not a request to
    // search outside the hotel. Keep an explicit outside-the-hotel request as
    // an external preference, but do not infer one from a vague negative.
    const vagueAlternative = /^(?:no[,\s]+)?(?:something|anything|another|different)\s+else[!.?]*$/i.test(String(latestMessage || '').trim());
    return {
      ...classification,
      category: classification.category || prior.category,
      cuisine: classification.cuisine || prior.cuisine,
      location: classification.location || prior.location,
      wantsExternal: vagueAlternative ? false : classification.wantsExternal,
      hasIntent: true,
      contextualFollowUp: true,
    };
  }

  // A follow-up after a broad hotel catalogue should remain a hotel
  // conversation even when it names no category yet (for example, "something
  // romantic"). The model receives the verified collection and can ask one
  // useful question rather than sending the guest to a web search.
  if (!hasRecentCatalogueContext) return classification;
  return {
    ...classification,
    hasIntent: true,
    wantsExternal: false,
    contextualFollowUp: true,
    contextualHotelCatalogue: true,
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
  if (!classification.hasIntent || ['greeting', 'hotel_faq', 'partner_catalog', 'stay_planning'].includes(classification.route)) return false;
  // A vague continuation of a known hotel discussion stays hotel-first. A
  // later semantic step can still use the full verified collection to answer
  // naturally, but it must not invent an unrelated external-search intent.
  if (classification.contextualFollowUp && !classification.wantsExternal) return false;
  // A semantic route can deliberately prefer current external information
  // even when a broad hotel category happens to contain a partner service.
  return Boolean(classification.externalDiscovery) || Boolean(classification.wantsExternal) || !services.length;
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

export function enforceContract(model, { language, classification, matching, excluded, externalOptions, inputMessage = '', providerFailure = '' }) {
  const isAngry = Boolean(classification?.hasEscalation);
  const operationalType = classification?.isOperational ? operationalServiceType(inputMessage || classification?.rawMessage || '') : '';
  if (isAngry) {
    return {
      reply: ESCALATION_REPLIES[language] ?? ESCALATION_REPLIES.en,
      intent: 'complaint',
      serviceType: 'escalation',
      requiresHuman: true,
      escapeHatchTriggered: true,
      requests: [{
        serviceName: 'Guest Service Recovery Request',
        source: 'partner',
        summary: 'URGENT: Guest requested manager / expressed severe dissatisfaction',
        isUpsell: false,
      }],
      externalOptionNames: [],
      recommendations: [],
    };
  }

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
    // Recommendation names, descriptions and links are supplied in the
    // structured array below. Never let the model invent an unverified venue
    // in the short conversational introduction.
    finalReply = classification.category === 'itinerary'
      ? itineraryReply(language, externalOptions)
      : externalIntro(language, externalOptions.length);
    requests = requests.filter((item) => optionNames.some((name) => normalized(item.serviceName).includes(normalized(name))));
  }

  const rawMsg = String(inputMessage || classification?.rawMessage || '').toLowerCase();
  const isSmalltalk = model?.intent === 'smalltalk' || model?.intent === 'faq' || !classification?.hasIntent;
  const isInformational = /\b(weather|temperature|forecast|rain|sunny|time|hours|open|closed|where is|direction|directions|metro|subway|bus|walking|walk|stroll)\b/i.test(rawMsg);
  const isRefusal = hasNegation(rawMsg);
  const isExplicitlyExternal = classification?.wantsExternal || guestInsistsOnExternal(rawMsg);

  const suppressPartnerSuffix = isAngry || isSmalltalk || isInformational || isRefusal || isExplicitlyExternal || classification?.isOperational || classification?.route === 'partner_catalog' || !classification?.hasIntent;

  if (!suppressPartnerSuffix && matching.length && !matching.some((service) => normalized(finalReply).includes(normalized(service.name)))) {
    const service = matching[0];
    const details = [service.price === null || service.price === '' ? '' : `EUR ${Number(service.price).toFixed(0)}`, service.duration ? `${service.duration} min` : ''].filter(Boolean).join(', ');
    const partnerSuffix = {
      en: `Partner option: ${service.name}${details ? ` (${details})` : ''}. Our team will verify availability before confirming any request.`,
      fr: `Option partenaire : ${service.name}${details ? ` (${details})` : ''}. Notre \u00e9quipe v\u00e9rifiera la disponibilit\u00e9 avant toute confirmation.`,
      es: `Opci\u00f3n asociada: ${service.name}${details ? ` (${details})` : ''}. Nuestro equipo verificar\u00e1 la disponibilidad antes de cualquier confirmaci\u00f3n.`,
      it: `Opzione partner: ${service.name}${details ? ` (${details})` : ''}. Il nostro team verificher\u00e0 la disponibilit\u00e0 prima di qualsiasi conferma.`,
      de: `Partneroption: ${service.name}${details ? ` (${details})` : ''}. Unser Team pr\u00fcft die Verf\u00fcgbarkeit vor jeder Best\u00e4tigung.`,
      ar: `\u062e\u064a\u0627\u0631 \u0634\u0631\u064a\u0643: ${service.name}${details ? ` (${details})` : ''}. \u0633\u064a\u062a\u062d\u0642\u0642 \u0641\u0631\u064a\u0642\u0646\u0627 \u0645\u0646 \u0627\u0644\u062a\u0648\u0641\u0631 \u0642\u0628\u0644 \u0623\u064a \u062a\u0623\u0643\u064a\u062f.`,
      ja: `\u30d1\u30fc\u30c8\u30ca\u30fc\u30aa\u30d7\u30b7\u30e7\u30f3: ${service.name}${details ? ` (${details})` : ''}\u3002\u78ba\u5b9a\u524d\u306b\u5f53\u30c1\u30fc\u30e0\u304c\u7a7a\u304d\u72b6\u6cc1\u3092\u78ba\u8a8d\u3057\u307e\u3059\u3002`,
      zh: `\u5408\u4f5c\u65b9\u9009\u9879\uff1a${service.name}${details ? ` (${details})` : ''}\u3002\u6211\u4eec\u7684\u56e2\u961f\u5c06\u5728\u786e\u8ba4\u524d\u6838\u5b9e\u53ef\u7528\u6027\u3002`,
    };
    const suffix = partnerSuffix[language] || partnerSuffix.en;
    finalReply = finalReply ? `${finalReply}\n\n${suffix}` : suffix;
  }

  const isDelayFallback = Boolean(providerFailure && !finalReply);
  if (isDelayFallback) {
    finalReply = 'I apologize, but I am experiencing a brief system delay and could not prepare your request. Please try again shortly or contact the front desk directly for immediate assistance.';
  }

  return {
    reply: finalReply || (DEFERRED[language] ?? DEFERRED.en),
    intent: isAngry ? 'complaint' : (classification.isOperational ? 'service_request' : (isDelayFallback ? 'service_request' : model.intent)),
    serviceType: isAngry ? 'escalation' : (operationalType || (isDelayFallback ? 'Concierge' : model.serviceType)),
    requiresHuman: isDelayFallback ? false : (isAngry || Boolean(model.requiresHuman) || Boolean(classification.cuisine) || Boolean(classification.isOperational)),
    escapeHatchTriggered: isDelayFallback ? false : (isAngry || Boolean(model.escapeHatchTriggered)),
    requests: isDelayFallback ? [] : requests.filter((item) => !excludedNames.some((name) => normalized(item.serviceName).includes(normalized(name)))),
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
- Respond in the language of the guest's CURRENT message (${input.language}) unless the guest explicitly requests another language. A saved preference may help only with an ambiguous short turn.
- Answer the exact question first. Specific hotel categories beat a generic catalogue: Dining means Dining, Rooms means Rooms, and broad planning should be a warm conversation rather than an external-search failure.
- POST-CHECKOUT REVIEWS:
  * POSITIVE FEEDBACK (e.g. loved it, great stay, 5 stars, wonderful): Thank the guest warmly and offer the simulated Google Review link (https://g.page/r/hotel-lumiere-paris/review). Do NOT create a complaint ticket.
  * NEGATIVE FEEDBACK / COMPLAINTS (e.g. noisy room, poor service, disappointment): Apologize, prepare a private service-recovery request routed to the General Manager, and offer the same neutral public review link without pressure. Do not state that a manager has received or is reviewing the request. Set requires_human: true.
- OPERATIONAL & ROOM ITEM REQUESTS: If a guest asks for a physical item to be delivered to their room (e.g., towels, water, pillows, blankets, toiletries, amenities) or reports a maintenance/housekeeping issue, prepare an operational request. Route towels, linen, cleaning and amenities to Housekeeping; route air conditioning, heating, plumbing, electrical, locks and broken equipment to Maintenance. Do not claim staff have been notified, dispatched, or have received the request. Do NOT offer hotel partner services, catalog items, or attempt to upsell for operational requests.
- CANCELLATIONS: When the guest cancels a previously requested service, acknowledge the cancellation clearly. Do not continue to offer or create the cancelled service; if another request is present in the same message, handle that new request separately.
- REFUSALS & DECLINED OFFERS: When the guest declines an offer, says no thanks, states they do not want to book a service/tour/chauffeur, or prefers to explore on their own, respect their choice immediately. NEVER create booking requests or push the declined service. Provide warm, helpful hospitality for independent exploration.
- SENTIMENT OVERRIDE: If the guest expresses frustration, anger, complaint, or requests a manager/human/reception, apologize sincerely and empathetically. NEVER offer upsells, services, or room upgrades. Set requires_human: true.
- Use only the facts, partner services, and external search results below.
- A required cuisine is absolute. Never recommend a venue unless its own listing explicitly matches that cuisine, even if it appeared earlier in the conversation.
- Partner services are preferred for leisure & hospitality inquiries. State a catalog price only when it is supplied below.
- Keep normal replies short and human. Do not dump the hotel database into a chat bubble; structured cards carry service detail where the client supports them.
- External results are non-partner suggestions. Never invent a price, rating, address, link, or availability. Keep reply_text to one or two elegant sentences; cards are rendered separately by the website.
- For a new or unusual guest request, respond to the actual need and use the verified external cards. Do not defer to staff when cards are available.
- Never state that a booking or availability is confirmed. The hotel team verifies and confirms every request. Ask at most one useful clarifying question at a time. Relationship questions must feel hospitable, never like a sales funnel; human staff retains control.

Return exactly this JSON shape:
{"reply_text":"string","language_detected":"${input.language}","intent":"faq|service_request|smalltalk|other","service_type":"Housekeeping|Maintenance|Spa & Wellness|Transport|Dining|Concierge|General Manager","requests":[{"service_name":"string|null","source":"partner|external","summary":"staff action","est_value_eur":null,"is_upsell":false}],"requires_human":true}

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
