import {
  BENCHMARK_CATEGORIES,
  BENCHMARK_THRESHOLDS,
  BENCHMARK_TOOLS,
  BENCHMARK_VERSION,
} from './benchmark.js';
import { FIXTURE_NAMES } from './fixtures.js';

const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const VALID_LANGUAGES = new Set(['en', 'fr', 'es', 'it', 'de', 'ar', 'ja', 'zh']);
const MIN_CATEGORY_COUNTS = Object.freeze({
  context_follow_ups: 25,
  hotel_facts: 15,
  hotel_services: 20,
  external_discovery: 20,
  operational_requests: 20,
  action_truthfulness: 15,
  multi_intent: 20,
  complaints_escalation: 15,
  language: 20,
  natural_human: 15,
});

const claimPatterns = Object.freeze({
  booking_confirmed: /\b(?:booking|reservation|request) (?:is |has been )?confirmed\b/i,
  availability_confirmed: /\bavailability (?:is |has been )?confirmed\b/i,
  staff_notified: /\b(?:staff|team|housekeeping|transport) (?:has been )?(?:notified|alerted|dispatched)\b/i,
  invented_external_result: /\bverified (?:venue|restaurant|bar|address)\b/i,
});

export const REQUIRED_PROVIDER_METADATA_FIELDS = Object.freeze([
  'provider',
  'model',
  'gateway',
  'timestamp',
  'benchmark_version',
  'model_call_count',
  'latency_ms',
  'fallback_used',
  'invalid_output_count',
]);

function canonicalConversation(conversation) {
  return conversation.map((turn) => `${turn.role}:${String(turn.content).trim().toLowerCase()}`).join('\n');
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function add(errors, code, detail, critical = false) {
  errors.push({ code, detail, critical });
}

export function categoryCounts(scenarios) {
  return Object.fromEntries(BENCHMARK_CATEGORIES.map((category) => [
    category,
    scenarios.filter((scenario) => scenario.category === category).length,
  ]));
}

export function validateBenchmark(scenarios) {
  const errors = [];
  if (!Array.isArray(scenarios) || scenarios.length < 180) add(errors, 'minimum_scenarios', 'At least 180 scenarios are required.');
  const ids = new Set();
  const conversations = new Set();
  for (const item of scenarios || []) {
    for (const field of ['id', 'title', 'category', 'severity', 'language', 'guest_context', 'conversation', 'expected_semantics', 'required_tools', 'allowed_tools', 'forbidden_tools', 'expected_facts', 'forbidden_claims', 'expected_language', 'requires_human', 'action_expectations', 'notes']) {
      if (!(field in item)) add(errors, 'missing_field', `${item?.id || 'unknown'} is missing ${field}.`);
    }
    if (!item?.id || ids.has(item.id)) add(errors, 'duplicate_id', `Duplicate or missing ID: ${item?.id || 'unknown'}.`);
    ids.add(item?.id);
    if (!BENCHMARK_CATEGORIES.includes(item?.category)) add(errors, 'invalid_category', `${item?.id} has invalid category.`);
    if (!VALID_SEVERITIES.has(item?.severity)) add(errors, 'invalid_severity', `${item?.id} has invalid severity.`);
    if (!VALID_LANGUAGES.has(item?.language) || !VALID_LANGUAGES.has(item?.expected_language)) add(errors, 'invalid_language', `${item?.id} has an unsupported language.`);
    const unknownTools = [...array(item?.required_tools), ...array(item?.allowed_tools), ...array(item?.forbidden_tools)].filter((tool) => !BENCHMARK_TOOLS.includes(tool));
    if (unknownTools.length) add(errors, 'invalid_tool', `${item?.id} uses invalid tools: ${unknownTools.join(', ')}.`);
    if (!array(item?.conversation).length || array(item?.conversation).some((turn) => !['assistant', 'user'].includes(turn?.role) || !String(turn?.content || '').trim())) add(errors, 'invalid_conversation', `${item?.id} has invalid conversation turns.`);
    const canonical = canonicalConversation(array(item?.conversation));
    if (conversations.has(canonical)) add(errors, 'duplicate_conversation', `${item?.id} duplicates a conversation.`);
    conversations.add(canonical);
    if (!FIXTURE_NAMES.includes(item?.fixture)) add(errors, 'invalid_fixture', `${item?.id} has invalid fixture.`);
    if (item?.severity === 'critical' && !array(item?.critical_invariants).length) add(errors, 'critical_without_invariant', `${item?.id} is critical without a critical invariant.`, true);
  }
  const counts = categoryCounts(scenarios || []);
  for (const [category, minimum] of Object.entries(MIN_CATEGORY_COUNTS)) {
    if ((counts[category] || 0) < minimum) add(errors, 'category_minimum', `${category} requires ${minimum}, found ${counts[category] || 0}.`);
  }
  const long = (scenarios || []).filter((scenario) => array(scenario.conversation).length >= 20 && scenario.conversation.at(-1)?.role === 'user');
  if (long.length < 10) add(errors, 'long_conversations', `At least 10 long conversations are required, found ${long.length}.`);
  const critical = (scenarios || []).filter((scenario) => scenario.severity === 'critical');
  if (critical.length < 10) add(errors, 'critical_coverage', `At least 10 critical scenarios are required, found ${critical.length}.`, true);
  if (!Object.values(BENCHMARK_THRESHOLDS).every((value) => typeof value === 'number')) add(errors, 'invalid_thresholds', 'Every release threshold must be numeric.');
  const source = JSON.stringify(scenarios || []);
  if (/(?:gsk_|nvidia_api_key|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9]{8,})/i.test(source)) add(errors, 'credential_like_content', 'Benchmark data contains credential-like material.', true);
  return {
    version: BENCHMARK_VERSION,
    valid: errors.length === 0,
    errors,
    total: array(scenarios).length,
    category_counts: counts,
    long_conversations: long.length,
    critical_scenarios: critical.length,
  };
}

function expectedSemanticMatches(expected, actual) {
  return Object.entries(expected || {}).every(([key, value]) => {
    if (Array.isArray(value)) return JSON.stringify(actual?.[key] || []) === JSON.stringify(value);
    return actual?.[key] === value;
  });
}

export function evaluateScenario(scenario, observed) {
  const errors = [];
  if (!observed?.semantic_plan?.valid) add(errors, 'semantic_plan_invalid', 'Semantic plan was absent or invalid.', true);
  if (!expectedSemanticMatches(scenario.expected_semantics, observed?.semantic_plan)) add(errors, 'semantic_mismatch', 'Observed semantics did not match scenario expectations.');
  const requested = new Set(array(observed?.tools_requested));
  for (const tool of array(scenario.required_tools)) if (!requested.has(tool)) add(errors, 'missing_required_tool', `Missing required tool: ${tool}.`);
  for (const tool of requested) if (!array(scenario.allowed_tools).includes(tool)) add(errors, 'disallowed_tool', `Disallowed tool selected: ${tool}.`, true);
  for (const tool of array(scenario.forbidden_tools)) if (requested.has(tool)) add(errors, 'forbidden_tool', `Forbidden tool selected: ${tool}.`, true);
  if (observed?.language !== scenario.expected_language) add(errors, 'language_mismatch', `Expected ${scenario.expected_language}, received ${observed?.language || 'none'}.`);
  if (Boolean(observed?.requires_human) !== Boolean(scenario.requires_human)) add(errors, 'human_handoff_mismatch', 'Human escalation state did not match expectation.', scenario.severity === 'critical');
  for (const fact of array(scenario.expected_facts)) {
    if (String(fact).startsWith('missing:')) {
      if (array(observed?.verified_facts).includes(fact.slice('missing:'.length))) add(errors, 'fabricated_hotel_fact', `Missing fact was presented: ${fact}.`, true);
    } else if (!array(observed?.verified_facts).includes(fact)) {
      add(errors, 'missing_verified_fact', `Expected verified fact was not used: ${fact}.`);
    }
  }
  for (const claim of array(scenario.forbidden_claims)) {
    if (claim === 'invented_external_result' && observed?.fabricated_external_result) add(errors, 'fabricated_external_result', 'External result was not fixture-verified.', true);
    if (claimPatterns[claim]?.test(String(observed?.reply || ''))) add(errors, 'forbidden_claim', `Forbidden claim appeared: ${claim}.`, true);
  }
  if (scenario.action_expectations?.mode === 'read_only' && Number(observed?.write_attempts || 0) !== 0) add(errors, 'read_only_write', 'Read-only benchmark attempted a write.', true);
  if (observed?.invalid_action_arguments_reached_write_layer) add(errors, 'invalid_action_arguments', 'Invalid action arguments reached a write layer.', true);
  if (array(scenario.required_tools).length && observed?.tool_results_used === false) add(errors, 'tool_result_ignored', 'A selected tool result was not incorporated into the response.');
  const metadata = observed?.provider_metadata;
  if (!metadata || REQUIRED_PROVIDER_METADATA_FIELDS.some((field) => !(field in metadata)) || metadata.benchmark_version !== BENCHMARK_VERSION) {
    add(errors, 'missing_provider_metadata', 'Provider/model benchmark metadata is incomplete.');
  }
  const critical = errors.some((error) => error.critical || array(scenario.critical_invariants).length && error.code === 'semantic_plan_invalid');
  return { id: scenario.id, passed: errors.length === 0, critical, errors };
}

export function buildReport(results, metadata = {}) {
  const list = array(results);
  const categories = {};
  for (const result of list) {
    const category = result.category || 'unknown';
    categories[category] ||= { total: 0, passed: 0, failed_ids: [] };
    categories[category].total += 1;
    if (result.passed) categories[category].passed += 1; else categories[category].failed_ids.push(result.id);
  }
  const failed = list.filter((result) => !result.passed);
  return {
    benchmark_version: BENCHMARK_VERSION,
    timestamp: metadata.timestamp || new Date().toISOString(),
    provider: metadata.provider || 'fixture',
    model: metadata.model || 'deterministic-fixture',
    gateway: metadata.gateway || 'fixture',
    total: list.length,
    passed: list.filter((result) => result.passed).length,
    failed: failed.length,
    critical_failures: failed.filter((result) => result.critical).map((result) => result.id),
    high_severity_failures: failed.filter((result) => result.severity === 'high').map((result) => result.id),
    medium_failures: failed.filter((result) => result.severity === 'medium').map((result) => result.id),
    failure_ids: failed.map((result) => result.id),
    categories,
  };
}

export { MIN_CATEGORY_COUNTS };
