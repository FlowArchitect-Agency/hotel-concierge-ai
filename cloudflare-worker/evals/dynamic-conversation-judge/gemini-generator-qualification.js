import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completeText } from '../../src/llm/index.js';
import { CONVERSATION_BENCHMARK } from '../conversation-benchmark/benchmark.js';
import { completeRoleStructured, roleGatewayEnvironment, roleTimeoutMs } from './config.js';
import { acceptGeneratedCandidates, generateDynamicBlueprint } from './generator.js';
import { planDynamicBlueprints, validateScenarioAgainstBlueprint } from './blueprints.js';
import { validateDynamicScenario } from './schema.js';

export const GEMINI_GENERATOR_QUALIFICATION_VERSION = 'gemini-3.7-flash-generator-qualification-v1';
export const GEMINI_GENERATOR_MODEL = 'gemini-3.7-flash';
export const GEMINI_GENERATOR_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
export const GEMINI_GENERATOR_TIMEOUT_MS = 90_000;

// The current blueprint planner assigns long-context, multi-intent, and
// multilingual traits to disjoint primary categories. Under the fixed
// ten-call cap, this selection prioritizes the mandatory two-per-trait stress
// coverage while its expected tool classes still exercise service, discovery,
// operational, and handoff capabilities. It remains fully deterministic.
export const GEMINI_QUALIFICATION_BLUEPRINT_IDS = Object.freeze([
  'bp-001', 'bp-002', 'bp-032', 'bp-041', 'bp-060',
  'bp-061', 'bp-073', 'bp-083', 'bp-084', 'bp-098',
]);

export function defaultGeminiQualificationCheckpointPath() {
  return path.join(os.tmpdir(), 'conciergeflow-gemini-3-7-flash-generator-qualification-v1.json');
}

export function defaultGeminiBaselineCheckpointPath() {
  return path.join(os.tmpdir(), 'conciergeflow-dynamic-conversation-eval-v1-gemini.json');
}

export function selectGeminiQualificationBlueprints(seed = 'task13d-gemini-generator-qualification') {
  const plan = planDynamicBlueprints(seed);
  const selected = GEMINI_QUALIFICATION_BLUEPRINT_IDS.map((id) => plan.find((blueprint) => blueprint.blueprint_id === id));
  if (selected.some((blueprint) => !blueprint)) throw new Error('Gemini qualification blueprint missing from plan');
  const traitCount = (trait) => selected.filter((blueprint) => blueprint.required_traits.includes(trait)).length;
  if (new Set(selected.map((blueprint) => blueprint.blueprint_id)).size !== 10
    || traitCount('long_conversation') < 2 || traitCount('multi_intent') < 2
    || traitCount('multilingual_switch') < 2
    || !selected.some((blueprint) => blueprint.required_traits.includes('tool_provider_failure'))
    || !selected.some((blueprint) => blueprint.required_traits.includes('typo_slang_informal'))) {
    throw new Error('Gemini qualification trait coverage is incomplete');
  }
  return selected;
}

export function freshGeminiQualificationCheckpoint(seed = 'task13d-gemini-generator-qualification') {
  return {
    version: 1,
    qualification_version: GEMINI_GENERATOR_QUALIFICATION_VERSION,
    seed: String(seed),
    generator_provider: 'google-gemini',
    generator_model: GEMINI_GENERATOR_MODEL,
    generator_gateway: 'openai-compatible',
    timeout_ms: GEMINI_GENERATOR_TIMEOUT_MS,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    basic_preflight: null,
    structured_preflight: null,
    long_context_preflight: null,
    complex_preflight: null,
    blueprints: selectGeminiQualificationBlueprints(seed),
    calls: [],
    accepted_qualification_only: [],
    status: 'ready',
    last_rate_limit: null,
  };
}

export function loadGeminiQualificationCheckpoint(checkpointPath, { seed } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (parsed?.qualification_version === GEMINI_GENERATOR_QUALIFICATION_VERSION
      && String(parsed.seed) === String(seed)
      && Array.isArray(parsed.blueprints) && Array.isArray(parsed.calls)) return parsed;
  } catch { /* A local qualification checkpoint is initialized on first use. */ }
  return freshGeminiQualificationCheckpoint(seed);
}

export function saveGeminiQualificationCheckpoint(checkpointPath, checkpoint) {
  checkpoint.updated_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

function structuralErrors(errors) {
  return errors.filter((error) => /^(?:history_contents|final_guest_turn|blueprint_prior_turn_count|invalid_history)/.test(error));
}

function schemaValid(result) {
  return result.status === 'success'
    && result.candidate?.generator_structural_errors?.length === 0
    && Boolean(validateDynamicScenario(result.candidate).valid);
}

function toRecord(result, blueprint, validation, unseen) {
  const errors = validation?.errors || (result.status === 'success' ? [] : [result.error_code || result.status]);
  const accepted = result.status === 'success' && validation?.valid && unseen?.newlyAccepted?.length;
  return {
    blueprint_id: blueprint.blueprint_id,
    primary_category: blueprint.primary_category,
    required_traits: [...blueprint.required_traits],
    requested_prior_messages: blueprint.prior_turn_count,
    actual_prior_messages: result.candidate?.conversation_history?.length ?? null,
    latency_ms: result.latency_ms ?? null,
    transport_status: result.status,
    schema_valid: schemaValid(result),
    blueprint_valid: Boolean(validation?.valid),
    result: accepted ? 'ACCEPTED' : 'REJECTED',
    structural_errors: structuralErrors(errors),
    validation_errors: errors,
  };
}

async function generateOne(env, checkpoint, blueprint, { seed, index, fetchImpl } = {}) {
  const result = await generateDynamicBlueprint(env, {
    blueprint, seed, startIndex: index, attempt: 1, rejectionFeedback: [], fetchImpl,
  });
  if (result.status !== 'success') return { result, validation: null, unseen: null, record: toRecord(result, blueprint, null, null) };
  const validation = validateScenarioAgainstBlueprint(result.candidate, blueprint);
  const unseen = validation.valid
    ? acceptGeneratedCandidates([result.candidate], { accepted: checkpoint.accepted_qualification_only, permanent: CONVERSATION_BENCHMARK })
    : { newlyAccepted: [], rejected: [] };
  return { result, validation, unseen, record: toRecord(result, blueprint, validation, unseen) };
}

function preflightFailureStatus(result) {
  if (result.status === 'rate_limited') return 'GEMINI_PROVIDER_RATE_LIMIT';
  if (result.status === 'timeout') return 'GEMINI_PROVIDER_LATENCY_BLOCKER';
  if (result.error_code === 'http_401' || result.error_code === 'http_403') return 'GEMINI_AUTHENTICATION_FAILURE';
  if (result.error_code === 'http_404') return 'GEMINI_MODEL_ACCESS_FAILURE';
  if (result.status !== 'success') return 'GEMINI_TRANSPORT_FAILURE';
  return 'GEMINI_STRUCTURED_OUTPUT_BLOCKER';
}

function checkpointPreflight(checkpoint, key, record, status) {
  checkpoint[key] = record;
  checkpoint.status = status;
}

async function basicPreflight(env, fetchImpl) {
  const startedAt = Date.now();
  const result = await completeText(roleGatewayEnvironment(env, 'generator'), {
    purpose: 'response_generator',
    messages: [{ role: 'user', content: 'Reply exactly: OK' }],
    max_tokens: 16,
    timeout_ms: roleTimeoutMs(env, 'generator'),
    conversation_id: 'gemini-generator-basic-preflight',
  }, { fetchImpl });
  return {
    transport_status: result.status,
    provider: result.provider,
    model: result.model,
    latency_ms: result.latency_ms || (Date.now() - startedAt),
    normalized_content_valid: result.status === 'success' && result.content.trim() === 'OK',
    error_code: result.error_code || '',
  };
}

function blueprintById(seed, id) {
  const blueprint = planDynamicBlueprints(seed).find((item) => item.blueprint_id === id);
  if (!blueprint) throw new Error(`Required Gemini preflight blueprint missing: ${id}`);
  return blueprint;
}

function traitStats(calls, trait) {
  const relevant = calls.filter((call) => call.required_traits.includes(trait));
  return { passed: relevant.filter((call) => call.result === 'ACCEPTED').length, total: relevant.length };
}

function finalQualificationStatus(calls) {
  const accepted = calls.filter((call) => call.result === 'ACCEPTED').length;
  const long = traitStats(calls, 'long_conversation');
  const multi = traitStats(calls, 'multi_intent');
  const multilingual = traitStats(calls, 'multilingual_switch');
  const noSystemicTraitFailure = long.passed > 0 && multi.passed > 0 && multilingual.passed > 0;
  if (accepted >= 8 && noSystemicTraitFailure) return 'GEMINI_GENERATOR_QUALIFIED';
  if (accepted >= 6 && noSystemicTraitFailure) return 'GEMINI_GENERATOR_PROVISIONALLY_QUALIFIED';
  return 'GEMINI_GENERATOR_NOT_QUALIFIED';
}

/**
 * Generator-only Gemini qualification. It never starts the SUT, scenario
 * judge, or baseline run, and writes only an isolated local checkpoint.
 */
export async function runGeminiGeneratorQualification(env, { seed, checkpointPath, fetchImpl } = {}) {
  const checkpoint = loadGeminiQualificationCheckpoint(checkpointPath, { seed });
  if (!checkpoint.basic_preflight) {
    const basic = await basicPreflight(env, fetchImpl);
    const pass = basic.transport_status === 'success' && basic.normalized_content_valid;
    checkpointPreflight(checkpoint, 'basic_preflight', basic, pass ? 'basic_preflight_passed' : preflightFailureStatus({ status: basic.transport_status, error_code: basic.error_code }));
    saveGeminiQualificationCheckpoint(checkpointPath, checkpoint);
    if (!pass) return { status: checkpoint.status, checkpoint };
  }

  const structuredBlueprint = blueprintById(seed, 'bp-016');
  if (!checkpoint.structured_preflight) {
    const generated = await generateOne(env, checkpoint, structuredBlueprint, { seed, index: 1, fetchImpl });
    checkpointPreflight(checkpoint, 'structured_preflight', generated.record,
      generated.record.schema_valid ? 'structured_preflight_passed' : preflightFailureStatus(generated.result));
    saveGeminiQualificationCheckpoint(checkpointPath, checkpoint);
    if (!generated.record.schema_valid) return { status: checkpoint.status, checkpoint };
  }

  for (const [key, id, index] of [
    ['long_context_preflight', 'bp-001', 2],
    ['complex_preflight', 'bp-058', 3],
  ]) {
    if (checkpoint[key]) continue;
    const generated = await generateOne(env, checkpoint, blueprintById(seed, id), { seed, index, fetchImpl });
    const passed = generated.record.result === 'ACCEPTED';
    const failure = generated.result.status === 'success'
      ? 'GEMINI_GENERATOR_NOT_QUALIFIED'
      : preflightFailureStatus(generated.result);
    checkpointPreflight(checkpoint, key, generated.record, passed ? `${key}_passed` : failure);
    saveGeminiQualificationCheckpoint(checkpointPath, checkpoint);
    if (!passed) return { status: checkpoint.status, checkpoint };
  }

  for (const blueprint of checkpoint.blueprints) {
    if (checkpoint.calls.some((call) => call.blueprint_id === blueprint.blueprint_id)) continue;
    const generated = await generateOne(env, checkpoint, blueprint, { seed, index: checkpoint.calls.length + 1, fetchImpl });
    if (generated.result.status === 'rate_limited') {
      checkpoint.last_rate_limit = { status: 429, observed_at: new Date().toISOString(), role: 'generator' };
      checkpoint.status = 'GEMINI_PROVIDER_RATE_LIMIT';
      saveGeminiQualificationCheckpoint(checkpointPath, checkpoint);
      return { status: checkpoint.status, checkpoint };
    }
    checkpoint.calls.push(generated.record);
    if (generated.unseen?.newlyAccepted?.length) checkpoint.accepted_qualification_only = generated.unseen.accepted;
    saveGeminiQualificationCheckpoint(checkpointPath, checkpoint);
  }
  checkpoint.status = finalQualificationStatus(checkpoint.calls);
  saveGeminiQualificationCheckpoint(checkpointPath, checkpoint);
  return { status: checkpoint.status, checkpoint };
}
