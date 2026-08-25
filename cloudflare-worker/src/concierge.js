const CATEGORY_RULES = [
  { category: 'accommodation', words: ['hotel room', 'hotel rooms', 'room booking', 'book a room', 'reserve a room', 'reserve in your hotel', 'book your hotel', 'hotel stay', 'stay at your hotel', 'overnight stay', 'accommodation', 'suite', 'suites', 'guest room', 'guest rooms', 'rooms', 'room', 'nights', 'night', 'chambre', 'chambres', 'habitacion', 'habitaciones', 'habitation', 'camera', 'zimmer', 'check-in', 'check in', 'check-out', 'check out'] },
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
const CUISINE_FILLER_WORDS = new Set(['i', 'im', 'am', 'looking', 'for', 'a', 'an', 'the', 'some', 'any', 'find', 'need', 'want', 'would', 'like', 'to', 'book', 'reserve', 'reservation', 'fancy', 'best', 'top', 'good', 'great', 'nice', 'authentic', 'excellent', 'your', 'our', 'hotel', 'table', 'restaurant', 'restaurants', 'restaurante', 'restaurantes', 'ristorante', 'ristoranti', 'cuisine', 'food', 'dining', 'place', 'places', 'near', 'close', 'around', 'by', 'in', 'at', 'please', 'show', 'me', 'one', 'only', 'just', 'of', 'is', 'that', 'this', 'with', 'and', 'or']);

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

export function inferLanguage(message) {
  const requested = requestedResponseLanguage(message);
  if (requested) return requested;
  const text = normalized(message);
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  if (/\b(hallo|wie geht|ihnen|bitte|danke|guten tag)\b/.test(text)) return 'de';
  if (/\b(ciao|avete|disponibilita|cena|stasera|vorrei|prenotare)\b/.test(text)) return 'it';
  if (/\b(hola|necesito|aeropuerto|manana|quiero|reserva|gracias|por favor)\b/.test(text)) return 'es';
  if (/\b(quel|prix|demain|bonjour|voudrais|reserver)\b/.test(text)) return 'fr';
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
  const language = requestedLanguage || (detectedLanguage !== 'en' || hasExplicitEnglishSignal(message)
    ? detectedLanguage
    : (SUPPORTED_REPLY_LANGUAGES.has(preferredLanguage) ? preferredLanguage : detectedLanguage));
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
    receivedAt: new Date().toISOString(),
  };
}

const ESCALATION_TERMS = [
  'manager', 'director', 'general manager', 'gm', 'front desk', 'reception', 'receptionist', 'duty manager',
  'human', 'person', 'real person', 'agent', 'representative', 'talk to someone', 'speak to someone', 'speak with someone', 'talk with someone',
  'angry', 'furious', 'upset', 'terrible', 'horrible', 'awful', 'unacceptable', 'disaster', 'disgusted',
  'complaint', 'complain', 'complaining', 'refund', 'dirty', 'broken', 'scam', 'ridiculous', 'worst',
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
  en: 'I sincerely apologize for the frustration and inconvenience caused. I have flagged your situation with highest urgency for our Front Desk Duty Manager, who is stepping in immediately to assist you directly.',
  fr: 'Je vous présente toutes mes excuses pour ce désagrément. J’ai immédiatement alerté notre responsable de réception de garde, qui prend personnellement en charge votre situation pour intervenir sans délai.',
  es: 'Le pido sinceras disculpas por los inconvenientes. He informado de inmediato a nuestro Responsable de Recepción de guardia, quien atenderá su situación personalmente de forma prioritaria.',
  de: 'Ich entschuldige mich aufrichtig für die Unannehmlichkeiten. Ich habe unser Management-Team umgehend verständigt, damit sich sofort persönlich um Ihr Anliegen gekümmert wird.',
  it: 'Le porgo le mie più sincere scuse per il disagio. Ho immediatamente allertato il nostro Duty Manager della reception, che interverrà di persona per assisterla senza indugio.',
  ja: 'ご不便とご不快な思いをおかけし、心より深くお詫び申し上げます。ただちにフロント統括責任者へ緊急連絡いたしました。担当マネージャーが直接引き継ぎ、最優先で対応いたします。',
  zh: '对于给您带来的不便与困扰，我致以最真诚的歉意。我已为您将此情况直接转达给值班大堂经理，经理将立即亲自跟进并为您妥善处理。',
  ar: 'أعتذر بشدة عن الإزعاج والاستياء الذي واجهتموه. لقد قمت على الفور بإبلاغ مدير الاستقبال المناوب الذي سيتدخل شخصياً لمساعدتكم ومعالجة الأمر دون تأخير.',
};

export function detectMediaBrochure(message, category = null) {
  const text = normalized(message);
  const asksForBrochure = /\b(menu|carte|brochure|pdf|catalog|catalogue|treatments?|pricing|tarifs?|tarifs|services list|list of services|carte des soins|soins|massages?)\b/i.test(text);
  const isSpa = category === 'spa' || /\b(spa|massage|sauna|hammam|wellness|facial|soin)\b/i.test(text);
  const isDining = category === 'restaurant' || /\b(dinner|lunch|breakfast|food|carte|dining|restaurant|wine|cocktail|room service)\b/i.test(text);
  const isRooms = category === 'accommodation' || /\b(room|suite|chambre|habitacion|stay)\b/i.test(text);

  if (asksForBrochure || isSpa) {
    if (isSpa) {
      return {
        type: 'document',
        format: 'PDF',
        title: 'Hôtel Lumière — Spa & Wellness Brochure',
        filename: 'Lumiere_Spa_Wellness_Menu.pdf',
        size: '2.4 MB',
        pages: '12 pages',
        url: 'https://flowarchitect-agency.github.io/hotel-concierge-ai/Lumiere_Spa_Wellness_Menu.pdf',
        thumbnail: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=700&q=84',
      };
    }
    if (isDining) {
      return {
        type: 'document',
        format: 'PDF',
        title: 'Le Jardin Lumière — Carte des Saisons & Dining',
        filename: 'Le_Jardin_Lumiere_Menu.pdf',
        size: '1.8 MB',
        pages: '8 pages',
        url: 'https://flowarchitect-agency.github.io/hotel-concierge-ai/assets/brochures/dining-menu.pdf',
        thumbnail: 'https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?auto=format&fit=crop&w=700&q=84',
      };
    }
    if (isRooms) {
      return {
        type: 'document',
        format: 'PDF',
        title: 'Hôtel Lumière — Suites & Rooms Collection',
        filename: 'Lumiere_Suites_Collection.pdf',
        size: '3.1 MB',
        pages: '16 pages',
        url: 'https://flowarchitect-agency.github.io/hotel-concierge-ai/assets/brochures/suites-collection.pdf',
        thumbnail: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=700&q=84',
      };
    }
  }
  return null;
}

const OPERATIONAL_TERMS = [
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
  'air conditioning', 'ac', 'aircon', 'a/c', 'heating', 'heater', 'climatisation', 'clim', 'chauffage', 'aire acondicionado', 'calefaccion', 'エアコン',
  'leak', 'leaking', 'clogged', 'light bulb', 'bulb', 'tv remote', 'key card', 'door lock', 'safe', 'plumbing', 'maintenance',
  'en panne', 'ne marche pas', 'fuite', 'bouche', 'ampoule', 'telecommande', 'carte cle', 'serrure',
  'no funciona', 'fuga', 'atascado', 'bombilla', 'mando', 'tarjeta', 'cerradura',
  'luggage', 'bags', 'baggage', 'valise', 'valises', 'bagages', 'maleta', 'maletas', '荷物'
];

export function isOperationalRequest(message) {
  const text = normalized(message);
  const isTransport = /\b(transfer|shuttle|airport|aeroport|cdg|orly|flight|vol|landed|atterri|taxi|uber|mercedes|chauffeur)\b/i.test(text);
  if (isTransport) return false;
  return OPERATIONAL_TERMS.some((term) => hasTerm(text, term));
}

export const OPERATIONAL_REPLIES = {
  en: 'I have logged your request and notified our team to deliver this to your room promptly.',
  fr: 'J’ai bien pris note de votre demande et alerté notre équipe d’étage pour vous apporter cela en chambre dans les plus brefs délais.',
  es: 'He registrado su solicitud y avisado a nuestro equipo para que se lo lleve a su habitación a la mayor brevedad.',
  de: 'Ich habe Ihre Anfrage erfasst und unser Team verständigt, dies umgehend auf Ihr Zimmer zu bringen.',
  it: 'Ho registrato la sua richiesta e informato il nostro personale affinché venga recapitata rapidamente in camera.',
  ja: 'ご依頼を承りました。担当スタッフへ手配し、速やかにお部屋へお届けいたします。',
  zh: '已收到您的客房需求，我已通知客房服务团队为您尽快送至房间。',
  ar: 'تم تسجيل طلبكم وإبلاغ فريق الخدمة لتوصيله إلى غرفتكم في أقرب وقت ممكن.',
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
    en: `Dear ${name}, we sincerely apologize that your experience fell short of our high standards. Your feedback has been immediately escalated to our General Manager, who is reviewing this matter privately to make things right.`,
    fr: `Cher/Chère ${name}, nous vous présentons nos excuses les plus sincères pour cette expérience qui ne reflète pas nos standards d'excellence. Votre retour a été directement transmis à notre Directeur Général pour un suivi privé immédiat.`,
    es: `Estimado/a ${name}, le pedimos sinceras disculpas porque su experiencia no estuvo a la altura de nuestros estándares. Sus comentarios han sido remitidos directamente a nuestro Director General para una atención privada prioritaria.`,
    ja: `${name}様、ご期待に沿うご滞在を提供できず、深くお詫び申し上げます。いただいたご指摘は直ちに総支配人へ共有し、改善と個別対応に向けて確認を進めております。`,
    de: `Sehr geehrte(r) ${name}, wir entschuldigen uns aufrichtig für diese Erfahrung. Ihr Feedback wurde direkt an unseren General Manager weitergeleitet, um den Sachverhalt persönlich zu klären.`,
    it: `Gentile ${name}, le porgiamo le nostre più sincere scuse. La sua segnalazione è stata trasmessa direttamente al nostro Direttore Generale per una gestione privata prioritaria.`,
    zh: `尊敬的 ${name}，对于未能给您带来满意的入住体验，我们致以最深切的歉意。您的反馈已直接呈报给酒店总经理，总经理将亲自跟进处理。`,
    ar: `عزيزنا ${name}، نعتذر بشدة لأن تجربتكم لم تكن بالمستوى المطلوب. لقد تم رفع ملاحظاتكم مباشرة إلى المدير العام لمراجعتها والتعامل معها باهتمام بالغ.`,
  };
  return replies[language] ?? replies.en;
}

export function classifyRequest(message) {
  const text = normalized(message);
  const hasEscalation = isEscalation(message);
  const isOperational = isOperationalRequest(message);
  const scores = new Map();
  for (const rule of CATEGORY_RULES) {
    for (const word of rule.words) {
      if (hasTerm(text, word)) scores.set(rule.category, (scores.get(rule.category) ?? 0) + 1);
    }
  }
  if (ITINERARY_WORDS.some((word) => hasTerm(text, word))) scores.set('itinerary', 1);
  let category = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const cuisine = CUISINES.find((item) => item.words.some((word) => hasTerm(text, word))) ?? inferOpenCuisine(message);
  if (cuisine) category = 'restaurant';
  if (isOperational) category = 'housekeeping';
  const trimmed = text.replace(/[!.?\u00a1\u00bf]+$/g, '');
  const isGreeting = GREETINGS.has(trimmed) || trimmed.length <= 2;
  const hasIntent = !isGreeting && Boolean(category || cuisine || hasEscalation || isOperational || REQUEST_WORDS.some((word) => hasTerm(text, word)));
  return { category, cuisine, location: inferLocation(message), hasIntent, hasEscalation, isOperational };
}

export function inheritConversationContext(classification, history, latestMessage) {
  if (classification.cuisine && classification.category) return classification;
  const latest = normalized(latestMessage);
  const isContinuation = classification.hasIntent || /\b(pictures?|photos?|images?|show|attach|one|best|which|that|details?|more)\b/i.test(latest);
  if (!isContinuation || GREETINGS.has(latest.replace(/[!.?\u00a1\u00bf]+$/g, ''))) return classification;
  const previousGuestMessage = [...(history || [])].reverse().find((item) => item?.role === 'user' && item?.message);
  if (!previousGuestMessage) return classification;
  const prior = classifyRequest(previousGuestMessage.message);
  // Short confirmations such as "yes, book it" must retain any recently
  // established service category, including transport and wellness.
  if (!prior.category && !prior.cuisine) return classification;
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
  const isAngry = Boolean(classification?.hasEscalation);
  if (isAngry) {
    return {
      reply: ESCALATION_REPLIES[language] ?? ESCALATION_REPLIES.en,
      intent: 'complaint',
      serviceType: 'escalation',
      requiresHuman: true,
      escapeHatchTriggered: true,
      requests: [{
        serviceName: 'Duty Manager Escalation',
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

  if (!isAngry && !classification.isOperational && classification.route !== 'partner_catalog' && classification.hasIntent && matching.length && !matching.some((service) => normalized(finalReply).includes(normalized(service.name)))) {
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

  return {
    reply: finalReply || (DEFERRED[language] ?? DEFERRED.en),
    intent: isAngry ? 'complaint' : (classification.isOperational ? 'service_request' : model.intent),
    serviceType: isAngry ? 'escalation' : (classification.isOperational ? 'housekeeping' : model.serviceType),
    requiresHuman: isAngry || Boolean(model.requiresHuman) || Boolean(classification.cuisine) || Boolean(classification.isOperational),
    escapeHatchTriggered: isAngry || Boolean(model.escapeHatchTriggered),
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
- Reply entirely in the guest's latest-message language (${input.language}).
- POST-CHECKOUT REVIEWS:
  * POSITIVE FEEDBACK (e.g. loved it, great stay, 5 stars, wonderful): Thank the guest warmly and provide the simulated Google Review link (https://g.page/r/hotel-lumiere-paris/review). Do NOT create a complaint ticket.
  * NEGATIVE FEEDBACK / COMPLAINTS (e.g. noisy room, poor service, disappointment): Apologize profusely and assure the guest that the General Manager is reviewing their feedback privately. You MUST NOT provide any public review link. Create an operational staff request routed to the General Manager for private service recovery. Set requires_human: true.
- OPERATIONAL & ROOM ITEM REQUESTS: If a guest asks for a physical item to be delivered to their room (e.g., towels, water, pillows, blankets, toiletries, amenities) or reports a maintenance/housekeeping issue, you MUST acknowledge the delivery to their room and trigger an operational request for staff. Do NOT offer hotel partner services, catalog items, or attempt to upsell for operational requests.
- CANCELLATIONS: When the guest cancels a previously requested service, acknowledge the cancellation clearly. Do not continue to offer or create the cancelled service; if another request is present in the same message, handle that new request separately.
- REFUSALS & DECLINED OFFERS: When the guest declines an offer, says no thanks, states they do not want to book a service/tour/chauffeur, or prefers to explore on their own, respect their choice immediately. NEVER create booking requests or push the declined service. Provide warm, helpful hospitality for independent exploration.
- SENTIMENT OVERRIDE: If the guest expresses frustration, anger, complaint, or requests a manager/human/reception, apologize sincerely and empathetically. NEVER offer upsells, services, or room upgrades. Set requires_human: true.
- Use only the facts, partner services, and external search results below.
- A required cuisine is absolute. Never recommend a venue unless its own listing explicitly matches that cuisine, even if it appeared earlier in the conversation.
- Partner services are preferred for leisure & hospitality inquiries. State a catalog price only when it is supplied below.
- Full-catalogue, services, and spa-menu requests are rendered by the Worker as a text-only catalogue. Never create option, card, button, or booking-choice data for those requests.
- External results are non-partner suggestions. Never invent a price, rating, address, link, or availability. Keep reply_text to one or two elegant sentences; cards are rendered separately by the website.
- For a new or unusual guest request, respond to the actual need and use the verified external cards. Do not defer to staff when cards are available.
- Never state that a booking or availability is confirmed. The hotel team verifies and confirms every request.

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
