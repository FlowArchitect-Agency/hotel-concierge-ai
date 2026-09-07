import { invalidStructuredResult, normalizedResult, normalizeLlmRequest } from './schemas.js';
import { qualifiedForPurpose } from './model-qualification.js';
import { completeGroq } from './providers/groq.js';
import { completeOpenAICompatible } from './providers/openai-compatible.js';
import { completeOmniRoute } from './providers/omniroute.js';

const DEFAULT_GROQ_MODEL = 'qwen/qwen3.6-27b';
const DEFAULT_OMNIROUTE_BASE_URL = 'http://localhost:20128/v1';

function configured(value) {
  return String(value || '').trim();
}

// OpenAI-compatible providers sometimes expose non-standard chat-template
// switches (for example, a hosted model's reasoning mode). Keep those as a
// deployment-owned transport setting: never derive them from guest input and
// never allow them to replace the application-owned request fields.
function chatTemplateKwargs(env) {
  const source = configured(env.LLM_OPENAI_COMPATIBLE_CHAT_TEMPLATE_KWARGS_JSON);
  if (!source || source.length > 1_000) return null;
  try {
    const parsed = JSON.parse(source);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.keys(parsed).length > 12) return null;
    const entries = Object.entries(parsed).filter(([key, value]) => (
      /^[a-z][a-z0-9_]{0,63}$/i.test(key)
      && (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 160))
    ));
    return entries.length === Object.keys(parsed).length ? Object.fromEntries(entries) : null;
  } catch {
    return null;
  }
}

function providerName(env) {
  const provider = configured(env.LLM_PROVIDER || 'groq').toLowerCase();
  return ['groq', 'openai-compatible', 'omniroute'].includes(provider) ? provider : 'groq';
}

function primaryModel(env, provider, purpose) {
  if (provider === 'groq') {
    return purpose === 'intent_router'
      ? configured(env.GROQ_ROUTER_MODEL || env.GROQ_MODEL || DEFAULT_GROQ_MODEL)
      : configured(env.GROQ_MODEL || DEFAULT_GROQ_MODEL);
  }
  return configured(env.LLM_MODEL);
}

function providerConfig(env, provider, model) {
  if (provider === 'groq') return { provider, model, apiKey: env.GROQ_API_KEY, baseUrl: '' };
  if (provider === 'omniroute') {
    return {
      provider,
      model,
      apiKey: env.LLM_API_KEY || env.OMNIROUTE_API_KEY,
      baseUrl: configured(env.LLM_BASE_URL || env.OMNIROUTE_BASE_URL || DEFAULT_OMNIROUTE_BASE_URL),
    };
  }
  return {
    provider,
    model,
    apiKey: env.LLM_API_KEY,
    baseUrl: configured(env.LLM_BASE_URL),
    chatTemplateKwargs: chatTemplateKwargs(env),
  };
}

function fallbackCandidate(env, primary, purpose) {
  const provider = configured(env.LLM_FALLBACK_PROVIDER || primary.provider).toLowerCase();
  const model = configured(env.LLM_FALLBACK_MODEL || (provider === 'groq' ? env.GROQ_FALLBACK_MODEL : ''));
  if (!['groq', 'openai-compatible', 'omniroute'].includes(provider) || !model) return null;
  if (provider === primary.provider && model === primary.model) return null;
  // A configured primary is deliberate. A fallback is not: it must carry
  // explicit benchmark evidence for the same provider/model/purpose.
  if (!qualifiedForPurpose(provider, model, purpose)) return null;
  return providerConfig(env, provider, model);
}

async function providerComplete(candidate, request, fetchImpl) {
  if (candidate.provider === 'groq') return completeGroq({ apiKey: candidate.apiKey, request, fetchImpl });
  if (candidate.provider === 'omniroute') return completeOmniRoute({ baseUrl: candidate.baseUrl, apiKey: candidate.apiKey, request, fetchImpl });
  return completeOpenAICompatible({
    provider: 'openai-compatible', baseUrl: candidate.baseUrl, apiKey: candidate.apiKey, request, fetchImpl,
    requestTransform: candidate.chatTemplateKwargs
      ? (body) => ({ ...body, chat_template_kwargs: candidate.chatTemplateKwargs })
      : undefined,
  });
}

function validateStructured(result, request) {
  if (result.status !== 'success' || !request.structured_schema) return result;
  const parser = request.structured_schema.parse;
  if (typeof parser !== 'function') return invalidStructuredResult(result);
  const structured = parser(result.content);
  return structured ? normalizedResult({ ...result, structured }) : invalidStructuredResult(result);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A 429 from Groq's free-tier per-minute limit is usually gone within a
// second -- a guest conversation only has to survive the current window, not
// a real outage. Retrying immediately, back-to-back, tends to land in the
// same window and fail again, which is exactly what turned "the model was
// rate-limited once" into "the response generator failed twice and the
// guest got the last-resort fallback sentence." A short, jittered pause
// before exactly one retry is enough to usually clear the window without
// meaningfully changing guest-facing latency for the common (non-limited)
// case. A real 'timeout' is not retried here: the request timeout is already
// generous (30s default), so doubling it would risk far worse latency for
// what is more likely a genuine provider slowdown than a clearable window.
const RATE_LIMIT_RETRY_BASE_MS = 350;

/**
 * Executes a deterministic primary → qualified fallback chain. The gateway
 * does not route across an arbitrary provider pool and never owns guest state:
 * callers pass the complete context on every turn, including after failover.
 */
export async function complete(env, rawRequest, { fetchImpl } = {}) {
  const request = normalizeLlmRequest(rawRequest);
  const provider = providerName(env);
  const primary = providerConfig(env, provider, rawRequest.model || primaryModel(env, provider, request.purpose));
  const candidates = [primary, fallbackCandidate(env, primary, request.purpose)].filter(Boolean);
  let last = normalizedResult({ status: 'provider_error', provider: primary.provider, model: primary.model, error_code: 'no_candidate' });
  for (const [index, candidate] of candidates.entries()) {
    if (!candidate.apiKey || !candidate.model || (candidate.provider !== 'groq' && !candidate.baseUrl)) {
      last = normalizedResult({ status: 'provider_error', provider: candidate.provider, model: candidate.model, attempts: index + 1, fallback_used: index > 0, error_code: 'missing_configuration' });
      continue;
    }
    let result = validateStructured(await providerComplete(candidate, { ...request, model: candidate.model }, fetchImpl), request);
    if (result.status === 'rate_limited') {
      await sleep(RATE_LIMIT_RETRY_BASE_MS + Math.floor(Math.random() * RATE_LIMIT_RETRY_BASE_MS));
      result = validateStructured(await providerComplete(candidate, { ...request, model: candidate.model }, fetchImpl), request);
    }
    last = normalizedResult({ ...result, attempts: index + 1, fallback_used: index > 0 });
    if (last.status === 'success') return last;
  }
  return last;
}

export function completeStructured(env, request, options) {
  return complete(env, { ...request, structured_schema: { type: 'json_object', parse: options?.parse } }, options);
}

export function completeText(env, request, options) {
  return complete(env, { ...request, structured_schema: null }, options);
}

export function llmConfigurationStatus(env, purpose = 'semantic_controller') {
  const provider = providerName(env);
  const model = primaryModel(env, provider, purpose);
  const candidate = providerConfig(env, provider, model);
  return {
    configured: Boolean(candidate.apiKey && candidate.model && (candidate.provider === 'groq' || candidate.baseUrl)),
    provider: candidate.provider,
    model: candidate.model,
  };
}
