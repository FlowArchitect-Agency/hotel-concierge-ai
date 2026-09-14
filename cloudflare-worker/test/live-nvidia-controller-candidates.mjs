/**
 * Read-only NVIDIA candidate qualification for Task 13B.4F. This deliberately
 * exercises the existing Worker/controller contract; it does not alter it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';
import { parseSemanticControllerOutput } from '../src/semantic-controller.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const origin = 'https://flowarchitect-agency.github.io';
const endpoint = 'https://integrate.api.nvidia.com/v1/chat/completions';
const checkpointPath = path.join(os.tmpdir(), 'conciergeflow-task13b-nvidia-controller-candidates.json');
const intervalMs = 1_600; // NVIDIA account page: up to 40 RPM.
// Match the 30-second NVIDIA bound used by the 20-scenario evaluator. A
// slower candidate is not usable for a conversational concierge and should
// not consume the entire qualification window.
const timeoutMs = 30_000;
const candidates = [
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'deepseek-ai/deepseek-v4-flash-0731',
  'moonshotai/kimi-k3',
];

const cases = [
  {
    id: 'context-no-why',
    message: 'No, why?',
    history: [{ role: 'assistant', message: 'Is this your first time in Paris?' }],
    expectedTools: [],
    expected: (plan) => plan.interactionType === 'conversation'
      && plan.referenceTarget === 'previous_question'
      && !Object.values(plan.toolNeeds).some(Boolean),
  },
  {
    id: 'spa-choice',
    message: 'Which one would you choose?',
    history: [{ role: 'assistant', message: 'The spa offers a couples massage and a hammam ritual.' }],
    expectedTools: ['hotel_services'],
    expected: (plan) => plan.toolNeeds.hotelServices && !plan.toolNeeds.externalSearch && !plan.toolNeeds.guestRequest,
  },
  {
    id: 'external-preference',
    message: 'My girlfriend hates tourist stuff, any ideas?',
    history: [],
    expectedTools: ['external_search'],
    expected: (plan) => plan.interactionType === 'external_discovery' && plan.toolNeeds.externalSearch,
  },
  {
    id: 'multi-tool-maintenance-dining',
    message: 'My room is freezing and can you find somewhere for dinner tonight?',
    history: [],
    expectedTools: ['hotel_services', 'guest_request'],
    expected: (plan) => plan.toolNeeds.hotelServices && plan.toolNeeds.guestRequest,
  },
  {
    id: 'cancel-and-reschedule',
    message: 'Actually forget that, same thing tomorrow.',
    history: [{ role: 'assistant', message: 'I can prepare a dinner request for this evening.' }],
    expectedTools: ['guest_request'],
    expected: (plan) => plan.topicChanged && plan.toolNeeds.guestRequest,
  },
];

function privateValues() {
  const values = {};
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const at = line.indexOf('=');
    if (at > 0) values[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  const nvidiaKey = process.env.NVIDIA_API_KEY || values.NVIDIA_API_KEY;
  for (const name of ['GROQ_API_KEY', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID']) {
    if (!values[name]) throw new Error(`${name} is required in local private configuration.`);
  }
  if (!nvidiaKey) throw new Error('NVIDIA_API_KEY_REQUIRED');
  return { values, nvidiaKey };
}

const fingerprint = JSON.stringify({ candidates, cases: cases.map(({ id, message, history }) => ({ id, message, history })) });
function fresh() {
  return {
    version: 1,
    fingerprint,
    provider: { name: 'nvidia', endpoint },
    candidates: {},
    metrics: { modelCalls: 0, controllerCalls: 0, responseCalls: 0, rateLimitRetries: 0 },
    last_rate_limit: null,
  };
}
let checkpoint;
try {
  const parsed = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  checkpoint = parsed?.version === 1 && parsed?.fingerprint === fingerprint ? parsed : fresh();
} catch { checkpoint = fresh(); }
function save() { fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`); }

function rateLimitMetadata(response) {
  const allowed = [
    'retry-after', 'retry-after-ms', 'x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests',
    'x-ratelimit-reset-requests', 'x-ratelimit-limit-tokens', 'x-ratelimit-remaining-tokens', 'x-ratelimit-reset-tokens',
  ];
  const headers = Object.fromEntries(allowed.map((name) => [name, response.headers.get(name) || null]));
  return { status: 429, observed_at: new Date().toISOString(), headers };
}

const { values, nvidiaKey } = privateValues();
const env = { ...values, ALLOWED_ORIGIN: origin, HOTEL_NAME: values.HOTEL_NAME || 'Hôtel Lumière Paris', HOTEL_CITY: values.HOTEL_CITY || 'Paris' };
const originalFetch = globalThis.fetch;
let lastModelAt = 0;
let active = null;

async function nvidiaFetch(body) {
  const delay = intervalMs - (Date.now() - lastModelAt);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  lastModelAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await originalFetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${nvidiaKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

globalThis.fetch = async (input, init) => {
  if (!String(input).includes('api.groq.com/openai/v1/chat/completions')) return originalFetch(input, init);
  const originalBody = JSON.parse(init?.body || '{}');
  const prompt = originalBody.messages?.[0]?.content || '';
  const isController = /semantic conversation controller/i.test(prompt);
  const { reasoning_effort: _effort, reasoning_format: _format, ...body } = originalBody;
  body.model = active.model;
  checkpoint.metrics.modelCalls += 1;
  if (isController) checkpoint.metrics.controllerCalls += 1;
  else checkpoint.metrics.responseCalls += 1;
  active.modelCalls.total += 1;
  if (isController) active.modelCalls.controller += 1;
  else active.modelCalls.response += 1;
  save();
  const response = await nvidiaFetch(body);
  if (response.status === 429) {
    checkpoint.metrics.rateLimitRetries += 1;
    checkpoint.last_rate_limit = rateLimitMetadata(response);
    active.rateLimited = true;
    save();
  }
  if (isController && response.ok) {
    const content = (await response.clone().json().catch(() => null))?.choices?.[0]?.message?.content || '';
    active.controllerOutput = String(content).slice(0, 2_000);
    active.plan = parseSemanticControllerOutput(content, { language: 'en' });
  }
  return response;
};

function planSummary(plan) {
  return plan ? {
    valid: Boolean(plan.valid), interactionType: plan.interactionType || null, referenceTarget: plan.referenceTarget || null,
    serviceCategories: plan.serviceCategories || [], toolNeeds: plan.toolNeeds || {}, language: plan.language || null,
  } : null;
}

async function basic(model) {
  const started = Date.now();
  try {
    const response = await nvidiaFetch({
      model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], temperature: 1, top_p: 1, max_tokens: 16, stream: false,
    });
    const text = await response.text();
    let content = '';
    if (response.ok) {
      try {
        content = JSON.parse(text).choices?.[0]?.message?.content || '';
      } catch {
        return { passed: false, http_status: response.status, latency_ms: Date.now() - started, failure: 'invalid_provider_json' };
      }
    }
    return { passed: response.status === 200, http_status: response.status, latency_ms: Date.now() - started, usable_content: Boolean(String(content).trim()) };
  } catch (error) {
    return { passed: false, http_status: null, latency_ms: Date.now() - started, failure: error?.name === 'AbortError' ? 'timeout' : 'request_error' };
  }
}

async function runCase(model, testCase, run) {
  const started = Date.now();
  active = { model, plan: null, controllerOutput: '', rateLimited: false, modelCalls: { total: 0, controller: 0, response: 0 } };
  try {
    const response = await worker.fetch(new Request('https://worker.local/api/chat', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: testCase.message, sessionId: `task13b_candidate_${model.replace(/[^a-z0-9]/gi, '_')}_${testCase.id}_${run}`, chatHistory: testCase.history, testMode: 'read_only', testRunId: 'task13b_candidate_model_selection' }),
    }), env, { waitUntil() { throw new Error('Candidate evaluation attempted a write.'); } });
    const body = await response.json();
    const observed = body.observability || {};
    const plan = active.plan;
    const responseSafe = String(body.reply || '').trim().length >= 18
      && !/booking is confirmed|availability is confirmed|staff (?:has been )?notified/i.test(String(body.reply || ''));
    const requestedTools = observed.tools_requested || [];
    const expectedTools = testCase.expectedTools || [];
    const toolSelectionCorrect = expectedTools.length === requestedTools.length
      && expectedTools.every((tool) => requestedTools.includes(tool));
    const passed = !active.rateLimited && response.status === 200 && Boolean(plan?.valid)
      && testCase.expected(plan) && toolSelectionCorrect && responseSafe;
    return {
      id: `${testCase.id}-${run}`, passed, http_status: response.status, latency_ms: Date.now() - started,
      plan: planSummary(plan), expected_tools: expectedTools, tool_selection_correct: toolSelectionCorrect,
      tools_requested: requestedTools, tools_executed: observed.tools_executed || [],
      tool_statuses: observed.tool_statuses || {}, model_calls: active.modelCalls,
      failure: passed ? null : active.rateLimited ? 'rate_limited' : !plan?.valid ? 'semantic_plan_invalid'
        : !testCase.expected(plan) ? 'semantic_expectation_failed' : !toolSelectionCorrect ? 'tool_selection_failed'
          : !responseSafe ? 'response_safety_or_quality_failed' : 'contract_expectation_failed',
    };
  } catch (error) {
    return {
      id: `${testCase.id}-${run}`, passed: false, http_status: null, latency_ms: Date.now() - started,
      plan: planSummary(active.plan), tools_requested: [], tools_executed: [], tool_statuses: {}, model_calls: active.modelCalls,
      failure: active.rateLimited ? 'rate_limited' : error?.name === 'AbortError' ? 'timeout' : 'worker_request_error',
    };
  } finally {
    active = null;
  }
}

async function evaluateCandidate(model) {
  const existing = checkpoint.candidates[model];
  if (existing?.complete) return existing;
  const result = existing || { model, basic: null, cases: [], complete: false };
  if (!result.basic) { result.basic = await basic(model); checkpoint.candidates[model] = result; save(); }
  if (!result.basic.passed) { result.complete = true; save(); return result; }
  const runs = [...cases, cases[0], cases[0]];
  for (let index = result.cases.length; index < runs.length; index += 1) {
    const outcome = await runCase(model, runs[index], index + 1);
    result.cases.push(outcome);
    checkpoint.candidates[model] = result;
    save();
    if (outcome.failure === 'rate_limited') break;
  }
  result.complete = result.cases.length === runs.length;
  save();
  return result;
}

try {
  for (const model of candidates) {
    const result = await evaluateCandidate(model);
    if (result.cases.some((item) => item.failure === 'rate_limited')) break;
  }
} finally {
  globalThis.fetch = originalFetch;
}

const summary = candidates.map((model) => {
  const result = checkpoint.candidates[model] || { model, basic: null, cases: [] };
  const fiveCases = result.cases.slice(0, cases.length);
  const noWhy = result.cases.filter((item) => item.id.startsWith('context-no-why-'));
  const average = result.cases.length ? Math.round(result.cases.reduce((sum, item) => sum + item.latency_ms, 0) / result.cases.length) : null;
  return { model, basic: result.basic?.passed ? 'PASS' : result.basic ? 'FAIL' : 'NOT_RUN', structured_cases: `${fiveCases.filter((item) => item.passed).length}/5`, no_why_reliability: `${noWhy.filter((item) => item.passed).length}/3`, average_latency_ms: average };
});
console.log(JSON.stringify({ checkpoint: checkpointPath, candidates: summary, rate_limit_retries: checkpoint.metrics.rateLimitRetries }));
