import { completeStructured, llmConfigurationStatus } from '../../src/llm/index.js';

export const DYNAMIC_EVAL_VERSION = 'dynamic-conversation-eval-v1';
export const DYNAMIC_TARGET_SCENARIOS = 105;
export const DYNAMIC_ROLE_NAMES = Object.freeze(['generator', 'sut', 'judge']);

function clean(value) {
  return String(value || '').trim();
}

function rolePrefix(role) {
  return `DYNAMIC_${String(role || '').toUpperCase()}`;
}

export function roleTimeoutMs(env = {}, role) {
  const configured = Number(env[`${rolePrefix(role)}_TIMEOUT_MS`]);
  // Only the synthetic generator is permitted to exceed the normal gateway
  // default. SUT and judge calls remain at their existing 30-second limit.
  if (role === 'generator' && Number.isFinite(configured)) return Math.max(1_000, Math.min(90_000, Math.floor(configured)));
  return 30_000;
}

/**
 * Adapts an evaluation role's explicit configuration to the Task 13B.5
 * provider-neutral gateway contract. Credentials are deliberately inherited
 * from normal provider variables or role-specific secrets but never returned.
 */
export function roleGatewayEnvironment(env = {}, role) {
  if (!DYNAMIC_ROLE_NAMES.includes(role)) throw new Error(`Unsupported dynamic evaluation role: ${role}`);
  const prefix = rolePrefix(role);
  const requestedProvider = clean(env[`${prefix}_PROVIDER`] || env.LLM_PROVIDER || 'groq').toLowerCase();
  // NVIDIA NIM uses the existing OpenAI-compatible transport. This alias is
  // evaluation-role configuration only; it introduces no NVIDIA-specific
  // product controller or tool architecture.
  const provider = requestedProvider === 'nvidia' ? 'openai-compatible' : requestedProvider;
  const model = clean(env[`${prefix}_MODEL`]
    || (provider === 'groq' ? env.GROQ_MODEL : env.LLM_MODEL)
    || (provider === 'groq' ? 'qwen/qwen3.6-27b' : ''));
  const roleEnv = { ...env, LLM_PROVIDER: provider };
  // Evaluation roles may name their credential environment variable without
  // copying credentials into a shared LLM_* setting. This is provider-neutral
  // and keeps the generator isolated from the SUT and judge configuration.
  const namedApiKey = clean(env[`${prefix}_API_KEY_ENV`]);
  const roleApiKey = env[`${prefix}_API_KEY`]
    || (namedApiKey ? env[namedApiKey] : '')
    || '';

  if (provider === 'groq') {
    roleEnv.GROQ_MODEL = model;
    roleEnv.GROQ_API_KEY = roleApiKey || env.GROQ_API_KEY;
  } else {
    roleEnv.LLM_MODEL = model;
    roleEnv.LLM_BASE_URL = env[`${prefix}_BASE_URL`] || (requestedProvider === 'nvidia' ? 'https://integrate.api.nvidia.com/v1' : env.LLM_BASE_URL);
    roleEnv.LLM_API_KEY = roleApiKey || (requestedProvider === 'nvidia' ? env.NVIDIA_API_KEY : env.LLM_API_KEY) || env.LLM_API_KEY;
  }
  return roleEnv;
}

export function roleConfigurationMetadata(env = {}, role) {
  const roleEnv = roleGatewayEnvironment(env, role);
  const status = llmConfigurationStatus(roleEnv, 'response_generator');
  return {
    role,
    provider: status.provider,
    model: status.model,
    configured: status.configured,
    gateway: 'conciergeflow-llm-gateway',
  };
}

export function judgeIndependence(env = {}) {
  const sut = roleConfigurationMetadata(env, 'sut');
  const judge = roleConfigurationMetadata(env, 'judge');
  if (sut.provider !== judge.provider) return 'FULL';
  if (sut.model !== judge.model) return 'LIMITED — SAME PROVIDER';
  return 'LIMITED — SAME MODEL';
}

export async function completeRoleStructured(env, role, request, options = {}) {
  const roleEnv = roleGatewayEnvironment(env, role);
  return completeStructured(roleEnv, {
    purpose: 'response_generator',
    temperature: options.temperature ?? 0.45,
    ...request,
    timeout_ms: request.timeout_ms ?? roleTimeoutMs(env, role),
  }, options);
}
