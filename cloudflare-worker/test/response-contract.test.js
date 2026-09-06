import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildResponseContract,
  buildResponseRepairPrompt,
  contextualSafeFallback,
  responseModeForPlan,
  validateResponseAdherence,
} from '../src/response-contract.js';
import { buildPrompt } from '../src/concierge.js';

function semanticPlan(overrides = {}) {
  return {
    valid: true,
    interactionType: 'clarification',
    activeGoal: 'clarification',
    guestGoal: 'Clarify the earlier information',
    contextSummary: 'The assistant gave a verified factual statement.',
    referenceTarget: 'previous_question',
    activeConstraints: [], preferenceConstraints: [], referencedEntities: [], rejectedEntities: [], supersededGoals: [],
    locationConstraint: '', timeConstraint: '', topicReset: false,
    toolNeeds: { hotelFacts: false, hotelServices: false, externalSearch: false, guestRequest: false, humanTakeover: false },
    ...overrides,
  };
}

function contract(plan = semanticPlan(), toolResults = {}) {
  return buildResponseContract({
    semanticPlan: plan,
    history: [{ role: 'assistant', content: 'The morning meal is served according to the verified schedule.' }],
    facts: { text: 'Verified hotel facts only.' },
    toolResults,
  });
}

test('known references reject a generic restart but accept a grounded explanation', () => {
  const handoff = contract();
  assert.equal(handoff.response_mode, 'clarify_previous_statement');
  assert.ok(validateResponseAdherence({ reply: 'How may I assist you today?' }, handoff).failures.includes('resolved_reference_not_addressed'));
  assert.equal(validateResponseAdherence({ reply: 'To clarify, I was referring to the verified schedule for the morning meal.' }, handoff).passed, true);
});

test('self-reported response labels are non-authoritative and cannot reject a grounded reply', () => {
  const handoff = contract();
  const result = validateResponseAdherence({
    reply: 'To clarify, I was referring to the verified schedule for the morning meal.',
    responseMode: 'one contract mode', addressedGoal: 'different goal', addressedReference: 'previous_question',
  }, handoff);
  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
});

test('an explain-mode fallback answers the purpose of a resolved prior question', () => {
  const handoff = contract(semanticPlan({ interactionType: 'conversation', activeGoal: 'conversation', clarificationNeeded: false }));
  const reply = contextualSafeFallback(handoff, 'en');
  assert.match(reply, /why I asked/i);
  assert.equal(validateResponseAdherence({
    reply, responseMode: handoff.response_mode, addressedGoal: handoff.active_goal, addressedReference: handoff.reference_summary,
  }, handoff).passed, true);
});

test('an unresolved reference may request clarification without pretending a reference was known', () => {
  const handoff = contract(semanticPlan({ referenceTarget: 'none', contextSummary: '', clarificationNeeded: true }));
  assert.equal(handoff.response_mode, 'ask_clarifying_question');
  assert.equal(validateResponseAdherence({ reply: 'Could you tell me which part you would like me to clarify?' }, handoff).passed, true);
});

test('refined recommendations retain active constraints and do not present rejected entities as current', () => {
  const handoff = contract(semanticPlan({
    interactionType: 'external_discovery', activeGoal: 'external_discovery', referenceTarget: 'previous_option',
    activeConstraints: ['quiet'], preferenceConstraints: ['nearby'], rejectedEntities: ['Earlier Venue'],
    toolNeeds: { hotelFacts: false, hotelServices: false, externalSearch: true, guestRequest: false, humanTakeover: false },
  }));
  assert.equal(handoff.response_mode, 'refine_recommendation');
  assert.equal(validateResponseAdherence({ reply: 'I will refine the verified options for somewhere quiet and nearby, avoiding Earlier Venue.' }, handoff).passed, true);
  assert.ok(validateResponseAdherence({ reply: 'I recommend Earlier Venue.' }, handoff).failures.includes('active_constraints_not_reflected'));
});

test('superseded goals cannot be continued as the current goal', () => {
  const handoff = contract(semanticPlan({
    interactionType: 'external_discovery', activeGoal: 'external_discovery', referenceTarget: 'topic_reset',
    supersededGoals: ['spa appointment'], topicReset: true,
    toolNeeds: { hotelFacts: false, hotelServices: false, externalSearch: true, guestRequest: false, humanTakeover: false },
  }));
  assert.equal(handoff.response_mode, 'acknowledge_change');
  assert.ok(validateResponseAdherence({ reply: 'I will prepare the spa appointment now.' }, handoff).failures.includes('superseded_goal_continued'));
  assert.equal(validateResponseAdherence({ reply: 'Understood — I will leave the earlier spa appointment aside and focus on your updated request.' }, handoff).passed, true);
});

test('hotel services and external discovery receive distinct grounded response modes', () => {
  assert.equal(responseModeForPlan(semanticPlan({ interactionType: 'hotel_service', activeGoal: 'hotel_service', referenceTarget: 'none' })), 'recommend');
  assert.equal(responseModeForPlan(semanticPlan({
    interactionType: 'external_discovery', activeGoal: 'external_discovery',
    toolNeeds: { hotelFacts: false, hotelServices: false, externalSearch: true, guestRequest: false, humanTakeover: false },
  }), { external_search: { status: 'unavailable', data: null } }), 'report_tool_failure');
});

test('a failed tool cannot become a successful recommendation and has a grounded fallback', () => {
  const handoff = contract(semanticPlan({
    interactionType: 'external_discovery', activeGoal: 'external_discovery', referenceTarget: 'none',
    toolNeeds: { hotelFacts: false, hotelServices: false, externalSearch: true, guestRequest: false, humanTakeover: false },
  }), { external_search: { status: 'unavailable', data: { results: [] } } });
  assert.ok(validateResponseAdherence({ reply: 'I found a wonderful venue for you.' }, handoff).failures.includes('tool_failure_presented_as_success'));
  assert.match(contextualSafeFallback(handoff, 'en'), /unable to verify/i);
});

test('the active goal and resolved reference are explicitly bound into the response prompt', () => {
  const handoff = contract();
  const prompt = buildPrompt({
    input: { message: 'Please explain.', language: 'en' }, classification: {},
    history: [{ role: 'assistant', content: 'The morning meal is served according to the verified schedule.' }],
    services: [], externalOptions: [], facts: { hotelName: 'Test Hotel', text: 'Verified hotel facts only.' },
    semanticPlan: semanticPlan(), toolResults: {}, responseContract: handoff,
  });
  assert.match(prompt, /RESPONSE CONTRACT/i);
  assert.match(prompt, /clarify_previous_statement/i);
  assert.match(prompt, /morning meal/i);
  assert.equal(/one contract mode|short active goal|short referenced content/i.test(prompt), false);
});

test('repair prompts are contract-driven rather than tied to a historical guest phrase', () => {
  const prompt = buildResponseRepairPrompt({ contract: contract(), failures: ['resolved_reference_not_addressed'] });
  assert.match(prompt, /RESPONSE CONTRACT/i);
  assert.equal(/what\?/i.test(prompt), false);
  assert.equal(/breakfast/i.test(prompt), false);
});
