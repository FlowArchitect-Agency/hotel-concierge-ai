import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEMO_READINESS_VERSION, scenarioFingerprint } from './scenarios.js';

export function defaultReadinessCheckpointPath() {
  return path.join(os.tmpdir(), 'conciergeflow-demo-ai-readiness-v1.json');
}

export function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

export function freshReadinessCheckpoint({ mainCheckpointPath, mainCheckpointHash, sut = {} } = {}) {
  return {
    version: 1, suite_version: DEMO_READINESS_VERSION, scenario_fingerprint: scenarioFingerprint(),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), status: 'running',
    sut, main_checkpoint: { path: mainCheckpointPath, hash_before: mainCheckpointHash, hash_after: null },
    results: {}, metrics: { model_calls: 0, controller_model_calls: 0, response_model_calls: 0, rate_limit_retries: 0 },
    last_rate_limit: null,
  };
}

export function loadReadinessCheckpoint(checkpointPath, options) {
  try {
    const parsed = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (parsed?.version === 1 && parsed.suite_version === DEMO_READINESS_VERSION && parsed.scenario_fingerprint === scenarioFingerprint() && parsed.results && parsed.metrics) return parsed;
  } catch { /* First run uses a fresh local checkpoint. */ }
  return freshReadinessCheckpoint(options);
}

export function saveReadinessCheckpoint(checkpointPath, checkpoint) {
  checkpoint.updated_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}
