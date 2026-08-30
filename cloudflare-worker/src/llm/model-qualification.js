// Qualification is deliberately provider-and-model specific. A model reachable
// through one provider cannot inherit another provider's benchmark evidence.
export const MODEL_QUALIFICATIONS = Object.freeze([
  {
    provider: 'groq',
    model: 'qwen/qwen3.6-27b',
    controllerQualified: true,
    responseQualified: true,
    benchmarkScore: 'Task 13A live semantic 20/20; local Task 13B contracts',
    productionApproved: false,
  },
  {
    provider: 'nvidia',
    model: 'openai/gpt-oss-20b',
    controllerQualified: false,
    responseQualified: false,
    benchmarkScore: 'Task 13B NVIDIA controller qualification failed',
    productionApproved: false,
  },
  {
    provider: 'nvidia',
    model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    controllerQualified: false,
    responseQualified: false,
    benchmarkScore: 'Task 13B NVIDIA controller qualification failed',
    productionApproved: false,
  },
  {
    provider: 'nvidia',
    model: 'deepseek-ai/deepseek-v4-flash-0731',
    controllerQualified: false,
    responseQualified: false,
    benchmarkScore: 'Task 13B NVIDIA controller qualification failed',
    productionApproved: false,
  },
  {
    provider: 'nvidia',
    model: 'moonshotai/kimi-k3',
    controllerQualified: false,
    responseQualified: false,
    benchmarkScore: 'Task 13B NVIDIA provider/API incompatibility',
    productionApproved: false,
  },
]);

export function qualificationFor(provider, model) {
  return MODEL_QUALIFICATIONS.find((item) => item.provider === provider && item.model === model) || null;
}

export function qualifiedForPurpose(provider, model, purpose) {
  const qualification = qualificationFor(provider, model);
  if (!qualification) return false;
  return purpose === 'response_generator'
    ? qualification.responseQualified === true
    : qualification.controllerQualified === true;
}
