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

function openAiCompatibleEnv(overrides = {}) {
  return env({
    LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'https://provider.example/v1',
    LLM_API_KEY: 'provider-test-key', LLM_MODEL: 'provider-test-model',
    ...overrides,
  });
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

test('OpenAI-compatible gateway accepts ordinary string assistant content', async () => {
  const result = await completeText(openAiCompatibleEnv(), {
    purpose: 'response_generator', messages: [{ role: 'user', content: 'Reply exactly: OK' }],
  }, { fetchImpl: async () => jsonResponse('OK') });
  assert.equal(result.status, 'success');
  assert.equal(result.content, 'OK');
});

test('OpenAI-compatible gateway applies validated deployment-owned chat-template options', async () => {
  let body;
  const result = await completeText(openAiCompatibleEnv({
    LLM_OPENAI_COMPATIBLE_CHAT_TEMPLATE_KWARGS_JSON: JSON.stringify({ enable_thinking: false }),
  }), {
    purpose: 'response_generator', messages: [{ role: 'user', content: 'Reply exactly: OK' }],
  }, {
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return jsonResponse('OK');
    },
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(body.model, 'provider-test-model');
  assert.equal(body.messages[0].content, 'Reply exactly: OK');
});

test('OpenAI-compatible gateway ignores malformed chat-template configuration', async () => {
  let body;
  const result = await completeText(openAiCompatibleEnv({
    LLM_OPENAI_COMPATIBLE_CHAT_TEMPLATE_KWARGS_JSON: '{not json',
  }), {
    purpose: 'response_generator', messages: [{ role: 'user', content: 'Reply exactly: OK' }],
  }, {
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return jsonResponse('OK');
    },
  });
  assert.equal(result.status, 'success');
  assert.equal('chat_template_kwargs' in body, false);
});

test('OpenAI-compatible gateway normalizes a typed text content array', async () => {
  const result = await completeText(openAiCompatibleEnv(), {
    purpose: 'response_generator', messages: [{ role: 'user', content: 'Reply' }],
  }, { fetchImpl: async () => jsonResponse([{ type: 'text', text: 'A verified option.' }]) });
  assert.equal(result.status, 'success');
  assert.equal(result.content, 'A verified option.');
});

test('OpenAI-compatible gateway concatenates multiple typed text chunks only', async () => {
  const result = await completeText(openAiCompatibleEnv(), {
    purpose: 'response_generator', messages: [{ role: 'user', content: 'Reply' }],
  }, {
    fetchImpl: async () => jsonResponse([
      { type: 'text', text: 'First verified detail.' },
      { type: 'citation', reference: 'internal metadata only' },
      { type: 'text', text: 'Second verified detail.' },
    ]),
  });
  assert.equal(result.status, 'success');
  assert.equal(result.content, 'First verified detail.\nSecond verified detail.');
});

test('OpenAI-compatible gateway rejects typed arrays without usable text', async () => {
  for (const content of [
    [{ type: 'tool_call', arguments: '{"query":"private"}' }],
    null,
  ]) {
    const result = await completeText(openAiCompatibleEnv(), {
      purpose: 'response_generator', messages: [{ role: 'user', content: 'Reply' }],
    }, { fetchImpl: async () => jsonResponse(content) });
    assert.equal(result.status, 'invalid_output');
    assert.equal(result.content, '');
  }
});

test('OpenAI-compatible gateway rejects malformed choices safely', async () => {
  const result = await completeText(openAiCompatibleEnv(), {
    purpose: 'response_generator', messages: [{ role: 'user', content: 'Reply' }],
  }, { fetchImpl: async () => Response.json({ choices: [{ message: null }] }) });
  assert.equal(result.status, 'invalid_output');
  assert.equal(result.content, '');
});

test('structured JSON remains strictly parsed after typed-text normalization', async () => {
  const result = await completeStructured(openAiCompatibleEnv(), {
    purpose: 'response_generator', messages: [{ role: 'user', content: 'Return JSON only.' }],
  }, {
    parse: (content) => {
      try {
        const parsed = JSON.parse(content);
        return typeof parsed.reply === 'string' ? parsed : null;
      } catch { return null; }
    },
    fetchImpl: async () => jsonResponse([{ type: 'text', text: JSON.stringify({ reply: 'Verified JSON.' }) }]),
  });
  assert.equal(result.status, 'success');
  assert.equal(result.structured.reply, 'Verified JSON.');
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

// Regression test for a live readiness test found 2026-09-07: a single
// transient 429 from Groq's free-tier per-minute limit was going straight to
// a failed result with no retry, and since the app's own "repair" second
// attempt fires back-to-back with no delay, it usually landed in the same
// rate-limit window and failed too -- turning one brief rate-limit blip into
// a guest-facing "I am experiencing a brief system delay" fallback. The
// gateway should absorb a single transient 429 by retrying once after a
// short pause, so only a sustained outage (limit still active on the retry)
// reaches the caller as a failure.
test('gateway retries once after a single transient rate limit and recovers', async () => {
  let calls = 0;
  const result = await completeText(env(), {
    purpose: 'response_generator', messages: [{ role: 'user', content: 'Hello' }],
  }, {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response(null, { status: 429 })
        : Response.json({ choices: [{ message: { content: 'Breakfast starts at 7am.' } }] });
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.status, 'success');
  assert.equal(result.content, 'Breakfast starts at 7am.');
});

test('gateway gives up after a sustained rate limit (retry also limited)', async () => {
  let calls = 0;
  const result = await completeText(env(), {
    purpose: 'response_generator', messages: [{ role: 'user', content: 'Hello' }],
  }, { fetchImpl: async () => { calls += 1; return new Response(null, { status: 429 }); } });
  assert.equal(calls, 2);
  assert.equal(result.status, 'rate_limited');
  assert.equal(result.content, '');
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

test('Groq transport sends per-model reasoning settings that the provider actually accepts', async () => {
  // Groq rejects reasoning_effort:'none' for gpt-oss models with HTTP 400
  // ("must be one of low, medium, or high"), and gpt-oss leaves `content`
  // empty unless reasoning_format is hidden. Sending Qwen's settings to a
  // gpt-oss model would therefore fail every call, so a future failover to it
  // must not inherit them.
  const sent = [];
  const fetchImpl = async (url, options) => {
    sent.push(JSON.parse(options.body));
    return Response.json({ choices: [{ message: { content: '{"reply_text":"ok"}' } }] });
  };

  await completeText({ GROQ_API_KEY: 'k', GROQ_MODEL: 'qwen/qwen3.6-27b' },
    { purpose: 'response_generator', messages: [{ role: 'user', content: 'hi' }] }, { fetchImpl });
  assert.equal(sent[0].reasoning_effort, 'none', 'qwen keeps reasoning_effort none');
  assert.equal(sent[0].reasoning_format, 'hidden');

  await completeText({ GROQ_API_KEY: 'k', GROQ_MODEL: 'openai/gpt-oss-20b' },
    { purpose: 'response_generator', messages: [{ role: 'user', content: 'hi' }] }, { fetchImpl });
  assert.equal(sent[1].reasoning_effort, undefined, 'gpt-oss must NOT receive reasoning_effort:none (HTTP 400)');
  assert.equal(sent[1].reasoning_format, 'hidden', 'gpt-oss needs hidden reasoning to return content');
});

test('An unqualified fallback model is never selected, even when configured', async () => {
  // GROQ_FALLBACK_MODEL is set in production but openai/gpt-oss-20b carries no
  // groq qualification entry, and the nvidia evidence records it as failing
  // controller qualification. It must stay unselected until real evidence for
  // this provider/model/purpose exists.
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(JSON.parse(options.body).model);
    return new Response('{"error":"rate limited"}', { status: 429 });
  };
  const result = await completeText(
    { GROQ_API_KEY: 'k', GROQ_MODEL: 'qwen/qwen3.6-27b', GROQ_FALLBACK_MODEL: 'openai/gpt-oss-20b' },
    { purpose: 'semantic_controller', messages: [{ role: 'user', content: 'hi' }] },
    { fetchImpl },
  );
  assert.equal(result.status, 'rate_limited');
  assert.equal(result.fallback_used, false, 'no fallback should be attempted');
  assert.ok(calls.every((m) => m === 'qwen/qwen3.6-27b'), 'the unqualified model must never be called');
});

test('Reasoning-model candidates get a token floor so their JSON is not truncated', async () => {
  // Callers budget 180-350 tokens, which suits Qwen with reasoning suppressed.
  // A reasoning model writes its chain-of-thought before the JSON and gets cut
  // off mid-object at that budget, so the strict parser rejects a plan the
  // model was perfectly capable of producing.
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push(JSON.parse(options.body));
    return Response.json({ choices: [{ message: { content: '{"reply_text":"ok"}' } }] });
  };

  await completeText({ GROQ_API_KEY: 'k', GROQ_MODEL: 'qwen/qwen3.6-27b' },
    { purpose: 'response_generator', max_tokens: 350, messages: [{ role: 'user', content: 'hi' }] }, { fetchImpl });
  assert.equal(seen[0].max_tokens, 350, 'the Qwen primary keeps its small budget');

  await completeText(
    { LLM_API_KEY: 'k', LLM_BASE_URL: 'https://integrate.api.nvidia.com/v1', LLM_PROVIDER: 'openai-compatible', LLM_MODEL: 'minimaxai/minimax-m3' },
    { purpose: 'response_generator', max_tokens: 350, messages: [{ role: 'user', content: 'hi' }] }, { fetchImpl },
  );
  assert.ok(seen[1].max_tokens >= 2500, `reasoning model must get a floor, got ${seen[1].max_tokens}`);
});
