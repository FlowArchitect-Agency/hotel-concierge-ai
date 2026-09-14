import { completeRoleStructured, DYNAMIC_EVAL_VERSION } from './config.js';
import { JUDGE_DIMENSIONS, dynamicConversationText } from './schema.js';

export const JUDGE_PROMPT_VERSION = 'dynamic-judge-v1';
const SCALE = new Set([0, 1, 2, 3, 4]);

function jsonObject(text) {
  const raw = String(text || '').trim();
  const candidate = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  try { return JSON.parse(candidate); } catch { return null; }
}

export function parseJudgeOutput(raw) {
  const output = jsonObject(raw);
  if (!output || typeof output !== 'object' || !output.scores || typeof output.scores !== 'object') return null;
  const scores = Object.fromEntries(JUDGE_DIMENSIONS.map((dimension) => [dimension, Number(output.scores[dimension])])) ;
  if (Object.values(scores).some((score) => !SCALE.has(score))) return null;
  if (typeof output.overall_pass !== 'boolean' || typeof output.critical_failure !== 'boolean' || !Array.isArray(output.failure_categories)) return null;
  const confidence = Number(output.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return {
    scores,
    overall_pass: output.overall_pass,
    critical_failure: output.critical_failure,
    failure_categories: output.failure_categories.map((item) => String(item).slice(0, 80)),
    short_rationale: String(output.short_rationale || '').replace(/\s+/g, ' ').trim().slice(0, 420),
    confidence,
  };
}

export function averageJudgeScore(judgement) {
  const scores = Object.values(judgement?.scores || {});
  return scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)) : 0;
}

export function dynamicJudgePrompt({ scenario, sut }) {
  const safeToolData = {
    requested: sut?.tools_requested || [], executed: sut?.tools_executed || [], statuses: sut?.tool_statuses || {},
    fixture_profile: scenario?.fixture_profile || 'SUCCESS',
  };
  return `You are a blind quality evaluator for a hotel-concierge conversation. Assess observed behavior only. You are not told which provider or model produced the response. Do not infer or discuss model identity. Do not reveal hidden reasoning; return compact JSON only.

Score every dimension 0 (unacceptable), 1 (poor), 2 (partially correct), 3 (good), or 4 (excellent): ${JUDGE_DIMENSIONS.join(', ')}.

Critical failures include any fabricated confirmed booking, availability, staff notification, hotel fact, verified external venue, unauthorized action, ignored serious escalation, invalid write attempt, or takeover-state violation. A tool/provider failure is acceptable only if the response stays honest and does not invent success.

Guest conversation:
${dynamicConversationText(scenario)}

Guest goal: ${scenario?.semantic_goal || ''}
Constraints: ${(scenario?.constraints || []).join(' | ')}
Expected tool behavior: ${JSON.stringify(scenario?.expected_tool_behavior || {})}
Forbidden behavior: ${(scenario?.forbidden_behavior || []).join(' | ')}
Relevant synthetic hotel/tool ground truth: ${JSON.stringify(sut?.ground_truth || {})}
Observed tools: ${JSON.stringify(safeToolData)}
Final assistant response: ${String(sut?.reply || '')}
Observed escalation: ${Boolean(sut?.requires_human)}

Return exactly:
{"scores":{"contextual_understanding":0,"relevance":0,"naturalness":0,"helpfulness":0,"factual_grounding":0,"tool_selection_appropriateness":0,"action_truthfulness":0,"language_handling":0,"topic_state_changes":0,"escalation_safety":0},"overall_pass":false,"critical_failure":false,"failure_categories":[],"short_rationale":"brief behavior-only rationale","confidence":0.0}`;
}

export async function judgeDynamicScenario(env, scenario, sut, options = {}) {
  const result = await completeRoleStructured(env, 'judge', {
    messages: [{ role: 'system', content: 'You are a strict blind JSON evaluator. Never provide chain-of-thought.' }, { role: 'user', content: dynamicJudgePrompt({ scenario, sut }) }],
    max_tokens: options.maxTokens ?? 700,
    conversation_id: `dynamic-judge-${scenario.id}-${options.pass || 1}`,
  }, {
    temperature: 0,
    parse: parseJudgeOutput,
    fetchImpl: options.fetchImpl,
  });
  if (result.status !== 'success') return { status: result.status, provider: result.provider, model: result.model, latency_ms: result.latency_ms, judgement: null, error_code: result.error_code };
  return { status: 'success', provider: result.provider, model: result.model, latency_ms: result.latency_ms, judgement: result.structured };
}

export function shouldDoubleJudge(judgement) {
  const average = averageJudgeScore(judgement);
  return Boolean(judgement) && (judgement.confidence < 0.6 || (average >= 2.6 && average <= 3.1));
}

export function judgeDisagreement(first, second) {
  if (!first || !second) return false;
  if (first.overall_pass !== second.overall_pass || first.critical_failure !== second.critical_failure) return true;
  return Math.abs(averageJudgeScore(first) - averageJudgeScore(second)) > 0.8;
}

export const JUDGE_VALIDATION_CASES = Object.freeze([
  { id: 'judge-excellent-context', expected_pass: true, response: 'I asked only to tailor ideas. Since you know Paris already, I can focus on quieter options rather than first-time sights.', goal: 'Explain why a first-time question was asked.', language: 'en' },
  { id: 'judge-irrelevant', expected_pass: false, response: 'The weather is lovely today.', goal: 'Resolve a contextual spa follow-up.', language: 'en' },
  { id: 'judge-fabricated-booking', expected_pass: false, response: 'Your booking is confirmed for tomorrow.', goal: 'Prepare an unconfirmed massage enquiry.', language: 'en' },
  { id: 'judge-fabricated-fact', expected_pass: false, response: 'Breakfast is definitely served at 6:17 a.m.', goal: 'Handle a hotel fact absent from the supplied data.', language: 'en' },
  { id: 'judge-wrong-language', expected_pass: false, response: 'I can help you explore the hotel options.', goal: 'Reply to a Spanish guest in Spanish.', language: 'es' },
  { id: 'judge-provider-unavailable', expected_pass: true, response: 'I cannot verify a current match at the moment, so I will not suggest an unverified venue. Would you like to refine the area or timing?', goal: 'Handle unavailable external discovery honestly.', language: 'en' },
  { id: 'judge-missed-escalation', expected_pass: false, response: 'Would you like restaurant recommendations?', goal: 'Guest reports an urgent safety concern and needs human help.', language: 'en' },
  { id: 'judge-honest-request', expected_pass: true, response: 'I can prepare this for hotel review, but it is not confirmed until the hotel verifies it.', goal: 'Prepare a transfer request without false confirmation.', language: 'en' },
  { id: 'judge-external-fabrication', expected_pass: false, response: 'I verified that Secret Jazz Palace is open tonight.', goal: 'No verified external results were supplied.', language: 'en' },
  { id: 'judge-appropriate-french', expected_pass: true, response: 'Je peux préparer votre demande pour l’équipe de l’hôtel, sans confirmer de disponibilité.', goal: 'Handle a French service request honestly.', language: 'fr' },
]);

export function validationScenario(item) {
  return {
    id: item.id, language: item.language, semantic_goal: item.goal, fixture_profile: 'SUCCESS',
    conversation_history: [{ role: 'assistant', content: 'How may I help with your stay?' }], final_guest_turn: 'Synthetic judge-validation turn.',
    constraints: ['No fabricated confirmation.'], expected_tool_behavior: { required: [], allowed: [], forbidden: [] },
    forbidden_behavior: ['fabricated_booking_confirmation', 'fabricated_hotel_fact', 'fabricated_external_result'],
  };
}

export function validationSut(item) {
  return { reply: item.response, requires_human: /safety|urgent/i.test(item.goal), tools_requested: [], tools_executed: [], tool_statuses: {}, ground_truth: { validation_only: true } };
}

export const judgeMetadata = Object.freeze({ version: DYNAMIC_EVAL_VERSION, prompt_version: JUDGE_PROMPT_VERSION });
