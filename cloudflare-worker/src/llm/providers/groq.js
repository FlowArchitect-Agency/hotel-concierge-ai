import { completeOpenAICompatible } from './openai-compatible.js';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export function completeGroq({ apiKey, request, fetchImpl } = {}) {
  return completeOpenAICompatible({
    provider: 'groq',
    baseUrl: GROQ_BASE_URL,
    apiKey,
    request,
    fetchImpl,
    requestTransform(body, normalizedRequest) {
      const model = String(normalizedRequest.model);
      const qwen = model.startsWith('qwen/');
      const gptOss = /(^|\/)gpt-oss/.test(model);
      const controllerQwen = normalizedRequest.purpose === 'semantic_controller' && qwen;
      const transformed = { ...body };
      // Preserve the existing Groq/Qwen transport behaviour. The controller
      // prompt itself remains the authority for Qwen JSON while other models
      // receive OpenAI JSON mode.
      if (controllerQwen) delete transformed.response_format;
      // Qwen accepts reasoning_effort:'none'. Groq's gpt-oss models do NOT --
      // they reject it with HTTP 400 ("must be one of low, medium, or high"),
      // so sending the Qwen transport settings to a gpt-oss model would fail
      // every call. gpt-oss also streams its chain-of-thought into a separate
      // `reasoning` field and leaves `content` empty unless reasoning_format is
      // hidden, which the gateway would read as invalid_output. Verified
      // against Groq: reasoning_format 'hidden' alone yields clean, parseable
      // JSON content with zero reasoning tokens.
      if (qwen) Object.assign(transformed, { reasoning_effort: 'none', reasoning_format: 'hidden' });
      else if (gptOss) Object.assign(transformed, { reasoning_format: 'hidden' });
      return transformed;
    },
  });
}
