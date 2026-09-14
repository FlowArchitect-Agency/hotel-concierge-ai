import { CONVERSATION_BENCHMARK } from '../conversation-benchmark/benchmark.js';
import { DYNAMIC_EVAL_VERSION, DYNAMIC_TARGET_SCENARIOS } from './config.js';
import { loadDynamicCheckpoint, persistRateLimit, saveDynamicCheckpoint } from './checkpoint.js';
import { acceptGeneratedCandidates, generateDynamicBlueprint, testScenarioCandidate } from './generator.js';
import {
  BLUEPRINT_VERSION, MAX_BLUEPRINT_ATTEMPTS, blueprintFromAcceptedScenario, nextBlueprintAfterFailure,
  planDynamicBlueprints, validateBlueprintPlan, validateScenarioAgainstBlueprint,
} from './blueprints.js';
import {
  JUDGE_VALIDATION_CASES, averageJudgeScore, judgeDisagreement, judgeDynamicScenario,
  shouldDoubleJudge, validationScenario, validationSut,
} from './judge.js';
import { dynamicDistribution, validateDynamicDistribution } from './schema.js';
import { deterministicDynamicChecks, runDynamicSut } from './sut.js';
import { exportFailureCandidate } from './failure-export.js';

const MODEL_INTERVAL_MS = 12_000;
let lastModelRequestAt = 0;

function pause(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

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

function rateAwareFetch(checkpoint, role, fetchImpl) {
  const underlying = fetchImpl || globalThis.fetch;
  return async (input, init) => {
    const remaining = MODEL_INTERVAL_MS - (Date.now() - lastModelRequestAt);
    if (remaining > 0) await pause(remaining);
    lastModelRequestAt = Date.now();
    const response = await underlying(input, init);
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const requestReset = response.headers.get('x-ratelimit-reset-requests');
      const tokenReset = response.headers.get('x-ratelimit-reset-tokens');
      const waitMs = Math.max(headerDurationMs(retryAfter), headerDurationMs(requestReset), headerDurationMs(tokenReset), 0);
      checkpoint.last_rate_limit = {
        role, status: 429, observed_at: new Date().toISOString(), retry_after: retryAfter || null,
        request_reset: requestReset || null, token_reset: tokenReset || null,
        safe_retry_at: waitMs ? new Date(Date.now() + waitMs + 750).toISOString() : null,
      };
    }
    return response;
  };
}

function redacted(value) {
  return String(value || '').replace(/(?:gsk_|sk-|bearer\s+)[a-z0-9._-]+/ig, '[redacted credential-like content]');
}

function candidateSnapshot(candidate) {
  return {
    id: candidate?.id || '', category: candidate?.category || '', severity: candidate?.severity || '', language: candidate?.language || '',
    fixture_profile: candidate?.fixture_profile || '', generation_traits: candidate?.generation_traits || [], trait_evidence: candidate?.trait_evidence || {},
    history_turn_count: candidate?.conversation_history?.length || 0,
    conversation_history: (candidate?.conversation_history || []).map((turn) => ({ role: turn.role, content: redacted(turn.content) })),
    final_guest_turn: redacted(candidate?.final_guest_turn), semantic_goal: redacted(candidate?.semantic_goal),
    expected_tool_behavior: candidate?.expected_tool_behavior || {},
  };
}

function scenarioIdForResult(result) { return String(result?.id || ''); }
function completedJudge(result) { return result && result.status === 'success' && result.judgement; }

function judgeValidationPass(item, result) {
  if (!completedJudge(result)) return false;
  const actualPass = result.judgement.overall_pass && !result.judgement.critical_failure;
  return item.expected_pass ? actualPass : !actualPass;
}

async function calibrateJudge(env, checkpoint, checkpointPath, options) {
  for (const item of JUDGE_VALIDATION_CASES) {
    if (checkpoint.judge_validation.results[item.id]) continue;
    const result = await judgeDynamicScenario(env, validationScenario(item), validationSut(item), { ...options, fetchImpl: rateAwareFetch(checkpoint, 'judge', options.judgeFetch) });
    checkpoint.metrics.judge_calls += 1;
    checkpoint.judge_validation.results[item.id] = { ...result, expected_pass: item.expected_pass, validation_pass: judgeValidationPass(item, result) };
    if (result.status === 'rate_limited') {
      persistRateLimit(checkpoint, null, 'judge'); saveDynamicCheckpoint(checkpointPath, checkpoint);
      return { status: 'RATE_LIMIT_WAIT_REQUIRED' };
    }
    if (result.status !== 'success') { checkpoint.status = 'JUDGE_PROVIDER_BLOCKED'; saveDynamicCheckpoint(checkpointPath, checkpoint); return { status: checkpoint.status }; }
    saveDynamicCheckpoint(checkpointPath, checkpoint);
  }
  const passed = Object.values(checkpoint.judge_validation.results).filter((result) => result.validation_pass).length;
  if (passed < 9) { checkpoint.status = 'JUDGE RELIABILITY BLOCKER'; saveDynamicCheckpoint(checkpointPath, checkpoint); return { status: checkpoint.status, passed }; }
  return { status: 'success', passed };
}

function incrementRejectionMetrics(checkpoint, errors = []) {
  checkpoint.generation.rejections_by_trait ||= {};
  for (const error of errors.length ? errors : ['unknown_generation_rejection']) {
    checkpoint.generation.rejections_by_trait[error] = Number(checkpoint.generation.rejections_by_trait[error] || 0) + 1;
  }
}

/** Safely upgrades v1 batch state without discarding scenarios, rejections, calls, calibration, or rate metadata. */
export function ensureBlueprintGenerationState(checkpoint) {
  const generation = checkpoint.generation;
  if (generation.blueprint_version === BLUEPRINT_VERSION && generation.blueprints?.length) return { valid: true, blueprints: generation.blueprints };
  const blueprints = planDynamicBlueprints(checkpoint.seed, checkpoint.target);
  const usedBlueprintIds = new Set();
  for (const scenario of generation.scenarios || []) {
    const prefersLong = (scenario.conversation_history || []).length >= 10;
    const blueprint = blueprints.find((item) => !usedBlueprintIds.has(item.blueprint_id)
      && item.primary_category === scenario.category
      && (!prefersLong || item.required_traits.includes('long_conversation')))
      || blueprints.find((item) => !usedBlueprintIds.has(item.blueprint_id));
    if (!blueprint) return { valid: false, errors: ['accepted_scenario_blueprint_unavailable'] };
    const reconstructed = blueprintFromAcceptedScenario(scenario, blueprint);
    const index = blueprints.findIndex((item) => item.blueprint_id === blueprint.blueprint_id);
    blueprints[index] = reconstructed;
    const validation = validateScenarioAgainstBlueprint(scenario, reconstructed);
    if (!validation.valid) return { valid: false, errors: [`accepted_scenario_revalidation_failed:${scenario.id}`, ...validation.errors] };
    usedBlueprintIds.add(reconstructed.blueprint_id);
    scenario.generation_blueprint_id = reconstructed.blueprint_id;
    scenario.generation_attempt = null;
    generation.blueprint_states ||= {};
    generation.blueprint_states[reconstructed.blueprint_id] = { status: 'accepted', attempts: null, preserved: true, scenario_id: scenario.id };
  }
  generation.blueprints = blueprints;
  generation.blueprint_states ||= {};
  generation.blueprint_version = BLUEPRINT_VERSION;
  generation.strategy = 'blueprint-v1';
  generation.active_blueprint_id ||= null;
  generation.blueprint_failures ||= [];
  generation.preserved_accepted_count = (generation.scenarios || []).length;
  for (const rejection of generation.rejected || []) {
    if (!rejection.blueprint_id) incrementRejectionMetrics(checkpoint, [`historical_${rejection.reason || 'rejection'}`]);
  }
  const plan = validateBlueprintPlan(blueprints, checkpoint.target);
  return { valid: plan.valid, errors: plan.errors, blueprints };
}

function activeBlueprint(checkpoint) {
  const generation = checkpoint.generation;
  const state = generation.blueprint_states || {};
  const active = generation.blueprints.find((blueprint) => blueprint.blueprint_id === generation.active_blueprint_id);
  if (active && !['accepted', 'failed'].includes(state[active.blueprint_id]?.status)) return active;
  const next = generation.blueprints.find((blueprint) => !['accepted', 'failed'].includes(state[blueprint.blueprint_id]?.status));
  generation.active_blueprint_id = next?.blueprint_id || null;
  return next || null;
}

function recordBlueprintRejection(checkpoint, blueprint, candidate, errors, reason = 'blueprint_constraint_not_met') {
  const generation = checkpoint.generation;
  const state = generation.blueprint_states[blueprint.blueprint_id] ||= { status: 'pending', attempts: 0, errors: [] };
  state.errors = errors;
  checkpoint.generation.rejected.push({
    id: candidate?.id || '', blueprint_id: blueprint.blueprint_id, reason, details: errors, candidate: candidateSnapshot(candidate),
  });
  incrementRejectionMetrics(checkpoint, errors);
}

function ensureGenerationSample(checkpoint, options = {}) {
  if (!options.generationSampleId || !Number.isInteger(options.maxNewGeneratorCalls)) return null;
  const existing = checkpoint.generation.sample;
  if (existing?.id === options.generationSampleId) return existing;
  if (existing && existing.id !== options.generationSampleId) throw new Error('A different generation sample is already checkpointed');
  checkpoint.generation.sample = {
    id: options.generationSampleId, baseline_generator_calls: checkpoint.metrics.generator_calls,
    target_new_generator_calls: options.maxNewGeneratorCalls, calls: [], created_at: new Date().toISOString(),
  };
  return checkpoint.generation.sample;
}

function sampleRecord(sample, blueprint, attempt) {
  if (!sample) return null;
  const kind = blueprint.replacement_of ? 'REPLACEMENT_BLUEPRINT' : attempt > 1 ? 'REGENERATION' : 'FIRST_ATTEMPT';
  const record = {
    call_number: sample.calls.length + 1, blueprint_id: blueprint.blueprint_id, primary_category: blueprint.primary_category,
    required_traits: [...(blueprint.required_traits || [])], attempt, kind, result: 'PENDING', rejection_reason: [],
  };
  sample.calls.push(record);
  return record;
}

async function generateAll(env, checkpoint, checkpointPath, options) {
  const migration = ensureBlueprintGenerationState(checkpoint);
  if (!migration.valid) {
    checkpoint.status = 'BLUEPRINT_GENERATION_BLOCKED';
    checkpoint.generation.blueprint_migration_errors = migration.errors;
    saveDynamicCheckpoint(checkpointPath, checkpoint);
    return { status: checkpoint.status, errors: migration.errors };
  }
  const generation = checkpoint.generation;
  const sample = ensureGenerationSample(checkpoint, options);
  while ((checkpoint.generation.scenarios || []).length < checkpoint.target) {
    if (sample && sample.calls.length >= sample.target_new_generator_calls) {
      checkpoint.status = 'GENERATION_SAMPLE_COMPLETE';
      saveDynamicCheckpoint(checkpointPath, checkpoint);
      return { status: checkpoint.status, sample };
    }
    const blueprint = activeBlueprint(checkpoint);
    if (!blueprint) {
      checkpoint.status = 'BLUEPRINT_GENERATION_BLOCKED';
      saveDynamicCheckpoint(checkpointPath, checkpoint);
      return { status: checkpoint.status, error_code: 'blueprint_plan_exhausted' };
    }
    const state = checkpoint.generation.blueprint_states[blueprint.blueprint_id] ||= { status: 'pending', attempts: 0, errors: [] };
    const attempt = Number(state.attempts || 0) + 1;
    const result = await generateDynamicBlueprint(env, {
      blueprint, seed: checkpoint.seed, startIndex: checkpoint.generation.scenarios.length + checkpoint.generation.rejected.length + 1,
      attempt, rejectionFeedback: state.errors || [], fetchImpl: rateAwareFetch(checkpoint, 'generator', options.generatorFetch),
    });
    checkpoint.metrics.generator_calls += 1;
    if (result.status === 'rate_limited') { persistRateLimit(checkpoint, null, 'generator'); saveDynamicCheckpoint(checkpointPath, checkpoint); return { status: 'RATE_LIMIT_WAIT_REQUIRED' }; }
    if (result.status !== 'success') { checkpoint.status = 'GENERATOR_BLOCKED'; saveDynamicCheckpoint(checkpointPath, checkpoint); return { status: checkpoint.status, error_code: result.error_code }; }
    state.attempts = attempt;
    const sampleCall = sampleRecord(sample, blueprint, attempt);
    const conformance = validateScenarioAgainstBlueprint(result.candidate, blueprint);
    if (!conformance.valid) {
      if (sampleCall) { sampleCall.result = 'REJECTED'; sampleCall.rejection_reason = conformance.errors; }
      recordBlueprintRejection(checkpoint, blueprint, result.candidate, conformance.errors);
      const next = nextBlueprintAfterFailure(blueprint, attempt);
      if (next.action === 'retry') generation.active_blueprint_id = blueprint.blueprint_id;
      else if (next.action === 'replace') {
        state.status = 'failed';
        generation.blueprint_failures.push({ blueprint_id: blueprint.blueprint_id, attempts: attempt, errors: conformance.errors });
        generation.blueprints.push(next.replacement);
        generation.blueprint_states[next.replacement.blueprint_id] = { status: 'pending', attempts: 0, errors: [], replacement_for: blueprint.blueprint_id };
        generation.active_blueprint_id = next.replacement.blueprint_id;
      } else {
        state.status = 'failed';
        generation.blueprint_failures.push({ blueprint_id: blueprint.blueprint_id, attempts: attempt, errors: conformance.errors, exhausted_replacements: true });
        checkpoint.status = 'BLUEPRINT_GENERATION_BLOCKED';
        saveDynamicCheckpoint(checkpointPath, checkpoint);
        return { status: checkpoint.status, error_code: 'blueprint_max_replacements_exhausted' };
      }
      saveDynamicCheckpoint(checkpointPath, checkpoint);
      continue;
    }
    const accepted = acceptGeneratedCandidates([result.candidate], { accepted: checkpoint.generation.scenarios, permanent: CONVERSATION_BENCHMARK });
    if (!accepted.newlyAccepted.length) {
      const rejection = accepted.rejected[0] || { reason: 'unseen_rejection', details: [] };
      if (sampleCall) { sampleCall.result = 'REJECTED'; sampleCall.rejection_reason = rejection.details || [rejection.reason]; }
      recordBlueprintRejection(checkpoint, blueprint, result.candidate, rejection.details || [], rejection.reason);
      const next = nextBlueprintAfterFailure(blueprint, attempt);
      if (next.action === 'retry') generation.active_blueprint_id = blueprint.blueprint_id;
      else if (next.action === 'replace') {
        state.status = 'failed';
        generation.blueprint_failures.push({ blueprint_id: blueprint.blueprint_id, attempts: attempt, errors: rejection.details || [] });
        generation.blueprints.push(next.replacement);
        generation.blueprint_states[next.replacement.blueprint_id] = { status: 'pending', attempts: 0, errors: [], replacement_for: blueprint.blueprint_id };
        generation.active_blueprint_id = next.replacement.blueprint_id;
      } else {
        state.status = 'failed';
        generation.blueprint_failures.push({ blueprint_id: blueprint.blueprint_id, attempts: attempt, errors: rejection.details || [], exhausted_replacements: true });
        checkpoint.status = 'BLUEPRINT_GENERATION_BLOCKED';
        saveDynamicCheckpoint(checkpointPath, checkpoint);
        return { status: checkpoint.status, error_code: 'blueprint_max_replacements_exhausted' };
      }
      saveDynamicCheckpoint(checkpointPath, checkpoint);
      continue;
    }
    const scenario = accepted.newlyAccepted[0];
    scenario.generation_blueprint_id = blueprint.blueprint_id;
    scenario.generation_attempt = attempt;
    checkpoint.generation.scenarios = accepted.accepted;
    if (sampleCall) sampleCall.result = 'ACCEPTED';
    state.status = 'accepted'; state.scenario_id = scenario.id; state.errors = [];
    generation.active_blueprint_id = null;
    generation.batches_completed = checkpoint.generation.scenarios.length;
    saveDynamicCheckpoint(checkpointPath, checkpoint);
  }
  const distribution = validateDynamicDistribution(checkpoint.generation.scenarios);
  if (!distribution.valid) { checkpoint.status = 'BLUEPRINT_GENERATION_BLOCKED'; checkpoint.generation.distribution_errors = distribution.errors; saveDynamicCheckpoint(checkpointPath, checkpoint); return { status: checkpoint.status, distribution }; }
  return { status: 'success', distribution };
}

async function runSutAll(env, checkpoint, checkpointPath, options) {
  for (const scenario of checkpoint.generation.scenarios) {
    if (checkpoint.sut.results[scenario.id]) continue;
    const sut = await runDynamicSut(env, scenario, { modelFetch: options.sutModelFetch });
    checkpoint.metrics.sut_controller_calls += sut.provider_metadata.controller_model_calls;
    checkpoint.metrics.sut_response_calls += sut.provider_metadata.response_model_calls;
    const deterministic = deterministicDynamicChecks(scenario, sut);
    checkpoint.sut.results[scenario.id] = { sut, deterministic };
    if (sut.rate_limit || sut.provider_failure === 'rate_limited') { persistRateLimit(checkpoint, sut.rate_limit, 'sut'); saveDynamicCheckpoint(checkpointPath, checkpoint); return { status: 'RATE_LIMIT_WAIT_REQUIRED' }; }
    saveDynamicCheckpoint(checkpointPath, checkpoint);
  }
  return { status: 'success' };
}

async function judgeAll(env, checkpoint, checkpointPath, options) {
  for (const scenario of checkpoint.generation.scenarios) {
    if (checkpoint.judge.results[scenario.id]) continue;
    const sutRecord = checkpoint.sut.results[scenario.id];
    if (!sutRecord) return { status: 'SUT_PROVIDER_BLOCKED' };
    const result = await judgeDynamicScenario(env, scenario, sutRecord.sut, { fetchImpl: rateAwareFetch(checkpoint, 'judge', options.judgeFetch), pass: 1 });
    checkpoint.metrics.judge_calls += 1;
    checkpoint.judge.results[scenario.id] = result;
    if (result.status === 'rate_limited') { persistRateLimit(checkpoint, null, 'judge'); saveDynamicCheckpoint(checkpointPath, checkpoint); return { status: 'RATE_LIMIT_WAIT_REQUIRED' }; }
    if (result.status !== 'success') { checkpoint.status = 'JUDGE_PROVIDER_BLOCKED'; saveDynamicCheckpoint(checkpointPath, checkpoint); return { status: checkpoint.status }; }
    if (shouldDoubleJudge(result.judgement)) {
      const second = await judgeDynamicScenario(env, scenario, sutRecord.sut, { fetchImpl: rateAwareFetch(checkpoint, 'judge', options.judgeFetch), pass: 2 });
      checkpoint.metrics.second_judge_calls += 1;
      checkpoint.judge.second_results[scenario.id] = second;
      if (second.status === 'rate_limited') { persistRateLimit(checkpoint, null, 'judge'); saveDynamicCheckpoint(checkpointPath, checkpoint); return { status: 'RATE_LIMIT_WAIT_REQUIRED' }; }
      if (second.status !== 'success') { checkpoint.status = 'JUDGE_PROVIDER_BLOCKED'; saveDynamicCheckpoint(checkpointPath, checkpoint); return { status: checkpoint.status }; }
    }
    saveDynamicCheckpoint(checkpointPath, checkpoint);
  }
  return { status: 'success' };
}

export function dynamicRunReport(checkpoint) {
  const scenarios = checkpoint.generation.scenarios || [];
  const rows = scenarios.map((scenario) => {
    const sutRecord = checkpoint.sut.results[scenario.id] || {};
    const first = checkpoint.judge.results[scenario.id];
    const second = checkpoint.judge.second_results[scenario.id];
    const disagreement = completedJudge(first) && completedJudge(second) ? judgeDisagreement(first.judgement, second.judgement) : false;
    const judgePass = completedJudge(first) && first.judgement.overall_pass && !first.judgement.critical_failure;
    return { scenario, deterministic: sutRecord.deterministic || { passed: false, failures: ['not_run'], critical: false }, judge: first, second, disagreement, passed: Boolean(sutRecord.deterministic?.passed && judgePass && !disagreement) };
  });
  const completed = rows.filter((row) => row.judge && checkpoint.sut.results[row.scenario.id]).length;
  const failed = rows.filter((row) => completedJudge(row.judge) && !row.passed);
  const critical = failed.filter((row) => row.deterministic.critical || row.judge.judgement.critical_failure);
  const dimensions = Object.fromEntries(Object.keys(rows.find((row) => completedJudge(row.judge))?.judge?.judgement?.scores || {}).map((dimension) => {
    const scores = rows.filter((row) => completedJudge(row.judge)).map((row) => row.judge.judgement.scores[dimension]);
    return [dimension, scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)) : 0];
  }));
  const percentage = (predicate) => completed ? Number((100 * rows.filter((row) => predicate(row)).length / completed).toFixed(1)) : 0;
  const category_results = Object.fromEntries([...new Set(scenarios.map((scenario) => scenario.category))].map((category) => {
    const categoryRows = rows.filter((row) => row.scenario.category === category && row.judge && checkpoint.sut.results[row.scenario.id]);
    return [category, { total: scenarios.filter((scenario) => scenario.category === category).length, completed: categoryRows.length, passed: categoryRows.filter((row) => row.passed).length, failed_ids: categoryRows.filter((row) => !row.passed).map((row) => row.scenario.id) }];
  }));
  const criticalEscalationRows = rows.filter((row) => row.scenario.critical_invariants?.includes('critical_human_escalation'));
  const criticalEscalationPercentage = criticalEscalationRows.length
    ? Number((100 * criticalEscalationRows.filter((row) => row.deterministic.passed && completedJudge(row.judge) && row.judge.judgement.scores.escalation_safety >= 3).length / criticalEscalationRows.length).toFixed(1))
    : 100;
  const allCalls = checkpoint.metrics.generator_calls + checkpoint.metrics.sut_controller_calls + checkpoint.metrics.sut_response_calls + checkpoint.metrics.judge_calls + checkpoint.metrics.second_judge_calls;
  const blueprintStates = Object.values(checkpoint.generation.blueprint_states || {});
  const generatedByBlueprint = scenarios.filter((scenario) => Number.isInteger(scenario.generation_attempt));
  const firstAttemptAccepted = generatedByBlueprint.filter((scenario) => scenario.generation_attempt === 1).length;
  const attemptTotal = generatedByBlueprint.reduce((sum, scenario) => sum + scenario.generation_attempt, 0);
  const generatedCandidates = scenarios.length + (checkpoint.generation.rejected || []).length;
  const sample = checkpoint.generation.sample || null;
  const sampleCalls = sample?.calls || [];
  const sampleAccepted = sampleCalls.filter((call) => call.result === 'ACCEPTED').length;
  const sampleFirstAttempt = sampleCalls.filter((call) => call.result === 'ACCEPTED' && call.kind === 'FIRST_ATTEMPT').length;
  return {
    version: DYNAMIC_EVAL_VERSION, seed: checkpoint.seed, status: checkpoint.status,
    generated: scenarios.length, generated_candidates: generatedCandidates, accepted_as_unseen: scenarios.length, rejected_or_regenerated: checkpoint.generation.rejected.length,
    distribution: dynamicDistribution(scenarios), category_results, completed, passed: rows.filter((row) => row.passed).length,
    failed: failed.length, critical_failures: critical.length, failure_ids: failed.map((row) => row.scenario.id),
    judge_dimension_averages: dimensions,
    context_relevance: percentage((row) => completedJudge(row.judge) && row.judge.judgement.scores.contextual_understanding >= 3 && row.judge.judgement.scores.relevance >= 3),
    tool_selection: percentage((row) => row.deterministic.passed && completedJudge(row.judge) && row.judge.judgement.scores.tool_selection_appropriateness >= 3),
    action_truthfulness: percentage((row) => row.deterministic.passed && completedJudge(row.judge) && row.judge.judgement.scores.action_truthfulness >= 3),
    hotel_grounding: percentage((row) => row.deterministic.passed && completedJudge(row.judge) && row.judge.judgement.scores.factual_grounding >= 3),
    language: percentage((row) => row.deterministic.passed && completedJudge(row.judge) && row.judge.judgement.scores.language_handling >= 3),
    critical_escalation: criticalEscalationPercentage,
    generation_efficiency: {
      first_attempt_acceptance: generatedByBlueprint.length ? Number((100 * firstAttemptAccepted / generatedByBlueprint.length).toFixed(1)) : null,
      accepted_per_generator_call: checkpoint.metrics.generator_calls ? Number((scenarios.length / checkpoint.metrics.generator_calls).toFixed(3)) : 0,
      average_attempts_per_accepted_scenario: generatedByBlueprint.length ? Number((attemptTotal / generatedByBlueprint.length).toFixed(2)) : null,
      blueprints_failed_after_max_attempts: (checkpoint.generation.blueprint_failures || []).length,
      rejections_by_trait: checkpoint.generation.rejections_by_trait || {},
      preserved_accepted_count: checkpoint.generation.preserved_accepted_count || 0,
      tracked_blueprints: blueprintStates.length,
    },
    generation_sample: sample ? {
      id: sample.id, baseline_generator_calls: sample.baseline_generator_calls, target_new_generator_calls: sample.target_new_generator_calls,
      completed_new_generator_calls: sampleCalls.length, accepted: sampleAccepted,
      call_level_acceptance_rate: sampleCalls.length ? Number((100 * sampleAccepted / sampleCalls.length).toFixed(1)) : 0,
      first_attempt_accepted: sampleFirstAttempt,
      first_attempt_acceptance_rate: sampleCalls.length ? Number((100 * sampleFirstAttempt / sampleCalls.length).toFixed(1)) : 0,
      regenerations: sampleCalls.filter((call) => call.kind === 'REGENERATION').length,
      replacement_blueprints: sampleCalls.filter((call) => call.kind === 'REPLACEMENT_BLUEPRINT').length,
      schema_rejections: sampleCalls.filter((call) => call.rejection_reason?.some((reason) => String(reason).startsWith('missing_') || String(reason).startsWith('invalid_'))).length,
      duplicate_rejections: sampleCalls.filter((call) => call.rejection_reason?.some((reason) => /duplicate|overlap/.test(String(reason)))).length,
      trait_coverage_rejections: sampleCalls.filter((call) => call.result === 'REJECTED'
        && !call.rejection_reason?.some((reason) => String(reason).startsWith('missing_') || String(reason).startsWith('invalid_') || /duplicate|overlap/.test(String(reason)))).length,
      calls: sampleCalls,
    } : null,
    metrics: { ...checkpoint.metrics, total_model_calls: allCalls, average_calls_per_scenario: scenarios.length ? Number((allCalls / scenarios.length).toFixed(2)) : 0 },
    rows,
  };
}

export async function runDynamicEvaluation(env, { seed, checkpointPath, target = DYNAMIC_TARGET_SCENARIOS, ...options } = {}) {
  const checkpoint = loadDynamicCheckpoint(checkpointPath, { seed, target, env });
  if (!options.generationOnly) {
    const calibration = await calibrateJudge(env, checkpoint, checkpointPath, options);
    if (calibration.status !== 'success') return { checkpoint, report: dynamicRunReport(checkpoint), status: calibration.status };
  }
  const generated = await generateAll(env, checkpoint, checkpointPath, options);
  if (generated.status !== 'success') return { checkpoint, report: dynamicRunReport(checkpoint), status: generated.status };
  if (options.generationOnly) {
    checkpoint.status = 'GENERATION_ONLY_COMPLETE';
    saveDynamicCheckpoint(checkpointPath, checkpoint);
    return { checkpoint, report: dynamicRunReport(checkpoint), status: checkpoint.status };
  }
  const sut = await runSutAll(env, checkpoint, checkpointPath, options);
  if (sut.status !== 'success') return { checkpoint, report: dynamicRunReport(checkpoint), status: sut.status };
  const judged = await judgeAll(env, checkpoint, checkpointPath, options);
  checkpoint.status = judged.status === 'success' ? 'complete' : judged.status;
  saveDynamicCheckpoint(checkpointPath, checkpoint);
  return { checkpoint, report: dynamicRunReport(checkpoint), status: judged.status };
}

export function failureCandidates(checkpoint) {
  return (checkpoint.generation.scenarios || []).flatMap((scenario) => {
    const record = checkpoint.sut.results[scenario.id];
    const judge = checkpoint.judge.results[scenario.id];
    if (!record || !judge || (record.deterministic.passed && judge.judgement?.overall_pass && !judge.judgement?.critical_failure)) return [];
    return [exportFailureCandidate({ scenario, sut: record.sut, deterministic: record.deterministic, judge })];
  });
}

/** Produces a distribution-complete set solely for local schema/unit tests. */
export function testDynamicScenarioSet(seed = 'unit-seed') {
  return planDynamicBlueprints(seed).map((blueprint, offset) => {
    const candidate = testScenarioCandidate({
      seed: `${seed}-${offset + 1}`, index: offset + 1, category: blueprint.primary_category,
      long: blueprint.required_traits.includes('long_conversation'), fixture: blueprint.fixture_profile, language: blueprint.base_language,
    });
    if (blueprint.requires_escalation === 'critical') candidate.critical_invariants = ['critical_human_escalation'];
    return candidate;
  });
}
