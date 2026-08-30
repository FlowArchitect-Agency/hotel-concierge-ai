/**
 * Twenty real-model, read-only tool-planning checks. This reuses Task 13A's
 * checkpoint/rate-limit principles but keeps its results separate.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';
import { parseSemanticControllerOutput } from '../src/semantic-controller.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const origin = 'https://flowarchitect-agency.github.io';
const LONG_WAIT_MS = 60_000;
const MAX_RETRIES = 3;
const NVIDIA_REQUEST_TIMEOUT_MS = 30_000;

function readPrivateValues() {
  const values = {};
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const at = line.indexOf('=');
    if (at > 0) values[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function configuredValue(name, values, fallback = '') {
  return process.env[name] || values[name] || fallback;
}

function resolveProvider(values) {
  const name = configuredValue('LIVE_EVAL_PROVIDER', values, 'groq').trim().toLowerCase();
  assert.ok(['groq', 'nvidia'].includes(name), 'LIVE_EVAL_PROVIDER must be "groq" or "nvidia".');
  const nvidia = name === 'nvidia';
  const apiKeyName = nvidia ? 'NVIDIA_API_KEY' : 'GROQ_API_KEY';
  const apiKey = configuredValue(apiKeyName, values);
  assert.ok(apiKey, nvidia ? 'NVIDIA_API_KEY_REQUIRED' : 'GROQ_API_KEY is required in local private configuration.');
  const baseUrl = configuredValue('LIVE_EVAL_BASE_URL', values, nvidia
    ? 'https://integrate.api.nvidia.com/v1'
    : 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  const model = configuredValue('LIVE_EVAL_MODEL', values, nvidia
    ? 'openai/gpt-oss-120b'
    : (values.GROQ_ROUTER_MODEL || values.GROQ_MODEL || 'qwen/qwen3.6-27b'));
  return { name, apiKey, baseUrl, model, endpoint: `${baseUrl}/chat/completions` };
}

function providerDescriptor(provider) {
  return { name: provider.name, base_url: provider.baseUrl, model: provider.model };
}

function privateEnv(values) {
  for (const name of ['GROQ_API_KEY', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID']) assert.ok(values[name], `${name} is required in local private configuration.`);
  return { ...values, ALLOWED_ORIGIN: origin, HOTEL_NAME: values.HOTEL_NAME || 'Hôtel Lumière Paris', HOTEL_CITY: values.HOTEL_CITY || 'Paris' };
}

const scenarios = [
  ['tool-01', 'No, why?', [{ role: 'assistant', message: 'Is this your first time in Paris?' }], []],
  ['tool-02', 'What would you suggest?', [{ role: 'assistant', message: 'The spa offers a couples massage and a hammam ritual.' }], ['hotel_services']],
  ['tool-03', 'What time is breakfast and can you arrange an airport transfer?', [], ['hotel_facts', 'hotel_services', 'guest_request']],
  ['tool-04', 'My room is freezing and we would like dinner tonight.', [], ['hotel_services', 'guest_request']],
  ['tool-05', 'Please bring towels and find a romantic place for dinner nearby.', [], ['external_search', 'guest_request']],
  ['tool-06', 'The shower is broken. Could we also arrange a couples massage tomorrow?', [], ['hotel_services', 'guest_request']],
  ['tool-07', 'Forget dinner. Find live jazz in Paris tonight instead.', [{ role: 'assistant', message: 'Le Jardin is our preferred dinner option.' }], ['external_search']],
  ['tool-08', 'Show me your spa options and prepare a request for tomorrow.', [], ['hotel_services', 'guest_request']],
  ['tool-09', 'Actually cancel that and arrange an airport transfer.', [{ role: 'assistant', message: 'I have prepared a dinner request for 20:00.' }], ['hotel_services', 'guest_request']],
  ['tool-10', 'Where is breakfast? Also find something non-touristy for this evening.', [], ['hotel_facts', 'external_search']],
  ['tool-11', 'I have been here five times. Surprise me with a quiet experience.', [], ['hotel_services']],
  ['tool-12', 'Can you tell me the parking policy and arrange a taxi?', [], ['hotel_facts', 'hotel_services', 'guest_request']],
  ['tool-13', 'The Wi-Fi is down and I need somewhere for dinner.', [], ['hotel_services', 'guest_request']],
  ['tool-14', 'A quiet spa treatment and a romantic table, please.', [], ['hotel_services']],
  ['tool-15', 'I need a real person for a sensitive issue and an airport transfer tomorrow.', [], ['hotel_services', 'guest_request', 'human_takeover']],
  ['tool-16', 'Find an Indian restaurant in Paris and keep it vegetarian-friendly.', [], ['external_search']],
  ['tool-17', 'My air conditioning has failed and I would also like a massage tomorrow.', [], ['hotel_services', 'guest_request']],
  ['tool-18', 'Could you explain checkout and find a quiet jazz bar tonight?', [], ['hotel_facts', 'external_search']],
  ['tool-19', 'Plan a private tour and an accessible place for dinner.', [], ['hotel_services', 'external_search']],
  ['tool-20', 'The room key is broken; please arrange dinner after that.', [], ['hotel_services', 'guest_request']],
].map(([id, message, history, expectedTools]) => ({ id, message, history, expectedTools }));

// Expectations may be clarified after a legitimate semantic interpretation;
// checkpoints are keyed to the guest turns, not an assertion-only edit.
const fingerprint = JSON.stringify(scenarios.map(({ id, message, history }) => ({ id, message, history })));
const isRateLimitSelfTest = process.argv.includes('--self-test-rate-limit');
const isProviderTransportSelfTest = process.argv.includes('--self-test-provider-transport');
const isLocalSelfTest = isRateLimitSelfTest || isProviderTransportSelfTest;
const privateValues = isLocalSelfTest ? {} : readPrivateValues();
const requestedProviderName = configuredValue('LIVE_EVAL_PROVIDER', privateValues, 'groq').trim().toLowerCase();
assert.ok(['groq', 'nvidia'].includes(requestedProviderName), 'LIVE_EVAL_PROVIDER must be "groq" or "nvidia".');
const checkpointPath = path.resolve(process.env.LIVE_TOOL_EVAL_CHECKPOINT || path.join(
  os.tmpdir(),
  requestedProviderName === 'nvidia'
    ? 'conciergeflow-task13b-live-tool-evals-nvidia.json'
    : 'conciergeflow-task13b-live-tool-evals.json',
));
const liveProvider = isLocalSelfTest ? null : resolveProvider(privateValues);
const checkpointProvider = liveProvider ? providerDescriptor(liveProvider) : { name: 'local-self-test', base_url: '', model: '' };
// NVIDIA's account page reports 40 requests/minute. 1.6s remains below that
// ceiling while Groq retains the deliberately conservative prior pacing.
const modelIntervalMs = liveProvider?.name === 'nvidia' ? 1_600 : 15_000;

function fresh() {
  return {
    version: 1,
    fingerprint,
    provider: checkpointProvider,
    results: {},
    metrics: { modelCalls: 0, controllerModelCalls: 0, responseModelCalls: 0, preflightModelCalls: 0, rateLimitRetries: 0 },
    nextRetryAt: 0,
    last_rate_limit: null,
    diagnostic_preflights: [],
    diagnostic_runs: [],
  };
}
let checkpoint;
try {
  const parsed = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  const compatible = parsed?.version === 1 && parsed?.results
    && Object.keys(parsed.results).every((id) => scenarios.some((scenario) => scenario.id === id))
    && (!parsed.provider || (parsed.provider.name === checkpointProvider.name
      && parsed.provider.base_url === checkpointProvider.base_url
      && parsed.provider.model === checkpointProvider.model));
  if (compatible) checkpoint = { ...parsed, fingerprint };
  else {
    checkpoint = fresh();
    // A failed 120B diagnostic must not count toward the clean 20B suite, but
    // retaining its sanitized preflight record keeps the provider history.
    if (parsed?.provider?.name === 'nvidia' && parsed?.preflight) {
      checkpoint.diagnostic_preflights.push({ provider: parsed.provider, ...parsed.preflight });
    }
    // NVIDIA candidates receive clean scenario scoring. Keep prior sanitized
    // diagnostic outcomes so an earlier model failure is never mistaken for
    // a result from the selected model.
    if (parsed?.provider?.name === 'nvidia') {
      checkpoint.diagnostic_runs.push(...(Array.isArray(parsed.diagnostic_runs) ? parsed.diagnostic_runs : []));
      const priorResults = Object.values(parsed.results || {});
      if (priorResults.length || parsed?.preflight) {
        checkpoint.diagnostic_runs.push({
          provider: parsed.provider,
          preflight_status: parsed?.preflight?.status || null,
          completed: priorResults.length,
          passed: priorResults.filter((result) => result.status === 'passed').length,
          failed: priorResults.filter((result) => result.status === 'failed').length,
        });
      }
    }
  }
} catch { checkpoint = fresh(); }
function save() { fs.mkdirSync(path.dirname(checkpointPath), { recursive: true }); fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function parseDurationMs(value, observedAt = Date.now()) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 1_000;
  const duration = text.match(/^(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec(?:onds?)?|m|min(?:utes?)?|h|hours?)$/);
  if (duration) {
    const amount = Number(duration[1]);
    const unit = duration[2];
    if (unit.startsWith('h')) return amount * 3_600_000;
    if (unit === 'm' || unit.startsWith('min')) return amount * 60_000;
    if (unit.startsWith('ms')) return amount;
    return amount * 1_000;
  }
  const date = Date.parse(String(value));
  return Number.isFinite(date) && date > observedAt ? date - observedAt : null;
}

function parseMillisecondsHeader(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return parseDurationMs(text);
}

function headerValue(response, name) {
  const value = response.headers.get(name);
  return value && value.trim() ? value.trim() : null;
}

function rateLimitMetadata(response, observedAt = Date.now()) {
  const retryAfter = headerValue(response, 'retry-after');
  const retryAfterMs = headerValue(response, 'retry-after-ms');
  const requestReset = headerValue(response, 'x-ratelimit-reset-requests');
  const tokenReset = headerValue(response, 'x-ratelimit-reset-tokens');
  const globalReset = headerValue(response, 'x-ratelimit-reset');
  const retryAfterWaitMs = parseDurationMs(retryAfter, observedAt);
  const retryAfterHeaderMs = parseMillisecondsHeader(retryAfterMs);
  const requestResetMs = parseDurationMs(requestReset, observedAt);
  const tokenResetMs = parseDurationMs(tokenReset, observedAt);
  const globalResetMs = parseDurationMs(globalReset, observedAt);
  const safeWaitMs = Math.max(0, ...[
    retryAfterWaitMs,
    retryAfterHeaderMs,
    requestResetMs,
    tokenResetMs,
    globalResetMs,
  ].filter((value) => Number.isFinite(value) && value > 0));

  // This is deliberately an allowlist. It records only provider rate-limit
  // information and cannot serialize request credentials or other headers.
  return {
    status: 429,
    observed_at: new Date(observedAt).toISOString(),
    retry_after: retryAfter,
    retry_after_seconds: retryAfterWaitMs === null ? null : retryAfterWaitMs / 1_000,
    retry_after_ms: retryAfterHeaderMs,
    request_limit: headerValue(response, 'x-ratelimit-limit-requests'),
    request_remaining: headerValue(response, 'x-ratelimit-remaining-requests'),
    request_reset: requestReset,
    request_reset_ms: requestResetMs,
    token_limit: headerValue(response, 'x-ratelimit-limit-tokens'),
    token_remaining: headerValue(response, 'x-ratelimit-remaining-tokens'),
    token_reset: tokenReset,
    token_reset_ms: tokenResetMs,
    global_limit: headerValue(response, 'x-ratelimit-limit'),
    global_remaining: headerValue(response, 'x-ratelimit-remaining'),
    global_reset: globalReset,
    global_reset_ms: globalResetMs,
    safe_retry_at: safeWaitMs > 0 ? new Date(observedAt + safeWaitMs).toISOString() : null,
  };
}

function storeRateLimitMetadata(targetCheckpoint, response, observedAt = Date.now()) {
  const metadata = rateLimitMetadata(response, observedAt);
  targetCheckpoint.last_rate_limit = metadata;
  return metadata;
}

function retryMs(metadata) {
  if (!metadata?.safe_retry_at) return LONG_WAIT_MS;
  const waitMs = Date.parse(metadata.safe_retry_at) - Date.now();
  return Number.isFinite(waitMs) && waitMs > 0 ? waitMs : LONG_WAIT_MS;
}

function providerTransportRequest(provider, input, init) {
  if (provider.name !== 'nvidia') return { input, init };
  const body = JSON.parse(init?.body || '{}');
  // These fields are specific to Groq's Qwen transport. NVIDIA NIM receives
  // the standard OpenAI-compatible payload only.
  const { reasoning_effort: _reasoningEffort, reasoning_format: _reasoningFormat, ...nvidiaBody } = body;
  return {
    input: provider.endpoint,
    init: {
      method: init?.method || 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...nvidiaBody, model: provider.model }),
    },
  };
}

async function providerFetch(provider, input, init) {
  if (provider.name !== 'nvidia') return originalFetch(input, init);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NVIDIA_REQUEST_TIMEOUT_MS);
  try {
    return await originalFetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function runRateLimitSelfTest() {
  const observedAt = Date.parse('2026-08-30T09:00:00.000Z');
  const simulatedCheckpoint = fresh();
  const metadata = storeRateLimitMetadata(simulatedCheckpoint, new Response(null, {
    status: 429,
    headers: {
      'Retry-After': '12',
      'retry-after-ms': '5000',
      'x-ratelimit-limit-requests': '1000',
      'x-ratelimit-remaining-requests': '0',
      'x-ratelimit-reset-requests': '8s',
      'x-ratelimit-limit-tokens': '6000',
      'x-ratelimit-remaining-tokens': '0',
      'x-ratelimit-reset-tokens': '15s',
      'authorization': 'must-not-be-persisted',
    },
  }), observedAt);
  assert.equal(metadata.status, 429);
  assert.equal(metadata.retry_after_seconds, 12);
  assert.equal(metadata.retry_after_ms, 5_000);
  assert.equal(metadata.request_reset_ms, 8_000);
  assert.equal(metadata.token_reset_ms, 15_000);
  assert.equal(metadata.safe_retry_at, '2026-08-30T09:00:15.000Z');
  assert.deepEqual(simulatedCheckpoint.last_rate_limit, metadata);
  assert.equal(JSON.stringify(metadata).includes('must-not-be-persisted'), false);

  const noHintMetadata = rateLimitMetadata(new Response(null, { status: 429, headers: { authorization: 'also-not-persisted' } }), observedAt);
  assert.equal(noHintMetadata.safe_retry_at, null);
  assert.equal(noHintMetadata.retry_after_seconds, null);
  assert.equal(JSON.stringify(noHintMetadata).includes('also-not-persisted'), false);
  console.log('RATE-LIMIT METADATA SELF-TEST: PASS');
}

function runProviderTransportSelfTest() {
  const provider = {
    name: 'nvidia', apiKey: 'local-test-placeholder', baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'openai/gpt-oss-120b', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
  };
  const request = providerTransportRequest(provider, 'https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer groq-test-placeholder', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen/qwen3.6-27b', response_format: { type: 'json_object' }, reasoning_effort: 'none', reasoning_format: 'hidden' }),
  });
  const body = JSON.parse(request.init.body);
  assert.equal(request.input, provider.endpoint);
  assert.equal(request.init.headers.Authorization, 'Bearer local-test-placeholder');
  assert.equal(body.model, provider.model);
  assert.equal('reasoning_effort' in body, false);
  assert.equal('reasoning_format' in body, false);
  console.log('NVIDIA PROVIDER TRANSPORT SELF-TEST: PASS');
}

const env = isLocalSelfTest ? null : privateEnv(privateValues);
const originalFetch = globalThis.fetch;
let lastModelAt = 0;
let current = null;
let rateLimitedMs = 0;
async function interceptedFetch(input, init) {
  const target = String(input);
  if (target.includes('api.groq.com/openai/v1/chat/completions')) {
    const delay = modelIntervalMs - (Date.now() - lastModelAt);
    if (delay > 0) await sleep(delay);
    lastModelAt = Date.now();
    const prompt = JSON.parse(init?.body || '{}').messages?.[0]?.content || '';
    const controller = /semantic conversation controller/i.test(prompt);
    checkpoint.metrics.modelCalls += 1;
    if (controller) checkpoint.metrics.controllerModelCalls += 1; else checkpoint.metrics.responseModelCalls += 1;
    if (current) { current.modelCalls.total += 1; if (controller) current.modelCalls.controller += 1; else current.modelCalls.response += 1; }
    save();
    const transport = providerTransportRequest(liveProvider, input, init);
    const response = await providerFetch(liveProvider, transport.input, transport.init);
    if (response.status === 429) {
      const metadata = storeRateLimitMetadata(checkpoint, response);
      checkpoint.metrics.rateLimitRetries += 1;
      if (current) current.retries += 1;
      rateLimitedMs = retryMs(metadata);
      save();
    }
    if (controller && response.ok && current) {
      const content = (await response.clone().json().catch(() => null))?.choices?.[0]?.message?.content || '';
      current.controllerOutput = String(content).slice(0, 2_000);
      current.plan = parseSemanticControllerOutput(content, { language: 'en' });
    }
    return response;
  }
  return originalFetch(input, init);
}

async function runNvidiaPreflight() {
  if (liveProvider.name !== 'nvidia') return { passed: true, skipped: true };
  current = { plan: null, controllerOutput: '', retries: 0, modelCalls: { total: 0, controller: 0, response: 0 } };
  rateLimitedMs = 0;
  const started = Date.now();
  try {
    const response = await worker.fetch(new Request('https://worker.local/api/chat', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'No, why?',
        sessionId: 'task13b_nvidia_preflight',
        chatHistory: [{ role: 'assistant', message: 'Is this your first time in Paris?' }],
        testMode: 'read_only',
        testRunId: 'task13b_nvidia_preflight',
      }),
    }), env, { waitUntil() { throw new Error('NVIDIA preflight attempted a write.'); } });
    const body = await response.json();
    if (rateLimitedMs > 0) {
      checkpoint.preflight = { status: 'rate_limited', observed_at: new Date().toISOString(), http_status: 429 };
      save();
      return { passed: false, rateLimited: true };
    }
    assert.equal(response.status, 200, `NVIDIA preflight: HTTP ${response.status}`);
    assert.equal(current.plan?.valid, true, 'NVIDIA preflight: controller returned an invalid semantic plan');
    const observed = body.observability;
    assert.ok(observed, 'NVIDIA preflight: read-only observability missing');
    assert.equal(observed.tools_requested.length, 0, 'NVIDIA preflight: unnecessary tool requested');
    assert.ok(String(body.reply || '').trim().length >= 18, 'NVIDIA preflight: response generator returned an unusable reply');
    assert.ok(current.modelCalls.controller >= 1, 'NVIDIA preflight: controller model call missing');
    assert.ok(current.modelCalls.response >= 1, 'NVIDIA preflight: response-generator model call missing');
    checkpoint.preflight = {
      status: 'passed',
      observed_at: new Date().toISOString(),
      http_status: response.status,
      semantic_controller_valid: true,
      tools_requested: observed.tools_requested,
      controller_model_calls: current.modelCalls.controller,
      response_model_calls: current.modelCalls.response,
      latency_ms: Date.now() - started,
    };
    save();
    return { passed: true };
  } catch (error) {
    checkpoint.preflight = {
      status: 'failed', observed_at: new Date().toISOString(), http_status: null,
      failure: error?.name === 'AbortError' ? 'timeout' : String(error?.message || 'request_error').slice(0, 300),
      controller_model_calls: current?.modelCalls?.controller || 0,
      response_model_calls: current?.modelCalls?.response || 0,
      latency_ms: Date.now() - started,
    };
    save();
    return { passed: false };
  } finally {
    current = null;
  }
}

async function evaluate(scenario) {
  let error = null;
  let lastDetails = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    current = { plan: null, controllerOutput: '', retries: 0, modelCalls: { total: 0, controller: 0, response: 0 } };
    lastDetails = current;
    rateLimitedMs = 0;
    const started = Date.now();
    try {
      const response = await worker.fetch(new Request('https://worker.local/api/chat', {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: scenario.message, sessionId: `task13b_live_${scenario.id}_${attempt}`, chatHistory: scenario.history, testMode: 'read_only', testRunId: 'task13b_live_tools' }),
      }), env, { waitUntil() { throw new Error('Live tool evaluation attempted a write.'); } });
      const body = await response.json();
      // A second 429 within one turn is a quota/reset signal even when the
      // provider's Retry-After is short or missing. Checkpoint conservatively
      // instead of consuming fallback-model quota with repeated retries.
      if (rateLimitedMs > 0 && (rateLimitedMs >= LONG_WAIT_MS || current.retries >= 1)) {
        checkpoint.nextRetryAt = Date.now() + Math.max(rateLimitedMs, LONG_WAIT_MS); save(); return { rateLimited: true };
      }
      assert.equal(response.status, 200, `${scenario.id}: HTTP ${response.status}`);
      assert.equal(current.plan?.valid, true, `${scenario.id}: semantic controller plan invalid`);
      const observed = body.observability;
      assert.ok(observed, `${scenario.id}: test-only observability missing`);
      for (const tool of scenario.expectedTools) assert.ok(observed.tools_requested.includes(tool), `${scenario.id}: missing ${tool}`);
      assert.ok(String(body.reply || '').trim().length >= 18, `${scenario.id}: unnatural empty response`);
      assert.doesNotMatch(String(body.reply || ''), /booking is confirmed|availability is confirmed|staff (?:has been )?notified/i, `${scenario.id}: fabricated action`);
      checkpoint.results[scenario.id] = { id: scenario.id, status: 'passed', turns: 1, expectedTools: scenario.expectedTools, plan: { interactionType: current.plan.interactionType, serviceCategory: current.plan.serviceCategory, toolNeeds: current.plan.toolNeeds }, toolsRequested: observed.tools_requested, toolsExecuted: observed.tools_executed, toolStatuses: observed.tool_statuses, modelCalls: current.modelCalls, providerUsed: observed.provider_used, fallbackUsed: observed.fallback_used, retries: current.retries, latencyMs: Date.now() - started };
      checkpoint.nextRetryAt = 0; save(); return { passed: true };
    } catch (caught) {
      error = caught;
      if (rateLimitedMs > 0 && (rateLimitedMs >= LONG_WAIT_MS || lastDetails?.retries >= 1)) {
        checkpoint.nextRetryAt = Date.now() + Math.max(rateLimitedMs, LONG_WAIT_MS); save(); return { rateLimited: true };
      }
      if (attempt < MAX_RETRIES) await sleep(Math.min(5_000 * attempt, 15_000));
    } finally { current = null; }
  }
  checkpoint.results[scenario.id] = {
    id: scenario.id, status: 'failed', failure: String(error?.message || 'Unknown failure').slice(0, 500),
    controllerOutput: String(lastDetails?.controllerOutput || '').slice(0, 2_000),
  };
  save(); return { passed: false };
}

function summary(status) {
  const results = Object.values(checkpoint.results);
  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const turns = results.reduce((sum, result) => sum + (result.turns || 0), 0);
  const preflightCalls = Number(checkpoint.metrics.preflightModelCalls || 0);
  console.log(`LIVE TOOL EVAL CHECKPOINT: ${checkpointPath}`);
  console.log(`LIVE ${liveProvider.name.toUpperCase()} TOOL SCENARIOS: ${results.length}/20`);
  console.log(`LIVE EVALUATION MODEL: ${liveProvider.model}`);
  if (liveProvider.name === 'nvidia') console.log(`NVIDIA PREFLIGHT: ${checkpoint.preflight?.status === 'passed' ? 'PASS' : 'FAIL'}`);
  console.log(`PASSED: ${passed}/20`);
  console.log(`FAILED: ${failed}`);
  console.log(`TOTAL MODEL CALLS: ${Number(checkpoint.metrics.modelCalls || 0) + preflightCalls}`);
  console.log(`CONTROLLER CALLS: ${checkpoint.metrics.controllerModelCalls || 0}`);
  console.log(`RESPONSE-GENERATOR CALLS: ${checkpoint.metrics.responseModelCalls || 0}`);
  console.log(`AVERAGE MODEL CALLS PER TURN: ${turns ? (checkpoint.metrics.modelCalls / turns).toFixed(2) : '0.00'}`);
  console.log(`RATE-LIMIT RETRIES: ${checkpoint.metrics.rateLimitRetries}`);
  if (status === 'rate') console.log(liveProvider.name === 'nvidia' ? 'NVIDIA_RATE_LIMIT_WAIT_REQUIRED' : 'RATE_LIMIT_WAIT_REQUIRED');
  else if (status === 'preflight') console.log('NVIDIA_PREFLIGHT_FAILED');
  else if (failed) console.log('SEMANTIC_QUALITY_BLOCKER');
  else if (passed === 20) console.log(`TASK 13B ${liveProvider.name.toUpperCase()} TOOL SCENARIOS: 20/20 passed`);
}

async function runScenarioSuite() {
  const wait = checkpoint.nextRetryAt - Date.now();
  if (wait >= LONG_WAIT_MS) {
    summary('rate');
    return;
  }
  if (wait > 0) await sleep(wait);
  let stopStatus = 'complete';
  for (const scenario of scenarios) {
    if (checkpoint.results[scenario.id]?.status === 'passed') continue;
    console.log(`Evaluating ${scenario.id}`);
    const outcome = await evaluate(scenario);
    if (outcome.rateLimited) { stopStatus = 'rate'; break; }
    if (!outcome.passed) { stopStatus = 'failed'; break; }
  }
  summary(stopStatus);
}

if (isRateLimitSelfTest) {
  runRateLimitSelfTest();
} else if (isProviderTransportSelfTest) {
  runProviderTransportSelfTest();
} else {
  globalThis.fetch = interceptedFetch;
  try {
    if (liveProvider.name === 'nvidia' && checkpoint.preflight?.status !== 'passed') {
      const preflight = await runNvidiaPreflight();
      if (!preflight.passed) summary(preflight.rateLimited ? 'rate' : 'preflight');
      else await runScenarioSuite();
    } else {
      await runScenarioSuite();
    }
  } finally { globalThis.fetch = originalFetch; }
}
