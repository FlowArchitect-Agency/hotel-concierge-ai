import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeLlmRequest } from '../src/llm/schemas.js';
import test from 'node:test';
import { CONVERSATION_BENCHMARK } from '../evals/conversation-benchmark/benchmark.js';
import { freshCheckpoint, loadDynamicCheckpoint, persistRateLimit, saveDynamicCheckpoint } from '../evals/dynamic-conversation-judge/checkpoint.js';
import { MAX_BLUEPRINT_ATTEMPTS, nextBlueprintAfterFailure, planDynamicBlueprints, replacementBlueprint, validateBlueprint, validateBlueprintPlan, validateScenarioAgainstBlueprint } from '../evals/dynamic-conversation-judge/blueprints.js';
import { judgeIndependence, roleConfigurationMetadata, roleGatewayEnvironment, roleTimeoutMs } from '../evals/dynamic-conversation-judge/config.js';
import { GEMINI_GENERATOR_BASE_URL, GEMINI_GENERATOR_MODEL, GEMINI_GENERATOR_TIMEOUT_MS, freshGeminiQualificationCheckpoint, selectGeminiQualificationBlueprints } from '../evals/dynamic-conversation-judge/gemini-generator-qualification.js';
import { NVIDIA_GENERATOR_TIMEOUT_MS, NVIDIA_QUALIFICATION_BLUEPRINT_IDS, freshNvidiaQualificationCheckpoint, selectNvidiaQualificationBlueprints } from '../evals/dynamic-conversation-judge/nvidia-generator-qualification.js';
import { exportFailureCandidate } from '../evals/dynamic-conversation-judge/failure-export.js';
import { acceptGeneratedCandidates, assembleBlueprintScenario, dynamicBlueprintPrompt, generateDynamicBlueprint, messageSlotsForBlueprint, normaliseGeneratedScenario, testScenarioCandidate } from '../evals/dynamic-conversation-judge/generator.js';
import { JUDGE_VALIDATION_CASES, averageJudgeScore, judgeDisagreement, parseJudgeOutput, shouldDoubleJudge } from '../evals/dynamic-conversation-judge/judge.js';
import { JUDGE_DIMENSIONS, duplicateSignal, dynamicConversationText, evaluateGeneratedTraits, validateDynamicDistribution, validateDynamicScenario } from '../evals/dynamic-conversation-judge/schema.js';
import { ensureBlueprintGenerationState, runDynamicEvaluation, testDynamicScenarioSet } from '../evals/dynamic-conversation-judge/runner.js';
import { STRATIFIED_CATEGORIES, freshStratifiedDiagnosticCheckpoint, runStratifiedDiagnosticSample, selectStratifiedDiagnosticBlueprints } from '../evals/dynamic-conversation-judge/stratified-sample.js';
import { deterministicDynamicChecks, runDynamicSut } from '../evals/dynamic-conversation-judge/sut.js';

function validJudge(overrides = {}) {
  return {
    scores: Object.fromEntries(JUDGE_DIMENSIONS.map((dimension) => [dimension, 4])),
    overall_pass: true, critical_failure: false, failure_categories: [], short_rationale: 'Observed behavior satisfies the applicable constraints.', confidence: 0.9,
    ...overrides,
  };
}

function modelSlotScenario(blueprint, overrides = {}) {
  const source = testScenarioCandidate({ seed: `slots-${blueprint.blueprint_id}`, index: 1, category: blueprint.primary_category });
  return {
    ...source,
    category: blueprint.primary_category,
    language: blueprint.base_language,
    fixture_profile: blueprint.fixture_profile,
    expected_tool_behavior: {
      required: [...blueprint.expected_tool_classes],
      allowed: [...blueprint.expected_tool_classes],
      forbidden: [],
    },
    history_contents: Array.from({ length: blueprint.prior_turn_count }, (_, index) => `Model-authored slot ${index + 1} for ${blueprint.blueprint_id}.`),
    final_guest_turn: 'Model-authored final guest message.',
    ...overrides,
  };
}

test('dynamic scenario schema and required 105-scenario distribution are valid', () => {
  const scenarios = testDynamicScenarioSet();
  assert.equal(scenarios.length, 105);
  assert.ok(scenarios.every((scenario) => validateDynamicScenario(scenario).valid));
  const distribution = validateDynamicDistribution(scenarios);
  assert.equal(distribution.valid, true, JSON.stringify(distribution));
  assert.ok(distribution.metrics.long_conversations >= 10);
  assert.ok(distribution.metrics.tool_failures >= 10);
});

test('unseen duplicate detection rejects permanent and same-run copies', () => {
  const source = CONVERSATION_BENCHMARK.find((item) => item.id === 'ctx-001-no-why-returning');
  const candidate = normaliseGeneratedScenario({
    category: 'context_follow_ups', severity: 'medium', language: 'en', guest_profile: 'Test guest', hotel_context: 'Test hotel',
    conversation_history: source.conversation.slice(0, -1).map((turn) => ({ role: turn.role, content: turn.content })), final_guest_turn: source.conversation.at(-1).content,
    semantic_goal: 'Answer contextual follow-up.', constraints: [], expected_tool_behavior: { required: [], allowed: [], forbidden: [] },
    forbidden_behavior: [], critical_invariants: [], fixture_profile: 'SUCCESS', judge_dimensions: [...JUDGE_DIMENSIONS], generation_traits: ['informal'], trait_evidence: {},
  }, { seed: 'duplicate', index: 1 });
  assert.equal(duplicateSignal(candidate, [source]).duplicate, true);
  const accepted = acceptGeneratedCandidates([testScenarioCandidate({ seed: 'one', index: 1 }), testScenarioCandidate({ seed: 'one', index: 1 })], { accepted: [], permanent: [] });
  assert.equal(accepted.newlyAccepted.length, 1);
  assert.equal(accepted.rejected.length, 1);
});

test('one-blueprint generator parser normalizes a strict unseen scenario through the gateway contract', async () => {
  const blueprint = planDynamicBlueprints('gateway').find((item) => item.primary_category === 'natural_human');
  const raw = modelSlotScenario(blueprint, {
    final_guest_turn: 'bro, what can we do tonight??', generation_traits: ['typo_slang_informal'],
  });
  const result = await generateDynamicBlueprint({ GROQ_API_KEY: 'test', GROQ_MODEL: 'qwen/qwen3.6-27b' }, {
    seed: 'gateway', blueprint, startIndex: 9,
    fetchImpl: async () => Response.json({ choices: [{ message: { content: JSON.stringify({ scenario: raw }) } }] }),
  });
  assert.equal(result.status, 'success');
  assert.equal(validateDynamicScenario(result.candidate).valid, true);
  assert.equal(result.candidate.generation_blueprint_id, blueprint.blueprint_id);
  assert.deepEqual(result.candidate.generation_structural_errors || [], []);
  assert.deepEqual(result.candidate.conversation_history.map((turn) => turn.role), messageSlotsForBlueprint(blueprint).map((slot) => slot.role));
  assert.notEqual(dynamicConversationText(result.candidate), dynamicConversationText(CONVERSATION_BENCHMARK[0]));
});

test('NVIDIA generator configuration is role-scoped and permits only its 90-second evaluation timeout', () => {
  const env = {
    DYNAMIC_GENERATOR_PROVIDER: 'nvidia', DYNAMIC_GENERATOR_MODEL: 'minimaxai/minimax-m3',
    DYNAMIC_GENERATOR_TIMEOUT_MS: '90000', NVIDIA_API_KEY: 'test-only-nvidia-key',
  };
  const generator = roleGatewayEnvironment(env, 'generator');
  const sut = roleGatewayEnvironment({ ...env, DYNAMIC_SUT_PROVIDER: 'groq', DYNAMIC_SUT_MODEL: 'sut-model', GROQ_API_KEY: 'test' }, 'sut');
  assert.equal(generator.LLM_PROVIDER, 'openai-compatible');
  assert.equal(generator.LLM_BASE_URL, 'https://integrate.api.nvidia.com/v1');
  assert.equal(generator.LLM_MODEL, 'minimaxai/minimax-m3');
  assert.equal(roleTimeoutMs(env, 'generator'), NVIDIA_GENERATOR_TIMEOUT_MS);
  assert.equal(roleTimeoutMs(env, 'sut'), 30_000);
  assert.equal(sut.LLM_PROVIDER, 'groq');
  const request = normalizeLlmRequest({ purpose: 'response_generator', messages: [{ role: 'user', content: 'test' }], timeout_ms: NVIDIA_GENERATOR_TIMEOUT_MS });
  assert.equal(request.timeout_ms, NVIDIA_GENERATOR_TIMEOUT_MS);
});

test('Gemini generator configuration remains OpenAI-compatible, role-scoped, and credential-name based', () => {
  const env = {
    DYNAMIC_GENERATOR_PROVIDER: 'openai-compatible', DYNAMIC_GENERATOR_MODEL: GEMINI_GENERATOR_MODEL,
    DYNAMIC_GENERATOR_BASE_URL: GEMINI_GENERATOR_BASE_URL, DYNAMIC_GENERATOR_API_KEY_ENV: 'GEMINI_API_KEY',
    DYNAMIC_GENERATOR_TIMEOUT_MS: '90000', GEMINI_API_KEY: 'test-only-gemini-key',
    GROQ_API_KEY: 'test-only-groq-key', GROQ_MODEL: 'qwen/qwen3.6-27b',
  };
  const generator = roleGatewayEnvironment(env, 'generator');
  const sut = roleGatewayEnvironment(env, 'sut');
  assert.equal(generator.LLM_PROVIDER, 'openai-compatible');
  assert.equal(generator.LLM_MODEL, GEMINI_GENERATOR_MODEL);
  assert.equal(generator.LLM_BASE_URL, GEMINI_GENERATOR_BASE_URL);
  assert.equal(generator.LLM_API_KEY, 'test-only-gemini-key');
  assert.equal(generator.GROQ_API_KEY, 'test-only-groq-key');
  assert.equal(sut.LLM_PROVIDER, 'groq');
  assert.equal(sut.GROQ_MODEL, 'qwen/qwen3.6-27b');
  assert.equal(roleTimeoutMs(env, 'generator'), GEMINI_GENERATOR_TIMEOUT_MS);
  assert.equal(roleTimeoutMs(env, 'sut'), 30_000);
  assert.equal(normalizeLlmRequest({ purpose: 'response_generator', messages: [{ role: 'user', content: 'test' }], timeout_ms: GEMINI_GENERATOR_TIMEOUT_MS }).timeout_ms, GEMINI_GENERATOR_TIMEOUT_MS);
  assert.equal(JSON.stringify(roleConfigurationMetadata(env, 'generator')).includes('test-only-gemini-key'), false);
});

test('Gemini qualification selection is isolated, deterministic, and covers the required generator stress traits', () => {
  const selected = selectGeminiQualificationBlueprints('gemini-selection');
  assert.equal(selected.length, 10);
  assert.equal(new Set(selected.map((blueprint) => blueprint.blueprint_id)).size, 10);
  const count = (trait) => selected.filter((blueprint) => blueprint.required_traits.includes(trait)).length;
  assert.ok(count('long_conversation') >= 2);
  assert.ok(count('multi_intent') >= 2);
  assert.ok(count('multilingual_switch') >= 2);
  assert.ok(count('tool_provider_failure') >= 1);
  assert.ok(count('typo_slang_informal') >= 1);
  const checkpoint = freshGeminiQualificationCheckpoint('gemini-selection');
  assert.equal(checkpoint.calls.length, 0);
  assert.equal(checkpoint.generator_provider, 'google-gemini');
  assert.equal(checkpoint.generator_gateway, 'openai-compatible');
  assert.equal(JSON.stringify(checkpoint).includes('test-only-gemini-key'), false);
});

test('NVIDIA qualification blueprint selection is isolated, distinct, and covers the required stress traits', () => {
  const selected = selectNvidiaQualificationBlueprints('nvidia-qualification-test');
  const checkpoint = freshNvidiaQualificationCheckpoint('nvidia-qualification-test');
  assert.deepEqual(selected.map((blueprint) => blueprint.blueprint_id), NVIDIA_QUALIFICATION_BLUEPRINT_IDS);
  assert.equal(new Set(selected.map((blueprint) => blueprint.blueprint_id)).size, 10);
  assert.equal(selected.filter((blueprint) => blueprint.required_traits.includes('long_conversation')).length, 2);
  assert.equal(selected.filter((blueprint) => blueprint.required_traits.includes('multi_intent')).length, 2);
  assert.equal(selected.filter((blueprint) => blueprint.required_traits.includes('multilingual_switch')).length, 2);
  assert.equal(checkpoint.calls.length, 0);
  assert.equal(checkpoint.accepted_qualification_only.length, 0);
});

test('message slots deterministically assemble exact history counts and a separate final guest turn', () => {
  for (const count of [2, 3, 4, 5, 10, 12, 14, 16, 18]) {
    const blueprint = { blueprint_id: `slots-${count}`, prior_turn_count: count };
    const raw = modelSlotScenario({ ...blueprint, primary_category: 'hotel_facts', base_language: 'en', fixture_profile: 'SUCCESS', expected_tool_classes: [] }, {
      history_contents: Array.from({ length: count }, (_, index) => `Natural model message ${index + 1}.`),
      final_guest_turn: 'Natural model final guest message.',
    });
    const scenario = assembleBlueprintScenario(raw, { blueprint, seed: 'slots', index: count, category: 'hotel_facts', blueprintId: blueprint.blueprint_id });
    assert.equal(dynamicBlueprintPrompt({ blueprint }).includes(`exactly ${count} non-empty strings`), true);
    assert.equal(scenario.conversation_history.length, count);
    assert.deepEqual(scenario.conversation_history.map((turn) => turn.role), messageSlotsForBlueprint(blueprint).map((slot) => slot.role));
    assert.equal(scenario.final_guest_turn, 'Natural model final guest message.');
    assert.deepEqual(scenario.generator_structural_errors, []);
  }
});

test('message-slot assembly rejects missing, excess, non-string, empty, and malformed final content without repair', () => {
  const blueprint = { blueprint_id: 'slots-negative', prior_turn_count: 10 };
  const source = modelSlotScenario({ ...blueprint, primary_category: 'hotel_facts', base_language: 'en', fixture_profile: 'SUCCESS', expected_tool_classes: [] });
  const cases = [
    { change: { history_contents: source.history_contents.slice(0, -1) }, error: 'history_contents_exact_length_required' },
    { change: { history_contents: [...source.history_contents, 'Excess model message.'] }, error: 'history_contents_exact_length_required' },
    { change: { history_contents: [...source.history_contents.slice(0, 2), { text: 'not a string' }, ...source.history_contents.slice(3)] }, error: 'history_contents_non_string:3' },
    { change: { history_contents: [...source.history_contents.slice(0, 4), '   ', ...source.history_contents.slice(5)] }, error: 'history_contents_empty:5' },
    { change: { final_guest_turn: { text: 'not a string' } }, error: 'final_guest_turn_not_string' },
    { change: { final_guest_turn: undefined }, error: 'final_guest_turn_not_string' },
  ];
  for (const { change, error } of cases) {
    const scenario = assembleBlueprintScenario({ ...source, ...change }, { blueprint, seed: 'negative', index: 1, category: 'hotel_facts', blueprintId: blueprint.blueprint_id });
    assert.ok(scenario.generator_structural_errors.includes(error));
    assert.ok(validateScenarioAgainstBlueprint(scenario, { ...blueprint, primary_category: 'hotel_facts', base_language: 'en', fixture_profile: 'SUCCESS', expected_tool_classes: [], required_traits: [], required_intents: [], intent_count: 1, requires_escalation: 'none' }).errors.includes(error));
  }
});

test('acceptance traits require real transcript evidence, not category or trait labels', () => {
  const long = testScenarioCandidate({ seed: 'long', index: 1, long: true });
  assert.equal(evaluateGeneratedTraits(long, { long: true, context: true }).valid, true);
  const shortFakeLong = testScenarioCandidate({ seed: 'short', index: 2 });
  shortFakeLong.generation_traits = ['long_conversation'];
  assert.ok(evaluateGeneratedTraits(shortFakeLong, { long: true }).errors.includes('insufficient_long_context'));

  const multilingual = testScenarioCandidate({ seed: 'switch', index: 3, category: 'language', language: 'fr' });
  assert.equal(evaluateGeneratedTraits(multilingual, { multilingual: true }).valid, true);
  const metadataOnlyLanguage = testScenarioCandidate({ seed: 'metadata', index: 4 });
  metadataOnlyLanguage.category = 'language'; metadataOnlyLanguage.language = 'fr'; metadataOnlyLanguage.generation_traits = ['language_switch'];
  assert.ok(evaluateGeneratedTraits(metadataOnlyLanguage, { multilingual: true }).errors.includes('insufficient_multilingual_behavior'));

  const multi = testScenarioCandidate({ seed: 'two-goals', index: 5, category: 'multi_intent' });
  assert.equal(evaluateGeneratedTraits(multi, { multiIntent: true }).valid, true);
  const singleIntent = testScenarioCandidate({ seed: 'one-goal', index: 6 });
  singleIntent.category = 'multi_intent'; singleIntent.generation_traits = ['multi_intent']; singleIntent.trait_evidence = { independent_goals: ['bring towels'] };
  assert.ok(evaluateGeneratedTraits(singleIntent, { multiIntent: true }).errors.includes('insufficient_multi_intent'));
});

test('failure and human-like traits require relevant fixtures and actual noisy language', () => {
  const failure = testScenarioCandidate({ seed: 'failure', index: 7, fixture: 'TIMEOUT' });
  assert.equal(evaluateGeneratedTraits(failure, { toolFailure: true }).valid, true);
  const irrelevantFailure = testScenarioCandidate({ seed: 'irrelevant', index: 8 });
  irrelevantFailure.fixture_profile = 'TIMEOUT'; irrelevantFailure.trait_evidence = { fixture_relevance: { tool: 'external_search', expected_status: 'error' } };
  assert.ok(evaluateGeneratedTraits(irrelevantFailure, { toolFailure: true }).errors.includes('insufficient_tool_failure_behavior'));

  const noisy = testScenarioCandidate({ seed: 'noisy', index: 9, category: 'natural_human' });
  assert.equal(evaluateGeneratedTraits(noisy, { humanLike: true }).valid, true);
  const labelOnly = testScenarioCandidate({ seed: 'formal', index: 10 });
  labelOnly.final_guest_turn = 'Could you please suggest a calm dinner option tonight?'; labelOnly.generation_traits = ['slang'];
  assert.ok(evaluateGeneratedTraits(labelOnly, { humanLike: true }).errors.includes('insufficient_typo_slang_informal_trait'));
});

test('blueprint planner creates a deterministic, coverage-complete 105-scenario plan', () => {
  const first = planDynamicBlueprints('blueprint-seed');
  const second = planDynamicBlueprints('blueprint-seed');
  assert.equal(first.length, 105);
  assert.deepEqual(first, second);
  const plan = validateBlueprintPlan(first);
  assert.equal(plan.valid, true, JSON.stringify(plan));
  assert.equal(new Set(first.map((blueprint) => blueprint.blueprint_id)).size, 105);
  assert.ok(plan.coverage.long >= 10);
  assert.ok(plan.coverage.multilingual >= 15);
  assert.ok(plan.coverage.multi_intent >= 15);
  assert.ok(plan.coverage.contextual >= 15);
  assert.ok(plan.coverage.complaints >= 10);
  assert.ok(plan.coverage.tool_provider_failure >= 10);
  assert.ok(plan.coverage.informal >= 10);
});

test('planner rejects invalid fixture, language-switch, and multi-intent blueprint combinations', () => {
  const plan = planDynamicBlueprints('invalid-blueprints');
  const failure = plan.find((blueprint) => blueprint.required_traits.includes('tool_provider_failure'));
  const wrongFailure = { ...failure, expected_tool_classes: ['hotel_facts'] };
  assert.ok(validateBlueprint(wrongFailure).errors.includes('invalid_tool_failure_blueprint'));
  const multilingual = plan.find((blueprint) => blueprint.required_traits.includes('multilingual_switch'));
  const wrongSwitch = { ...multilingual, language_switch: { ...multilingual.language_switch, language: multilingual.base_language } };
  assert.ok(validateBlueprint(wrongSwitch).errors.includes('invalid_multilingual_blueprint'));
  const multi = plan.find((blueprint) => blueprint.required_traits.includes('multi_intent'));
  const wrongMulti = { ...multi, intent_count: 1, required_intents: ['hotel_fact'] };
  assert.ok(validateBlueprint(wrongMulti).errors.includes('invalid_multi_intent_blueprint'));
});

test('prior_turn_count means individual history messages, excludes final guest turn, and accepts the valid long shape', () => {
  const blueprint = planDynamicBlueprints('long-shape').find((item) => item.required_traits.includes('long_conversation'));
  assert.equal(blueprint.prior_turn_count % 2, 0);
  const scenario = testScenarioCandidate({ seed: 'long-shape', index: 1, long: true });
  scenario.generation_blueprint_id = blueprint.blueprint_id;
  scenario.conversation_history = scenario.conversation_history.slice(0, blueprint.prior_turn_count);
  assert.equal(scenario.conversation_history.length, blueprint.prior_turn_count);
  assert.equal(validateScenarioAgainstBlueprint(scenario, blueprint).valid, true);
  const invalidOrder = structuredClone(scenario);
  invalidOrder.conversation_history[1].role = 'user';
  assert.ok(validateScenarioAgainstBlueprint(invalidOrder, blueprint).errors.includes('non_alternating_long_context'));
});

test('context dependency is behavioral rather than metadata-only', () => {
  const contextual = testScenarioCandidate({ seed: 'context-behavior', index: 1 });
  contextual.conversation_history = [
    { role: 'user', content: 'Could the courtyard suite be quiet tomorrow?' },
    { role: 'assistant', content: 'The courtyard suite is the quieter option tomorrow.' },
  ];
  contextual.final_guest_turn = 'Could the courtyard option be thirty minutes later?';
  assert.equal(evaluateGeneratedTraits(contextual, { context: true }).valid, true);
  const metadataOnly = structuredClone(contextual);
  metadataOnly.conversation_history = [];
  metadataOnly.trait_evidence = { contextual_follow_up: 'References an earlier conversation.' };
  assert.ok(evaluateGeneratedTraits(metadataOnly, { context: true }).errors.includes('insufficient_contextual_follow_up'));
});

test('structurally perfect message slots still fail independent semantic blueprint requirements', () => {
  const plan = planDynamicBlueprints('slot-semantics');
  const assemble = (blueprint, overrides) => assembleBlueprintScenario(modelSlotScenario(blueprint, {
    history_contents: Array.from({ length: blueprint.prior_turn_count }, () => 'Please help me with a calm dinner option.'),
    final_guest_turn: 'Please explain tomorrow.',
    ...overrides,
  }), { blueprint, seed: 'slot-semantics', index: 1, category: blueprint.primary_category, blueprintId: blueprint.blueprint_id });

  const contextualBlueprint = plan.find((item) => item.required_traits.includes('long_conversation'));
  const contextual = assemble(contextualBlueprint, { final_guest_turn: 'Please explain tomorrow.' });
  assert.deepEqual(contextual.generator_structural_errors, []);
  assert.ok(validateScenarioAgainstBlueprint(contextual, contextualBlueprint).errors.includes('long_final_not_context_dependent'));

  const multiBlueprint = plan.find((item) => item.required_traits.includes('multi_intent'));
  const multi = assemble(multiBlueprint, { final_guest_turn: 'Please bring towels.', trait_evidence: { independent_goals: ['bring towels'] } });
  assert.deepEqual(multi.generator_structural_errors, []);
  assert.ok(validateScenarioAgainstBlueprint(multi, multiBlueprint).errors.includes('insufficient_multi_intent'));

  const languageBlueprint = plan.find((item) => item.required_traits.includes('multilingual_switch'));
  const language = assemble(languageBlueprint, { final_guest_turn: 'Please explain the dinner plan.', history_contents: Array.from({ length: languageBlueprint.prior_turn_count }, () => 'Please help with the dinner plan.') });
  assert.deepEqual(language.generator_structural_errors, []);
  assert.ok(validateScenarioAgainstBlueprint(language, languageBlueprint).errors.includes('insufficient_multilingual_behavior'));

  const complaintBlueprint = plan.find((item) => item.requires_escalation === 'critical');
  const complaint = assemble(complaintBlueprint, { final_guest_turn: 'Please explain the dinner plan.', critical_invariants: [] });
  assert.deepEqual(complaint.generator_structural_errors, []);
  assert.ok(validateScenarioAgainstBlueprint(complaint, complaintBlueprint).errors.includes('insufficient_complaint_escalation'));
  assert.ok(validateScenarioAgainstBlueprint(complaint, complaintBlueprint).errors.includes('blueprint_critical_escalation_missing'));

  const failureBlueprint = plan.find((item) => item.required_traits.includes('tool_provider_failure'));
  const failure = assemble(failureBlueprint, { trait_evidence: {} });
  assert.deepEqual(failure.generator_structural_errors, []);
  assert.ok(validateScenarioAgainstBlueprint(failure, failureBlueprint).errors.includes('insufficient_tool_failure_behavior'));
});

test('bounded regeneration creates a replacement that preserves coverage contribution', () => {
  const blueprint = planDynamicBlueprints('replacement').find((item) => item.required_traits.includes('long_conversation'));
  assert.equal(nextBlueprintAfterFailure(blueprint, MAX_BLUEPRINT_ATTEMPTS - 1).action, 'retry');
  const result = nextBlueprintAfterFailure(blueprint, MAX_BLUEPRINT_ATTEMPTS);
  assert.equal(result.action, 'replace');
  assert.equal(result.replacement.replacement_of, blueprint.blueprint_id);
  assert.deepEqual(result.replacement.required_traits, blueprint.required_traits);
  assert.deepEqual(result.replacement.expected_tool_classes, blueprint.expected_tool_classes);
  assert.notEqual(result.replacement.prior_turn_count, blueprint.prior_turn_count);
  assert.notDeepEqual(result.replacement.context_events, blueprint.context_events);
  const exhausted = replacementBlueprint(result.replacement, 2);
  assert.equal(nextBlueprintAfterFailure(exhausted, MAX_BLUEPRINT_ATTEMPTS).action, 'blocked');
});

test('stratified diagnostic selects ten distinct blueprint categories without touching the baseline checkpoint', () => {
  const main = freshCheckpoint({ seed: 'main-baseline', env: { GROQ_API_KEY: 'test' } });
  const before = JSON.stringify(main);
  const diagnostic = freshStratifiedDiagnosticCheckpoint('stratified');
  const selected = selectStratifiedDiagnosticBlueprints('stratified');
  assert.equal(selected.length, 10);
  assert.equal(new Set(selected.map((blueprint) => blueprint.blueprint_id)).size, 10);
  assert.deepEqual(selected.map((blueprint) => blueprint.primary_category), STRATIFIED_CATEGORIES);
  diagnostic.calls.push({ blueprint_id: selected[0].blueprint_id, result: 'REJECTED' });
  assert.equal(JSON.stringify(main), before);
});

test('stratified diagnostic checkpoints a provider 429 without touching the baseline', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'stratified-rate-test-'));
  const checkpointPath = path.join(folder, 'checkpoint.json');
  const result = await runStratifiedDiagnosticSample({ GROQ_API_KEY: 'test', GROQ_MODEL: 'qwen/qwen3.6-27b' }, {
    seed: 'stratified-rate', checkpointPath,
    fetchImpl: async () => new Response('', { status: 429, headers: { 'retry-after': '30', 'x-ratelimit-reset-requests': '1m' } }),
  });
  assert.equal(result.status, 'RATE_LIMIT_WAIT_REQUIRED');
  assert.equal(result.checkpoint.calls.length, 0);
  assert.equal(result.checkpoint.last_rate_limit.status, 429);
  assert.ok(result.checkpoint.last_rate_limit.safe_retry_at);
});

test('blueprint checkpoint migration preserves accepted scenarios and historical call accounting', () => {
  const checkpoint = freshCheckpoint({ seed: 'migration', env: { GROQ_API_KEY: 'test' } });
  const accepted = testScenarioCandidate({ seed: 'preserved', index: 1, long: true });
  checkpoint.version = 1;
  checkpoint.generation.strategy = undefined;
  checkpoint.generation.blueprints = [];
  checkpoint.generation.scenarios.push(accepted);
  checkpoint.metrics.generator_calls = 10;
  checkpoint.metrics.judge_calls = 10;
  const migrated = ensureBlueprintGenerationState(checkpoint);
  assert.equal(migrated.valid, true, JSON.stringify(migrated));
  assert.equal(checkpoint.generation.scenarios[0].id, accepted.id);
  assert.equal(checkpoint.generation.scenarios[0].generation_blueprint_id, 'bp-001');
  assert.equal(checkpoint.generation.blueprint_states['bp-001'].preserved, true);
  assert.equal(checkpoint.metrics.generator_calls, 10);
  assert.equal(checkpoint.metrics.judge_calls, 10);
});

test('generation-only sample honors its cap before generator, judge, or SUT calls', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-sample-test-'));
  const checkpointPath = path.join(folder, 'checkpoint.json');
  const result = await runDynamicEvaluation({ GROQ_API_KEY: 'test', GROQ_MODEL: 'qwen/qwen3.6-27b' }, {
    seed: 'sample-cap', checkpointPath, generationOnly: true, generationSampleId: 'sample-cap-10', maxNewGeneratorCalls: 0,
    generatorFetch: async () => { throw new Error('The capped sample must not call a provider.'); },
  });
  assert.equal(result.status, 'GENERATION_SAMPLE_COMPLETE');
  assert.equal(result.checkpoint.generation.sample.calls.length, 0);
  assert.equal(result.checkpoint.metrics.generator_calls, 0);
  assert.equal(result.checkpoint.metrics.judge_calls, 0);
  assert.equal(Object.keys(result.checkpoint.sut.results).length, 0);
});

test('judge schema, stable scoring, and borderline double-judging are enforced', () => {
  const parsed = parseJudgeOutput(JSON.stringify(validJudge()));
  assert.ok(parsed);
  assert.equal(averageJudgeScore(parsed), 4);
  assert.equal(shouldDoubleJudge({ ...parsed, confidence: 0.5 }), true);
  const second = { ...parsed, scores: Object.fromEntries(JUDGE_DIMENSIONS.map((dimension) => [dimension, 2])), overall_pass: false };
  assert.equal(judgeDisagreement(parsed, second), true);
  assert.equal(parseJudgeOutput(JSON.stringify({ ...validJudge(), scores: { relevance: 9 } })), null);
  assert.equal(JUDGE_VALIDATION_CASES.length, 10);
});

test('deterministic critical invariants take precedence over any favourable judge result', () => {
  const scenario = testScenarioCandidate({ seed: 'truth', index: 3, category: 'action_truthfulness' });
  scenario.expected_tool_behavior = { required: ['guest_request'], allowed: ['guest_request'], forbidden: ['external_search'] };
  const checks = deterministicDynamicChecks(scenario, {
    status: 200, reply: 'Your booking is confirmed and the team has been notified.', language: 'en',
    tools_requested: ['guest_request', 'external_search'], write_attempts: 1, deterministic_failures: ['fabricated_booking_confirmation'],
  });
  assert.equal(checks.passed, false);
  assert.equal(checks.critical, true);
  assert.ok(checks.failures.includes('read_only_write'));
  assert.ok(checks.failures.some((failure) => failure.startsWith('forbidden_tool:')));
});

test('checkpoint/resume records only non-secret role metadata and sanitized rate-limit state', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-eval-test-'));
  const checkpointPath = path.join(folder, 'checkpoint.json');
  const env = { GROQ_API_KEY: 'not-in-checkpoint', GROQ_MODEL: 'qwen/qwen3.6-27b' };
  const checkpoint = freshCheckpoint({ seed: 'reproducible-seed', env });
  checkpoint.generation.scenarios.push(testScenarioCandidate());
  persistRateLimit(checkpoint, { retry_after: '30', request_reset: '30s', token_reset: '1m' }, 'generator');
  saveDynamicCheckpoint(checkpointPath, checkpoint);
  const resumed = loadDynamicCheckpoint(checkpointPath, { seed: 'reproducible-seed', target: 105, env });
  assert.equal(resumed.generation.scenarios.length, 1);
  assert.equal(resumed.status, 'RATE_LIMIT_WAIT_REQUIRED');
  assert.equal(JSON.stringify(resumed).includes('not-in-checkpoint'), false);
  assert.equal(resumed.last_rate_limit.role, 'generator');
});

test('provider metadata reports judge independence honestly without credentials', () => {
  const same = { GROQ_API_KEY: 'private', GROQ_MODEL: 'qwen/qwen3.6-27b' };
  assert.equal(judgeIndependence(same), 'LIMITED — SAME MODEL');
  const metadata = roleConfigurationMetadata(same, 'judge');
  assert.equal(metadata.provider, 'groq');
  assert.equal(JSON.stringify(metadata).includes('private'), false);
});

test('failure export is review-only and can never mutate the permanent benchmark', () => {
  const scenario = testScenarioCandidate({ seed: 'export', index: 8 });
  const exported = exportFailureCandidate({ scenario, sut: { reply: 'Unhelpful response.', tools_requested: [] }, deterministic: { failures: ['missing_required_tool'] }, judge: { judgement: { overall_pass: false, critical_failure: false, failure_categories: ['relevance'], short_rationale: 'The reply missed the request.' } } });
  assert.equal(exported.status, 'candidate_requires_human_review');
  assert.match(exported.promotion_note, /human/i);
  assert.equal(exported.source_dynamic_id, scenario.id);
});

test('fixture-isolated SUT never schedules a production write', async () => {
  const scenario = normaliseGeneratedScenario({
    category: 'hotel_services', severity: 'medium', language: 'en', guest_profile: 'Guest', hotel_context: 'Hotel',
    conversation_history: [], final_guest_turn: 'Show me your rooms and suites.', semantic_goal: 'Show verified hotel room options.', constraints: [],
    expected_tool_behavior: { required: [], allowed: [], forbidden: ['guest_request'] }, forbidden_behavior: [], critical_invariants: [], fixture_profile: 'SUCCESS', judge_dimensions: [...JUDGE_DIMENSIONS], generation_traits: ['informal'], trait_evidence: {},
  }, { seed: 'readonly', index: 1 });
  const result = await runDynamicSut({ GROQ_API_KEY: 'test', GROQ_MODEL: 'qwen/qwen3.6-27b' }, scenario, {
    modelFetch: async () => { throw new Error('This deterministic hotel-first request must not call a model.'); },
  });
  assert.equal(result.status, 200);
  assert.equal(result.write_attempts, 0);
  assert.equal(result.provider_metadata.model_call_count, 0);
});
