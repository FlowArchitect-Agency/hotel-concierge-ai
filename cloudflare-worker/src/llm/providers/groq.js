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
      const qwen = String(normalizedRequest.model).startsWith('qwen/');
      const controllerQwen = normalizedRequest.purpose === 'semantic_controller' && qwen;
      const transformed = { ...body };
      // Preserve the existing Groq/Qwen transport behaviour. The controller
      // prompt itself remains the authority for Qwen JSON while other models
      // receive OpenAI JSON mode.
      if (controllerQwen) delete transformed.response_format;
      if (qwen) Object.assign(transformed, { reasoning_effort: 'none', reasoning_format: 'hidden' });
      return transformed;
    },
  });
}
