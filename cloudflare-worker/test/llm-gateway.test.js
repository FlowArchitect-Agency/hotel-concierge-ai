import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModelJson } from '../src/concierge.js';
import { parseSemanticControllerOutput } from '../src/semantic-controller.js';
import { completeStructured, completeText, llmConfigurationStatus } from '../src/llm/index.js';

const semanticJson = JSON.stringify({
  interaction_type: 'conversation', guest_goal: 'answer the previous question', context_summary: 'Guest asks why the question was asked.',
  service_category: null, additional_service_categories: [], reference_target: 'previous_question', needs_hotel_facts: false,
  needs_hotel_services: false, needs_external_search: false, needs_guest_request: false, needs_human: false,
  language: 'en', confidence: 0.92, clarification_needed: false, clarification_reason: '', topic_changed: false,
});

function env(overrides = {}) {
  return {
    GROQ_API_KEY: 'test-groq-key',
    GROQ_MODEL: 'qwen/qwen3.6-27b',
    ...overrides,
  };
}

function jsonResponse(content, status = 200) {
  return Response.json({ choices: [{ message: { content } }] }, { status });
}

function semanticRequest(message = 'No, why?') {
  return {
    purpose: 'semantic_controller',
    messages: [{ role: 'user', content: message }],
    max_tokens: 320,
  };
}

function semanticParser(content) {
  const plan = parseSemanticControllerOutput(content, { language: 'en' });
  return plan.valid ? plan : null;
}

test('semantic controller is validated identically through the provider-neutral gateway', async () => {
  const result = await completeStructured(env(), semanticRequest(), {
    parse: semanticParser,
    fetchImpl: async () => jsonResponse(semanticJson),
  });
  assert.equal(result.status, 'success');
  assert.equal(result.provider, 'groq');
  assert.equal(result.structured.referenceTarget, 'previous_question');
});

test('response generator is validated through the same gateway contract', async () => {
  const result = await completeStructured(env(), {
    purpose: 'response_generator',
    messages: [{ role: 'user', content: 'Compose a concise hotel reply.' }],
  }, {
    parse: (content) => {
      const model = parseModelJson(content);
      return model.reply ? model : null;
    },
    fetchImpl: async () => jsonResponse(JSON.stringify({ reply_text: 'I can help you explore the verified collection.', intent: 'other' })),
  });
  assert.equal(result.status, 'success');
  assert.match(result.structured.reply, /verified collection/i);
});

test('Groq adapter preserves the known Qwen transport shape', async () => {
  let body;
  const result = await completeStructured(env(), semanticRequest(), {
    parse: semanticParser,
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return jsonResponse(semanticJson);
    },
  });
  assert.equal(result.status, 'success');
  assert.equal(body.model, 'qwen/qwen3.6-27b');
  assert.equal(body.reasoning_effort, 'none');
  assert.equal(body.reasoning_format, 'hidden');
  assert.equal('response_format' in body, false);
});

test('gateway normalizes a provider rate limit without exposing headers or credentials', async () => {
  const result = await completeText(env(), {
    purpose: 'response_generator', messages: [{ role: 'user', content: 'Hello' }],
  }, { fetchImpl: async () => new Response(null, { status: 429, headers: { 'retry-after': '5' } }) });
  assert.equal(result.status, 'rate_limited');
  assert.equal(result.content, '');
  assert.equal(JSON.stringify(result).includes('retry-after'), false);
  assert.equal(JSON.stringify(result).includes('test-groq-key'), false);
});

test('gateway normalizes an aborted provider call as a timeout', async () => {
  const result = await completeText(env(), {
    purpose: 'response_generator', messages: [{ role: 'user', content: 'Hello' }],
  }, { fetchImpl: async () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error; } });
  assert.equal(result.status, 'timeout');
  assert.equal(result.error_code, 'timeout');
});

test('invalid structured output cannot become a semantic plan', async () => {
  const result = await completeStructured(env(), semanticRequest(), {
    parse: semanticParser,
    fetchImpl: async () => jsonResponse('I would be happy to help with that.'),
  });
  assert.equal(result.status, 'invalid_output');
  assert.equal(result.structured, null);
  assert.equal(result.content, '');
});

test('provider errors have a normalized, secret-free failure result', async () => {
  const result = await completeText(env(), {
    purpose: 'response_generator', messages: [{ role: 'user', content: 'Hello' }],
  }, { fetchImpl: async () => new Response(null, { status: 503 }) });
  assert.equal(result.status, 'provider_error');
  assert.equal(result.error_code, 'http_503');
  assert.equal(result.content, '');
});

test('gateway uses an explicitly qualified fallback after a primary failure', async () => {
  const calls = [];
  const result = await completeStructured(env({
    LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'https://synthetic.primary/v1', LLM_API_KEY: 'primary-test-key', LLM_MODEL: 'synthetic-primary',
    LLM_FALLBACK_PROVIDER: 'groq', LLM_FALLBACK_MODEL: 'qwen/qwen3.6-27b',
  }), semanticRequest(), {
    parse: semanticParser,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return String(url).includes('synthetic.primary') ? new Response(null, { status: 503 }) : jsonResponse(semanticJson);
    },
  });
  assert.equal(result.status, 'success');
  assert.equal(result.provider, 'groq');
  assert.equal(result.attempts, 2);
  assert.equal(result.fallback_used, true);
  assert.equal(calls.length, 2);
});

test('both configured providers failing returns a safe no-content result', async () => {
  const result = await completeStructured(env({
    LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'https://synthetic.primary/v1', LLM_API_KEY: 'primary-test-key', LLM_MODEL: 'synthetic-primary',
    LLM_FALLBACK_PROVIDER: 'groq', LLM_FALLBACK_MODEL: 'qwen/qwen3.6-27b',
  }), semanticRequest(), {
    parse: semanticParser,
    fetchImpl: async () => new Response(null, { status: 503 }),
  });
  assert.equal(result.status, 'provider_error');
  assert.equal(result.content, '');
  assert.equal(result.structured, null);
  assert.equal(result.attempts, 2);
});

test('provider switch retains the complete application-owned conversation context', async () => {
  let fallbackMessages = [];
  const history = [
    { role: 'assistant', content: 'Is this your first time in Paris?' },
    { role: 'user', content: 'No, why?' },
  ];
  const result = await completeStructured(env({
    LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'https://synthetic.primary/v1', LLM_API_KEY: 'primary-test-key', LLM_MODEL: 'synthetic-primary',
    LLM_FALLBACK_PROVIDER: 'groq', LLM_FALLBACK_MODEL: 'qwen/qwen3.6-27b',
  }), { purpose: 'semantic_controller', messages: history, conversation_id: 'web_context_test' }, {
    parse: semanticParser,
    fetchImpl: async (url, options) => {
      if (String(url).includes('synthetic.primary')) return new Response(null, { status: 503 });
      fallbackMessages = JSON.parse(options.body).messages;
      return jsonResponse(semanticJson);
    },
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(fallbackMessages, history);
});

test('an unqualified model cannot become an automatic fallback', async () => {
  let calls = 0;
  const result = await completeText(env({ GROQ_FALLBACK_MODEL: 'openai/gpt-oss-20b' }), {
    purpose: 'response_generator', messages: [{ role: 'user', content: 'Hello' }],
  }, { fetchImpl: async () => { calls += 1; return new Response(null, { status: 503 }); } });
  assert.equal(result.status, 'provider_error');
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
});

test('named OmniRoute adapter uses a configurable OpenAI-compatible endpoint', async () => {
  let target = '';
  const result = await completeText(env({
    LLM_PROVIDER: 'omniroute', LLM_BASE_URL: 'http://localhost:20128/v1', LLM_API_KEY: 'omniroute-test-key', LLM_MODEL: 'synthetic/qualified-for-test',
  }), {
    purpose: 'response_generator', messages: [{ role: 'user', content: 'Reply exactly: OK' }],
  }, {
    fetchImpl: async (url) => { target = String(url); return jsonResponse('OK'); },
  });
  assert.equal(result.status, 'success');
  assert.equal(result.provider, 'omniroute');
  assert.equal(target, 'http://localhost:20128/v1/chat/completions');
});

test('configuration status is provider-neutral and never returns credentials', () => {
  const status = llmConfigurationStatus(env({ LLM_PROVIDER: 'omniroute', LLM_BASE_URL: 'https://gateway.example/v1', LLM_API_KEY: 'private', LLM_MODEL: 'demo' }));
  assert.deepEqual(status, { configured: true, provider: 'omniroute', model: 'demo' });
  assert.equal(JSON.stringify(status).includes('private'), false);
});
