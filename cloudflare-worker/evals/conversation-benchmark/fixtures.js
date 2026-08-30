import { BENCHMARK_TOOLS } from './benchmark.js';

export const FIXTURE_NAMES = Object.freeze([
  'SUCCESS',
  'NO_RESULTS',
  'UNAVAILABLE',
  'TIMEOUT',
  'ERROR',
  'PARTIAL_SUCCESS',
  'READ_ONLY',
  'DUPLICATE',
]);

export const HOTEL_FIXTURES = Object.freeze({
  facts: Object.freeze({
    breakfast_hours: 'Breakfast timing is supplied by the verified hotel facts fixture.',
    checkout: 'Checkout timing is supplied by the verified hotel facts fixture.',
    checkin: 'Check-in timing is supplied by the verified hotel facts fixture.',
    wifi: 'Wi-Fi information is supplied by the verified hotel facts fixture.',
    parking: 'Parking information is supplied by the verified hotel facts fixture.',
    reception: 'Reception information is supplied by the verified hotel facts fixture.',
    pets_policy: 'Pet-policy information is supplied by the verified hotel facts fixture.',
    accessibility: 'Accessibility information is supplied by the verified hotel facts fixture.',
    cancellation_policy: 'Cancellation policy is supplied by the verified hotel facts fixture.',
    restaurant_hours: 'Restaurant timing is supplied by the verified hotel facts fixture.',
    spa_hours: 'Spa timing is supplied by the verified hotel facts fixture.',
    luggage_storage: 'Luggage storage information is supplied by the verified hotel facts fixture.',
    room_service: 'Room-service information is supplied by the verified hotel facts fixture.',
    late_checkout: 'Late-checkout information is supplied by the verified hotel facts fixture.',
  }),
  services: Object.freeze([
    { name: 'Lumière Junior Suite', category: 'accommodation', description: 'Verified fixture suite option.', price_eur: 680 },
    { name: 'Lumière Spa — Couples Massage', category: 'spa', description: 'Verified fixture wellness option.', price_eur: 220 },
    { name: 'Le Jardin — Chef’s Table', category: 'restaurant', description: 'Verified fixture dining option.', price_eur: 320 },
    { name: 'Private Chauffeur — CDG Transfer', category: 'transport', description: 'Verified fixture transfer option.', price_eur: 130 },
    { name: 'Private Paris Experience', category: 'experience', description: 'Verified fixture experience option.', price_eur: 560 },
  ]),
  externalResults: Object.freeze([
    { name: 'Fixture Jazz Venue', url: 'https://example.test/jazz', description: 'Synthetic verified fixture result.' },
    { name: 'Fixture Local Restaurant', url: 'https://example.test/dining', description: 'Synthetic verified fixture result.' },
  ]),
});

function statusFor(fixture, tool) {
  if (fixture === 'SUCCESS') return tool === 'guest_request' || tool === 'human_takeover' ? 'prepared' : 'success';
  if (fixture === 'READ_ONLY') return tool === 'guest_request' || tool === 'human_takeover' ? 'read_only' : 'success';
  if (fixture === 'NO_RESULTS') return tool === 'external_search' || tool === 'guest_request' ? 'no_results' : 'success';
  if (fixture === 'UNAVAILABLE' || fixture === 'TIMEOUT') return tool === 'external_search' ? 'unavailable' : 'prepared';
  if (fixture === 'ERROR') return tool === 'guest_request' || tool === 'external_search' ? 'error' : 'success';
  if (fixture === 'PARTIAL_SUCCESS') return tool === 'external_search' ? 'partial_success' : 'prepared';
  if (fixture === 'DUPLICATE') return tool === 'guest_request' || tool === 'human_takeover' ? 'duplicate' : 'success';
  return 'not_needed';
}

function replyFor(scenario) {
  const mode = scenario.action_expectations?.mode || 'read_only';
  if (scenario.requires_human) return 'I will make sure this receives the appropriate staff attention. I cannot confirm delivery or an outcome from here.';
  if (scenario.fixture === 'NO_RESULTS') return 'I do not have a verified matching result in the current information. I can help refine the request.';
  if (scenario.fixture === 'UNAVAILABLE' || scenario.fixture === 'TIMEOUT' || scenario.fixture === 'ERROR') {
    return 'The requested information or preparation is temporarily unavailable. I have not confirmed any booking, availability, or staff delivery.';
  }
  if (mode === 'read_only') return 'I can outline the appropriate next step, but this evaluation has not sent or confirmed any request.';
  return 'I can prepare the next step for hotel review; nothing is confirmed until the hotel verifies it.';
}

/**
 * A deterministic synthetic observation for expectation-engine tests. It is
 * deliberately separate from production code and never calls an external API.
 */
export function fixtureObservationFor(scenario) {
  const requested = [...scenario.required_tools];
  const statuses = Object.fromEntries(BENCHMARK_TOOLS.map((tool) => [
    tool,
    requested.includes(tool) ? statusFor(scenario.fixture, tool) : 'not_needed',
  ]));
  const facts = scenario.expected_facts.filter((fact) => !String(fact).startsWith('missing:'));
  return {
    semantic_plan: { valid: true, ...scenario.expected_semantics },
    tools_requested: requested,
    tools_executed: requested,
    tool_statuses: statuses,
    verified_facts: facts,
    reply: replyFor(scenario),
    language: scenario.expected_language,
    requires_human: Boolean(scenario.requires_human),
    write_attempts: 0,
    invalid_action_arguments_reached_write_layer: false,
    tool_results_used: true,
    fabricated_external_result: false,
    provider_metadata: {
      provider: 'fixture',
      model: 'deterministic-fixture',
      gateway: 'fixture',
      timestamp: '2026-08-30T00:00:00.000Z',
      benchmark_version: 'concierge-benchmark-v1',
      model_call_count: 0,
      latency_ms: 0,
      fallback_used: false,
      invalid_output_count: 0,
    },
  };
}
