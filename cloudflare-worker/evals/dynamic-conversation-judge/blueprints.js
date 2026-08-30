import { FIXTURE_NAMES } from '../conversation-benchmark/fixtures.js';
import { BENCHMARK_TOOLS } from '../conversation-benchmark/benchmark.js';
import { DYNAMIC_CATEGORIES, DYNAMIC_LANGUAGES, evaluateGeneratedTraits, observedScenarioLanguages, validateDynamicScenario } from './schema.js';

export const BLUEPRINT_VERSION = 'dynamic-blueprint-v1';
export const MAX_BLUEPRINT_ATTEMPTS = 3;
export const MAX_REPLACEMENTS_PER_BLUEPRINT = 2;

const CATEGORY_ALLOCATION = Object.freeze([
  ['context_follow_ups', 15], ['hotel_facts', 8], ['hotel_services', 8], ['external_discovery', 9],
  ['operational_requests', 8], ['action_truthfulness', 9], ['multi_intent', 15], ['complaints_escalation', 10],
  ['language', 15], ['natural_human', 8],
]);
const FAILURE_FIXTURES = Object.freeze(['NO_RESULTS', 'UNAVAILABLE', 'TIMEOUT', 'ERROR', 'PARTIAL_SUCCESS']);
const LANGUAGE_PAIRS = Object.freeze([['en', 'fr'], ['fr', 'en'], ['en', 'es'], ['es', 'en'], ['it', 'en'], ['de', 'en']]);
const INTENT_PAIRS = Object.freeze([
  ['operational_request', 'external_discovery'], ['hotel_fact', 'guest_request'], ['hotel_service', 'external_discovery'],
  ['guest_request', 'human_takeover'], ['hotel_fact', 'hotel_service'],
]);
const TOOL_FOR_INTENT = Object.freeze({
  operational_request: 'guest_request', guest_request: 'guest_request', external_discovery: 'external_search',
  hotel_fact: 'hotel_facts', hotel_service: 'hotel_services', human_takeover: 'human_takeover',
});

function unique(values) { return [...new Set(values.filter(Boolean))]; }
function blueprintId(index) { return `bp-${String(index + 1).padStart(3, '0')}`; }
function fixtureForFailure(index) { return FAILURE_FIXTURES[index % FAILURE_FIXTURES.length]; }
function expectedToolsForCategory(category) {
  return {
    hotel_facts: ['hotel_facts'], hotel_services: ['hotel_services'], external_discovery: ['external_search'],
    operational_requests: ['guest_request'], action_truthfulness: ['guest_request'],
    complaints_escalation: ['human_takeover'],
  }[category] || [];
}

function longContextEvents(index) {
  const events = [
    'initial preference', 'topic change', 'changed date', 'rejected option', 'interruption', 'return to earlier topic',
  ];
  return [events[index % events.length], events[(index + 2) % events.length], events[(index + 4) % events.length]];
}

/**
 * Creates a deterministic, coverage-complete generation plan. The planner
 * controls evaluation requirements only; the model must still write every
 * natural-language turn without any local transcript repair.
 */
export function planDynamicBlueprints(seed = 'dynamic-seed', target = 105) {
  if (Number(target) !== 105) throw new Error('dynamic-blueprint-v1 requires the approved 105-scenario target');
  const categories = CATEGORY_ALLOCATION.flatMap(([category, count]) => Array.from({ length: count }, () => category));
  const failureIndexes = new Set([...Array.from({ length: 9 }, (_, offset) => 31 + offset), 57]);
  const informalIndexes = new Set([...Array.from({ length: 8 }, (_, offset) => 97 + offset), 10, 11]);
  let contextOrdinal = 0;
  let languageOrdinal = 0;
  let multiOrdinal = 0;
  let complaintOrdinal = 0;
  let failureOrdinal = 0;

  return categories.map((primaryCategory, index) => {
    const requiredTraits = [];
    const secondaryCategories = [];
    // `prior_turn_count` is an individual-message count, excluding the final
    // guest turn. Long histories start with the guest and must end with the
    // assistant, so the planned count is deliberately even.
    const priorTurnCount = primaryCategory === 'context_follow_ups' && contextOrdinal < 10 ? 10 + (2 * (contextOrdinal % 5)) : 2 + (index % 4);
    const isLong = primaryCategory === 'context_follow_ups' && contextOrdinal < 10;
    if (primaryCategory === 'context_follow_ups') requiredTraits.push('contextual_follow_up');
    if (isLong) requiredTraits.push('long_conversation');
    if (informalIndexes.has(index)) requiredTraits.push('typo_slang_informal');

    let baseLanguage = 'en';
    let switchLanguage = null;
    let switchAtTurn = null;
    let finalLanguage = 'en';
    if (primaryCategory === 'language') {
      const pair = LANGUAGE_PAIRS[languageOrdinal % LANGUAGE_PAIRS.length];
      [baseLanguage, switchLanguage] = pair;
      switchAtTurn = Math.min(priorTurnCount, 2 + (languageOrdinal % 3));
      finalLanguage = switchLanguage;
      requiredTraits.push('multilingual_switch');
      languageOrdinal += 1;
    }

    let requiredIntents = [];
    let expectedToolClasses = expectedToolsForCategory(primaryCategory);
    if (primaryCategory === 'multi_intent') {
      requiredIntents = [...INTENT_PAIRS[multiOrdinal % INTENT_PAIRS.length]];
      expectedToolClasses = unique(requiredIntents.map((intent) => TOOL_FOR_INTENT[intent]));
      secondaryCategories.push(...requiredIntents);
      requiredTraits.push('multi_intent');
      multiOrdinal += 1;
    }

    let requiresEscalation = 'none';
    if (primaryCategory === 'complaints_escalation') {
      requiresEscalation = complaintOrdinal < 2 ? 'critical' : complaintOrdinal < 6 ? 'human_requested' : 'normal_complaint';
      requiredTraits.push('complaint_escalation');
      complaintOrdinal += 1;
    }

    let fixtureProfile = 'SUCCESS';
    if (failureIndexes.has(index)) {
      fixtureProfile = fixtureForFailure(failureOrdinal);
      failureOrdinal += 1;
      requiredTraits.push('tool_provider_failure');
      if (!expectedToolClasses.includes('external_search')) {
        expectedToolClasses = unique([...expectedToolClasses, 'external_search']);
        secondaryCategories.push('external_discovery');
      }
    }

    const blueprint = {
      blueprint_id: blueprintId(index), blueprint_version: BLUEPRINT_VERSION, seed: String(seed),
      primary_category: primaryCategory, secondary_categories: unique(secondaryCategories), severity: requiresEscalation === 'critical' ? 'critical' : requiresEscalation !== 'none' ? 'high' : index % 3 === 0 ? 'low' : 'medium',
      base_language: baseLanguage, language_switch: switchLanguage ? { language: switchLanguage, at_prior_turn: switchAtTurn, final_language: finalLanguage } : null,
      required_traits: unique(requiredTraits), prior_turn_count: priorTurnCount,
      intent_count: requiredIntents.length || 1, required_intents: requiredIntents,
      fixture_profile: fixtureProfile, expected_tool_classes: unique(expectedToolClasses), requires_escalation: requiresEscalation,
      noise_style: informalIndexes.has(index) ? ['typo', 'slang', 'fragmented'][index % 3] : 'none',
      guest_profile: ['returning guest', 'business traveller', 'family traveller', 'weekend visitor', 'international guest'][index % 5],
      context_dependency: isLong || primaryCategory === 'context_follow_ups',
      context_events: isLong ? longContextEvents(contextOrdinal) : [],
      replacement_of: null, replacement_depth: 0,
    };
    if (primaryCategory === 'context_follow_ups') contextOrdinal += 1;
    return blueprint;
  });
}

export function blueprintCoverage(blueprints = []) {
  const traits = (name) => blueprints.filter((blueprint) => blueprint.required_traits?.includes(name)).length;
  const categories = Object.fromEntries(DYNAMIC_CATEGORIES.map((category) => [category, blueprints.filter((blueprint) => blueprint.primary_category === category).length]));
  return {
    total: blueprints.length, categories, long: traits('long_conversation'), multilingual: traits('multilingual_switch'),
    multi_intent: traits('multi_intent'), contextual: traits('contextual_follow_up'), complaints: traits('complaint_escalation'),
    tool_provider_failure: traits('tool_provider_failure'), informal: traits('typo_slang_informal'),
  };
}

export function validateBlueprint(blueprint) {
  const errors = [];
  if (!blueprint || typeof blueprint !== 'object') return { valid: false, errors: ['blueprint_not_object'] };
  if (!/^bp-\d{3}(?:-r\d+)?$/.test(String(blueprint.blueprint_id || ''))) errors.push('invalid_blueprint_id');
  if (!DYNAMIC_CATEGORIES.includes(blueprint.primary_category)) errors.push('invalid_primary_category');
  if (!DYNAMIC_LANGUAGES.includes(blueprint.base_language)) errors.push('invalid_base_language');
  if (!Array.isArray(blueprint.required_traits) || !Array.isArray(blueprint.expected_tool_classes) || !Array.isArray(blueprint.required_intents)) errors.push('invalid_blueprint_lists');
  if (blueprint.expected_tool_classes?.some((tool) => !BENCHMARK_TOOLS.includes(tool))) errors.push('invalid_blueprint_tool_class');
  if (!Number.isInteger(blueprint.prior_turn_count) || blueprint.prior_turn_count < 0 || blueprint.prior_turn_count > 20) errors.push('invalid_prior_turn_count');
  if (!FIXTURE_NAMES.includes(blueprint.fixture_profile)) errors.push('invalid_blueprint_fixture');
  if (blueprint.required_traits?.includes('long_conversation') && (blueprint.prior_turn_count < 10 || blueprint.prior_turn_count > 20 || !blueprint.context_dependency)) errors.push('invalid_long_blueprint');
  if (blueprint.required_traits?.includes('multilingual_switch')) {
    const languageSwitch = blueprint.language_switch;
    if (!languageSwitch || !DYNAMIC_LANGUAGES.includes(languageSwitch.language) || languageSwitch.language === blueprint.base_language
      || !Number.isInteger(languageSwitch.at_prior_turn) || languageSwitch.at_prior_turn < 1 || languageSwitch.at_prior_turn > blueprint.prior_turn_count
      || languageSwitch.final_language !== languageSwitch.language) errors.push('invalid_multilingual_blueprint');
  }
  if (blueprint.required_traits?.includes('multi_intent') && (blueprint.intent_count < 2 || blueprint.required_intents.length < 2 || blueprint.expected_tool_classes.length < 2)) errors.push('invalid_multi_intent_blueprint');
  if (blueprint.required_traits?.includes('tool_provider_failure') && (!FAILURE_FIXTURES.includes(blueprint.fixture_profile) || !blueprint.expected_tool_classes.includes('external_search'))) errors.push('invalid_tool_failure_blueprint');
  if (!['none', 'normal_complaint', 'human_requested', 'critical'].includes(blueprint.requires_escalation)) errors.push('invalid_escalation_level');
  if (blueprint.requires_escalation !== 'none' && !blueprint.required_traits?.includes('complaint_escalation')) errors.push('missing_complaint_trait');
  return { valid: errors.length === 0, errors };
}

export function validateBlueprintPlan(blueprints = [], target = 105) {
  const errors = [];
  if (blueprints.length < target) errors.push('minimum_blueprints');
  const ids = blueprints.map((blueprint) => blueprint.blueprint_id);
  if (new Set(ids).size !== ids.length) errors.push('duplicate_blueprint_ids');
  for (const blueprint of blueprints) errors.push(...validateBlueprint(blueprint).errors.map((error) => `${blueprint.blueprint_id}:${error}`));
  const coverage = blueprintCoverage(blueprints);
  if (coverage.long < 10) errors.push('minimum_long_blueprints');
  if (coverage.multilingual < 15) errors.push('minimum_multilingual_blueprints');
  if (coverage.multi_intent < 15) errors.push('minimum_multi_intent_blueprints');
  if (coverage.contextual < 15) errors.push('minimum_contextual_blueprints');
  if (coverage.complaints < 10) errors.push('minimum_complaint_blueprints');
  if (coverage.tool_provider_failure < 10) errors.push('minimum_failure_blueprints');
  if (coverage.informal < 10) errors.push('minimum_informal_blueprints');
  if (Object.values(coverage.categories).some((count) => !count)) errors.push('missing_primary_category_blueprints');
  return { valid: errors.length === 0, errors, coverage };
}

export function replacementBlueprint(blueprint, replacementNumber = 1) {
  const depth = Number(blueprint?.replacement_depth || 0) + 1;
  const isLong = blueprint?.required_traits?.includes('long_conversation');
  const correctedLongCount = isLong
    ? (blueprint.prior_turn_count % 2 ? Math.min(20, blueprint.prior_turn_count + 1) : blueprint.prior_turn_count >= 20 ? 18 : blueprint.prior_turn_count + 2)
    : blueprint.prior_turn_count;
  const events = [...(blueprint.context_events || [])];
  const rotatedEvents = events.length > 1 ? [...events.slice(1), events[0]] : events;
  return {
    ...blueprint,
    blueprint_id: `${String(blueprint.blueprint_id).replace(/-r\d+$/, '')}-r${replacementNumber}`,
    replacement_of: blueprint.replacement_of || blueprint.blueprint_id,
    replacement_depth: depth,
    guest_profile: `${blueprint.guest_profile} alternative ${replacementNumber}`,
    noise_style: blueprint.noise_style === 'none' ? 'concise' : blueprint.noise_style,
    prior_turn_count: correctedLongCount,
    context_events: rotatedEvents,
  };
}

function expectedToolClasses(candidate) {
  const behavior = candidate?.expected_tool_behavior || {};
  return unique([...(behavior.required || []), ...(behavior.allowed || [])]);
}

/** Strictly checks model output against the pre-planned contract. It never edits output. */
export function validateScenarioAgainstBlueprint(scenario, blueprint) {
  const errors = [
    ...validateDynamicScenario(scenario).errors,
    ...validateBlueprint(blueprint).errors,
    ...(Array.isArray(scenario?.generator_structural_errors) ? scenario.generator_structural_errors : []),
  ];
  if (scenario?.category !== blueprint?.primary_category) errors.push('blueprint_category_mismatch');
  if (scenario?.fixture_profile !== blueprint?.fixture_profile) errors.push('blueprint_fixture_mismatch');
  if ((scenario?.conversation_history || []).length !== blueprint?.prior_turn_count) errors.push('blueprint_prior_turn_count_mismatch');
  const tools = expectedToolClasses(scenario);
  if ((blueprint?.expected_tool_classes || []).some((tool) => !tools.includes(tool))) errors.push('blueprint_expected_tool_missing');
  if (scenario?.language !== blueprint?.base_language) errors.push('blueprint_base_language_mismatch');
  const traits = evaluateGeneratedTraits(scenario, {
    long: blueprint?.required_traits?.includes('long_conversation'), context: blueprint?.required_traits?.includes('contextual_follow_up'),
    multilingual: blueprint?.required_traits?.includes('multilingual_switch'), multiIntent: blueprint?.required_traits?.includes('multi_intent'),
    complaint: blueprint?.required_traits?.includes('complaint_escalation'), toolFailure: blueprint?.required_traits?.includes('tool_provider_failure'),
    humanLike: blueprint?.required_traits?.includes('typo_slang_informal'),
  });
  errors.push(...traits.errors);
  if (blueprint?.language_switch) {
    const languages = observedScenarioLanguages(scenario);
    if (!languages.includes(blueprint.base_language) || !languages.includes(blueprint.language_switch.language)) errors.push('blueprint_language_switch_not_observed');
  }
  if (blueprint?.required_traits?.includes('multi_intent') && (scenario?.trait_evidence?.independent_goals || []).length < blueprint.intent_count) errors.push('blueprint_intent_evidence_missing');
  if (blueprint?.requires_escalation === 'human_requested' && !tools.includes('human_takeover')) errors.push('blueprint_human_takeover_missing');
  if (blueprint?.requires_escalation === 'critical' && (!tools.includes('human_takeover') || !scenario?.critical_invariants?.includes('critical_human_escalation'))) errors.push('blueprint_critical_escalation_missing');
  return { valid: errors.length === 0, errors: unique(errors), observed_languages: traits.observed_languages };
}

export function nextBlueprintAfterFailure(blueprint, attempts) {
  if (attempts < MAX_BLUEPRINT_ATTEMPTS) return { action: 'retry', replacement: null };
  if (Number(blueprint?.replacement_depth || 0) >= MAX_REPLACEMENTS_PER_BLUEPRINT) return { action: 'blocked', replacement: null };
  return { action: 'replace', replacement: replacementBlueprint(blueprint, Number(blueprint?.replacement_depth || 0) + 1) };
}

/** Reconstructs only planning metadata around an already accepted transcript. */
export function blueprintFromAcceptedScenario(scenario, blueprint) {
  const historyCount = (scenario?.conversation_history || []).length;
  const requiredTraits = unique([
    ...(blueprint?.required_traits || []),
    ...(historyCount >= 10 ? ['long_conversation', 'contextual_follow_up'] : []),
  ]);
  return {
    ...blueprint,
    primary_category: scenario.category, base_language: scenario.language,
    prior_turn_count: historyCount, fixture_profile: scenario.fixture_profile,
    expected_tool_classes: expectedToolClasses(scenario), required_traits: requiredTraits,
    language_switch: blueprint?.required_traits?.includes('multilingual_switch') ? blueprint.language_switch : null,
    intent_count: blueprint?.required_traits?.includes('multi_intent') ? blueprint.intent_count : 1,
    required_intents: blueprint?.required_traits?.includes('multi_intent') ? blueprint.required_intents : [],
  };
}
