import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySemanticPlan,
  buildSemanticControllerPrompt,
  parseSemanticControllerOutput,
  semanticFallback,
} from '../src/semantic-controller.js';

function controllerOutput(overrides = {}) {
  return JSON.stringify({
    interaction_type: 'conversation',
    guest_goal: 'continue the current conversation',
    context_summary: 'Use the immediately preceding hotel discussion.',
    service_category: null,
    reference_target: 'previous_question',
    needs_hotel_facts: false,
    needs_hotel_services: false,
    needs_external_search: false,
    needs_guest_request: false,
    needs_human: false,
    language: 'en',
    confidence: 0.9,
    clarification_needed: false,
    clarification_reason: '',
    topic_changed: false,
    ...overrides,
  });
}

test('semantic controller rejects non-controller JSON rather than granting it authority', () => {
  const fallback = parseSemanticControllerOutput('{"route":"external_discovery","category":"itinerary"}', { language: 'en' });
  assert.equal(fallback.valid, false);
  assert.equal(fallback.providerFailure, 'semantic_unavailable');
  assert.deepEqual(semanticFallback({ language: 'invalid' }).toolNeeds, {
    hotelFacts: false, hotelServices: false, externalSearch: false, guestRequest: false, humanTakeover: false,
  });
});

test('semantic controller prompt makes previous assistant context and capability boundary explicit', () => {
  const prompt = buildSemanticControllerPrompt({
    input: { message: 'No, why?', language: 'en', conversationOwner: 'ai' },
    history: [{ role: 'assistant', message: 'Is this your first time in Paris?' }],
    context: { guestContext: 'Guest returns in September.', pendingContext: 'No pending request.' },
    capabilities: ['hotel_facts', 'hotel_services', 'external_search', 'guest_request', 'human_takeover'],
  });
  assert.match(prompt, /IMMEDIATELY PREVIOUS ASSISTANT MESSAGE:[\s\S]*first time in Paris/i);
  assert.match(prompt, /AVAILABLE CAPABILITIES .*external_search/i);
  assert.match(prompt, /Do not answer the guest and do not invent facts/i);
  assert.match(prompt, /arrange, book, bring, repair, cancel, prepare/i);
});

const semanticCases = [
  ['No, why?', { reference_target: 'previous_question', interaction_type: 'conversation' }, { route: 'conversation', external: false }],
  ['Yes, why do you ask?', { reference_target: 'previous_question', interaction_type: 'conversation' }, { route: 'conversation', external: false }],
  ['Why do you ask?', { reference_target: 'previous_question', interaction_type: 'conversation' }, { route: 'conversation', external: false }],
  ["I've been here loads of times.", { reference_target: 'previous_question', interaction_type: 'conversation' }, { route: 'conversation', external: false }],
  ['What do you suggest?', { reference_target: 'previous_service', interaction_type: 'hotel_service', service_category: 'spa', needs_hotel_services: true }, { route: 'partner_request', category: 'spa', external: false }],
  ['Which one would you pick?', { reference_target: 'previous_option', interaction_type: 'hotel_service', service_category: 'restaurant', needs_hotel_services: true }, { route: 'partner_request', category: 'restaurant', external: false }],
  ['Not that one.', { reference_target: 'previous_option', interaction_type: 'hotel_service', service_category: 'spa', needs_hotel_services: true }, { route: 'partner_request', category: 'spa', external: false }],
  ['The other one.', { reference_target: 'previous_option', interaction_type: 'hotel_service', service_category: 'transport', needs_hotel_services: true }, { route: 'partner_request', category: 'transport', external: false }],
  ['Same thing tomorrow.', { reference_target: 'previous_request', interaction_type: 'booking_request', service_category: 'restaurant', needs_guest_request: true }, { route: 'partner_request', category: 'restaurant', external: false }],
  ['Please bring towels and arrange dinner.', { interaction_type: 'guest_request', service_category: 'housekeeping', additional_service_categories: ['restaurant'], needs_guest_request: true, needs_hotel_services: true }, { route: 'partner_request', category: 'housekeeping', external: false }],
  ['Actually forget that.', { reference_target: 'topic_reset', interaction_type: 'conversation', topic_changed: true }, { route: 'conversation', category: null, external: false }],
  ['My girlfriend hates tourist stuff.', { interaction_type: 'external_discovery', service_category: 'itinerary', needs_external_search: true }, { route: 'external_discovery', category: 'itinerary', external: true }],
  ['Anything quieter?', { reference_target: 'previous_service', interaction_type: 'hotel_service', service_category: 'spa', needs_hotel_services: true }, { route: 'partner_request', category: 'spa', external: false }],
  ['Something romantic.', { reference_target: 'stay_context', interaction_type: 'hotel_service', service_category: 'experience', needs_hotel_services: true }, { route: 'partner_request', category: 'experience', external: false }],
  ["I'm starving.", { interaction_type: 'hotel_service', service_category: 'restaurant', needs_hotel_services: true }, { route: 'partner_request', category: 'restaurant', external: false }],
  ['I need help.', { interaction_type: 'clarification', clarification_needed: true, clarification_reason: 'The desired kind of help is unclear.' }, { route: 'conversation', external: false }],
  ['This is unacceptable.', { interaction_type: 'complaint', needs_human: true }, { route: 'conversation', external: false, human: true }],
  ['Can somebody come upstairs?', { interaction_type: 'operational_request', service_category: 'housekeeping', needs_guest_request: true, needs_human: true }, { route: 'conversation', category: 'housekeeping', external: false, human: true }],
  ['¿Cuál escogerías?', { interaction_type: 'hotel_service', service_category: 'restaurant', reference_target: 'previous_option', needs_hotel_services: true, language: 'es' }, { route: 'partner_request', category: 'restaurant', language: 'es', external: false }],
  ['Je voudrais quelque chose de calme, svp.', { interaction_type: 'hotel_service', service_category: 'spa', needs_hotel_services: true, language: 'fr' }, { route: 'partner_request', category: 'spa', language: 'fr', external: false }],
  ['whch wun wud u pik?', { interaction_type: 'hotel_service', service_category: 'restaurant', reference_target: 'previous_option', needs_hotel_services: true }, { route: 'partner_request', category: 'restaurant', external: false }],
];

for (const [message, planOverrides, expected] of semanticCases) {
  test(`validated semantic plan preserves intent for: ${message}`, () => {
    const plan = parseSemanticControllerOutput(controllerOutput(planOverrides), { language: 'en', hint: { category: 'tour' } });
    const classification = applySemanticPlan({ category: 'tour', hasIntent: true, route: '', externalDiscovery: false }, plan);
    assert.equal(plan.valid, true);
    assert.equal(classification.route, expected.route);
    assert.equal(classification.externalDiscovery, expected.external);
    if ('category' in expected) assert.equal(classification.category, expected.category);
    if ('language' in expected) assert.equal(plan.language, expected.language);
    if (expected.human) assert.equal(plan.toolNeeds.humanTakeover, true);
  });
}
