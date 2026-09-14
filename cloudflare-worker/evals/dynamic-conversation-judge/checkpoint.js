import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DYNAMIC_EVAL_VERSION, DYNAMIC_TARGET_SCENARIOS, judgeIndependence, roleConfigurationMetadata } from './config.js';

export const DYNAMIC_CHECKPOINT_VERSION = 2;

export function defaultDynamicCheckpointPath() {
  return path.join(os.tmpdir(), 'conciergeflow-dynamic-conversation-eval-v1.json');
}

export function freshCheckpoint({ seed, target = DYNAMIC_TARGET_SCENARIOS, env = {} } = {}) {
  return {
    version: DYNAMIC_CHECKPOINT_VERSION, dynamic_eval_version: DYNAMIC_EVAL_VERSION, seed: String(seed), target,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    roles: Object.fromEntries(['generator', 'sut', 'judge'].map((role) => [role, roleConfigurationMetadata(env, role)])),
    judge_independence: judgeIndependence(env),
    generation: {
      scenarios: [], rejected: [], batches_completed: 0, batch_attempts: {}, constraint_version: 2,
      strategy: 'blueprint-v1', blueprint_version: 'dynamic-blueprint-v1', blueprints: [], blueprint_states: {},
      active_blueprint_id: null, blueprint_failures: [], rejections_by_trait: {}, preserved_accepted_count: 0,
    },
    sut: { results: {} }, judge: { results: {}, second_results: {} }, judge_validation: { results: {} },
    metrics: { generator_calls: 0, sut_controller_calls: 0, sut_response_calls: 0, judge_calls: 0, second_judge_calls: 0, rate_limit_retries: 0 },
    last_rate_limit: null, status: 'running',
  };
}

/** Preserves every historical result/accounting field while preparing v1 state for the planner. */
export function migrateDynamicCheckpoint(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (![1, DYNAMIC_CHECKPOINT_VERSION].includes(Number(parsed.version)) || parsed.dynamic_eval_version !== DYNAMIC_EVAL_VERSION) return null;
  parsed.generation ||= { scenarios: [], rejected: [] };
  parsed.generation.scenarios ||= [];
  parsed.generation.rejected ||= [];
  parsed.generation.batch_attempts ||= {};
  parsed.generation.strategy ||= 'blueprint-v1';
  parsed.generation.blueprint_version ||= 'dynamic-blueprint-v1';
  parsed.generation.blueprints ||= [];
  parsed.generation.blueprint_states ||= {};
  parsed.generation.active_blueprint_id ||= null;
  parsed.generation.blueprint_failures ||= [];
  parsed.generation.rejections_by_trait ||= {};
  parsed.generation.preserved_accepted_count ||= 0;
  parsed.metrics ||= {};
  for (const key of ['generator_calls', 'sut_controller_calls', 'sut_response_calls', 'judge_calls', 'second_judge_calls', 'rate_limit_retries']) parsed.metrics[key] ||= 0;
  parsed.version = DYNAMIC_CHECKPOINT_VERSION;
  return parsed;
}

export function loadDynamicCheckpoint(checkpointPath, { seed, target, env } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    const migrated = migrateDynamicCheckpoint(parsed);
    if (migrated && String(migrated.seed) === String(seed) && Number(migrated.target) === Number(target)
      && migrated.generation?.scenarios && migrated.sut?.results && migrated.judge?.results) return migrated;
  } catch { /* A missing or incompatible checkpoint starts a new deterministic run. */ }
  return freshCheckpoint({ seed, target, env });
}

export function saveDynamicCheckpoint(checkpointPath, checkpoint) {
  checkpoint.updated_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

export function persistRateLimit(checkpoint, rateLimit, role) {
  const source = rateLimit || checkpoint.last_rate_limit || {};
  checkpoint.metrics.rate_limit_retries += 1;
  checkpoint.last_rate_limit = {
    role, status: 429, observed_at: new Date().toISOString(),
    retry_after: source.retry_after || source.retry_after_seconds || null,
    request_reset: source.request_reset || null, token_reset: source.token_reset || null,
    safe_retry_at: source.safe_retry_at || null,
  };
  checkpoint.status = 'RATE_LIMIT_WAIT_REQUIRED';
}
