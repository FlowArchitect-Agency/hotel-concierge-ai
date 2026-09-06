import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';
import { inheritConversationContext } from '../src/concierge.js';
import { buildToolRequests } from '../src/tools/index.js';
import { evaluateReadinessScenario } from '../evals/demo-ai-readiness/assertions.js';
import { DEMO_READINESS_SCENARIOS } from '../evals/demo-ai-readiness/scenarios.js';

const origin = 'https://flowarchitect-agency.github.io';
const baseEnv = {
  GROQ_API_KEY: 'test', AIRTABLE_API_KEY: 'test', AIRTABLE_BASE_ID: 'test', SCRAPINGBEE_API_KEY: 'test',
  HOTEL_NAME: 'Hôtel Lumière Paris', HOTEL_CITY: 'Paris',
};
const services = [
  { fields: { Name: 'Le Jardin', Category: 'restaurant', Description: 'A relaxed hotel dining option.', Active: true, IsPartner: true } },
  { fields: { Name: 'Chef’s Table', Category: 'restaurant', Description: 'A formal hotel dining option.', Active: true, IsPartner: true } },
  { fields: { Name: 'Lumière Spa — Couples Massage', Category: 'spa', Description: 'A quiet treatment for two.', Active: true, IsPartner: true } },
];

function plan(overrides = {}) {
  return {
    interaction_type: 'hotel_service', guest_goal: 'Refine the active hotel option', context_summary: 'Use the immediately preceding hotel discussion.',
    active_goal: 'hotel_service', active_constraints: [], preference_constraints: [], referenced_entities: [], rejected_entities: [], superseded_goals: [], location_constraint: '', time_constraint: '',
    service_category: 'restaurant', additional_service_categories: [], reference_target: 'previous_option',
    needs_hotel_facts: false, needs_hotel_services: true, needs_external_search: false, needs_guest_request: false, needs_human: false,
    language: 'en', confidence: 0.93, clarification_needed: false, clarification_reason: '', topic_changed: false, topic_reset: false,
    ...overrides,
  };
}

async function fixtureChat({ message, history, semanticPlan, reply, responseReplies = [], responsePayloads = [], externalResults = [], testRunId = 'task13b_conversational_routing' }) {
  const originalFetch = globalThis.fetch;
  const calls = { controller: 0, response: 0, external: 0, controllerPrompt: '', responsePrompt: '', searchUrl: '' };
  let responseIndex = 0;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/Services')) return Response.json({ records: services });
    if (target.includes('/Settings')) return Response.json({ records: [] });
    if (target.includes('api.groq.com')) {
      const promptText = JSON.parse(options.body).messages?.[0]?.content || '';
      if (/semantic conversation controller/i.test(promptText)) {
        calls.controller += 1;
        calls.controllerPrompt = promptText;
        return Response.json({ choices: [{ message: { content: JSON.stringify(semanticPlan) } }] });
      }
      calls.response += 1;
      const responseReply = responseReplies[responseIndex] ?? reply;
      const responsePayload = responsePayloads[responseIndex] ?? {
        reply_text: responseReply, language_detected: 'en', intent: 'service_request', service_type: 'Concierge', requests: [], requires_human: false,
      };
      responseIndex += 1;
      calls.responsePrompt = promptText;
      return Response.json({ choices: [{ message: { content: JSON.stringify(responsePayload) } }] });
    }
    if (target.includes('app.scrapingbee.com')) {
      calls.external += 1;
      calls.searchUrl = target;
      return Response.json({ organic_results: externalResults });
    }
    throw new Error(`Unexpected fixture request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/chat', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message, sessionId: `routing_${Math.random().toString(36).slice(2)}`,
        chatHistory: history, testMode: 'read_only', testRunId,
      }),
    }), baseEnv, { waitUntil() { throw new Error('read-only routing test scheduled a write'); } });
    return { body: await response.json(), status: response.status, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('history-bearing vague references reach the controller and response generator before hotel-first cards', async () => {
  const result = await fixtureChat({
    history: [{ role: 'assistant', content: 'For dinner, the first option is Le Jardin and the second is the Chef’s Table.' }],
    message: 'Could we do the second option instead?',
    semanticPlan: plan({ referenced_entities: ['Chef’s Table'], active_constraints: ['second option'] }),
    reply: 'The Chef’s Table is the second verified dining option; I can help you explore it further.',
  });
  assert.equal(result.status, 200);
  assert.equal(result.calls.controller, 1);
  assert.equal(result.calls.response, 1);
  assert.match(result.calls.controllerPrompt, /second option/i);
  assert.match(result.body.reply, /Chef’s Table/i);
  assert.ok(result.body.partner_offers.some((item) => item.name === 'Chef’s Table'));
});

test('rejected verified hotel options are not re-rendered merely because their category remains active', async () => {
  const result = await fixtureChat({
    history: [{ role: 'assistant', content: 'Le Jardin is one of our hotel dining options.' }],
    message: 'Not Le Jardin — what is more casual?',
    semanticPlan: plan({
      active_constraints: ['casual'], preference_constraints: ['less formal'], referenced_entities: ['Le Jardin'], rejected_entities: ['Le Jardin'],
    }),
    reply: 'For a more casual direction, I would avoid Le Jardin and focus on the other verified dining option.',
  });
  assert.equal(result.calls.controller, 1);
  assert.equal(result.calls.response, 1);
  assert.equal(result.body.partner_offers.some((item) => item.name === 'Le Jardin'), false);
  assert.equal(result.body.partner_offers.some((item) => item.name === 'Chef’s Table'), true);
});

test('active constraints and referenced entities survive bounded tool planning into the response-generator contract', async () => {
  const semanticPlan = plan({
    interaction_type: 'external_discovery', active_goal: 'external_discovery', reference_target: 'previous_option',
    active_constraints: ['smaller', 'casual'], preference_constraints: ['nearby'], referenced_entities: ['Fixture Jazz Venue'], rejected_entities: ['Fixture Jazz Venue'],
    location_constraint: 'Saint-Germain', time_constraint: 'tonight', service_category: 'experience',
    needs_hotel_services: false, needs_external_search: true,
  });
  const requests = buildToolRequests({ plan: {
    interactionType: semanticPlan.interaction_type, activeConstraints: semanticPlan.active_constraints, preferenceConstraints: semanticPlan.preference_constraints,
    locationConstraint: semanticPlan.location_constraint, timeConstraint: semanticPlan.time_constraint, serviceCategory: semanticPlan.service_category,
    toolNeeds: { externalSearch: true },
  }, classification: {}, input: { message: 'No, not that one.', language: 'en' } });
  assert.match(requests[0].input.query, /smaller/i);
  assert.match(requests[0].input.query, /nearby/i);
  assert.equal(requests[0].input.location, 'Saint-Germain');

  const result = await fixtureChat({
    history: [{ role: 'assistant', content: 'Fixture Jazz Venue is one verified result for tonight.' }],
    message: 'No, not that one. Something smaller nearby.', semanticPlan,
    reply: 'I will look for a smaller nearby alternative rather than repeat that venue.',
    externalResults: [{ title: 'Small Jazz Club Paris', description: 'An intimate live jazz club in Saint-Germain.', url: 'https://small-jazz.example/paris' }],
  });
  assert.equal(result.calls.external, 1);
  assert.equal(result.calls.response, 1);
  assert.match(result.calls.responsePrompt, /ACTIVE CONVERSATIONAL STATE/i);
  assert.match(result.calls.responsePrompt, /Fixture Jazz Venue/i);
  assert.match(result.calls.responsePrompt, /smaller/i);
});

test('semantic context inheritance no longer assigns a category or route before the controller', () => {
  const result = inheritConversationContext({ category: null, cuisine: null, route: '', hasIntent: false }, [
    { role: 'assistant', content: 'Our spa has a couples massage and a hammam ritual.' },
  ], 'The other one.');
  assert.equal(result.category, null);
  assert.equal(result.route, '');
  assert.equal(result.contextualFollowUp, undefined);
  assert.equal(result.hasConversationHistory, true);
});

test('readiness evaluator accepts equivalent references, contextual clarification, and superseded history correctly', () => {
  const ctx06 = DEMO_READINESS_SCENARIOS.find((item) => item.id === 'dar-ctx-06');
  const equivalent = evaluateReadinessScenario(ctx06, {
    status: 200, reply: 'For a rainy afternoon, I can help explore another hotel experience.', language: 'en', requires_human: false,
    semantic_plan: { valid: true, interaction_type: 'hotel_service', reference_target: 'previous_option', guest_goal: 'Explore rainy afternoon options', context_summary: 'Hotel collection was discussed.', active_goal: 'hotel_service', service_category: 'experience', service_categories: ['experience'] },
    tools_requested: ['hotel_services'], tools_executed: ['hotel_services'], tool_statuses: { hotel_services: 'success' }, write_attempts: 0, deterministic_failures: [],
  });
  assert.equal(equivalent.passed, true);

  const ctx07 = DEMO_READINESS_SCENARIOS.find((item) => item.id === 'dar-ctx-07');
  const clarification = evaluateReadinessScenario(ctx07, {
    status: 200, reply: 'Would you like another intimate jazz bar, or a quieter cocktail setting?', language: 'en', requires_human: false,
    semantic_plan: { valid: true, interaction_type: 'clarification', reference_target: 'previous_option', guest_goal: 'Clarify alternative venue preference', context_summary: 'The earlier venue is already visited.', active_goal: 'clarification', service_category: 'experience', service_categories: ['experience'], clarification_needed: true },
    tools_requested: [], tools_executed: [], tool_statuses: {}, write_attempts: 0, deterministic_failures: [],
  });
  assert.equal(clarification.passed, true);

  const chg02 = DEMO_READINESS_SCENARIOS.find((item) => item.id === 'dar-chg-02');
  const reset = evaluateReadinessScenario(chg02, {
    status: 200, reply: 'For this afternoon outside the hotel, I can help with a few ideas.', language: 'en', requires_human: false,
    semantic_plan: { valid: true, interaction_type: 'external_discovery', reference_target: 'topic_reset', guest_goal: 'Find outside afternoon ideas', context_summary: 'The earlier spa discussion was abandoned.', active_goal: 'external_discovery', active_constraints: ['outside', 'afternoon'], superseded_goals: ['spa massage'], service_category: 'experience', service_categories: ['experience'] },
    tools_requested: ['external_search'], tools_executed: ['external_search'], tool_statuses: { external_search: 'success' }, write_attempts: 0, deterministic_failures: [],
  });
  assert.equal(reset.passed, true);
});

test('a known resolved reference gets one corrective response rather than a generic restart', async () => {
  const result = await fixtureChat({
    history: [{ role: 'assistant', content: 'Breakfast is served from the verified hotel schedule.' }],
    message: 'Could you clarify?',
    semanticPlan: plan({
      interaction_type: 'clarification', active_goal: 'clarification', guest_goal: 'Clarify the breakfast statement',
      context_summary: 'Assistant stated breakfast timing; guest needs clarification.', service_category: null,
      reference_target: 'previous_question', needs_hotel_services: false, clarification_needed: true,
    }),
    responseReplies: [
      'I apologize if that was unclear. How may I assist you today?',
      'To clarify, I was referring to the breakfast schedule I mentioned.',
    ],
  });
  assert.equal(result.calls.controller, 1);
  assert.equal(result.calls.response, 2);
  assert.match(result.body.reply, /breakfast/i);
  assert.equal(result.body.observability.response_repair_used, true);
  assert.equal(result.body.observability.contextual_response_fallback_used, false);
});

test('evaluation-only observability retains non-authoritative metadata without triggering repair or exposing hidden reasoning', async () => {
  const result = await fixtureChat({
    history: [{ role: 'assistant', content: 'Breakfast is served from the verified hotel schedule.' }],
    message: 'Could you clarify?',
    semanticPlan: plan({
      interaction_type: 'clarification', active_goal: 'clarification', guest_goal: 'Clarify the breakfast statement',
      context_summary: 'Assistant stated breakfast timing; guest needs clarification.', service_category: null,
      reference_target: 'previous_question', needs_hotel_services: false, clarification_needed: true,
    }),
    responsePayloads: [
      {
        reply_text: 'To clarify, I was referring to the breakfast schedule I mentioned.', language_detected: 'en', intent: 'faq', service_type: 'Concierge', requests: [], requires_human: false,
        response_mode: 'recommend', addressed_goal: 'clarification', addressed_reference: 'breakfast schedule',
        reasoning: 'This hidden field and gsk_exampleSecret must never be retained.',
      },
      {
        reply_text: 'To clarify, I was referring to the breakfast schedule I mentioned.', language_detected: 'en', intent: 'faq', service_type: 'Concierge', requests: [], requires_human: false,
        response_mode: 'clarify_previous_statement', addressed_goal: 'clarification', addressed_reference: 'breakfast schedule',
      },
    ],
  });
  const pipeline = result.body.observability.response_pipeline;
  assert.equal(result.calls.response, 1);
  assert.equal(pipeline.attempts.length, 1);
  assert.equal(pipeline.attempts[0].adherence_result, 'PASS');
  assert.deepEqual(pipeline.attempts[0].failure_codes, []);
  assert.equal(pipeline.attempts[0].response_mode, 'recommend');
  assert.equal(pipeline.final_response_source, 'INITIAL_MODEL');
  assert.equal(pipeline.initial_rejected, false);
  assert.equal(pipeline.repair_rejected, null);
  assert.equal(pipeline.repair_input, null);
  assert.match(pipeline.response_contract.reference_summary, /breakfast/i);
  assert.equal(JSON.stringify(pipeline).includes('reasoning'), false);
  assert.equal(JSON.stringify(pipeline).includes('gsk_exampleSecret'), false);
});

test('two non-adherent replies use the contextual safe fallback without a third response attempt', async () => {
  const result = await fixtureChat({
    history: [{ role: 'assistant', content: 'The breakfast schedule is included in the verified hotel information.' }],
    message: 'Could you explain?',
    semanticPlan: plan({
      interaction_type: 'clarification', active_goal: 'clarification', guest_goal: 'Clarify the breakfast statement',
      context_summary: 'Assistant stated breakfast timing; guest needs clarification.', service_category: null,
      reference_target: 'previous_question', needs_hotel_services: false, clarification_needed: true,
    }),
    responseReplies: [
      'I am happy to help whenever you are ready.',
      'Please let me know how I can help.',
    ],
  });
  assert.equal(result.calls.response, 2);
  assert.match(result.body.reply, /breakfast/i);
  assert.equal(result.body.observability.contextual_response_fallback_used, true);
  assert.equal(result.body.observability.response_pipeline.final_response_source, 'CONTEXTUAL_SAFE_FALLBACK');
  assert.equal(result.body.observability.response_pipeline.initial_rejected, true);
  assert.equal(result.body.observability.response_pipeline.repair_rejected, true);
  assert.ok(result.body.observability.response_pipeline.attempts[0].failure_codes.includes('resolved_reference_not_addressed'));
});

test('non-Task-13 requests do not expose response-pipeline diagnostics', async () => {
  const result = await fixtureChat({
    history: [], message: 'What services do you offer?', semanticPlan: plan({ reference_target: 'none' }),
    reply: 'I can help you explore the verified hotel services.', testRunId: 'ordinary_read_only_test',
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.observability, undefined);
});

test('a contextual affirmative cannot become a booking when the semantic plan did not request an action', async () => {
  const result = await fixtureChat({
    history: [{ role: 'assistant', content: 'Our verified spa collection includes a couples massage and a hammam ritual.' }],
    message: 'Yes please.',
    semanticPlan: plan({
      interaction_type: 'hotel_service', active_goal: 'hotel_service', service_category: 'spa', reference_target: 'previous_service',
      needs_hotel_services: true, needs_guest_request: false, guest_goal: 'Continue exploring the spa collection',
    }),
    reply: 'Of course — here are the verified spa options to explore.',
  });
  assert.equal(result.body.requests.length, 0);
  assert.ok(result.body.partner_offers.some((item) => item.category === 'spa'));
});
