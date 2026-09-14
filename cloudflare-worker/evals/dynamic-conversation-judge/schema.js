import { BENCHMARK_CATEGORIES, BENCHMARK_THRESHOLDS, BENCHMARK_TOOLS, CONVERSATION_BENCHMARK } from '../conversation-benchmark/benchmark.js';
import { FIXTURE_NAMES } from '../conversation-benchmark/fixtures.js';
import { DYNAMIC_EVAL_VERSION, DYNAMIC_TARGET_SCENARIOS } from './config.js';

export const DYNAMIC_CATEGORIES = BENCHMARK_CATEGORIES;
export const DYNAMIC_RELEASE_THRESHOLDS = BENCHMARK_THRESHOLDS;
export const JUDGE_DIMENSIONS = Object.freeze([
  'contextual_understanding', 'relevance', 'naturalness', 'helpfulness',
  'factual_grounding', 'tool_selection_appropriateness', 'action_truthfulness',
  'language_handling', 'topic_state_changes', 'escalation_safety',
]);
export const DYNAMIC_SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
export const DYNAMIC_LANGUAGES = Object.freeze(['en', 'fr', 'es', 'it', 'de', 'ar', 'ja', 'zh']);
export const DYNAMIC_REQUIRED_FIELDS = Object.freeze([
  'id', 'generated_at', 'seed', 'category', 'severity', 'language', 'guest_profile',
  'hotel_context', 'conversation_history', 'final_guest_turn', 'semantic_goal',
  'constraints', 'expected_tool_behavior', 'forbidden_behavior',
  'critical_invariants', 'fixture_profile', 'judge_dimensions', 'trait_evidence',
]);

const credentialPattern = /(?:gsk_|nvidia_api_key|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9]{8,}|api[_-]?key\s*[:=]\s*[^\s]+)/i;
const normalise = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const words = (value) => normalise(value).split(' ').filter((word) => word.length > 2 && !new Set(['the', 'and', 'for', 'with', 'that', 'this', 'hotel', 'please', 'would', 'could']).has(word));

function scenarioTurns(scenario) {
  if (Array.isArray(scenario?.conversation_history)) return [...scenario.conversation_history, { role: 'user', content: scenario?.final_guest_turn || '' }];
  if (Array.isArray(scenario?.conversation)) return scenario.conversation;
  return [{ role: 'user', content: scenario?.final_guest_turn || '' }];
}

export function dynamicConversationText(scenario) {
  return scenarioTurns(scenario)
    .map((turn) => `${String(turn?.role || 'user').toLowerCase()}:${String(turn?.content || turn?.message || '').trim()}`)
    .join('\n');
}

function requiredToolShape(value) {
  const toolBehavior = value && typeof value === 'object' ? value : {};
  const lists = ['required', 'allowed', 'forbidden'];
  return lists.every((key) => Array.isArray(toolBehavior[key]) && toolBehavior[key].every((tool) => BENCHMARK_TOOLS.includes(tool)));
}

function turnsFor(scenario) {
  return Array.isArray(scenario?.conversation_history) ? [...scenario.conversation_history, { role: 'user', content: scenario.final_guest_turn || '' }] : [];
}

function alternates(turns) {
  return turns.length > 1 && turns.every((turn, index) => index === 0 || turn.role !== turns[index - 1].role);
}

function validLongConversationShape(history, final) {
  const turns = [...history, { role: 'user', content: final }];
  return history[0]?.role === 'user' && history.at(-1)?.role === 'assistant' && alternates(turns);
}

const languageSignals = Object.freeze({
  en: /\b(?:the|and|please|could|would|what|where|with|tonight|earlier)\b/i,
  fr: /\b(?:je|nous|vous|avec|pourquoi|quelque|soir|maintenant|annulez|s'il)\b|[àâçéèêëîïôùûüÿœ]/i,
  es: /\b(?:quiero|puede|para|esta|noche|ahora|antes|por qué|dónde|también)\b|[áéíóúñ¿¡]/i,
  it: /\b(?:vorrei|possiamo|perché|stasera|prima|grazie)\b/i,
  de: /\b(?:ich|bitte|heute|warum|früher|können)\b/i,
});

export function observedScenarioLanguages(scenario) {
  const text = turnsFor(scenario).map((turn) => turn.content || turn.message || '').join('\n');
  return Object.entries(languageSignals).filter(([, pattern]) => pattern.test(text)).map(([language]) => language);
}

function hasNoisyLanguage(scenario) {
  const text = dynamicConversationText(scenario).toLowerCase();
  return /\b(?:pls|plz|u|ur|bro|bruh|gonna|wanna|idk|lol|thx|svp|stp|masage|restarant|wht|whch|cud)\b|[!?]{2,}/.test(text);
}

function hasContextualReference(scenario) {
  const final = String(scenario?.final_guest_turn || '').toLowerCase();
  const history = scenario?.conversation_history || [];
  const explicitReference = /\b(?:no|yes|why|what|which|other|second|same|earlier|before|that|this|it|cancel|actually|instead|back)\b|\b(?:non|pourquoi|lequel|autre|avant|annulez)\b|\b(?:no|por qué|cuál|otro|antes|cancela)\b/i.test(final);
  // Natural references can be implicit (for example, a previously discussed
  // vehicle and checkout time). Require two meaningful shared terms so this
  // remains stronger than mere topic overlap.
  const finalTerms = new Set(words(final));
  const historyTerms = new Set(words(history.map((turn) => turn?.content || turn?.message || '').join(' ')));
  const sharedTerms = [...finalTerms].filter((term) => historyTerms.has(term)).length;
  const specificSharedTerm = [...finalTerms].some((term) => historyTerms.has(term) && (term.length >= 4 || ['suv', 'cdg'].includes(term)));
  return history.length > 0 && (explicitReference || sharedTerms >= 2 || (specificSharedTerm && /\bif\b/i.test(final)));
}

function hasMultiIntentEvidence(scenario) {
  const goals = Array.isArray(scenario?.trait_evidence?.independent_goals) ? scenario.trait_evidence.independent_goals.filter((goal) => String(goal).trim()) : [];
  const text = String(scenario?.final_guest_turn || '').toLowerCase();
  const actionSignals = [
    /\b(?:bring|send|fix|clean|prepare|arrange|cancel|book|find|recommend|tell|show|need)\b/gi,
    /\b(?:apportez|réparez|préparez|annulez|trouvez|montrez|besoin)\b/gi,
    /\b(?:traiga|arregle|prepare|cancele|encuentre|muestre|necesito)\b/gi,
  ].flatMap((pattern) => [...text.matchAll(pattern)]);
  return goals.length >= 2 && actionSignals.length >= 2 && /(?:\band\b|\balso\b|,|\bet\b|\by\b)/i.test(text);
}

function hasRelevantFixtureFailure(scenario) {
  const profile = scenario?.fixture_profile;
  if (!['NO_RESULTS', 'UNAVAILABLE', 'TIMEOUT', 'ERROR', 'PARTIAL_SUCCESS'].includes(profile)) return true;
  const relevance = scenario?.trait_evidence?.fixture_relevance;
  return relevance && BENCHMARK_TOOLS.includes(relevance.tool)
    && (scenario?.expected_tool_behavior?.required || []).includes(relevance.tool)
    && String(relevance.expected_status || '').trim();
}

function hasComplaintEvidence(scenario) {
  const text = dynamicConversationText(scenario).toLowerCase();
  return /\b(?:unacceptable|angry|manager|human|unsafe|emergency|complaint|still|awful|disappointed)\b|\b(?:inadmissible|directeur|humain|urgent|déçu)\b|\b(?:inaceptable|gerente|humano|urgente|decepcionado)\b/i.test(text);
}

export function evaluateGeneratedTraits(scenario, requirements = {}) {
  const errors = [];
  const history = scenario?.conversation_history || [];
  const final = String(scenario?.final_guest_turn || '');
  if (requirements.long) {
    if (history.length < 10 || history.length > 20) errors.push('insufficient_long_context');
    if (!validLongConversationShape(history, final)) errors.push('non_alternating_long_context');
    if (!hasContextualReference(scenario)) errors.push('long_final_not_context_dependent');
  }
  if (requirements.context && !hasContextualReference(scenario)) errors.push('insufficient_contextual_follow_up');
  if (requirements.multilingual && observedScenarioLanguages(scenario).length < 2) errors.push('insufficient_multilingual_behavior');
  if (requirements.multiIntent && !hasMultiIntentEvidence(scenario)) errors.push('insufficient_multi_intent');
  if (requirements.complaint && !hasComplaintEvidence(scenario)) errors.push('insufficient_complaint_escalation');
  if (requirements.toolFailure && !hasRelevantFixtureFailure(scenario)) errors.push('insufficient_tool_failure_behavior');
  if (requirements.humanLike && !hasNoisyLanguage(scenario)) errors.push('insufficient_typo_slang_informal_trait');
  return { valid: errors.length === 0, errors, observed_languages: observedScenarioLanguages(scenario) };
}

export function validateDynamicScenario(scenario) {
  const errors = [];
  if (!scenario || typeof scenario !== 'object') return { valid: false, errors: ['scenario_not_object'] };
  for (const field of DYNAMIC_REQUIRED_FIELDS) if (!(field in scenario)) errors.push(`missing_${field}`);
  if (!/^dynamic-[a-z0-9-]+$/i.test(String(scenario.id || ''))) errors.push('invalid_id');
  if (!DYNAMIC_CATEGORIES.includes(scenario.category)) errors.push('invalid_category');
  if (!DYNAMIC_SEVERITIES.includes(scenario.severity)) errors.push('invalid_severity');
  if (!DYNAMIC_LANGUAGES.includes(scenario.language)) errors.push('invalid_language');
  if (!Array.isArray(scenario.conversation_history) || scenario.conversation_history.some((turn) => !['assistant', 'user'].includes(turn?.role) || !String(turn?.content || turn?.message || '').trim())) errors.push('invalid_history');
  if (!String(scenario.final_guest_turn || '').trim()) errors.push('missing_final_guest_turn');
  if (!requiredToolShape(scenario.expected_tool_behavior)) errors.push('invalid_tool_behavior');
  if (!Array.isArray(scenario.forbidden_behavior) || !Array.isArray(scenario.critical_invariants) || !Array.isArray(scenario.judge_dimensions)) errors.push('invalid_expectation_lists');
  if (scenario.judge_dimensions?.some((dimension) => !JUDGE_DIMENSIONS.includes(dimension))) errors.push('invalid_judge_dimension');
  if (!FIXTURE_NAMES.includes(scenario.fixture_profile)) errors.push('invalid_fixture_profile');
  if (!scenario.trait_evidence || typeof scenario.trait_evidence !== 'object' || Array.isArray(scenario.trait_evidence)) errors.push('invalid_trait_evidence');
  if (credentialPattern.test(JSON.stringify(scenario))) errors.push('credential_like_content');
  return { valid: errors.length === 0, errors };
}

function tokenSet(text) { return new Set(words(text)); }
function overlap(left, right) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  const shared = [...a].filter((item) => b.has(item)).length;
  return { jaccard: shared / Math.max(1, new Set([...a, ...b]).size), containment: shared / Math.max(1, Math.min(a.size, b.size)) };
}

export function duplicateSignal(candidate, corpus = []) {
  const text = dynamicConversationText(candidate);
  const canonical = normalise(text);
  const structure = scenarioTurns(candidate).map((turn) => String(turn.role || 'user')).join('>');
  for (const item of corpus) {
    const other = dynamicConversationText(item);
    const otherCanonical = normalise(other);
    if (!canonical || !otherCanonical) continue;
    if (canonical === otherCanonical) return { duplicate: true, reason: 'normalized_exact_match', match_id: item.id };
    const score = overlap(text, other);
    const otherStructure = scenarioTurns(item).map((turn) => String(turn.role || 'user')).join('>');
    if (score.jaccard >= 0.82 || score.containment >= 0.88 || (structure === otherStructure && score.jaccard >= 0.68 && score.containment >= 0.72)) {
      return { duplicate: true, reason: 'high_phrase_or_structure_overlap', match_id: item.id, overlap: score };
    }
  }
  return { duplicate: false, reason: '' };
}

export function validateUnseenScenario(scenario, accepted = [], permanent = CONVERSATION_BENCHMARK) {
  const schema = validateDynamicScenario(scenario);
  if (!schema.valid) return { accepted: false, reason: 'schema', errors: schema.errors };
  const permanentMatch = duplicateSignal(scenario, permanent);
  if (permanentMatch.duplicate) return { accepted: false, reason: 'permanent_duplicate', details: permanentMatch };
  const runMatch = duplicateSignal(scenario, accepted);
  if (runMatch.duplicate) return { accepted: false, reason: 'run_duplicate', details: runMatch };
  return { accepted: true, reason: '' };
}

export function dynamicDistribution(scenarios = []) {
  const countCategory = (category) => scenarios.filter((item) => item.category === category).length;
  const traits = (name) => scenarios.filter((item) => Array.isArray(item.generation_traits) && item.generation_traits.includes(name)).length;
  const toolFailures = scenarios.filter((item) => ['NO_RESULTS', 'UNAVAILABLE', 'TIMEOUT', 'ERROR', 'PARTIAL_SUCCESS'].includes(item.fixture_profile)).length;
  const long = scenarios.filter((item) => (item.conversation_history || []).length >= 10 && Array.isArray(item.generation_traits) && item.generation_traits.includes('long_conversation')).length;
  const typoOrInformal = scenarios.filter((item) => ['typo', 'slang', 'informal'].some((trait) => item.generation_traits?.includes(trait))).length;
  return {
    total: scenarios.length,
    categories: Object.fromEntries(DYNAMIC_CATEGORIES.map((category) => [category, countCategory(category)])),
    multi_intent: countCategory('multi_intent'), language: countCategory('language'), context: countCategory('context_follow_ups'),
    complaints: countCategory('complaints_escalation'), tool_failures: toolFailures, long_conversations: long, typo_slang_informal: typoOrInformal,
    fixture_profiles: Object.fromEntries(FIXTURE_NAMES.map((name) => [name, scenarios.filter((item) => item.fixture_profile === name).length])),
  };
}

export function validateDynamicDistribution(scenarios = []) {
  const metrics = dynamicDistribution(scenarios);
  const errors = [];
  if (metrics.total < DYNAMIC_TARGET_SCENARIOS) errors.push('minimum_dynamic_scenarios');
  if (metrics.multi_intent < 15) errors.push('minimum_multi_intent');
  if (metrics.language < 15) errors.push('minimum_multilingual');
  if (metrics.context < 15) errors.push('minimum_contextual');
  if (metrics.complaints < 10) errors.push('minimum_complaints');
  if (metrics.tool_failures < 10) errors.push('minimum_tool_failures');
  if (metrics.long_conversations < 10) errors.push('minimum_long_conversations');
  if (metrics.typo_slang_informal < 10) errors.push('minimum_human_like_language');
  for (const fixture of ['SUCCESS', 'NO_RESULTS', 'UNAVAILABLE', 'TIMEOUT', 'ERROR', 'PARTIAL_SUCCESS']) {
    if (!metrics.fixture_profiles[fixture]) errors.push(`missing_fixture_${fixture.toLowerCase()}`);
  }
  if (Object.values(metrics.categories).some((count) => count === 0)) errors.push('missing_category');
  return { valid: errors.length === 0, errors, metrics };
}

export const dynamicBenchmarkMetadata = Object.freeze({ version: DYNAMIC_EVAL_VERSION, target: DYNAMIC_TARGET_SCENARIOS });
