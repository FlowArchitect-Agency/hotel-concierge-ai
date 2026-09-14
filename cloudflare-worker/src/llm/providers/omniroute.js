import { completeOpenAICompatible } from './openai-compatible.js';

export function completeOmniRoute({ baseUrl, apiKey, request, fetchImpl } = {}) {
  return completeOpenAICompatible({ provider: 'omniroute', baseUrl, apiKey, request, fetchImpl });
}
