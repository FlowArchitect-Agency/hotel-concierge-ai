import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDynamicCheckpointPath } from './checkpoint.js';
import { DYNAMIC_TARGET_SCENARIOS, judgeIndependence, roleConfigurationMetadata } from './config.js';
import { dynamicRunReport, runDynamicEvaluation } from './runner.js';

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--seed') result.seed = argv[index + 1];
    if (argv[index] === '--checkpoint') result.checkpoint = argv[index + 1];
    if (argv[index] === '--generation-only') result.generationOnly = true;
    if (argv[index] === '--sample') result.generationSampleId = argv[index + 1];
    if (argv[index] === '--calls') result.maxNewGeneratorCalls = Number(argv[index + 1]);
  }
  return result;
}

function localEnvironment() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const values = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
      const separator = line.indexOf('=');
      if (separator > 0 && !/^\s*#/.test(line)) values[line.slice(0, separator).trim()] ||= line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  } catch { /* Environment-only configuration is supported. */ }
  return values;
}

const input = args(process.argv.slice(2));
const seed = input.seed || `dynamic-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const checkpointPath = path.resolve(input.checkpoint || defaultDynamicCheckpointPath());
const env = localEnvironment();
const roles = Object.fromEntries(['generator', 'sut', 'judge'].map((role) => [role, roleConfigurationMetadata(env, role)]));

if (Object.values(roles).some((role) => !role.configured)) {
  console.log(JSON.stringify({ dynamic_eval_version: 'dynamic-conversation-eval-v1', seed, checkpoint: checkpointPath, status: 'GENERATOR_BLOCKED', reason: 'one_or_more_role_configurations_missing', roles }, null, 2));
  process.exitCode = 2;
} else {
  const result = await runDynamicEvaluation(env, {
    seed, checkpointPath, target: DYNAMIC_TARGET_SCENARIOS,
    generationOnly: input.generationOnly, generationSampleId: input.generationSampleId,
    maxNewGeneratorCalls: input.maxNewGeneratorCalls,
  });
  const report = dynamicRunReport(result.checkpoint);
  console.log(JSON.stringify({
    dynamic_eval_version: report.version, seed, checkpoint: checkpointPath, status: result.status,
    judge_independence: judgeIndependence(env), generated: report.generated, completed: `${report.completed}/${DYNAMIC_TARGET_SCENARIOS}`,
    passed: report.passed, failed: report.failed, critical_failures: report.critical_failures,
    metrics: report.metrics, generation_sample: report.generation_sample, last_rate_limit: result.checkpoint.last_rate_limit,
  }, null, 2));
  process.exitCode = ['RATE_LIMIT_WAIT_REQUIRED', 'success'].includes(result.status) ? 0 : 1;
}
