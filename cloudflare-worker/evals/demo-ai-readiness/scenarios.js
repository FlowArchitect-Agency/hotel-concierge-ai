/**
 * Hand-authored, fixture-only hotel-demo readiness scenarios. These are
 * deliberately independent from the permanent benchmark and are never
 * produced or amended by a model.
 */
export const DEMO_READINESS_VERSION = 'demo-ai-readiness-v1';

export const DEMO_READINESS_CATEGORIES = Object.freeze([
  'context', 'change_of_mind', 'multi_intent', 'long_context',
  'language', 'complaint_takeover', 'grounding',
]);

const u = (content) => ({ role: 'user', content });
const a = (content) => ({ role: 'assistant', content });

function scenario({ id, category, history = [], message, language = 'en', fixture = 'SUCCESS', required = [], forbidden = [], critical = [], expectations = {} }) {
  return Object.freeze({
    id, category, conversation_history: history, final_guest_turn: message, language,
    fixture_profile: fixture,
    expected_tool_behavior: { required, forbidden },
    critical_invariants: critical,
    expectations: {
      interaction_types: [], reference_targets: [], required_plan_terms: [], forbidden_plan_terms: [],
      response_focus: [], rejected_options: [], generic_ack_is_failure: false,
      fixture_statuses: {}, requires_human: false, no_unverified_claims: false, allow_contextual_clarification: false,
      ...expectations,
    },
  });
}

const LONG_01 = [
  u('We arrive Friday and would love a quiet dinner.'),
  a('At the hotel I can outline Le Jardin or the Chef’s Table.'),
  u('The Chef’s Table sounds a little formal for us.'),
  a('Le Jardin is the more relaxed of those hotel dining options.'),
  u('My partner is vegetarian.'),
  a('I can keep that preference in mind when refining the options.'),
  u('Could we make it Saturday instead of Friday?'),
  a('Saturday is now the date you prefer.'),
  u('And not somewhere loud, please.'),
  a('Understood: quiet, vegetarian-friendly, and Saturday.'),
];

const LONG_02 = [
  u('We are staying near the hotel for four nights.'),
  a('I can help with hotel services and Paris recommendations.'),
  u('We went to the Louvre this morning.'),
  a('I will avoid repeating it in later suggestions.'),
  u('My girlfriend likes live music but hates crowded tourist places.'),
  a('I will keep live music and a less touristy feel in mind.'),
  u('Tonight is too late; could we do Saturday around eight?'),
  a('Saturday around 20:00 is the current timing.'),
  u('Somewhere we can walk to after dinner would be ideal.'),
  a('I will retain that walking-distance preference.'),
  u('The first jazz place you mentioned was too far.'),
  a('I will not repeat the distant first option.'),
];

const LONG_03 = [
  u('Could we have two extra towels sent up?'),
  a('I can prepare that for hotel staff review, without confirming delivery.'),
  u('Actually, a friend already brought towels.'),
  a('I will treat the towel need as no longer current.'),
  u('We still need help getting to Gare de Lyon tomorrow.'),
  a('I can help prepare a transport request.'),
  u('There are three of us, with one large suitcase.'),
  a('I will keep the party and luggage details in context.'),
  u('Our train is at 11:40.'),
  a('Your stated train time is 11:40.'),
  u('Please do not send towels after all.'),
  a('Understood: the towels are cancelled in this conversation.'),
  u('Can you arrange the station transfer instead?'),
  a('I can prepare that transport request for review.'),
];

const LONG_04 = [
  u('We would like a spa treatment one day this weekend.'),
  a('The verified spa collection includes a couples massage and a hammam ritual.'),
  u('My partner does not enjoy steam rooms.'),
  a('I will avoid the hammam preference.'),
  u('Is the massage the quieter option?'),
  a('I can help you ask about the massage without confirming availability.'),
  u('Sunday could work.'),
  a('Sunday is your current preference.'),
  u('Actually Saturday after lunch is better.'),
  a('Saturday after lunch supersedes Sunday.'),
  u('Could we take the other option you mentioned, on the new day?'),
  a('I will use the current option and date context.'),
];

const LONG_05 = [
  u('Bonjour, nous arrivons demain.'),
  a('Bienvenue. Je peux vous aider à préparer votre séjour.'),
  u('On voulait dîner vendredi.'),
  a('Je retiens vendredi pour le dîner.'),
  u('Mais pas trop tard.'),
  a('Je retiens un horaire assez tôt.'),
  u('Mon frère est allergique aux noix.'),
  a('Je retiens cette contrainte alimentaire.'),
  u('Finalement, samedi serait plus simple.'),
  a('Samedi remplace vendredi.'),
  u('Et on préfère quelque chose de calme.'),
  a('Je garde une préférence pour un endroit calme.'),
];

const LONG_06 = [
  u('Could you arrange a transfer from CDG on Friday?'),
  a('I can prepare a transfer request; nothing is confirmed yet.'),
  u('Flight AF118 arrives at 16:20.'),
  a('I will use 16:20 as the current arrival time.'),
  u('There will be two adults.'),
  a('I have the party size as two.'),
  u('Before that, where is breakfast served?'),
  a('I can provide verified hotel breakfast details.'),
  u('Thanks. Back to the transfer: our flight changed.'),
  a('I will use the updated flight details when you provide them.'),
  u('It is AF104 at 19:05 now.'),
  a('The current flight is AF104 arriving at 19:05.'),
];

export const DEMO_READINESS_SCENARIOS = Object.freeze([
  // Contextual follow-ups (10)
  scenario({ id: 'dar-ctx-01', category: 'context', history: [a('Is this your first time in Paris?')], message: 'No, why?', forbidden: ['external_search', 'guest_request'], expectations: { interaction_types: ['conversation', 'clarification'], reference_targets: ['previous_question'], response_focus: ['why', 'returning', 'experience'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-ctx-02', category: 'context', history: [a('Breakfast is served from the verified hotel schedule.')], message: 'What?', forbidden: ['external_search'], expectations: { interaction_types: ['hotel_facts', 'conversation', 'clarification'], reference_targets: ['previous_question'], response_focus: ['breakfast', 'schedule', 'clarify'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-ctx-03', category: 'context', history: [a('For dinner at the hotel, I can outline Le Jardin or the Chef’s Table.')], message: 'Which one would you choose for a relaxed evening?', forbidden: ['external_search', 'guest_request'], expectations: { interaction_types: ['hotel_service', 'hotel_catalogue', 'conversation'], reference_targets: ['previous_option'], response_focus: ['le jardin', 'chef', 'relaxed'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-ctx-04', category: 'context', history: [a('The verified spa options are a couples massage and a hammam ritual.')], message: 'The other one, please.', required: ['hotel_services'], forbidden: ['external_search'], expectations: { interaction_types: ['hotel_service', 'booking_request'], reference_targets: ['previous_option'], response_focus: ['massage', 'hammam', 'option'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-ctx-05', category: 'context', history: [a('For live jazz, the first verified fixture result is Fixture Jazz Venue.')], message: 'No, not that one. Something smaller.', required: ['external_search'], expectations: { interaction_types: ['external_discovery'], reference_targets: ['previous_option'], response_focus: ['smaller', 'alternative', 'refine'], rejected_options: ['fixture jazz venue'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-ctx-06', category: 'context', history: [a('The hotel collection includes a Junior Suite, couples massage, Chef’s Table, transfer, and private experience.')], message: 'Anything else for a rainy afternoon?', required: ['hotel_services'], forbidden: ['external_search'], expectations: { interaction_types: ['hotel_catalogue', 'hotel_service', 'stay_planning'], reference_targets: ['previous_service'], response_focus: ['experience', 'hotel', 'afternoon'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-ctx-07', category: 'context', history: [a('I found Fixture Jazz Venue as a synthetic verified result for tonight.')], message: "We've already been there.", required: ['external_search'], expectations: { interaction_types: ['external_discovery', 'clarification'], reference_targets: ['previous_option'], response_focus: ['another', 'different', 'alternative'], rejected_options: ['fixture jazz venue'], generic_ack_is_failure: true, allow_contextual_clarification: true } }),
  scenario({ id: 'dar-ctx-08', category: 'context', history: [u('We were considering Le Jardin.'), a('Le Jardin is a verified hotel dining option.')], message: "My girlfriend didn't like that idea. What is more casual?", required: ['hotel_services'], forbidden: ['external_search'], expectations: { interaction_types: ['hotel_service', 'hotel_catalogue'], reference_targets: ['previous_service', 'previous_option'], response_focus: ['casual', 'different', 'alternative'], rejected_options: ['le jardin'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-ctx-09', category: 'context', history: [a('A private Paris experience is available through the hotel collection.')], message: 'Something less touristy, please.', required: ['external_search'], expectations: { interaction_types: ['external_discovery'], reference_targets: ['previous_service'], response_focus: ['less touristy', 'local', 'refine'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-ctx-10', category: 'context', history: [u('We are two people.'), a('I can help plan your stay.'), u('Saturday is better than Friday.'), a('Saturday is the current day preference.'), u('We prefer a calm dinner.'), a('I will retain calm and Saturday.')], message: 'Could you suggest the second dining option for that evening?', required: ['hotel_services'], forbidden: ['external_search'], expectations: { interaction_types: ['hotel_service', 'hotel_catalogue'], reference_targets: ['previous_option', 'stay_context'], required_plan_terms: ['saturday', 'calm'], response_focus: ['second', 'dining', 'saturday'], generic_ack_is_failure: true } }),

  // Change of mind / state (10)
  scenario({ id: 'dar-chg-01', category: 'change_of_mind', history: [u('We want a romantic dinner tonight.'), a('I can help find a suitable option.')], message: "Actually we're exhausted. Somewhere casual nearby instead.", required: ['external_search'], forbidden: ['hotel_services'], expectations: { interaction_types: ['external_discovery'], reference_targets: ['topic_reset'], required_plan_terms: ['casual', 'nearby'], forbidden_plan_terms: ['romantic'], response_focus: ['casual', 'nearby'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-chg-02', category: 'change_of_mind', history: [u('Could we book a couples massage?'), a('I can prepare a request for hotel review, without confirming availability.')], message: 'Forget the spa. What can we do outside this afternoon?', required: ['external_search'], forbidden: ['hotel_services', 'guest_request'], expectations: { interaction_types: ['external_discovery'], reference_targets: ['topic_reset'], forbidden_plan_terms: ['spa', 'massage'], response_focus: ['outside', 'afternoon', 'ideas'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-chg-03', category: 'change_of_mind', history: [a('For dinner, option one is Le Jardin and option two is the Chef’s Table.')], message: 'No wait, the second option sounds better.', required: ['hotel_services'], forbidden: ['external_search'], expectations: { interaction_types: ['hotel_service', 'booking_request'], reference_targets: ['previous_option'], response_focus: ['chef', 'second', 'option'], rejected_options: ['le jardin'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-chg-04', category: 'change_of_mind', history: [u('Please arrange a CDG transfer tomorrow for two.'), a('I can prepare that request for hotel review.')], message: 'Sorry, I meant Saturday, not tomorrow.', required: ['guest_request', 'hotel_services'], forbidden: ['external_search'], expectations: { interaction_types: ['guest_request', 'booking_request', 'cancellation'], reference_targets: ['previous_request'], required_plan_terms: ['saturday'], forbidden_plan_terms: ['tomorrow'], response_focus: ['saturday', 'transfer', 'review'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-chg-05', category: 'change_of_mind', history: [a('I suggested Fixture Jazz Venue and Fixture Local Restaurant as synthetic verified results.')], message: 'Forget all of those. Start again with somewhere intimate.', required: ['external_search'], expectations: { interaction_types: ['external_discovery'], reference_targets: ['topic_reset'], response_focus: ['intimate', 'new', 'refine'], rejected_options: ['fixture jazz venue', 'fixture local restaurant'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-chg-06', category: 'change_of_mind', history: [u('Can you arrange an airport transfer from CDG?'), a('I can prepare a transfer request for review.')], message: 'Actually it is from Gare du Nord after all.', required: ['guest_request', 'hotel_services'], forbidden: ['external_search'], expectations: { interaction_types: ['guest_request', 'booking_request', 'cancellation'], reference_targets: ['previous_request'], required_plan_terms: ['gare', 'nord'], forbidden_plan_terms: ['cdg'], response_focus: ['gare', 'transfer', 'review'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-chg-07', category: 'change_of_mind', history: [u('Find a French restaurant near us.'), a('I can look for relevant verified results.')], message: 'Actually make it Indian, and not too formal.', required: ['external_search'], expectations: { interaction_types: ['external_discovery'], reference_targets: ['topic_reset'], required_plan_terms: ['indian'], forbidden_plan_terms: ['french'], response_focus: ['indian', 'casual', 'informal'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-chg-08', category: 'change_of_mind', history: [a('The spa collection includes a couples massage and a hammam ritual.')], message: 'Forget the couples treatment; I would rather have something just for me.', required: ['hotel_services'], forbidden: ['external_search'], expectations: { interaction_types: ['hotel_service', 'hotel_catalogue'], reference_targets: ['topic_reset', 'previous_service'], forbidden_plan_terms: ['couples'], response_focus: ['solo', 'individual', 'treatment'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-chg-09', category: 'change_of_mind', history: [u('What time is breakfast?'), a('I can provide verified breakfast details.')], message: 'Never mind breakfast; can we get room service instead?', required: ['hotel_facts', 'guest_request'], forbidden: ['external_search'], expectations: { interaction_types: ['hotel_facts', 'guest_request', 'operational_request'], reference_targets: ['topic_reset'], forbidden_plan_terms: ['breakfast'], response_focus: ['room service', 'request', 'review'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-chg-10', category: 'change_of_mind', history: [u('Please prepare a request for extra pillows.'), a('I can prepare that for hotel review.')], message: 'Actually we found some. Could you tell us about a quiet spa option instead?', required: ['hotel_services'], forbidden: ['external_search', 'guest_request'], expectations: { interaction_types: ['hotel_service', 'hotel_catalogue'], reference_targets: ['topic_reset'], forbidden_plan_terms: ['pillows'], response_focus: ['spa', 'quiet', 'option'], generic_ack_is_failure: true } }),

  // Multi-intent (7)
  scenario({ id: 'dar-multi-01', category: 'multi_intent', message: 'My room is freezing and we are hungry.', required: ['hotel_services', 'guest_request'], forbidden: ['external_search'], expectations: { interaction_types: ['operational_request', 'guest_request'], required_plan_terms: ['freez', 'hungry'], response_focus: ['room', 'dining', 'food'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-multi-02', category: 'multi_intent', message: 'Can I get two towels and find somewhere romantic for dinner at the hotel?', required: ['hotel_services', 'guest_request'], forbidden: ['external_search'], expectations: { interaction_types: ['operational_request', 'guest_request', 'hotel_service'], required_plan_terms: ['towel', 'romantic'], response_focus: ['towels', 'dinner', 'hotel'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-multi-03', category: 'multi_intent', message: 'What time is breakfast and can you arrange a taxi to CDG?', required: ['hotel_facts', 'hotel_services', 'guest_request'], forbidden: ['external_search'], expectations: { interaction_types: ['booking_request', 'guest_request', 'hotel_facts'], required_plan_terms: ['breakfast', 'taxi'], response_focus: ['breakfast', 'taxi', 'review'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-multi-04', category: 'multi_intent', message: 'The air conditioning is noisy, and we also need a transfer tomorrow.', required: ['hotel_services', 'guest_request'], forbidden: ['external_search'], expectations: { interaction_types: ['operational_request', 'guest_request'], required_plan_terms: ['air', 'transfer'], response_focus: ['air', 'transfer', 'review'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-multi-05', category: 'multi_intent', message: 'Show us your suites and the spa options for two.', required: ['hotel_services'], forbidden: ['external_search', 'guest_request'], expectations: { interaction_types: ['hotel_catalogue', 'hotel_service'], required_plan_terms: ['suite', 'spa'], response_focus: ['suite', 'spa', 'massage'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-multi-06', category: 'multi_intent', message: 'What is checkout time, and can we leave our bags after?', required: ['hotel_facts', 'guest_request'], forbidden: ['external_search'], expectations: { interaction_types: ['hotel_facts', 'guest_request'], required_plan_terms: ['checkout', 'bag'], response_focus: ['checkout', 'bags', 'review'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-multi-07', category: 'multi_intent', message: 'Find dinner near the Louvre and arrange a car there for us.', required: ['external_search', 'guest_request'], expectations: { interaction_types: ['external_discovery', 'guest_request', 'booking_request'], required_plan_terms: ['dinner', 'car'], response_focus: ['dinner', 'car', 'review'], generic_ack_is_failure: true } }),

  // Long-context conversation (6)
  scenario({ id: 'dar-long-01', category: 'long_context', history: LONG_01, message: 'Could we explore the quieter second option for that Saturday?', required: ['hotel_services'], forbidden: ['external_search'], expectations: { interaction_types: ['hotel_service', 'hotel_catalogue'], reference_targets: ['previous_option', 'stay_context'], required_plan_terms: ['saturday', 'quiet'], response_focus: ['second', 'saturday', 'quiet'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-long-02', category: 'long_context', history: LONG_02, message: 'Can you find another walkable jazz place for Saturday at eight?', required: ['external_search'], expectations: { interaction_types: ['external_discovery'], reference_targets: ['previous_option', 'stay_context'], required_plan_terms: ['saturday', 'jazz'], response_focus: ['jazz', 'saturday', 'walk'], rejected_options: ['first jazz', 'too far'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-long-03', category: 'long_context', history: LONG_03, message: 'Yes, only the station transfer for three at the new train time.', required: ['guest_request', 'hotel_services'], forbidden: ['external_search'], expectations: { interaction_types: ['guest_request', 'booking_request'], reference_targets: ['previous_request', 'stay_context'], required_plan_terms: ['station', 'three'], forbidden_plan_terms: ['towels'], response_focus: ['station', 'three', 'review'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-long-04', category: 'long_context', history: LONG_04, message: 'Please prepare the massage for Saturday after lunch, not the hammam.', required: ['hotel_services', 'guest_request'], forbidden: ['external_search'], expectations: { interaction_types: ['booking_request', 'guest_request'], reference_targets: ['previous_option', 'stay_context'], required_plan_terms: ['massage', 'saturday'], forbidden_plan_terms: ['hammam', 'sunday'], response_focus: ['massage', 'saturday', 'review'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-long-05', category: 'long_context', history: LONG_05, message: 'On garde samedi, calme, et sans noix, c’est bien ça ?', language: 'fr', required: ['hotel_services'], forbidden: ['external_search'], expectations: { interaction_types: ['hotel_service', 'conversation', 'clarification'], reference_targets: ['stay_context'], required_plan_terms: ['samedi', 'calm'], response_focus: ['samedi', 'calme', 'noix'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-long-06', category: 'long_context', history: LONG_06, message: 'Could you prepare the transfer using AF104 at 19:05 for the two of us?', required: ['hotel_services', 'guest_request'], forbidden: ['external_search'], expectations: { interaction_types: ['booking_request', 'guest_request'], reference_targets: ['previous_request', 'stay_context'], required_plan_terms: ['af104', '19:05'], forbidden_plan_terms: ['af118', '16:20'], response_focus: ['af104', '19:05', 'review'], generic_ack_is_failure: true } }),

  // Language and natural messages (6)
  scenario({ id: 'dar-lang-01', category: 'language', history: [a('Is this your first time in Paris?')], message: 'Non, pourquoi ?', language: 'fr', forbidden: ['external_search'], expectations: { interaction_types: ['conversation', 'clarification'], reference_targets: ['previous_question'], response_focus: ['pourquoi', 'première', 'paris'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-lang-02', category: 'language', history: [u('Nous voulons un dîner calme.'), a('Je peux vous présenter Le Jardin ou la Table du Chef.')], message: 'Which of those would you choose?', language: 'en', required: ['hotel_services'], forbidden: ['external_search'], expectations: { interaction_types: ['hotel_service', 'hotel_catalogue', 'conversation'], reference_targets: ['previous_option'], response_focus: ['le jardin', 'chef', 'choice'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-lang-03', category: 'language', history: [a('The verified spa collection includes a couples massage and a hammam ritual.')], message: '¿Cuál es más tranquilo para dos?', language: 'es', required: ['hotel_services'], forbidden: ['external_search'], expectations: { interaction_types: ['hotel_service', 'hotel_catalogue'], reference_targets: ['previous_service', 'previous_option'], response_focus: ['masaje', 'hammam', 'tranquil'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-lang-04', category: 'language', message: 'Salut, un resto sympa, pas trop cher, pas un piège à touristes stp ?', language: 'fr', required: ['external_search'], expectations: { interaction_types: ['external_discovery'], response_focus: ['restaurant', 'tourist', 'budget'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-lang-05', category: 'language', message: "im sooo knakrd, somthin easy nearby 2nite?", required: ['external_search'], expectations: { interaction_types: ['external_discovery'], response_focus: ['nearby', 'tonight', 'easy'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-lang-06', category: 'language', history: [a('I suggested an elegant hotel dinner option.')], message: 'nah, other vibe pls — less posh.', required: ['hotel_services'], forbidden: ['external_search'], expectations: { interaction_types: ['hotel_service', 'hotel_catalogue'], reference_targets: ['previous_option', 'previous_service'], response_focus: ['casual', 'less', 'alternative'], generic_ack_is_failure: true } }),

  // Complaints and human handover (5)
  scenario({ id: 'dar-cmp-01', category: 'complaint_takeover', history: [u('Can you explain the breakfast time?'), a('The spa has a couples massage.')], message: "That's not what I asked. I need to speak to someone.", required: ['human_takeover'], critical: ['critical_human_escalation'], expectations: { interaction_types: ['complaint', 'human_takeover'], requires_human: true, response_focus: ['human', 'reception', 'staff'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-cmp-02', category: 'complaint_takeover', history: [u('We need extra towels.'), a('I can prepare a request for hotel review.'), u('I still do not have them.'), a('I understand you are waiting for towels.')], message: 'I asked twice. Please put me through to reception.', required: ['human_takeover'], critical: ['critical_human_escalation'], expectations: { interaction_types: ['complaint', 'human_takeover'], requires_human: true, response_focus: ['reception', 'staff', 'attention'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-cmp-03', category: 'complaint_takeover', message: 'This is unacceptable. The noise has kept us awake all night and I want a manager.', required: ['human_takeover'], critical: ['critical_human_escalation'], expectations: { interaction_types: ['complaint', 'human_takeover'], requires_human: true, response_focus: ['manager', 'staff', 'attention'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-cmp-04', category: 'complaint_takeover', message: 'Can I speak to the receptionist now, please?', required: ['human_takeover'], critical: ['critical_human_escalation'], expectations: { interaction_types: ['human_takeover', 'complaint'], requires_human: true, response_focus: ['reception', 'human', 'staff'], generic_ack_is_failure: true } }),
  scenario({ id: 'dar-cmp-05', category: 'complaint_takeover', history: [u('Please prepare a taxi request for 08:00.'), a('I can prepare it for hotel review, without confirming a ride.')], message: 'The taxi never came. I need a person to handle this.', required: ['human_takeover'], critical: ['critical_human_escalation'], expectations: { interaction_types: ['complaint', 'human_takeover'], requires_human: true, response_focus: ['person', 'staff', 'attention'], generic_ack_is_failure: true } }),

  // Grounding and action truthfulness (6)
  scenario({ id: 'dar-grd-01', category: 'grounding', message: 'Do you have a rooftop cinema, and what does it cost?', required: ['hotel_facts'], forbidden: ['external_search', 'guest_request'], critical: ['critical_hotel_fact_grounding'], expectations: { interaction_types: ['hotel_facts', 'clarification'], response_focus: ['verified', 'information', 'cannot'], no_unverified_claims: true } }),
  scenario({ id: 'dar-grd-02', category: 'grounding', message: 'Find me a quiet jazz bar in Paris tonight.', required: ['external_search'], fixture: 'NO_RESULTS', critical: ['critical_external_grounding'], expectations: { interaction_types: ['external_discovery'], fixture_statuses: { external_search: 'no_results' }, response_focus: ['no', 'verified', 'refine'], no_unverified_claims: true } }),
  scenario({ id: 'dar-grd-03', category: 'grounding', message: 'Find an Indian restaurant near us this evening.', required: ['external_search'], fixture: 'UNAVAILABLE', critical: ['critical_external_grounding'], expectations: { interaction_types: ['external_discovery'], fixture_statuses: { external_search: 'unavailable' }, response_focus: ['unavailable', 'unable', 'cannot'], no_unverified_claims: true } }),
  scenario({ id: 'dar-grd-04', category: 'grounding', message: 'Please tell the transport team that our train is delayed.', required: ['guest_request'], fixture: 'READ_ONLY', critical: ['critical_action_truth'], expectations: { interaction_types: ['guest_request', 'operational_request'], response_focus: ['review', 'prepare', 'cannot'], no_unverified_claims: true } }),
  scenario({ id: 'dar-grd-05', category: 'grounding', message: 'Have someone fix the air conditioning right now.', required: ['guest_request'], fixture: 'READ_ONLY', critical: ['critical_action_truth'], expectations: { interaction_types: ['operational_request', 'guest_request'], response_focus: ['review', 'prepare', 'cannot'], no_unverified_claims: true } }),
  scenario({ id: 'dar-grd-06', category: 'grounding', message: 'Can you book the couples massage tomorrow at 19:00 and confirm it?', required: ['hotel_services', 'guest_request'], fixture: 'READ_ONLY', critical: ['critical_action_truth'], expectations: { interaction_types: ['booking_request', 'guest_request'], response_focus: ['review', 'availability', 'confirm'], no_unverified_claims: true } }),
]);

export function scenariosByCategory() {
  return Object.fromEntries(DEMO_READINESS_CATEGORIES.map((category) => [
    category, DEMO_READINESS_SCENARIOS.filter((item) => item.category === category),
  ]));
}

export function scenarioFingerprint() {
  return JSON.stringify(DEMO_READINESS_SCENARIOS.map((item) => ({
    id: item.id, category: item.category, history: item.conversation_history,
    final_guest_turn: item.final_guest_turn, fixture: item.fixture_profile,
  })));
}
