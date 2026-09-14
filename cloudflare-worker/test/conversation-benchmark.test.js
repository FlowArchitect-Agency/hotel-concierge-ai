import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BENCHMARK_CATEGORIES,
  BENCHMARK_THRESHOLDS,
  BENCHMARK_VERSION,
  CONVERSATION_BENCHMARK,
} from '../evals/conversation-benchmark/benchmark.js';
import { FIXTURE_NAMES, fixtureObservationFor } from '../evals/conversation-benchmark/fixtures.js';
import {
  buildReport,
  categoryCounts,
  evaluateScenario,
  validateBenchmark,
} from '../evals/conversation-benchmark/expectations.js';
import { runFixtureBenchmark } from '../evals/conversation-benchmark/runner.js';

test('conversation benchmark is versioned, structurally valid, and has the required coverage', () => {
  const result = validateBenchmark(CONVERSATION_BENCHMARK);
  assert.equal(BENCHMARK_VERSION, 'concierge-benchmark-v1');
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.ok(result.total >= 180);
  assert.ok(result.long_conversations >= 10);
  assert.ok(result.critical_scenarios >= 10);
  for (const category of BENCHMARK_CATEGORIES) assert.ok(result.category_counts[category] > 0, `missing ${category}`);
});

test('category minima, long conversation shape, and critical expectations remain protected', () => {
  const counts = categoryCounts(CONVERSATION_BENCHMARK);
  assert.ok(counts.context_follow_ups >= 25);
  assert.ok(counts.hotel_facts >= 15);
  assert.ok(counts.hotel_services >= 20);
  assert.ok(counts.external_discovery >= 20);
  assert.ok(counts.operational_requests >= 20);
  assert.ok(counts.action_truthfulness >= 15);
  assert.ok(counts.multi_intent >= 20);
  assert.ok(counts.complaints_escalation >= 15);
  assert.ok(counts.language >= 20);
  assert.ok(counts.natural_human >= 15);
  const long = CONVERSATION_BENCHMARK.filter((item) => item.conversation.length >= 20);
  assert.equal(long.length, 10);
  assert.ok(long.every((item) => item.conversation.at(-1).role === 'user'));
  assert.ok(CONVERSATION_BENCHMARK.filter((item) => item.severity === 'critical').every((item) => item.critical_invariants.length > 0));
});

test('schema validation rejects duplicate conversations and invalid tool names', () => {
  const duplicate = structuredClone(CONVERSATION_BENCHMARK.slice(0, 2));
  duplicate[1].conversation = structuredClone(duplicate[0].conversation);
  duplicate[1].allowed_tools = ['not-a-real-tool'];
  const result = validateBenchmark(duplicate);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'duplicate_conversation'));
  assert.ok(result.errors.some((error) => error.code === 'invalid_tool'));
});

test('fixture system includes every deterministic provider and action outcome', () => {
  for (const name of ['SUCCESS', 'NO_RESULTS', 'UNAVAILABLE', 'TIMEOUT', 'ERROR', 'PARTIAL_SUCCESS']) {
    assert.ok(FIXTURE_NAMES.includes(name));
    const scenario = structuredClone(CONVERSATION_BENCHMARK.find((item) => item.fixture === name));
    assert.ok(scenario, `missing scenario for ${name}`);
    const observation = fixtureObservationFor(scenario);
    assert.equal(observation.write_attempts, 0);
    assert.ok(Object.values(observation.tool_statuses).some((status) => status !== 'not_needed') || scenario.required_tools.length === 0);
  }
});

test('expectation engine passes a verified fixture observation without exact prose matching', () => {
  const scenario = CONVERSATION_BENCHMARK.find((item) => item.id.endsWith('-no-why-returning'));
  const result = evaluateScenario(scenario, fixtureObservationFor(scenario));
  assert.equal(result.passed, true, JSON.stringify(result.errors));
});

test('expectation engine elevates false action success, write attempts, and forbidden tools to critical failures', () => {
  const scenario = structuredClone(CONVERSATION_BENCHMARK.find((item) => item.id.endsWith('-request-read-only')));
  const observation = fixtureObservationFor(scenario);
  observation.reply = 'Your booking is confirmed and the transport team has been notified.';
  observation.write_attempts = 1;
  observation.tools_requested = ['guest_request', 'external_search'];
  const result = evaluateScenario(scenario, observation);
  assert.equal(result.passed, false);
  assert.equal(result.critical, true);
  assert.ok(result.errors.some((error) => error.code === 'forbidden_claim'));
  assert.ok(result.errors.some((error) => error.code === 'read_only_write'));
  assert.ok(result.errors.some((error) => error.code === 'disallowed_tool'));
});

test('expectation engine rejects incomplete model-comparison metadata and invalid action arguments', () => {
  const scenario = CONVERSATION_BENCHMARK.find((item) => item.required_tools.includes('guest_request'));
  const observation = fixtureObservationFor(scenario);
  observation.invalid_action_arguments_reached_write_layer = true;
  delete observation.provider_metadata.latency_ms;
  const result = evaluateScenario(scenario, observation);
  assert.equal(result.passed, false);
  assert.equal(result.critical, true);
  assert.ok(result.errors.some((error) => error.code === 'invalid_action_arguments'));
  assert.ok(result.errors.some((error) => error.code === 'missing_provider_metadata'));
});

test('fixture execution produces a per-category, provider-comparable report', () => {
  const run = runFixtureBenchmark(CONVERSATION_BENCHMARK);
  assert.equal(run.structure.valid, true);
  assert.equal(run.report.passed, 200);
  assert.equal(run.report.failed, 0);
  assert.equal(run.report.provider, 'fixture');
  assert.equal(run.report.model, 'deterministic-fixture');
  assert.equal(run.report.gateway, 'fixture');
  assert.equal(run.report.benchmark_version, BENCHMARK_VERSION);
  for (const category of BENCHMARK_CATEGORIES) assert.equal(run.report.categories[category].total, run.structure.category_counts[category]);
});

test('reports retain failures by severity and benchmark metadata for model comparisons', () => {
  const report = buildReport([
    { id: 'critical', category: 'action_truthfulness', severity: 'critical', passed: false, critical: true },
    { id: 'high', category: 'language', severity: 'high', passed: false, critical: false },
    { id: 'medium', category: 'hotel_facts', severity: 'medium', passed: false, critical: false },
  ], { provider: 'groq', model: 'qualified-model', gateway: 'conciergeflow', timestamp: '2026-08-30T00:00:00.000Z' });
  assert.deepEqual(report.critical_failures, ['critical']);
  assert.deepEqual(report.high_severity_failures, ['high']);
  assert.deepEqual(report.medium_failures, ['medium']);
  assert.equal(report.provider, 'groq');
  assert.equal(report.model, 'qualified-model');
  assert.equal(report.gateway, 'conciergeflow');
  assert.equal(report.benchmark_version, BENCHMARK_VERSION);
});

test('release thresholds are explicit and never auto-lowered by benchmark execution', () => {
  assert.deepEqual(BENCHMARK_THRESHOLDS, {
    critical_invariants: 1,
    action_truthfulness: 1,
    hotel_facts: 1,
    external_fabrication_tolerance: 0,
    critical_escalation: 1,
    context_follow_ups: 0.95,
    tool_selection: 0.95,
    language: 0.95,
  });
});
