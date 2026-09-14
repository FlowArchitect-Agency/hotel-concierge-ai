import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONVERSATION_BENCHMARK } from '../conversation-benchmark/benchmark.js';
import { acceptGeneratedCandidates, generateDynamicBlueprint } from './generator.js';
import { planDynamicBlueprints, validateScenarioAgainstBlueprint } from './blueprints.js';

export const STRATIFIED_DIAGNOSTIC_VERSION = 'dynamic-stratified-generator-sample-v2';
export const STRATIFIED_CATEGORIES = Object.freeze([
  'context_follow_ups', 'hotel_facts', 'hotel_services', 'external_discovery', 'operational_requests',
  'action_truthfulness', 'multi_intent', 'complaints_escalation', 'language', 'natural_human',
]);

function headerDurationMs(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 0;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 1_000;
  const match = text.match(/(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec(?:onds?)?|m|min(?:utes?)?|h|hours?)/);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit.startsWith('h')) return amount * 3_600_000;
  if (unit === 'm' || unit.startsWith('min')) return amount * 60_000;
  if (unit.startsWith('ms')) return amount;
  return amount * 1_000;
}

function rateAwareDiagnosticFetch(checkpoint, fetchImpl) {
  const upstream = fetchImpl || globalThis.fetch;
  return async (input, init) => {
    const response = await upstream(input, init);
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const requestReset = response.headers.get('x-ratelimit-reset-requests');
      const tokenReset = response.headers.get('x-ratelimit-reset-tokens');
      const waitMs = Math.max(headerDurationMs(retryAfter), headerDurationMs(requestReset), headerDurationMs(tokenReset));
      checkpoint.last_rate_limit = {
        status: 429, role: 'generator', observed_at: new Date().toISOString(), retry_after: retryAfter || null,
        request_reset: requestReset || null, token_reset: tokenReset || null,
        safe_retry_at: waitMs ? new Date(Date.now() + waitMs + 750).toISOString() : null,
      };
    }
    return response;
  };
}

function conversationShape(candidate) {
  const history = Array.isArray(candidate?.conversation_history) ? candidate.conversation_history : [];
  const roles = history.map((turn) => turn?.role || 'missing');
  const roleSequenceValid = history.length > 0
    && roles[0] === 'user'
    && roles[roles.length - 1] === 'assistant'
    && roles.every((role, index) => role === (index % 2 === 0 ? 'user' : 'assistant'));
  return {
    actual_prior_messages: history.length,
    role_sequence_valid: roleSequenceValid,
  };
}

export function defaultStratifiedDiagnosticCheckpointPath() {
  return path.join(os.tmpdir(), 'conciergeflow-dynamic-stratified-generator-sample-v2.json');
}

/** Ten distinct first-attempt blueprints, one from every product capability area. */
export function selectStratifiedDiagnosticBlueprints(seed = 'dynamic-stratified-sample') {
  const plan = planDynamicBlueprints(seed);
  return STRATIFIED_CATEGORIES.map((category) => {
    const blueprint = plan.find((item) => item.primary_category === category);
    if (!blueprint) throw new Error(`Missing planned category: ${category}`);
    return blueprint;
  });
}

export function freshStratifiedDiagnosticCheckpoint(seed = 'dynamic-stratified-sample') {
  const blueprints = selectStratifiedDiagnosticBlueprints(seed);
  return {
    version: 2, diagnostic_version: STRATIFIED_DIAGNOSTIC_VERSION, generator_contract_version: 'message-slots-v1', seed: String(seed),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    blueprints, calls: [], accepted_diagnostic_only: [], status: 'ready', last_rate_limit: null,
  };
}

export function loadStratifiedDiagnosticCheckpoint(checkpointPath, { seed } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (parsed?.diagnostic_version === STRATIFIED_DIAGNOSTIC_VERSION && String(parsed.seed) === String(seed)
      && Array.isArray(parsed.blueprints) && Array.isArray(parsed.calls)) return parsed;
  } catch { /* A missing diagnostic checkpoint is initialized locally. */ }
  return freshStratifiedDiagnosticCheckpoint(seed);
}

export function saveStratifiedDiagnosticCheckpoint(checkpointPath, checkpoint) {
  checkpoint.updated_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

/**
 * Runs at most one first attempt per selected blueprint. Results are isolated
 * in this diagnostic checkpoint and never enter the 105-scenario baseline.
 */
export async function runStratifiedDiagnosticSample(env, { seed, checkpointPath, fetchImpl } = {}) {
  const checkpoint = loadStratifiedDiagnosticCheckpoint(checkpointPath, { seed });
  for (const blueprint of checkpoint.blueprints) {
    if (checkpoint.calls.some((call) => call.blueprint_id === blueprint.blueprint_id)) continue;
    const result = await generateDynamicBlueprint(env, {
      blueprint, seed, startIndex: checkpoint.calls.length + 1, attempt: 1, rejectionFeedback: [],
      fetchImpl: rateAwareDiagnosticFetch(checkpoint, fetchImpl),
    });
    if (result.status === 'rate_limited') {
      checkpoint.status = 'RATE_LIMIT_WAIT_REQUIRED';
      saveStratifiedDiagnosticCheckpoint(checkpointPath, checkpoint);
      return { status: checkpoint.status, checkpoint };
    }
    if (result.status !== 'success') {
      checkpoint.status = 'GENERATOR_BLOCKED';
      saveStratifiedDiagnosticCheckpoint(checkpointPath, checkpoint);
      return { status: checkpoint.status, checkpoint, error_code: result.error_code };
    }
    const validation = validateScenarioAgainstBlueprint(result.candidate, blueprint);
    const unseen = validation.valid
      ? acceptGeneratedCandidates([result.candidate], { accepted: checkpoint.accepted_diagnostic_only, permanent: CONVERSATION_BENCHMARK })
      : { newlyAccepted: [], rejected: [] };
    const rejection = validation.valid ? unseen.rejected[0] : null;
    checkpoint.calls.push({
      call_number: checkpoint.calls.length + 1, blueprint_id: blueprint.blueprint_id, primary_category: blueprint.primary_category,
      required_traits: [...blueprint.required_traits], attempt: 1, kind: 'FIRST_ATTEMPT',
      requested_prior_messages: blueprint.prior_turn_count,
      ...conversationShape(result.candidate), latency_ms: result.latency_ms ?? null,
      result: validation.valid && unseen.newlyAccepted.length ? 'ACCEPTED' : 'REJECTED',
      rejection_reason: validation.valid ? rejection?.details || (rejection ? [rejection.reason] : []) : validation.errors,
    });
    if (unseen.newlyAccepted.length) checkpoint.accepted_diagnostic_only = unseen.accepted;
    saveStratifiedDiagnosticCheckpoint(checkpointPath, checkpoint);
  }
  checkpoint.status = 'COMPLETE';
  saveStratifiedDiagnosticCheckpoint(checkpointPath, checkpoint);
  return { status: checkpoint.status, checkpoint };
}
