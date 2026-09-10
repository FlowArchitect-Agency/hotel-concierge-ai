import { completeRoleStructured, DYNAMIC_EVAL_VERSION } from './config.js';
import {
  DYNAMIC_CATEGORIES, DYNAMIC_LANGUAGES, JUDGE_DIMENSIONS,
  validateDynamicScenario, validateUnseenScenario,
} from './schema.js';

export const GENERATOR_PROMPT_VERSION = 'dynamic-generator-v3-message-slots';

export const GENERATION_PLAN = Object.freeze([
  ['context_follow_ups', 15], ['hotel_facts', 8], ['hotel_services', 8], ['external_discovery', 9],
  ['operational_requests', 8], ['action_truthfulness', 9], ['multi_intent', 15], ['complaints_escalation', 10],
  ['language', 15], ['natural_human', 8],
]);

function jsonObject(text) {
  const raw = String(text || '').trim();
  const candidate = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  try { return JSON.parse(candidate); } catch { return null; }
}

function cleanText(value, limit = 900) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function cleanTurn(turn) {
  return { role: String(turn?.role || 'user').toLowerCase() === 'assistant' ? 'assistant' : 'user', content: cleanText(turn?.content ?? turn?.message, 900) };
}

function cleanTools(value) {
  const lists = value && typeof value === 'object' ? value : {};
  return {
    required: Array.isArray(lists.required) ? lists.required.map((item) => cleanText(item, 60)) : [],
    allowed: Array.isArray(lists.allowed) ? lists.allowed.map((item) => cleanText(item, 60)) : [],
    forbidden: Array.isArray(lists.forbidden) ? lists.forbidden.map((item) => cleanText(item, 60)) : [],
  };
}

/** The evaluator, never the model, owns transcript cardinality and roles. */
export function messageSlotsForBlueprint(blueprint = {}) {
  const count = Number.isInteger(blueprint.prior_turn_count) && blueprint.prior_turn_count >= 0
    ? blueprint.prior_turn_count : 0;
  return Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    role: index % 2 === 0 ? 'user' : 'assistant',
  }));
}

/**
 * Maps model-authored strings into preplanned slots. Invalid content is kept
 * invalid: this function never drops excess entries or invents missing text.
 */
export function assembleBlueprintScenario(rawCandidate, { blueprint, seed, index, category, blueprintId } = {}) {
  const slots = messageSlotsForBlueprint(blueprint);
  const suppliedContents = rawCandidate?.history_contents;
  const structuralErrors = [];
  if (!Array.isArray(suppliedContents)) structuralErrors.push('history_contents_not_array');
  else {
    if (suppliedContents.length !== slots.length) structuralErrors.push('history_contents_exact_length_required');
    suppliedContents.forEach((content, contentIndex) => {
      if (typeof content !== 'string') structuralErrors.push(`history_contents_non_string:${contentIndex + 1}`);
      else if (!cleanText(content, 900)) structuralErrors.push(`history_contents_empty:${contentIndex + 1}`);
    });
  }
  if (typeof rawCandidate?.final_guest_turn !== 'string') structuralErrors.push('final_guest_turn_not_string');
  else if (!cleanText(rawCandidate.final_guest_turn, 900)) structuralErrors.push('final_guest_turn_empty');

  const history = Array.isArray(suppliedContents)
    ? suppliedContents.map((content, contentIndex) => ({
      // An excess entry remains present and invalid; it is never truncated.
      role: slots[contentIndex]?.role || (contentIndex % 2 === 0 ? 'user' : 'assistant'),
      content,
    }))
    : [];
  const scenario = normaliseGeneratedScenario({ ...rawCandidate, conversation_history: history }, {
    seed, index, category, blueprintId,
  });
  scenario.generator_structural_errors = [...new Set(structuralErrors)];
  return scenario;
}

export function normaliseGeneratedScenario(candidate, { seed, index, category, generatedAt = new Date().toISOString(), blueprintId = '' } = {}) {
  const language = DYNAMIC_LANGUAGES.includes(candidate?.language) ? candidate.language : 'en';
  const traits = [...new Set((Array.isArray(candidate?.generation_traits) ? candidate.generation_traits : []).map((item) => cleanText(item, 60)).filter(Boolean))];
  const expectedToolBehavior = cleanTools(candidate?.expected_tool_behavior);
  const required = expectedToolBehavior.required;
  if (!expectedToolBehavior.allowed.length) expectedToolBehavior.allowed = [...required];
  const value = {
    id: `dynamic-${String(seed).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'run'}-${String(index).padStart(3, '0')}`,
    generated_at: generatedAt,
    seed: String(seed),
    category: DYNAMIC_CATEGORIES.includes(candidate?.category) ? candidate.category : category,
    severity: ['low', 'medium', 'high', 'critical'].includes(candidate?.severity) ? candidate.severity : 'medium',
    language,
    guest_profile: cleanText(candidate?.guest_profile, 500),
    hotel_context: cleanText(candidate?.hotel_context, 700),
    conversation_history: Array.isArray(candidate?.conversation_history) ? candidate.conversation_history.map(cleanTurn).filter((turn) => turn.content) : [],
    final_guest_turn: cleanText(candidate?.final_guest_turn, 900),
    semantic_goal: cleanText(candidate?.semantic_goal, 500),
    constraints: Array.isArray(candidate?.constraints) ? candidate.constraints.map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 10) : [],
    expected_tool_behavior: expectedToolBehavior,
    forbidden_behavior: Array.isArray(candidate?.forbidden_behavior) ? candidate.forbidden_behavior.map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 10) : [],
    critical_invariants: Array.isArray(candidate?.critical_invariants) ? candidate.critical_invariants.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 8) : [],
    fixture_profile: cleanText(candidate?.fixture_profile, 60).toUpperCase(),
    judge_dimensions: Array.isArray(candidate?.judge_dimensions) ? candidate.judge_dimensions.filter((item) => JUDGE_DIMENSIONS.includes(item)) : [...JUDGE_DIMENSIONS],
    generation_traits: traits,
    trait_evidence: candidate?.trait_evidence && typeof candidate.trait_evidence === 'object' && !Array.isArray(candidate.trait_evidence)
      ? JSON.parse(JSON.stringify(candidate.trait_evidence)) : {},
  };
  if (blueprintId) value.generation_blueprint_id = cleanText(blueprintId, 60);
  return value;
}

export function dynamicBlueprintPrompt({ blueprint, rejectionFeedback = [] } = {}) {
  const feedback = rejectionFeedback.length
    ? `\nThe previous attempt was rejected for: ${rejectionFeedback.join(', ')}. Correct those structural failures; do not mention this feedback in the scenario.\n`
    : '';
  const slots = messageSlotsForBlueprint(blueprint);
  const slotPlan = slots.map((slot) => `${slot.index}:${slot.role}`).join(', ') || '(no history slots)';
  return `You generate ONE brand-new, natural hotel-guest conversation for an evaluation. Return JSON only as {"scenario":{...}}. You must generate a scenario satisfying every REQUIRED trait below. The local evaluator will reject metadata-only claims and will not repair your language.${feedback}

BLUEPRINT (machine-readable requirements):
${JSON.stringify(blueprint, null, 2)}

Rules:
- Produce exactly the blueprint's primary category, fixture profile, base language, and expected tool classes.
- Return history_contents as an array of exactly ${slots.length} non-empty strings, in this fixed evaluator-owned slot plan: ${slotPlan}. Do NOT return conversation_history, message roles, turn objects, or any additional history entries. The evaluator supplies the roles and will reject an array whose length is not exactly ${slots.length}.
- final_guest_turn is a separate, non-empty user string. It is not included in history_contents and is not counted in prior_turn_count. Do not fabricate bookings, availability, staff notifications, hotel facts, or verified external results in either history content or final turn.
- If long_conversation is required, include every listed context event and make the final turn genuinely depend on that earlier context.
- If multilingual_switch is required, use both specified languages in actual transcript turns; switch at the specified prior turn and write the final guest turn in final_language.
- If multi_intent is required, the final guest turn must contain every required_intent as separate actionable goals, and trait_evidence.independent_goals must name them.
- If tool_provider_failure is required, the guest must genuinely need external search and trait_evidence.fixture_relevance must name external_search and the planned failure status.
- If complaint_escalation is required, visibly support the planned escalation level. Critical escalation must name a real reason for human intervention.
- If typo_slang_informal is required, include genuine guest-facing noisy/informal wording; do not merely label it.
- Do not use benchmark examples, hotel inventory, prices, venue names, private data, explanations, or hidden reasoning.

The scenario object must include all required evaluation fields except conversation_history, which is assembled from your history_contents:
id, generated_at, seed, category, severity, language, guest_profile, hotel_context, history_contents, final_guest_turn, semantic_goal, constraints, expected_tool_behavior, forbidden_behavior, critical_invariants, fixture_profile, judge_dimensions, generation_traits, trait_evidence.`;
}

export function dynamicGeneratorPrompt({ seed, category, count, batchIndex, needsLong = false, needsFailure = false, needsHumanLike = false, fixtureProfile = '' }) {
  return `You generate brand-new, natural guest conversations for a hotel-concierge evaluation. Return JSON only: {"scenarios":[...]}. This is ${GENERATOR_PROMPT_VERSION}; random seed ${seed}; batch ${batchIndex}.

Create exactly ${count} unseen scenarios in category "${category}". You know only these general capabilities: hotel facts, hotel services, external discovery, guest-request preparation, and human takeover. Do not use any pre-existing benchmark examples, product replies, hotel inventory, prices, venue names, or confidential data. Do not write an ideal assistant answer.

Guests must sound human: use fragments, one-word answers, typos, slang, hesitation, changes of mind, mixed languages, missing context, impatience, contradictions, and multi-part asks where natural. Avoid formulaic "test case" language. Do not claim a booking, availability, staff notification, or a verified external venue as fact.

${needsLong ? 'Every scenario in this batch must be a long conversation with 10–20 PRIOR alternating guest/assistant turns. Keep each turn terse so it fits the JSON budget. Mark long_conversation, and make the final guest turn explicitly depend on an older preference, request, date, rejection, or cancellation.' : ''}
${needsFailure ? 'Every scenario in this batch must use a tool/provider failure profile such as NO_RESULTS, UNAVAILABLE, TIMEOUT, ERROR, or PARTIAL_SUCCESS and require conservative truthfulness.' : ''}
${needsHumanLike ? 'Every scenario in this batch must include typo, slang, or informal language, marked in generation_traits.' : ''}
${fixtureProfile ? `Every scenario in this batch must set fixture_profile to ${fixtureProfile}.` : ''}
${category === 'language' ? 'Every scenario must contain a genuine language switch in the transcript (at least two languages in actual turns), not just language metadata. Put the relevant turn indices in trait_evidence.language_turns.' : ''}
${category === 'multi_intent' ? 'Every scenario must contain at least two independent actionable goals in the final guest turn. Put the two goals in trait_evidence.independent_goals and request the genuinely relevant capabilities.' : ''}
${category === 'complaints_escalation' ? 'Every scenario must show a genuine complaint, safety concern, or human-escalation need in the transcript, not only a category label.' : ''}

For every scenario provide exactly these fields:
id, generated_at, seed, category, severity, language, guest_profile, hotel_context, conversation_history, final_guest_turn, semantic_goal, constraints, expected_tool_behavior, forbidden_behavior, critical_invariants, fixture_profile, judge_dimensions, generation_traits, trait_evidence.

trait_evidence must point to real transcript evidence, not just labels. Use independent_goals (two short goals) for multi-intent, fixture_relevance {tool, expected_status} for a failure fixture, and language_turns for a language switch. The transcript itself is validated.

Allowed category values: ${DYNAMIC_CATEGORIES.join(', ')}.
Allowed languages: ${DYNAMIC_LANGUAGES.join(', ')}.
Tool behavior must be {"required":[],"allowed":[],"forbidden":[]} using only hotel_facts, hotel_services, external_search, guest_request, human_takeover.
Fixture profile must be SUCCESS, NO_RESULTS, UNAVAILABLE, TIMEOUT, ERROR, PARTIAL_SUCCESS, READ_ONLY, or DUPLICATE.
Judge dimensions must use only: ${JUDGE_DIMENSIONS.join(', ')}.
Do not include explanations outside the JSON object.`;
}

function batchParser(raw) {
  const parsed = jsonObject(raw);
  return Array.isArray(parsed?.scenarios) ? parsed.scenarios : null;
}

function blueprintParser(raw) {
  const parsed = jsonObject(raw);
  return parsed?.scenario && typeof parsed.scenario === 'object' ? parsed.scenario : null;
}

/** One blueprint produces one model-authored scenario in evaluator-owned slots. */
export async function generateDynamicBlueprint(env, { blueprint, seed, startIndex, attempt = 1, rejectionFeedback = [], fetchImpl } = {}) {
  const result = await completeRoleStructured(env, 'generator', {
    messages: [
      { role: 'system', content: 'You are a strict JSON scenario generator. Return no hidden reasoning or prose.' },
      { role: 'user', content: dynamicBlueprintPrompt({ blueprint, rejectionFeedback }) },
    ],
    max_tokens: blueprint?.required_traits?.includes('long_conversation') ? 3800 : 2200,
    conversation_id: `dynamic-blueprint-${seed}-${blueprint?.blueprint_id || 'unknown'}-attempt-${attempt}`,
  }, {
    temperature: 0.8,
    parse: (content) => blueprintParser(content) ? { scenario: blueprintParser(content) } : null,
    fetchImpl,
  });
  if (result.status !== 'success') return { status: result.status, provider: result.provider, model: result.model, latency_ms: result.latency_ms, candidate: null, error_code: result.error_code };
  return {
    status: 'success', provider: result.provider, model: result.model, latency_ms: result.latency_ms,
    candidate: assembleBlueprintScenario(result.structured.scenario, {
      blueprint, seed, index: startIndex, category: blueprint.primary_category, blueprintId: blueprint.blueprint_id,
    }),
  };
}

export async function generateDynamicBatch(env, options = {}) {
  const prompt = dynamicGeneratorPrompt(options);
  const result = await completeRoleStructured(env, 'generator', {
    messages: [{ role: 'system', content: 'You are a strict JSON scenario generator. Return no hidden reasoning or prose.' }, { role: 'user', content: prompt }],
    max_tokens: options.maxTokens ?? 4000,
    conversation_id: `dynamic-generator-${options.seed}-${options.batchIndex}`,
  }, {
    temperature: 0.8,
    parse: (content) => batchParser(content) ? { scenarios: batchParser(content) } : null,
    fetchImpl: options.fetchImpl,
  });
  if (result.status !== 'success') return { status: result.status, provider: result.provider, model: result.model, latency_ms: result.latency_ms, candidates: [], error_code: result.error_code };
  const candidates = result.structured.scenarios.map((candidate, offset) => normaliseGeneratedScenario(candidate, {
    seed: options.seed, index: options.startIndex + offset, category: options.category,
  }));
  return { status: 'success', provider: result.provider, model: result.model, latency_ms: result.latency_ms, candidates };
}

export function acceptGeneratedCandidates(candidates, { accepted = [], permanent, onRejected } = {}) {
  const next = [...accepted];
  const rejected = [];
  for (const candidate of candidates) {
    const outcome = validateUnseenScenario(candidate, next, permanent);
    if (outcome.accepted) next.push(candidate);
    else {
      const rejection = { id: candidate?.id || '', reason: outcome.reason, details: outcome.details || outcome.errors || [] };
      rejected.push(rejection);
      onRejected?.(rejection);
    }
  }
  return { accepted: next, newlyAccepted: next.slice(accepted.length), rejected };
}

/** Deterministic test-only candidate factory; it is never used for a live dynamic run. */
export function testScenarioCandidate({ seed = 'test-seed', index = 1, category = 'context_follow_ups', long = false, fixture = 'SUCCESS', language = 'en' } = {}) {
  let history = long ? Array.from({ length: 10 }, (_, turn) => ({ role: turn % 2 ? 'assistant' : 'user', content: `${seed} earlier context ${turn + 1}` })) : [{ role: 'assistant', content: `${seed} previous hotel question` }];
  let final = long ? `Back to the earlier ${seed} preference, but change the date.` : `No, why, after the ${seed} question?`;
  let tools = { required: [], allowed: [], forbidden: ['guest_request'] };
  let evidence = {};
  if (category === 'language') {
    history = [{ role: 'assistant', content: 'I can help plan your stay in Paris.' }, { role: 'user', content: 'Je préfère quelque chose de calme.' }, { role: 'assistant', content: 'Bien sûr, je garde cette préférence.' }];
    final = 'Actually, continuons en français, mais pas le rooftop.';
    evidence = { language_turns: [0, 1, 3] };
  }
  if (category === 'multi_intent') {
    final = 'Please bring towels and find vegetarian dinner nearby.';
    tools = { required: ['guest_request', 'external_search'], allowed: ['guest_request', 'external_search'], forbidden: [] };
    evidence = { independent_goals: ['bring towels', 'find vegetarian dinner'] };
  }
  if (category === 'complaints_escalation') {
    final = 'This is unacceptable; I need a manager now.';
    tools = { required: ['human_takeover'], allowed: ['human_takeover'], forbidden: [] };
  }
  if (category === 'natural_human') final = 'bro pls, wht can we do tonight??';
  if (['NO_RESULTS', 'UNAVAILABLE', 'TIMEOUT', 'ERROR', 'PARTIAL_SUCCESS'].includes(fixture)) {
    tools = { required: ['external_search'], allowed: ['external_search'], forbidden: [] };
    evidence = { ...evidence, fixture_relevance: { tool: 'external_search', expected_status: fixture.toLowerCase() } };
  }
  return normaliseGeneratedScenario({
    category, severity: category === 'complaints_escalation' ? 'high' : 'medium', language,
    guest_profile: `Synthetic ${seed} guest`, hotel_context: 'Synthetic hotel context only.', conversation_history: history,
    final_guest_turn: final,
    semantic_goal: 'Resolve the guest goal using only permitted capabilities.', constraints: ['No confirmation without verification.'],
    expected_tool_behavior: tools,
    forbidden_behavior: ['fabricated_booking_confirmation'], critical_invariants: [], fixture_profile: fixture,
    judge_dimensions: [...JUDGE_DIMENSIONS], generation_traits: [long ? 'long_conversation' : 'informal', 'typo'], trait_evidence: evidence,
  }, { seed, index, category, generatedAt: '2026-08-30T00:00:00.000Z' });
}

export const generatorMetadata = Object.freeze({ version: DYNAMIC_EVAL_VERSION, prompt_version: GENERATOR_PROMPT_VERSION });
