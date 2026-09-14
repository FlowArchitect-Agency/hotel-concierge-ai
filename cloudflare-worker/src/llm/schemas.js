export const LLM_PURPOSES = Object.freeze([
  'semantic_controller',
  'intent_router',
  'response_generator',
]);

export const LLM_STATUSES = Object.freeze([
  'success',
  'rate_limited',
  'timeout',
  'provider_error',
  'invalid_output',
]);

const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 18_000;
// The dynamic generator can explicitly opt into a longer offline-evaluation
// timeout. Production callers retain the existing 30-second default.
const MAX_REQUEST_TIMEOUT_MS = 90_000;

function compact(value, max = MAX_MESSAGE_CHARS) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

export function normalizeMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) throw new Error('LLM messages are required.');
  return messages.slice(-MAX_MESSAGES).map((message) => ({
    role: ['system', 'assistant', 'user'].includes(String(message?.role || '')) ? String(message.role) : 'user',
    content: compact(message?.content),
  })).filter((message) => message.content);
}

export function normalizeLlmRequest(request = {}) {
  if (!LLM_PURPOSES.includes(request.purpose)) throw new Error('Unsupported LLM purpose.');
  const messages = normalizeMessages(request.messages);
  if (!messages.length) throw new Error('LLM messages are required.');
  const maxTokens = Number(request.max_tokens ?? request.maxTokens ?? 350);
  const timeoutMs = Number(request.timeout_ms ?? request.timeoutMs ?? 30_000);
  return {
    purpose: request.purpose,
    model: compact(request.model, 180),
    messages,
    temperature: Number.isFinite(Number(request.temperature)) ? Math.max(0, Math.min(2, Number(request.temperature))) : 0.2,
    max_tokens: Number.isFinite(maxTokens) ? Math.max(1, Math.min(4_096, Math.floor(maxTokens))) : 350,
    timeout_ms: Number.isFinite(timeoutMs) ? Math.max(1_000, Math.min(MAX_REQUEST_TIMEOUT_MS, Math.floor(timeoutMs))) : 30_000,
    structured_schema: request.structured_schema || null,
    conversation_id: compact(request.conversation_id, 160),
  };
}

export function normalizedResult({
  status,
  provider = '',
  model = '',
  content = '',
  structured = null,
  latency_ms = 0,
  attempts = 1,
  fallback_used = false,
  error_code = '',
} = {}) {
  const safeStatus = LLM_STATUSES.includes(status) ? status : 'provider_error';
  return {
    status: safeStatus,
    provider: compact(provider, 80),
    model: compact(model, 180),
    content: safeStatus === 'success' ? String(content || '') : '',
    structured: safeStatus === 'success' ? structured : null,
    latency_ms: Math.max(0, Math.round(Number(latency_ms) || 0)),
    attempts: Math.max(1, Math.floor(Number(attempts) || 1)),
    fallback_used: Boolean(fallback_used),
    error_code: compact(error_code, 100),
  };
}

export function invalidStructuredResult(result) {
  return normalizedResult({
    ...result,
    status: 'invalid_output',
    content: '',
    structured: null,
    error_code: 'invalid_structured_output',
  });
}
