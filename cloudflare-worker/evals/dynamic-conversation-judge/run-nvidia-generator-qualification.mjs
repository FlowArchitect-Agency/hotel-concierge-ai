import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultNvidiaQualificationCheckpointPath, NVIDIA_GENERATOR_MODEL, NVIDIA_GENERATOR_TIMEOUT_MS,
  runNvidiaGeneratorQualification,
} from './nvidia-generator-qualification.js';

function args(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--seed') values.seed = argv[index + 1];
    if (argv[index] === '--checkpoint') values.checkpoint = argv[index + 1];
  }
  return values;
}

function localEnvironment() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const values = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
      const separator = line.indexOf('=');
      if (separator > 0 && !/^\s*#/.test(line)) {
        const key = line.slice(0, separator).trim();
        values[key] ||= line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
      }
    }
  } catch { /* User environment configuration is also supported. */ }
  return values;
}

const input = args(process.argv.slice(2));
const seed = input.seed || 'nvidia-minimax-qualification';
const checkpointPath = path.resolve(input.checkpoint || defaultNvidiaQualificationCheckpointPath());
const local = localEnvironment();
const env = {
  ...local,
  DYNAMIC_GENERATOR_PROVIDER: 'nvidia',
  DYNAMIC_GENERATOR_MODEL: NVIDIA_GENERATOR_MODEL,
  DYNAMIC_GENERATOR_TIMEOUT_MS: String(NVIDIA_GENERATOR_TIMEOUT_MS),
};

if (!env.NVIDIA_API_KEY) {
  console.log(JSON.stringify({ status: 'GENERATOR_BLOCKED', reason: 'nvidia_api_key_missing' }, null, 2));
  process.exitCode = 2;
} else {
  const result = await runNvidiaGeneratorQualification(env, { seed, checkpointPath });
  const checkpoint = result.checkpoint;
  console.log(JSON.stringify({
    status: result.status, qualification_version: checkpoint.qualification_version,
    model: checkpoint.model, timeout_ms: checkpoint.timeout_ms, checkpoint: checkpointPath,
    preflight: checkpoint.preflight, completed: checkpoint.calls.length,
    accepted: checkpoint.accepted_qualification_only.length, calls: checkpoint.calls,
  }, null, 2));
  process.exitCode = ['COMPLETE', 'RATE_LIMIT_WAIT_REQUIRED'].includes(result.status) ? 0 : 1;
}
