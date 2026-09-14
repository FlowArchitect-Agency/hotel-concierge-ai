// Groq's token-per-day budget is enforced PER MODEL, not per account
// ("Rate limit reached for model `qwen/qwen3.6-27b` ... tokens per day").
// So an exhausted primary does not mean an exhausted key: a sibling model on
// the same key has its own full budget. This scans the Groq chat models for
// ones that still have budget AND produce a valid plan from the production
// semantic-controller prompt.

import { buildSemanticControllerPrompt, parseSemanticControllerOutput } from '../../src/semantic-controller.js';

const KEY = process.env.GROQ_API_KEY;
const MODELS = [
  'qwen/qwen3.8-27b',
  'qwen/qwen3.6-27b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'groq/compound-mini',
];

const CASES = [
  ['book', 'I would like to book the couples massage for Saturday.'],
  ['facts', 'What time is breakfast served?'],
  ['negation', 'Actually forget the spa idea, what about dinner?'],
];

for (const model of MODELS) {
  const qwen = model.startsWith('qwen/');
  const gptOss = /gpt-oss/.test(model);
  let ok = 0;
  let budget = 'ok';
  const notes = [];

  for (const [id, message] of CASES) {
    const prompt = buildSemanticControllerPrompt({
      input: { message, language: 'en' }, history: [], context: {},
      capabilities: ['hotel_facts', 'hotel_services', 'external_search', 'guest_request', 'human_takeover'],
    });
    const body = {
      model, max_tokens: 2500, temperature: 0,
      messages: [{ role: 'user', content: prompt }],
      // Mirror the production transport rules per model family.
      ...(qwen ? { reasoning_effort: 'none', reasoning_format: 'hidden' } : {}),
      ...(gptOss ? { reasoning_format: 'hidden' } : {}),
    };
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        if (/tokens per day|TPD/i.test(t)) { budget = 'EXHAUSTED (TPD)'; break; }
        if (res.status === 429) { budget = 'rate limited (TPM)'; notes.push(`${id}:429`); continue; }
        notes.push(`${id}:HTTP ${res.status}`);
        continue;
      }
      const j = await res.json();
      const raw = j?.choices?.[0]?.message?.content ?? '';
      const plan = parseSemanticControllerOutput(raw, { language: 'en' });
      if (plan.valid) ok += 1; else notes.push(`${id}:invalid(${j?.choices?.[0]?.finish_reason})`);
    } catch (e) { notes.push(`${id}:${String(e.message).slice(0, 40)}`); }
    await new Promise((r) => setTimeout(r, 2500));
  }

  console.log(`${budget === 'ok' ? (ok === CASES.length ? 'USABLE  ' : 'partial ') : 'NO      '} ${model.padEnd(22)} valid ${ok}/${CASES.length}  budget=${budget}  ${notes.join(' ')}`);
  await new Promise((r) => setTimeout(r, 1500));
}
