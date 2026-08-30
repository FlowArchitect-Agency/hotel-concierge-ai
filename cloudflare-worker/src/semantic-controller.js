export const SEMANTIC_INTERACTION_TYPES = Object.freeze([
  'greeting',
  'hotel_facts',
  'hotel_catalogue',
  'hotel_service',
  'guest_request',
  'stay_planning',
  'external_discovery',
  'booking_request',
  'cancellation',
  'operational_request',
  'complaint',
  'human_takeover',
  'conversation',
  'clarification',
]);

export const SEMANTIC_SERVICE_CATEGORIES = Object.freeze([
  'accommodation', 'spa', 'restaurant', 'transport', 'tour', 'experience',
  'itinerary', 'housekeeping', 'maintenance',
]);

const SUPPORTED_LANGUAGES = new Set(['en', 'fr', 'es', 'it', 'de', 'ar', 'ja', 'zh']);
const INTERACTION_TYPES = new Set(SEMANTIC_INTERACTION_TYPES);
const SERVICE_CATEGORIES = new Set(SEMANTIC_SERVICE_CATEGORIES);
const REFERENCE_TARGETS = new Set(['none', 'previous_question', 'previous_option', 'previous_request', 'previous_service', 'stay_context', 'topic_reset']);

function stringValue(value, max = 240) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function bool(value) {
  return value === true;
}

function jsonObject(raw) {
  const text = String(raw ?? '').trim();
  const candidate = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function semanticFallback({ language = 'en', hint = {} } = {}) {
  return {
    interactionType: 'conversation',
    guestGoal: '',
    contextSummary: '',
    serviceCategory: SERVICE_CATEGORIES.has(hint.category) ? hint.category : null,
    referenceTarget: 'none',
    toolNeeds: { hotelFacts: false, hotelServices: false, externalSearch: false, guestRequest: false, humanTakeover: false },
    language: SUPPORTED_LANGUAGES.has(language) ? language : 'en',
    confidence: 0,
    clarificationNeeded: false,
    clarificationReason: '',
    topicChanged: false,
    providerFailure: 'semantic_unavailable',
    valid: false,
  };
}

// The controller owns conversational interpretation only. Every value that can
// change execution is an allowlisted enum or boolean and is validated below.
export function parseSemanticControllerOutput(raw, { language = 'en', hint = {} } = {}) {
  const parsed = jsonObject(raw);
  if (!parsed) return semanticFallback({ language, hint });

  // Do not mistake an older router response or a final-response object for a
  // controller plan. This keeps backwards-compatible provider fallbacks from
  // gaining accidental authority.
  if (!INTERACTION_TYPES.has(parsed.interaction_type)) return semanticFallback({ language, hint });

  const interactionType = parsed.interaction_type;
  const serviceCategory = SERVICE_CATEGORIES.has(parsed.service_category) ? parsed.service_category : null;
  const additionalServiceCategories = [...new Set((Array.isArray(parsed.additional_service_categories) ? parsed.additional_service_categories : [])
    .filter((value) => SERVICE_CATEGORIES.has(value) && value !== serviceCategory))].slice(0, 2);
  const referenceTarget = REFERENCE_TARGETS.has(parsed.reference_target) ? parsed.reference_target : 'none';
  const inputLanguage = SUPPORTED_LANGUAGES.has(language) ? language : 'en';
  const modelLanguage = SUPPORTED_LANGUAGES.has(parsed.language) ? parsed.language : inputLanguage;
  // The controller may identify a language switch, but it must never
  // downgrade an already-detected non-English current turn to English just
  // because its own metadata is conservative. An explicit English request is
  // normalized before this controller runs and therefore arrives as `en`.
  const requestedLanguage = inputLanguage !== 'en' && modelLanguage === 'en' ? inputLanguage : modelLanguage;
  const confidenceValue = Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : 0;
  const clarificationNeeded = bool(parsed.clarification_needed);
  const topicChanged = bool(parsed.topic_changed) || referenceTarget === 'topic_reset';

  const externalSearch = interactionType === 'external_discovery' && bool(parsed.needs_external_search) && !clarificationNeeded;
  const hotelFacts = bool(parsed.needs_hotel_facts);
  const hotelServices = bool(parsed.needs_hotel_services)
    || ['hotel_catalogue', 'hotel_service', 'booking_request'].includes(interactionType);
  const guestRequest = bool(parsed.needs_guest_request)
    || ['guest_request', 'booking_request', 'operational_request', 'cancellation'].includes(interactionType);
  const humanTakeover = bool(parsed.needs_human)
    || ['complaint', 'human_takeover'].includes(interactionType);

  return {
    interactionType,
    guestGoal: stringValue(parsed.guest_goal),
    contextSummary: stringValue(parsed.context_summary, 420),
    serviceCategory,
    serviceCategories: [serviceCategory, ...additionalServiceCategories].filter(Boolean),
    referenceTarget,
    toolNeeds: { hotelFacts, hotelServices, externalSearch, guestRequest, humanTakeover },
    language: requestedLanguage,
    confidence,
    clarificationNeeded,
    clarificationReason: clarificationNeeded ? stringValue(parsed.clarification_reason, 200) : '',
    topicChanged,
    providerFailure: '',
    valid: true,
  };
}

function historyText(history) {
  const recent = (history || []).slice(-8).map((item) => {
    const role = String(item?.role || 'guest').toLowerCase() === 'assistant' ? 'assistant' : 'guest';
    return `${role}: ${stringValue(item?.message ?? item?.content, 420)}`;
  });
  return recent.join('\n') || '(no previous conversation)';
}

function previousAssistant(history) {
  const item = [...(history || [])].reverse().find((entry) => String(entry?.role || '').toLowerCase() === 'assistant');
  return stringValue(item?.message ?? item?.content, 420) || '(none)';
}

export function buildSemanticControllerPrompt({ input, history, context = {}, capabilities = [] }) {
  const capabilityList = capabilities.filter(Boolean).join(', ') || 'none';
  const priorAssistant = previousAssistant(history);
  const guestContext = stringValue(context.guestContext || '(no additional guest/stay context)', 700);
  const pendingContext = stringValue(context.pendingContext || '(no pending action)', 500);
  const preferredLanguage = input.language || 'en';

  return `You are ConciergeFlow's semantic conversation controller for a hotel assistant. Return JSON only. Do not answer the guest and do not invent facts, services, venues, prices, availability, bookings, notifications, or tool results.

Your only job is to understand the guest's meaning in context and request conceptual capabilities. Use the recent conversation and the immediately previous assistant message before interpreting short replies, pronouns, corrections, or references. A simple “no” can answer a prior question; it is not automatically a refusal. A topic reset supersedes previous context. A single guest turn can need more than one capability: mark every required capability, and use additional_service_categories for up to two secondary hotel-service categories.

This is a compact machine contract, not a reasoning trace: return exactly one JSON object and no commentary. Keep guest_goal to 16 words, context_summary to 24 words, and clarification_reason to 12 words or fewer. Do not explain alternatives, reasoning, or ambiguity beyond those limits.

AVAILABLE CAPABILITIES (not results): ${capabilityList}
CONVERSATION OWNER: ${input.conversationOwner}
CURRENT / PREFERRED LANGUAGE: ${preferredLanguage}
GUEST & STAY CONTEXT: ${guestContext}
PENDING ACTION / REQUEST CONTEXT: ${pendingContext}
IMMEDIATELY PREVIOUS ASSISTANT MESSAGE: ${priorAssistant}

Choose interaction_type from: greeting, hotel_facts, hotel_catalogue, hotel_service, guest_request, stay_planning, external_discovery, booking_request, cancellation, operational_request, complaint, human_takeover, conversation, clarification.
Choose service_category from: accommodation, spa, restaurant, transport, tour, experience, itinerary, housekeeping, maintenance, or null.
Choose reference_target from: none, previous_question, previous_option, previous_request, previous_service, stay_context, topic_reset.

Rules:
- Use external_discovery only when current, non-hotel information is actually needed. Do not request it merely because the guest asks “what do you suggest?” after hotel services were discussed.
- Requests for things to do, places to go, or recommendations in Paris at a specific time are non-hotel discovery unless the guest explicitly asks about a named hotel service. A topic reset ends an earlier hotel-service topic; do not infer that the hotel's collection covers a new city-wide or late-night request.
- Do not choose a privileged action because of an ambiguous turn. If materially different actions remain plausible, use clarification_needed.
- Keep a named cuisine, time, place, or other constraint when the conversation contains it, unless topic_changed is true.
- A guest asking for human help or describing a serious problem can need_human, but the backend decides whether a handoff is actually created.
- When a guest asks the hotel to arrange, book, bring, repair, cancel, prepare, or otherwise take action, set needs_guest_request: true even when the same turn also needs hotel facts or hotel services. Information and action are separate capabilities; do not leave an explicit action only in guest_goal.
- Preserve the guest's language, including a contextual short follow-up after an earlier French or Spanish message.
- Use confidence between 0.70 and 0.99 for a clear contextual reference or direct goal. Use a lower confidence only with clarification_needed: true.

Return exactly:
{"interaction_type":"conversation","guest_goal":"short neutral summary","context_summary":"short summary of resolved conversational context","service_category":null,"additional_service_categories":[],"reference_target":"none","needs_hotel_facts":false,"needs_hotel_services":false,"needs_external_search":false,"needs_guest_request":false,"needs_human":false,"language":"${preferredLanguage}","confidence":0.0,"clarification_needed":false,"clarification_reason":"","topic_changed":false}

RECENT CONVERSATION:
${historyText(history)}

LATEST GUEST MESSAGE:
${input.message}`;
}

export function applySemanticPlan(classification, plan) {
  if (!plan?.valid) return { ...classification, semanticPlan: plan };
  const category = plan.topicChanged
    ? plan.serviceCategory
    : (plan.serviceCategory || classification.category || null);
  const routeByInteraction = {
    hotel_facts: 'hotel_faq',
    hotel_catalogue: 'partner_catalog',
    hotel_service: 'partner_request',
    guest_request: 'partner_request',
    booking_request: 'partner_request',
    stay_planning: 'stay_planning',
    external_discovery: 'external_discovery',
    greeting: 'greeting',
    conversation: 'conversation',
    clarification: 'conversation',
  };
  const interactionType = plan.interactionType;
  const route = routeByInteraction[interactionType] || classification.route || 'conversation';
  const externalDiscovery = Boolean(plan.toolNeeds.externalSearch && interactionType === 'external_discovery');
  const hasIntent = interactionType !== 'greeting' && interactionType !== 'conversation'
    ? true
    : Boolean(classification.hasIntent && !plan.topicChanged);

  return {
    ...classification,
    category,
    serviceCategories: plan.serviceCategories,
    hasIntent,
    route,
    externalDiscovery,
    wantsExternal: externalDiscovery,
    searchQuery: '',
    contextualFollowUp: plan.referenceTarget !== 'none',
    contextualHotelCatalogue: Boolean(plan.toolNeeds.hotelServices && !externalDiscovery && !category),
    semanticPlan: plan,
  };
}

export function semanticToolStatus(status = 'not_needed', detail = '') {
  const allowed = new Set(['not_needed', 'ready', 'success', 'unavailable', 'failed']);
  return { status: allowed.has(status) ? status : 'failed', detail: stringValue(detail, 160) };
}
