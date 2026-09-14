import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultGeminiBaselineCheckpointPath,
  defaultGeminiQualificationCheckpointPath,
  GEMINI_GENERATOR_BASE_URL,
  GEMINI_GENERATOR_MODEL,
  GEMINI_GENERATOR_TIMEOUT_MS,
  runGeminiGeneratorQualification,
} from './gemini-generator-qualification.js';

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

function safeRecord(record) {
  if (!record) return null;
  return {
    blueprint_id: record.blueprint_id,
    primary_category: record.primary_category,
    requested_prior_messages: record.requested_prior_messages,
    actual_prior_messages: record.actual_prior_messages,
    latency_ms: record.latency_ms,
    transport_status: record.transport_status,
    schema_valid: record.schema_valid,
    blueprint_valid: record.blueprint_valid,
    result: record.result,
    structural_errors: record.structural_errors,
    validation_errors: record.validation_errors,
  };
}

const input = args(process.argv.slice(2));
const seed = input.seed || 'task13d-gemini-generator-qualification';
const checkpointPath = path.resolve(input.checkpoint || defaultGeminiQualificationCheckpointPath());
const local = localEnvironment();
const env = {
  ...local,
  DYNAMIC_GENERATOR_PROVIDER: 'openai-compatible',
  DYNAMIC_GENERATOR_MODEL: GEMINI_GENERATOR_MODEL,
  DYNAMIC_GENERATOR_BASE_URL: GEMINI_GENERATOR_BASE_URL,
  DYNAMIC_GENERATOR_API_KEY_ENV: 'GEMINI_API_KEY',
  DYNAMIC_GENERATOR_TIMEOUT_MS: String(GEMINI_GENERATOR_TIMEOUT_MS),
  // Qualification must not silently fall back to Groq or a production model.
  LLM_FALLBACK_MODEL: '',
};

if (!env.GEMINI_API_KEY) {
  console.log(JSON.stringify({ status: 'GEMINI_API_KEY_REQUIRED' }, null, 2));
  process.exitCode = 2;
} else {
  const result = await runGeminiGeneratorQualification(env, { seed, checkpointPath });
  const checkpoint = result.checkpoint;
  console.log(JSON.stringify({
    status: result.status,
    qualification_version: checkpoint.qualification_version,
    generator_provider: checkpoint.generator_provider,
    generator_model: checkpoint.generator_model,
    generator_gateway: checkpoint.generator_gateway,
    timeout_ms: checkpoint.timeout_ms,
    checkpoint: checkpointPath,
    clean_gemini_baseline_checkpoint: defaultGeminiBaselineCheckpointPath(),
    basic_preflight: checkpoint.basic_preflight,
    structured_preflight: safeRecord(checkpoint.structured_preflight),
    long_context_preflight: safeRecord(checkpoint.long_context_preflight),
    complex_preflight: safeRecord(checkpoint.complex_preflight),
    completed: checkpoint.calls.length,
    accepted: checkpoint.accepted_qualification_only.length,
    calls: checkpoint.calls.map(safeRecord),
  }, null, 2));
  process.exitCode = ['GEMINI_GENERATOR_QUALIFIED', 'GEMINI_GENERATOR_PROVISIONALLY_QUALIFIED'].includes(result.status) ? 0 : 1;
}
