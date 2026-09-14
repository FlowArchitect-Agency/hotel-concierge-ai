/**
 * Checkpointed, fixture-isolated readiness gate for the actual ConciergeFlow
 * SUT. Only the explicitly configured, provider-neutral evaluation role is
 * called; every hotel, search, request, and persistence dependency is
 * intercepted in memory.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateReadinessScenario, failureClusters } from './assertions.js';
import { defaultReadinessCheckpointPath, hashFile, loadReadinessCheckpoint, saveReadinessCheckpoint } from './checkpoint.js';
import { DEMO_READINESS_CATEGORIES, DEMO_READINESS_SCENARIOS, DEMO_READINESS_VERSION } from './scenarios.js';
import { roleConfigurationMetadata } from '../dynamic-conversation-judge/config.js';
import { runDynamicSut } from '../dynamic-conversation-judge/sut.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const mainCheckpointPath = path.join(os.tmpdir(), 'conciergeflow-dynamic-conversation-eval-v1.json');
const defaultIntervalMs = 2_500;

function loadLocalEnvironment() {
  const values = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(projectRoot, '.env'), 'utf8').split(/\r?\n/)) {
      const separator = line.indexOf('=');
      if (separator > 0 && !/^\s*#/.test(line)) values[line.slice(0, separator).trim()] ||= line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  } catch { /* Environment-only configuration is valid. */ }
  return values;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--checkpoint') result.checkpointPath = path.resolve(argv[index + 1]);
    if (argv[index] === '--interval-ms') result.intervalMs = Number(argv[index + 1]);
    if (argv[index] === '--scenario-ids') result.scenarioIds = String(argv[index + 1] || '').split(',').map((value) => value.trim()).filter(Boolean);
  }
  return result;
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function parseDurationMs(value) {
  const source = String(value || '').trim().toLowerCase();
  if (!source) return 0;
  if (/^\d+(?:\.\d+)?$/.test(source)) return Number(source) * 1_000;
  const match = source.match(/(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec(?:onds?)?|m|min(?:utes?)?|h|hours?)/);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit.startsWith('h')) return amount * 3_600_000;
  if (unit === 'm' || unit.startsWith('min')) return amount * 60_000;
  if (unit.startsWith('ms')) return amount;
  return amount * 1_000;
}

function rateLimitRecord(rateLimit) {
  const retryAfterMs = Number(rateLimit?.retry_after_ms || 0) || parseDurationMs(rateLimit?.retry_after);
  const requestResetMs = parseDurationMs(rateLimit?.request_reset);
  const tokenResetMs = parseDurationMs(rateLimit?.token_reset);
  const waitMs = Math.max(retryAfterMs, requestResetMs, tokenResetMs, 0);
  return {
    status: 429, observed_at: rateLimit?.observed_at || new Date().toISOString(),
    retry_after: rateLimit?.retry_after || null, retry_after_ms: rateLimit?.retry_after_ms || null,
    request_reset: rateLimit?.request_reset || null, token_reset: rateLimit?.token_reset || null,
    rate_limit: rateLimit?.rate_limit || {},
    safe_retry_at: waitMs ? new Date(Date.now() + waitMs + 750).toISOString() : null,
  };
}

function redact(value) {
  return String(value || '').replace(/(?:gsk_|sk-|bearer\s+)[a-z0-9._-]+/ig, '[redacted credential-like content]');
}

function resultSnapshot(scenario, sut, assertions, elapsedMs) {
  return {
    id: scenario.id, category: scenario.category, status: assertions.passed ? 'passed' : 'failed',
    completed_at: new Date().toISOString(), latency_ms: elapsedMs,
    transcript: [...scenario.conversation_history, { role: 'user', content: scenario.final_guest_turn }]
      .map((turn) => ({ role: turn.role, content: redact(turn.content) })),
    sut: {
      status: sut.status, reply: redact(sut.reply), language: sut.language, intent: sut.intent,
      requires_human: sut.requires_human, provider_failure: sut.provider_failure,
      semantic_route: sut.semantic_route, semantic_plan: sut.semantic_plan,
      tools_requested: sut.tools_requested, tools_executed: sut.tools_executed, tool_statuses: sut.tool_statuses,
      rendered_cards: sut.rendered_cards || { partner_offers: [], recommendations: [], media: null },
      write_attempts: sut.write_attempts, deterministic_failures: sut.deterministic_failures,
      provider_metadata: sut.provider_metadata,
      response_pipeline: sut.response_pipeline || null,
    },
    assertions,
  };
}

function percentage(numerator, denominator) {
  return denominator ? Number((100 * numerator / denominator).toFixed(1)) : 100;
}

function rowsFor(checkpoint, predicate, scenarios = DEMO_READINESS_SCENARIOS) {
  return scenarios
    .filter(predicate)
    .map((scenario) => checkpoint.results[scenario.id])
    .filter(Boolean);
}

function successful(rows) { return rows.filter((row) => row.status === 'passed').length; }

export function readinessReport(checkpoint, { scenarios = DEMO_READINESS_SCENARIOS } = {}) {
  const completed = Object.values(checkpoint.results || {});
  const categoryResults = Object.fromEntries(DEMO_READINESS_CATEGORIES.map((category) => {
    const rows = rowsFor(checkpoint, (scenario) => scenario.category === category, scenarios);
    return [category, { passed: successful(rows), total: scenarios.filter((scenario) => scenario.category === category).length }];
  }));
  const criticalRows = (invariant) => rowsFor(checkpoint, (scenario) => scenario.critical_invariants.includes(invariant), scenarios);
  const actionRows = criticalRows('critical_action_truth');
  const factRows = criticalRows('critical_hotel_fact_grounding');
  const externalRows = criticalRows('critical_external_grounding');
  const escalationRows = criticalRows('critical_human_escalation');
  const contextRows = rowsFor(checkpoint, (scenario) => scenario.category === 'context', scenarios);
  const changeRows = rowsFor(checkpoint, (scenario) => scenario.category === 'change_of_mind', scenarios);
  const multiRows = rowsFor(checkpoint, (scenario) => scenario.category === 'multi_intent', scenarios);
  const longRows = rowsFor(checkpoint, (scenario) => scenario.category === 'long_context', scenarios);
  const languageRows = rowsFor(checkpoint, (scenario) => scenario.category === 'language', scenarios);
  const criticalFailures = completed.filter((row) => row.assertions?.critical);
  const nonSequiturCount = completed.reduce((total, row) => total + (row.assertions?.contextual_non_sequiturs?.length || 0), 0);
  const relevanceRows = completed.filter((row) => !(row.assertions?.failures || []).some((failure) => /response_lacks_current_focus|contextual_non_sequitur/.test(failure)));
  const metrics = {
    action_truth: percentage(successful(actionRows), actionRows.length),
    hotel_fact_grounding: percentage(successful(factRows), factRows.length),
    external_grounding: percentage(successful(externalRows), externalRows.length),
    human_escalation: percentage(successful(escalationRows), escalationRows.length),
    contextual_understanding: percentage(successful(contextRows), contextRows.length),
    change_of_mind: percentage(successful(changeRows), changeRows.length),
    multi_intent: percentage(successful(multiRows), multiRows.length),
    long_context: percentage(successful(longRows), longRows.length),
    language: percentage(successful(languageRows), languageRows.length),
    response_relevance: percentage(relevanceRows.length, completed.length),
  };
  const clusters = failureClusters(completed);
  return {
    suite_version: DEMO_READINESS_VERSION, status: checkpoint.status, total: scenarios.length,
    completed: completed.length, passed: successful(completed), failed: completed.filter((row) => row.status === 'failed').length,
    critical_failures: criticalFailures.length, contextual_non_sequiturs: nonSequiturCount,
    categories: categoryResults, metrics, failure_clusters: clusters,
    rate_limit_retries: checkpoint.metrics.rate_limit_retries, model_calls: checkpoint.metrics.model_calls,
    controller_model_calls: checkpoint.metrics.controller_model_calls, response_model_calls: checkpoint.metrics.response_model_calls,
    main_checkpoint: checkpoint.main_checkpoint,
  };
}

export function readinessClassification(report) {
  if (report.status === 'RATE_LIMIT_WAIT_REQUIRED') return 'RATE_LIMIT_WAIT_REQUIRED';
  if (report.completed !== report.total) return 'DEMO AI NEEDS GENERALIZED FIXES';
  const meetsThresholds = report.metrics.action_truth === 100
    && report.metrics.hotel_fact_grounding === 100
    && report.metrics.external_grounding === 100
    && report.metrics.human_escalation === 100
    && report.metrics.contextual_understanding >= 95
    && report.metrics.change_of_mind >= 95
    && report.metrics.multi_intent >= 95
    && report.metrics.long_context >= 90
    && report.metrics.language >= 95
    && report.metrics.response_relevance >= 95
    && report.contextual_non_sequiturs === 0;
  if (meetsThresholds) return 'DEMO AI READY FOR HOTEL OUTREACH';
  if (report.critical_failures > 0 || report.failed / report.total >= 0.2) return 'DEMO AI NOT READY';
  return 'DEMO AI NEEDS GENERALIZED FIXES';
}

export async function runReadinessEvaluation({ checkpointPath = defaultReadinessCheckpointPath(), intervalMs = defaultIntervalMs, scenarioIds = null, env = loadLocalEnvironment() } = {}) {
  if (!fs.existsSync(mainCheckpointPath)) throw new Error(`Main checkpoint is required: ${mainCheckpointPath}`);
  const mainHash = hashFile(mainCheckpointPath);
  const sutConfiguration = roleConfigurationMetadata(env, 'sut');
  if (!sutConfiguration.configured) {
    throw new Error('Configured evaluation SUT role is unavailable.');
  }
  const checkpoint = loadReadinessCheckpoint(checkpointPath, {
    mainCheckpointPath, mainCheckpointHash: mainHash, sut: sutConfiguration,
  });
  const scenarios = Array.isArray(scenarioIds) && scenarioIds.length
    ? scenarioIds.map((id) => DEMO_READINESS_SCENARIOS.find((scenario) => scenario.id === id)).filter(Boolean)
    : DEMO_READINESS_SCENARIOS;
  if (!scenarios.length) throw new Error('No valid readiness scenarios were selected.');
  if (checkpoint.main_checkpoint?.hash_before !== mainHash) {
    throw new Error('Main 105-scenario checkpoint hash changed; readiness diagnostic will not run against altered baseline evidence.');
  }
  if (checkpoint.last_rate_limit?.safe_retry_at && Date.parse(checkpoint.last_rate_limit.safe_retry_at) > Date.now()) {
    checkpoint.status = 'RATE_LIMIT_WAIT_REQUIRED';
    saveReadinessCheckpoint(checkpointPath, checkpoint);
    const report = readinessReport(checkpoint, { scenarios });
    return { checkpoint, report, classification: readinessClassification(report) };
  }

  let lastModelAt = 0;
  const baseModelFetch = globalThis.fetch;
  const liveModelFetch = async (input, init) => {
    const delay = Math.max(0, intervalMs - (Date.now() - lastModelAt));
    if (delay) await wait(delay);
    lastModelAt = Date.now();
    return baseModelFetch(input, init);
  };

  for (const scenario of scenarios) {
    if (checkpoint.results[scenario.id]) continue;
    const startedAt = Date.now();
    const sut = await runDynamicSut(env, scenario, { modelFetch: liveModelFetch });
    if (sut.rate_limit) {
      checkpoint.metrics.rate_limit_retries += 1;
      checkpoint.last_rate_limit = rateLimitRecord(sut.rate_limit);
      checkpoint.status = 'RATE_LIMIT_WAIT_REQUIRED';
      saveReadinessCheckpoint(checkpointPath, checkpoint);
      const report = readinessReport(checkpoint, { scenarios });
      return { checkpoint, report, classification: readinessClassification(report) };
    }
    const assertions = evaluateReadinessScenario(scenario, sut);
    checkpoint.results[scenario.id] = resultSnapshot(scenario, sut, assertions, Date.now() - startedAt);
    checkpoint.metrics.model_calls += Number(sut.provider_metadata?.model_call_count || 0);
    checkpoint.metrics.controller_model_calls += Number(sut.provider_metadata?.controller_model_calls || 0);
    checkpoint.metrics.response_model_calls += Number(sut.provider_metadata?.response_model_calls || 0);
    checkpoint.status = 'running';
    saveReadinessCheckpoint(checkpointPath, checkpoint);
  }
  checkpoint.main_checkpoint.hash_after = hashFile(mainCheckpointPath);
  if (checkpoint.main_checkpoint.hash_before !== checkpoint.main_checkpoint.hash_after) {
    checkpoint.status = 'MAIN_CHECKPOINT_MUTATION_BLOCKER';
  } else {
    checkpoint.status = scenarios.length === DEMO_READINESS_SCENARIOS.length ? 'complete' : 'partial_regression_complete';
  }
  saveReadinessCheckpoint(checkpointPath, checkpoint);
  const report = readinessReport(checkpoint, { scenarios });
  return { checkpoint, report, classification: readinessClassification(report) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = await runReadinessEvaluation(args);
    console.log(JSON.stringify({ checkpoint: args.checkpointPath || defaultReadinessCheckpointPath(), ...result.report, classification: result.classification }, null, 2));
    process.exitCode = result.classification === 'RATE_LIMIT_WAIT_REQUIRED' ? 0 : result.report.status === 'complete' ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ status: 'DEMO_READINESS_EVALUATOR_BLOCKER', reason: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}
