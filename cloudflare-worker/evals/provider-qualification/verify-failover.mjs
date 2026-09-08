// Verifies cross-provider failover end to end against the real gateway and
// real networks: a broken Groq primary must fall through to the qualified
// NVIDIA candidate and return a usable plan, and must NOT fall through for a
// purpose that candidate is not qualified for.

import { complete } from '../../src/llm/index.js';

const base = {
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  LLM_FALLBACK_PROVIDER: 'openai-compatible',
  LLM_FALLBACK_MODEL: 'deepseek-ai/deepseek-v4-pro-0813',
  LLM_BASE_URL: 'https://integrate.api.nvidia.com/v1',
  LLM_API_KEY: process.env.NVIDIA_API_KEY,
};

const messages = [{
  role: 'user',
  content: 'Return JSON only: {"interaction_type":"booking_request","service_category":"spa","guest_goal":"book a massage"}. Guest said: I want to book the couples massage.',
}];

async function run(label, env, purpose) {
  const t0 = Date.now();
  const r = await complete(env, { purpose, messages, max_tokens: 350 });
  console.log(`\n[${label}]`);
  console.log(`  status=${r.status} provider=${r.provider} model=${r.model}`);
  console.log(`  fallback_used=${r.fallback_used} attempts=${r.attempts} ${Date.now() - t0}ms`);
  if (r.content) console.log(`  content: ${String(r.content).replace(/\s+/g, ' ').slice(0, 110)}`);
  return r;
}

// 1. Healthy primary: must NOT use the fallback.
const healthy = await run('healthy primary (gpt-oss-120b)',
  { ...base, GROQ_MODEL: 'openai/gpt-oss-120b' }, 'semantic_controller');

// 2. Broken primary, controller purpose: deepseek IS qualified -> must fail over.
const failedOver = await run('broken primary, controller purpose',
  { ...base, GROQ_MODEL: 'this-model-does-not-exist' }, 'semantic_controller');

// 3. Broken primary, response purpose: deepseek is NOT response-qualified ->
//    must NOT fail over, proving the qualification gate is enforced per purpose.
const gated = await run('broken primary, response purpose (unqualified)',
  { ...base, GROQ_MODEL: 'this-model-does-not-exist' }, 'response_generator');

console.log('\n================ VERDICT ================');
const checks = [
  ['healthy primary does not use fallback', healthy.fallback_used === false],
  ['healthy primary succeeds', healthy.status === 'success'],
  ['broken primary fails over for controller', failedOver.fallback_used === true],
  ['failover returns usable content', failedOver.status === 'success' && Boolean(failedOver.content)],
  ['failover used the NVIDIA candidate', String(failedOver.model).includes('deepseek')],
  ['unqualified purpose does NOT fail over', gated.fallback_used === false],
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log(checks.every(([, ok]) => ok) ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
