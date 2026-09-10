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
    // Reached at runtime through the openai-compatible provider pointed at
    // NVIDIA's integrate endpoint, which is the same endpoint this evidence was
    // gathered against. Controller-qualified only: 13/15 on the production
    // semantic-controller prompt and strict parser with zero unparseable plans
    // (evals/provider-qualification/controller-qualification.mjs). The two
    // misses were routing choices, not malformed output. No response-generator
    // evidence exists yet, so it stays unqualified for that purpose.
    // NOTE: requires the reasoning-model token floor in llm/index.js -- at the
    // callers' 180-350 budgets this model is truncated mid-JSON.
    provider: 'openai-compatible',
    model: 'deepseek-ai/deepseek-v4-pro-0813',
    controllerQualified: true,
    responseQualified: false,
    benchmarkScore: 'controller-qualification 13/15, 0 unparseable (2026-09-08)',
    productionApproved: false,
  },
  {
    // 0/15, every plan unparseable against the production controller prompt,
    // despite handling a toy JSON prompt correctly.
    provider: 'openai-compatible',
    model: 'minimaxai/minimax-m3',
    controllerQualified: false,
    responseQualified: false,
    benchmarkScore: 'controller-qualification 0/15, 15 unparseable (2026-09-08)',
    productionApproved: false,
  },
  {
    // 11/15 with 3 unparseable plans -- it fails in exactly the way a fallback
    // must not, so it is recorded but not qualified.
    provider: 'openai-compatible',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    controllerQualified: false,
    responseQualified: false,
    benchmarkScore: 'controller-qualification 11/15, 3 unparseable (2026-09-08)',
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
