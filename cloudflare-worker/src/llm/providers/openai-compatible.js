import { normalizedResult } from '../schemas.js';

function endpointFor(baseUrl) {
  const value = String(baseUrl || '').replace(/\/+$/, '');
  if (!value) return '';
  return value.endsWith('/chat/completions') ? value : `${value}/chat/completions`;
}

function contentFrom(data) {
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

export async function completeOpenAICompatible({
  provider,
  baseUrl,
  apiKey,
  request,
  requestTransform = (body) => body,
  fetchImpl = fetch,
} = {}) {
  const startedAt = Date.now();
  const model = request?.model || '';
  const endpoint = endpointFor(baseUrl);
  if (!endpoint || !apiKey || !model) {
    return normalizedResult({ status: 'provider_error', provider, model, latency_ms: Date.now() - startedAt, error_code: 'missing_configuration' });
  }
  const baseBody = {
    model,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    ...(request.structured_schema?.type === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeout_ms);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestTransform(baseBody, request)),
      signal: controller.signal,
    });
    if (response.status === 429) {
      return normalizedResult({ status: 'rate_limited', provider, model, latency_ms: Date.now() - startedAt, error_code: 'http_429' });
    }
    if (!response.ok) {
      return normalizedResult({ status: 'provider_error', provider, model, latency_ms: Date.now() - startedAt, error_code: `http_${response.status}` });
    }
    let data;
    try {
      data = await response.json();
    } catch {
      return normalizedResult({ status: 'invalid_output', provider, model, latency_ms: Date.now() - startedAt, error_code: 'invalid_provider_json' });
    }
    const content = contentFrom(data);
    return content
      ? normalizedResult({ status: 'success', provider, model, content, latency_ms: Date.now() - startedAt })
      : normalizedResult({ status: 'invalid_output', provider, model, latency_ms: Date.now() - startedAt, error_code: 'empty_content' });
  } catch (error) {
    return normalizedResult({
      status: error?.name === 'AbortError' ? 'timeout' : 'provider_error',
      provider,
      model,
      latency_ms: Date.now() - startedAt,
      error_code: error?.name === 'AbortError' ? 'timeout' : 'request_error',
    });
  } finally {
    clearTimeout(timeout);
  }
}
