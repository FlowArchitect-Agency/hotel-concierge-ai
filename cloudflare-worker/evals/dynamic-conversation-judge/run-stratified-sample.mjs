import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roleConfigurationMetadata } from './config.js';
import { defaultStratifiedDiagnosticCheckpointPath, runStratifiedDiagnosticSample } from './stratified-sample.js';

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--seed') result.seed = argv[index + 1];
    if (argv[index] === '--checkpoint') result.checkpoint = argv[index + 1];
  }
  return result;
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
  } catch { /* Environment-only configuration is supported. */ }
  return values;
}

const input = args(process.argv.slice(2));
const seed = input.seed || `stratified-${Date.now()}`;
const checkpointPath = path.resolve(input.checkpoint || defaultStratifiedDiagnosticCheckpointPath());
const env = localEnvironment();
const generator = roleConfigurationMetadata(env, 'generator');

if (!generator.configured) {
  console.log(JSON.stringify({ seed, checkpoint: checkpointPath, status: 'GENERATOR_BLOCKED', reason: 'generator_configuration_missing' }, null, 2));
  process.exitCode = 2;
} else {
  const result = await runStratifiedDiagnosticSample(env, { seed, checkpointPath });
  const checkpoint = result.checkpoint;
  console.log(JSON.stringify({
    diagnostic_version: checkpoint.diagnostic_version, seed, checkpoint: checkpointPath, status: result.status,
    completed: checkpoint.calls.length, accepted: checkpoint.accepted_diagnostic_only.length,
    calls: checkpoint.calls, last_rate_limit: checkpoint.last_rate_limit,
  }, null, 2));
  process.exitCode = ['COMPLETE', 'RATE_LIMIT_WAIT_REQUIRED'].includes(result.status) ? 0 : 1;
}
