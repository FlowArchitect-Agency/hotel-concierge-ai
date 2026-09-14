import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONVERSATION_BENCHMARK } from '../conversation-benchmark/benchmark.js';
import { acceptGeneratedCandidates, generateDynamicBlueprint } from './generator.js';
import { planDynamicBlueprints, validateScenarioAgainstBlueprint } from './blueprints.js';

export const NVIDIA_GENERATOR_QUALIFICATION_VERSION = 'nvidia-minimax-generator-qualification-v1';
export const NVIDIA_GENERATOR_MODEL = 'minimaxai/minimax-m3';
export const NVIDIA_GENERATOR_TIMEOUT_MS = 90_000;

// Ten distinct existing blueprints. The current planner isolates long,
// multi-intent, and multilingual traits in separate primary categories; this
// deliberately prioritizes the required two-per-trait coverage under the
// fixed ten-call qualification cap.
export const NVIDIA_QUALIFICATION_BLUEPRINT_IDS = Object.freeze([
  'bp-001', 'bp-002', 'bp-032', 'bp-041', 'bp-060',
  'bp-061', 'bp-073', 'bp-083', 'bp-084', 'bp-098',
]);

export function defaultNvidiaQualificationCheckpointPath() {
  return path.join(os.tmpdir(), 'conciergeflow-nvidia-minimax-generator-qualification-v1.json');
}

export function selectNvidiaQualificationBlueprints(seed = 'nvidia-minimax-qualification') {
  const plan = planDynamicBlueprints(seed);
  const selected = NVIDIA_QUALIFICATION_BLUEPRINT_IDS.map((id) => plan.find((blueprint) => blueprint.blueprint_id === id));
  if (selected.some((blueprint) => !blueprint)) throw new Error('NVIDIA qualification blueprint missing from plan');
  const traitCount = (trait) => selected.filter((blueprint) => blueprint.required_traits.includes(trait)).length;
  if (new Set(selected.map((blueprint) => blueprint.blueprint_id)).size !== 10
    || traitCount('long_conversation') < 2 || traitCount('multi_intent') < 2
    || traitCount('multilingual_switch') < 2 || !selected.some((blueprint) => blueprint.required_traits.includes('tool_provider_failure'))
    || !selected.some((blueprint) => blueprint.required_traits.includes('typo_slang_informal'))) {
    throw new Error('NVIDIA qualification trait coverage is incomplete');
  }
  return selected;
}

export function freshNvidiaQualificationCheckpoint(seed = 'nvidia-minimax-qualification') {
  return {
    version: 1,
    qualification_version: NVIDIA_GENERATOR_QUALIFICATION_VERSION,
    seed: String(seed),
    provider: 'nvidia', model: NVIDIA_GENERATOR_MODEL, timeout_ms: NVIDIA_GENERATOR_TIMEOUT_MS,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    preflight: null, blueprints: selectNvidiaQualificationBlueprints(seed), calls: [], accepted_qualification_only: [],
    status: 'ready', last_rate_limit: null,
  };
}

export function loadNvidiaQualificationCheckpoint(checkpointPath, { seed } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (parsed?.qualification_version === NVIDIA_GENERATOR_QUALIFICATION_VERSION && String(parsed.seed) === String(seed)
      && Array.isArray(parsed.blueprints) && Array.isArray(parsed.calls)) return parsed;
  } catch { /* A local qualification checkpoint is initialized on first use. */ }
  return freshNvidiaQualificationCheckpoint(seed);
}

export function saveNvidiaQualificationCheckpoint(checkpointPath, checkpoint) {
  checkpoint.updated_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

function structuralErrors(errors) {
  return errors.filter((error) => /^(?:history_contents|final_guest_turn|blueprint_prior_turn_count|invalid_history)/.test(error));
}

function toRecord(result, blueprint, validation, unseen) {
  const errors = validation?.errors || (result.status === 'success' ? [] : [result.error_code || result.status]);
  const accepted = result.status === 'success' && validation?.valid && unseen?.newlyAccepted?.length;
  return {
    blueprint_id: blueprint.blueprint_id, primary_category: blueprint.primary_category,
    required_traits: [...blueprint.required_traits], requested_prior_messages: blueprint.prior_turn_count,
    actual_prior_messages: result.candidate?.conversation_history?.length ?? null,
    latency_ms: result.latency_ms ?? null, transport_status: result.status,
    schema_valid: result.status === 'success' ? validation.errors.every((error) => !/^(?:missing_|invalid_|credential_like_content)/.test(error)) : false,
    blueprint_valid: Boolean(validation?.valid), result: accepted ? 'ACCEPTED' : 'REJECTED',
    structural_errors: structuralErrors(errors), validation_errors: errors,
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

/** Generator-only preflight followed by a distinct, isolated ten-call sample. */
export async function runNvidiaGeneratorQualification(env, { seed, checkpointPath, fetchImpl } = {}) {
  const checkpoint = loadNvidiaQualificationCheckpoint(checkpointPath, { seed });
  const preflightBlueprint = planDynamicBlueprints(seed).find((blueprint) => blueprint.blueprint_id === 'bp-058');
  if (!checkpoint.preflight) {
    const generated = await generateOne(env, checkpoint, preflightBlueprint, { seed, index: 1, fetchImpl });
    checkpoint.preflight = generated.record;
    if (generated.record.result === 'ACCEPTED') checkpoint.status = 'preflight_passed';
    else if (generated.result.status === 'timeout') checkpoint.status = 'PROVIDER_LATENCY_BLOCKER';
    else checkpoint.status = 'MODEL_QUALITY_FAILURE';
    saveNvidiaQualificationCheckpoint(checkpointPath, checkpoint);
    if (checkpoint.status !== 'preflight_passed') return { status: checkpoint.status, checkpoint };
  }

  for (const blueprint of checkpoint.blueprints) {
    if (checkpoint.calls.some((call) => call.blueprint_id === blueprint.blueprint_id)) continue;
    const generated = await generateOne(env, checkpoint, blueprint, { seed, index: checkpoint.calls.length + 1, fetchImpl });
    if (generated.result.status === 'rate_limited') {
      checkpoint.status = 'RATE_LIMIT_WAIT_REQUIRED';
      saveNvidiaQualificationCheckpoint(checkpointPath, checkpoint);
      return { status: checkpoint.status, checkpoint };
    }
    checkpoint.calls.push(generated.record);
    if (generated.unseen?.newlyAccepted?.length) checkpoint.accepted_qualification_only = generated.unseen.accepted;
    saveNvidiaQualificationCheckpoint(checkpointPath, checkpoint);
  }
  checkpoint.status = 'COMPLETE';
  saveNvidiaQualificationCheckpoint(checkpointPath, checkpoint);
  return { status: checkpoint.status, checkpoint };
}
