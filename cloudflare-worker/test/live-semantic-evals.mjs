/**
 * Read-only semantic architecture check. This calls the configured Groq model
 * through the local Worker while every persistence path is blocked. Results
 * are checkpointed outside the repository, so a provider-rate pause resumes
 * from the first unfinished scenario on a later run.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';
import { parseSemanticControllerOutput } from '../src/semantic-controller.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const origin = 'https://flowarchitect-agency.github.io';
const CHECKPOINT_VERSION = 1;
const MODEL_INTERVAL_MS = 15_000;
const MAX_PROVIDER_RETRIES = 3;
const LONG_WAIT_MS = 60_000;

function privateEnv() {
  const values = {};
  for (const line of fs.readFileSync(path.join(projectRoot, '.env'), 'utf8').split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const separator = line.indexOf('=');
    if (separator > 0) values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  for (const name of ['GROQ_API_KEY', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID']) {
    assert.ok(values[name] && !/^(your_|replace-with)/i.test(values[name]), `${name} is required in private configuration.`);
  }
  return {
    ...values,
    ALLOWED_ORIGIN: origin,
    HOTEL_NAME: values.HOTEL_NAME || 'Hôtel Lumière Paris',
    HOTEL_CITY: values.HOTEL_CITY || 'Paris',
  };
}

const scenarios = [
  { id: 'semantic-01', name: 'no-why reference', message: 'No, why?', history: [{ role: 'assistant', message: 'Is this your first time in Paris?' }], controller: true, external: false },
  { id: 'semantic-02', name: 'yes-why reference', message: 'Yes, why do you ask?', history: [{ role: 'assistant', message: 'Is this your first time in Paris?' }], controller: true, external: false },
  { id: 'semantic-03', name: 'why-do-you-ask reference', message: 'Why do you ask?', history: [{ role: 'assistant', message: 'Is this your first time in Paris?' }], controller: true, external: false },
  { id: 'semantic-04', name: 'returning-visitor statement', message: "I've been here loads of times.", history: [{ role: 'assistant', message: 'Is this your first time in Paris?' }], controller: true, external: false },
  { id: 'semantic-05', name: 'spa suggestion reference', message: 'What do you suggest?', history: [{ role: 'assistant', message: 'The spa offers a couples massage and a hammam ritual.' }], controller: true, external: false },
  { id: 'semantic-06', name: 'dining choice reference', message: 'Which one would you pick?', history: [{ role: 'assistant', message: 'For dinner, I can show the Chef’s Table or the rooftop dinner.' }], controller: true, external: false },
  { id: 'semantic-07', name: 'negative option reference', message: 'Not that one.', history: [{ role: 'assistant', message: 'Would you prefer the couples massage or the hammam ritual?' }], controller: true, external: false },
  { id: 'semantic-08', name: 'other option reference', message: 'The other one.', history: [{ role: 'assistant', message: 'Would you prefer the Chef’s Table or the rooftop dinner?' }], controller: true, external: false },
  { id: 'semantic-09', name: 'reuse request with tomorrow', message: 'Same thing as before but tomorrow.', history: [{ role: 'user', message: 'Could you arrange a transfer from CDG?' }, { role: 'assistant', message: 'I can prepare a transfer request for your arrival.' }], controller: true, external: false },
  { id: 'semantic-10', name: 'topic reset at 2am', message: 'Actually forget all that, what can we do at 2 a.m.?', history: [{ role: 'assistant', message: 'I can arrange a couples massage this evening.' }], controller: true, external: true },
  { id: 'semantic-11', name: 'non-touristy external preference', message: 'My girlfriend hates tourist stuff, any ideas?', history: [], controller: true, external: true },
  { id: 'semantic-12', name: 'quiet refinement', message: 'Anything quieter?', history: [{ role: 'assistant', message: 'The Chef’s Table is a celebratory dining option.' }], controller: true, external: false },
  { id: 'semantic-13', name: 'romantic suggestion', message: 'Something romantic.', history: [{ role: 'assistant', message: 'I can help you choose from the hotel collection.' }], controller: true, external: false },
  { id: 'semantic-14', name: 'hungry direct need', message: "I'm starving.", history: [], controller: false, external: false },
  { id: 'semantic-15', name: 'ambiguous help', message: 'I need help.', history: [], controller: true, external: false },
  { id: 'semantic-16', name: 'serious complaint', message: 'This is unacceptable.', history: [], controller: false, external: false, human: true },
  { id: 'semantic-17', name: 'upstairs assistance', message: 'Can somebody come upstairs?', history: [], controller: true, external: false },
  { id: 'semantic-18', name: 'Spanish reference', message: '¿Cuál escogerías?', history: [{ role: 'assistant', message: 'Puedo ofrecerle dos opciones de cena en el hotel.' }], controller: true, external: false, language: 'es' },
  { id: 'semantic-19', name: 'French contextual preference', message: 'Je voudrais quelque chose de plus calme.', history: [{ role: 'assistant', message: 'Nous avons parlé du spa et du dîner.' }], controller: true, external: false, language: 'fr' },
  { id: 'semantic-20', name: 'typo-heavy comparison', message: 'whch wun wud u pik?', history: [{ role: 'assistant', message: 'I can offer the Chef’s Table or the rooftop dinner.' }], controller: true, external: false },
];

const scenarioFingerprint = JSON.stringify(scenarios.map(({ id, message, history }) => ({ id, message, history })));
const checkpointPath = path.resolve(process.env.LIVE_SEMANTIC_EVAL_CHECKPOINT || path.join(os.tmpdir(), 'conciergeflow-task13a-live-semantic-evals.json'));

function freshCheckpoint() {
  return {
    version: CHECKPOINT_VERSION,
    scenarioFingerprint,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nextRetryAt: 0,
    results: {},
    metrics: { modelCalls: 0, controllerModelCalls: 0, responseModelCalls: 0, rateLimitRetries: 0, externalToolCalls: 0 },
  };
}

function loadCheckpoint() {
  try {
    const parsed = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (parsed?.version === CHECKPOINT_VERSION && parsed.scenarioFingerprint === scenarioFingerprint && parsed.results && parsed.metrics) return parsed;
  } catch { /* First evaluation or an interrupted local checkpoint. */ }
  return freshCheckpoint();
}

const checkpoint = loadCheckpoint();

function saveCheckpoint() {
  checkpoint.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

function pause(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function parseDurationMs(value) {
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

async function retryAfterMs(response) {
  const retryAfter = response.headers.get('retry-after');
  const retryDate = retryAfter && !/^\d/.test(retryAfter) ? Date.parse(retryAfter) - Date.now() : 0;
  const resetHints = [
    retryAfter && parseDurationMs(retryAfter),
    retryDate,
    parseDurationMs(response.headers.get('x-ratelimit-reset-requests')),
    parseDurationMs(response.headers.get('x-ratelimit-reset-tokens')),
    parseDurationMs(response.headers.get('x-ratelimit-reset')),
  ].filter((value) => Number.isFinite(value) && value > 0);
  const text = await response.clone().text().catch(() => '');
  const bodyHint = text.match(/(?:try again|retry after|reset(?:s)? in)[^\d]{0,20}(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|h)/i);
  if (bodyHint) resetHints.push(parseDurationMs(`${bodyHint[1]} ${bodyHint[2]}`));
  return Math.max(0, ...resetHints);
}

function controllerPlanSummary(plan) {
  if (!plan) return null;
  return {
    valid: Boolean(plan.valid), interactionType: plan.interactionType || '', serviceCategory: plan.serviceCategory || null,
    referenceTarget: plan.referenceTarget || 'none', toolNeeds: plan.toolNeeds || {}, language: plan.language || '',
    confidence: Number(plan.confidence || 0), clarificationNeeded: Boolean(plan.clarificationNeeded),
  };
}

function finalResultSummary(body) {
  return {
    intent: body.intent || '', language: body.language || '', requiresHuman: Boolean(body.requires_human), providerFailure: body.provider_failure || '',
    externalOptionCount: Array.isArray(body.external_options) ? body.external_options.length : 0,
    partnerOfferCount: Array.isArray(body.partner_offers) ? body.partner_offers.length : 0,
  };
}

const env = privateEnv();
const originalFetch = globalThis.fetch;
let lastModelAt = 0;
let currentScenario = null;
let rateLimitState = null;

globalThis.fetch = async (input, init) => {
  const target = String(input);
  if (target.includes('api.groq.com/openai/v1/chat/completions')) {
    const elapsed = Date.now() - lastModelAt;
    if (elapsed < MODEL_INTERVAL_MS) await pause(MODEL_INTERVAL_MS - elapsed);
    lastModelAt = Date.now();
    const prompt = JSON.parse(init?.body || '{}').messages?.[0]?.content || '';
    const isController = /semantic conversation controller/i.test(prompt);
    checkpoint.metrics.modelCalls += 1;
    if (isController) checkpoint.metrics.controllerModelCalls += 1;
    else checkpoint.metrics.responseModelCalls += 1;
    if (currentScenario) {
      currentScenario.modelCalls.total += 1;
      if (isController) currentScenario.modelCalls.controller += 1;
      else currentScenario.modelCalls.response += 1;
    }
    saveCheckpoint();

    const response = await originalFetch(input, init);
    if (response.status === 429) {
      const waitMs = await retryAfterMs(response);
      checkpoint.metrics.rateLimitRetries += 1;
      if (currentScenario) currentScenario.providerRetries += 1;
      rateLimitState = { waitMs, detectedAt: Date.now() };
      saveCheckpoint();
      return response;
    }
    if (isController && response.ok) {
      const payload = await response.clone().json().catch(() => null);
      const content = payload?.choices?.[0]?.message?.content || '';
      if (currentScenario) currentScenario.controllerPlan = parseSemanticControllerOutput(content, { language: 'en' });
    }
    return response;
  }
  if (target.includes('app.scrapingbee.com')) {
    checkpoint.metrics.externalToolCalls += 1;
    if (currentScenario) currentScenario.requestedTools.external_search = true;
    saveCheckpoint();
  }
  return originalFetch(input, init);
};

function readonlyContext() {
  return { waitUntil() { throw new Error('Read-only semantic evaluation attempted persistence.'); } };
}

async function turn(scenario, attempt) {
  const response = await worker.fetch(new Request('https://worker.local/api/chat', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: scenario.message,
      sessionId: `semantic_live_${scenario.id}_${attempt}`,
      chatHistory: scenario.history,
      scenario: 'pre-arrival',
      testMode: 'read_only',
      testRunId: 'task13a_live_semantic',
    }),
  }), env, readonlyContext());
  return { response, body: await response.json() };
}

function requestedTools(plan, externalSearchCalled) {
  return {
    hotel_facts: Boolean(plan?.toolNeeds?.hotelFacts), hotel_services: Boolean(plan?.toolNeeds?.hotelServices),
    external_search: Boolean(plan?.toolNeeds?.externalSearch || externalSearchCalled), guest_request: Boolean(plan?.toolNeeds?.guestRequest),
    human_takeover: Boolean(plan?.toolNeeds?.humanTakeover),
  };
}

function rateDelayMs(providerRetries) {
  if (rateLimitState?.waitMs > 0) return rateLimitState.waitMs + 750;
  return Math.min(15_000 * (2 ** Math.max(0, providerRetries - 1)), LONG_WAIT_MS);
}

async function evaluateScenario(scenario) {
  let lastError = null;
  let scenarioRateRetries = 0;
  const scenarioModelCalls = { controller: 0, response: 0, total: 0 };
  for (let attempt = 1; attempt <= MAX_PROVIDER_RETRIES; attempt += 1) {
    rateLimitState = null;
    currentScenario = {
      id: scenario.id, controllerPlan: null, requestedTools: {},
      modelCalls: scenarioModelCalls, providerRetries: scenarioRateRetries,
    };
    const startedAt = Date.now();
    try {
      const { response, body } = await turn(scenario, attempt);
      if (rateLimitState) {
        scenarioRateRetries = currentScenario.providerRetries;
        const delay = rateDelayMs(currentScenario.providerRetries);
        if (delay >= LONG_WAIT_MS) {
          checkpoint.nextRetryAt = Date.now() + delay;
          saveCheckpoint();
          return { rateLimited: true, waitMs: delay };
        }
        await pause(delay);
        continue;
      }
      const plan = currentScenario.controllerPlan;
      const externalSearchCalled = Boolean(currentScenario.requestedTools.external_search);
      assert.equal(response.status, 200, `${scenario.name}: status ${response.status}`);
      assert.ok(String(body.reply || '').trim().length >= 18, `${scenario.name}: reply was too short`);
      assert.equal(body.provider_failure || '', '', `${scenario.name}: model provider failure`);
      assert.doesNotMatch(String(body.reply || ''), /booking is confirmed|availability is confirmed|staff (?:has been )?notified/i, `${scenario.name}: fabricated action`);
      if (scenario.controller) {
        assert.equal(plan?.valid, true, `${scenario.name}: controller output did not validate`);
        assert.ok(plan?.confidence >= 0.35, `${scenario.name}: controller confidence too low`);
      }
      if (scenario.external) {
        assert.equal(externalSearchCalled, true, `${scenario.name}: external capability was not executed`);
        assert.equal((body.partner_offers || []).length, 0, `${scenario.name}: external request became a partner substitution`);
      } else {
        assert.equal(externalSearchCalled, false, `${scenario.name}: unexpected external discovery`);
      }
      if (scenario.language) assert.equal(body.language, scenario.language, `${scenario.name}: language was not preserved`);
      if (scenario.human) assert.equal(body.requires_human, true, `${scenario.name}: serious issue did not retain human attention`);
      checkpoint.results[scenario.id] = {
        id: scenario.id, name: scenario.name, turns: 1, status: 'passed', controller: controllerPlanSummary(plan),
        requestedTools: requestedTools(plan, externalSearchCalled), final: finalResultSummary(body), modelCalls: currentScenario.modelCalls,
        providerRetries: currentScenario.providerRetries, latencyMs: Date.now() - startedAt, completedAt: new Date().toISOString(),
      };
      checkpoint.nextRetryAt = 0;
      saveCheckpoint();
      return { passed: true };
    } catch (error) {
      lastError = error;
      if (rateLimitState) {
        scenarioRateRetries = currentScenario.providerRetries;
        const delay = rateDelayMs(currentScenario.providerRetries);
        if (delay >= LONG_WAIT_MS) {
          checkpoint.nextRetryAt = Date.now() + delay;
          saveCheckpoint();
          return { rateLimited: true, waitMs: delay };
        }
        await pause(delay);
      } else if (attempt < MAX_PROVIDER_RETRIES) {
        await pause(Math.min(5_000 * attempt, 15_000));
      }
    } finally {
      currentScenario = null;
    }
  }
  checkpoint.results[scenario.id] = {
    id: scenario.id, name: scenario.name, turns: 1, status: 'failed',
    failure: String(lastError?.message || 'Unknown semantic evaluation failure').slice(0, 500), completedAt: new Date().toISOString(),
  };
  saveCheckpoint();
  return { passed: false };
}

function printSummary(status) {
  const results = Object.values(checkpoint.results);
  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const turns = results.reduce((total, result) => total + Number(result.turns || 0), 0);
  const average = turns ? (checkpoint.metrics.modelCalls / turns).toFixed(2) : '0.00';
  console.log(`LIVE EVAL CHECKPOINT: ${checkpointPath}`);
  console.log(`SCENARIOS: ${results.length}/${scenarios.length}`);
  console.log(`PASSED: ${passed}/${scenarios.length}`);
  console.log(`FAILED: ${failed}`);
  console.log(`TOTAL MODEL CALLS: ${checkpoint.metrics.modelCalls}`);
  console.log(`AVERAGE MODEL CALLS PER GUEST TURN: ${average}`);
  console.log(`RATE-LIMIT RETRIES: ${checkpoint.metrics.rateLimitRetries}`);
  if (status === 'rate_limited') console.log('RATE_LIMIT_WAIT_REQUIRED');
  else if (failed) console.log('SEMANTIC_QUALITY_BLOCKER');
  else if (passed === scenarios.length) console.log('TASK 13A LIVE GROQ SCENARIOS: 20/20 passed');
}

try {
  const waitRemaining = Number(checkpoint.nextRetryAt || 0) - Date.now();
  if (waitRemaining >= LONG_WAIT_MS) {
    printSummary('rate_limited');
  } else {
    if (waitRemaining > 0) await pause(waitRemaining);
    console.log('Starting/resuming 20-scenario read-only semantic evaluation…');
    let rateLimited = false;
    for (const scenario of scenarios) {
      if (checkpoint.results[scenario.id]) continue;
      console.log(`Evaluating ${scenario.id}: ${scenario.name}`);
      const outcome = await evaluateScenario(scenario);
      if (outcome.rateLimited) {
        rateLimited = true;
        break;
      }
    }
    printSummary(rateLimited ? 'rate_limited' : 'complete');
  }
} finally {
  globalThis.fetch = originalFetch;
}
