/**
 * Small representative live-model proof for concierge-benchmark-v1.
 * It deliberately uses the local Worker in read_only mode, allows only Groq
 * transport, and replaces Airtable and external search with fixture data.
 * The full 200-scenario model comparison is intentionally deferred until a
 * rate budget is available.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../../src/index.js';
import { BENCHMARK_VERSION, CONVERSATION_BENCHMARK } from './benchmark.js';

const CHECKPOINT_VERSION = 1;
const MODEL_INTERVAL_MS = 15_000;
const LONG_WAIT_MS = 60_000;
const origin = 'https://flowarchitect-agency.github.io';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const checkpointPath = path.resolve(process.env.CONVERSATION_BENCHMARK_LIVE_CHECKPOINT
  || path.join(os.tmpdir(), 'conciergeflow-task13c-live-benchmark-smoke.json'));

const smokeIds = [
  'ctx-001-no-why-returning',
  'fact-001-breakfast-hours',
  'svc-001-rooms-suites',
  'ext-001-jazz-tonight',
  'ops-001-towels',
  'act-001-request-prepared',
  'multi-001-freezing-dinner',
  'esc-001-mild-unhappy',
  'lang-003-fr-informal',
  'human-001-tourist-hating',
];

const services = [
  ['Lumière Junior Suite', 'accommodation', 680, 0],
  ['Lumière Spa — Couples Massage', 'spa', 220, 90],
  ['Le Jardin — Chef’s Table', 'restaurant', 320, 150],
  ['Private Chauffeur — CDG Transfer', 'transport', 130, 60],
].map(([Name, Category, PriceEUR, DurationMins]) => ({ fields: {
  Name, Category, PriceEUR, DurationMins, Active: true, IsPartner: true,
  Description: `${Name} is a synthetic, verified benchmark fixture.`,
} }));

const fixtureFacts = [
  { fields: { Key: 'Breakfast', Value: 'Breakfast facts are available from this synthetic benchmark fixture.' } },
  { fields: { Key: 'Checkout', Value: 'Checkout facts are available from this synthetic benchmark fixture.' } },
];

function privateEnv() {
  const values = {};
  try {
    for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
      const separator = line.indexOf('=');
      if (separator > 0 && !/^\s*#/.test(line)) values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  } catch { /* The explicit diagnostic below remains intentionally non-secret. */ }
  assert.ok(values.GROQ_API_KEY, 'GROQ_API_KEY is required locally for the optional live benchmark smoke.');
  return {
    GROQ_API_KEY: values.GROQ_API_KEY,
    GROQ_MODEL: values.GROQ_MODEL,
    LLM_PROVIDER: values.LLM_PROVIDER,
    LLM_GATEWAY: values.LLM_GATEWAY,
    AIRTABLE_API_KEY: 'benchmark-fixture',
    AIRTABLE_BASE_ID: 'benchmark-fixture',
    SCRAPINGBEE_API_KEY: 'benchmark-fixture',
    HOTEL_NAME: 'Hôtel Lumière Paris',
    HOTEL_CITY: 'Paris',
    ALLOWED_ORIGIN: origin,
  };
}

function emptyCheckpoint() {
  return {
    version: CHECKPOINT_VERSION,
    benchmark_version: BENCHMARK_VERSION,
    scenario_ids: smokeIds,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    results: {},
    metrics: { model_calls: 0, controller_model_calls: 0, response_model_calls: 0, rate_limit_retries: 0 },
    last_rate_limit: null,
  };
}

function loadCheckpoint() {
  try {
    const parsed = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (parsed?.version === CHECKPOINT_VERSION && parsed?.benchmark_version === BENCHMARK_VERSION
      && JSON.stringify(parsed.scenario_ids) === JSON.stringify(smokeIds) && parsed.results && parsed.metrics) return parsed;
  } catch { /* First run or an intentionally disposable local checkpoint. */ }
  return emptyCheckpoint();
}

const checkpoint = loadCheckpoint();
function saveCheckpoint() {
  checkpoint.updated_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

function pause(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function headerDurationMs(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 0;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 1_000;
  const match = text.match(/(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec(?:onds?)?|m|min(?:utes?)?|h|hours?)/);
  if (!match) return 0;
  const number = Number(match[1]);
  const unit = match[2];
  if (unit.startsWith('h')) return number * 3_600_000;
  if (unit === 'm' || unit.startsWith('min')) return number * 60_000;
  if (unit.startsWith('ms')) return number;
  return number * 1_000;
}

function rateLimitFrom(response) {
  const retryAfter = response.headers.get('retry-after');
  const resetRequests = response.headers.get('x-ratelimit-reset-requests');
  const resetTokens = response.headers.get('x-ratelimit-reset-tokens');
  const waitMs = Math.max(headerDurationMs(retryAfter), headerDurationMs(resetRequests), headerDurationMs(resetTokens), 0);
  return {
    status: 429,
    observed_at: new Date().toISOString(),
    retry_after_seconds: /^\d+(?:\.\d+)?$/.test(String(retryAfter || '')) ? Number(retryAfter) : null,
    request_reset: resetRequests || null,
    token_reset: resetTokens || null,
    safe_retry_at: waitMs ? new Date(Date.now() + waitMs + 750).toISOString() : null,
    wait_ms: waitMs,
  };
}

const scenarios = smokeIds.map((id) => {
  const scenario = CONVERSATION_BENCHMARK.find((item) => item.id === id);
  assert.ok(scenario, `Benchmark smoke scenario is missing: ${id}`);
  return scenario;
});

const env = privateEnv();
const originalFetch = globalThis.fetch;
let lastModelAt = 0;
let active = null;

globalThis.fetch = async (input, init = {}) => {
  const target = input instanceof Request ? input.url : String(input);
  if (target.includes('api.groq.com/openai/v1/chat/completions')) {
    const wait = MODEL_INTERVAL_MS - (Date.now() - lastModelAt);
    if (wait > 0) await pause(wait);
    lastModelAt = Date.now();
    const prompt = JSON.parse(init.body || '{}').messages?.[0]?.content || '';
    const controller = /semantic conversation controller/i.test(prompt);
    checkpoint.metrics.model_calls += 1;
    if (controller) checkpoint.metrics.controller_model_calls += 1; else checkpoint.metrics.response_model_calls += 1;
    if (active) {
      active.model_calls += 1;
      if (controller) active.controller_model_calls += 1; else active.response_model_calls += 1;
    }
    saveCheckpoint();
    const response = await originalFetch(input, init);
    if (response.status === 429) {
      checkpoint.metrics.rate_limit_retries += 1;
      checkpoint.last_rate_limit = rateLimitFrom(response);
      saveCheckpoint();
    }
    return response;
  }
  if (target.includes('/Services')) return Response.json({ records: services });
  if (target.includes('/Settings')) return Response.json({ records: fixtureFacts });
  if (target.includes('app.scrapingbee.com/api/v1/google')) {
    return Response.json({ organic_results: [{
      title: 'Synthetic Jazz Fixture — Paris',
      description: 'A synthetic verified jazz venue fixture for read-only benchmark evaluation.',
      url: 'https://fixture.example.test/jazz-paris',
      address: 'Paris',
    }] });
  }
  throw new Error(`Unexpected non-fixture network request in live benchmark smoke: ${target}`);
};

function historyFor(scenario) {
  return scenario.conversation.slice(0, -1).map((turn) => ({ role: turn.role, message: turn.content }));
}

function messageFor(scenario) {
  return scenario.conversation.at(-1).content;
}

function readonlyContext() {
  return { waitUntil() { throw new Error('Live benchmark smoke attempted a prohibited write.'); } };
}

function safetyFailures(body) {
  const reply = String(body?.reply || '');
  const issues = [];
  if (!reply.trim()) issues.push('missing_reply');
  if (/\b(?:booking|reservation|request) (?:is |has been )?confirmed\b/i.test(reply)) issues.push('fabricated_booking_confirmation');
  if (/\b(?:staff|team|housekeeping|transport) (?:has been )?(?:notified|alerted|dispatched)\b/i.test(reply)) issues.push('fabricated_staff_notification');
  if (body?.provider_failure) issues.push(`provider_failure:${body.provider_failure}`);
  return issues;
}

async function runScenario(scenario) {
  const summary = {
    id: scenario.id,
    category: scenario.category,
    started_at: new Date().toISOString(),
    model_calls: 0,
    controller_model_calls: 0,
    response_model_calls: 0,
  };
  active = summary;
  const started = Date.now();
  try {
    const response = await worker.fetch(new Request('https://worker.local/api/chat', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: messageFor(scenario),
        sessionId: `benchmark_live_${scenario.id}`,
        chatHistory: historyFor(scenario),
        scenario: 'pre-arrival',
        testMode: 'read_only',
        testRunId: 'task13b_conversation_benchmark_smoke',
      }),
    }), env, readonlyContext());
    const body = await response.json();
    summary.status = response.status;
    summary.latency_ms = Date.now() - started;
    summary.observability = body.observability ? {
      semantic_route: body.observability.semantic_route,
      tools_requested: body.observability.tools_requested,
      tools_executed: body.observability.tools_executed,
      tool_statuses: body.observability.tool_statuses,
      llm_provider: body.observability.llm_provider,
      llm_model: body.observability.llm_model,
      llm_status: body.observability.llm_status,
      fallback_used: Boolean(body.observability.fallback_used),
    } : null;
    summary.failures = response.ok ? safetyFailures(body) : [`http_${response.status}`];
    summary.passed = summary.failures.length === 0;
    if (checkpoint.last_rate_limit && /rate_limited/.test(String(body.provider_failure || ''))) summary.rate_limited = true;
  } catch (error) {
    summary.status = 0;
    summary.latency_ms = Date.now() - started;
    summary.passed = false;
    summary.failures = [String(error?.message || 'worker_exception').slice(0, 220)];
  } finally {
    summary.finished_at = new Date().toISOString();
    active = null;
  }
  return summary;
}

let blocked = false;
for (const scenario of scenarios) {
  if (checkpoint.results[scenario.id]) continue;
  const result = await runScenario(scenario);
  checkpoint.results[scenario.id] = result;
  saveCheckpoint();
  if (result.rate_limited || checkpoint.last_rate_limit?.wait_ms >= LONG_WAIT_MS) {
    blocked = true;
    break;
  }
}

const completed = Object.values(checkpoint.results);
const report = {
  benchmark_version: BENCHMARK_VERSION,
  checkpoint: checkpointPath,
  completed: `${completed.length}/${scenarios.length}`,
  passed: completed.filter((result) => result.passed).length,
  failed: completed.filter((result) => !result.passed).length,
  total_model_calls: checkpoint.metrics.model_calls,
  average_model_calls_per_scenario: completed.length ? Number((checkpoint.metrics.model_calls / completed.length).toFixed(2)) : 0,
  rate_limit_retries: checkpoint.metrics.rate_limit_retries,
  status: blocked ? 'LIVE BENCHMARK SMOKE BLOCKED' : completed.length === scenarios.length ? 'COMPLETE' : 'INCOMPLETE',
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = blocked ? 0 : completed.some((result) => !result.passed) ? 1 : 0;
