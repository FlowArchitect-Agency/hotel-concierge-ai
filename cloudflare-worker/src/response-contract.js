const RESPONSE_MODES = new Set([
  'answer_question',
  'clarify_previous_statement',
  'recommend',
  'refine_recommendation',
  'acknowledge_change',
  'explain',
  'report_action_result',
  'report_tool_failure',
  'ask_clarifying_question',
  'escalate_to_human',
]);

const KNOWN_REFERENCE_TARGETS = new Set([
  'previous_question',
  'previous_option',
  'previous_request',
  'previous_service',
  'stay_context',
]);

const SIGNAL_STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'been', 'before', 'being', 'but', 'can', 'could',
  'does', 'for', 'from', 'have', 'hotel', 'into', 'just', 'like', 'more', 'most', 'much', 'next',
  'only', 'please', 'previous', 'question', 'schedule', 'served', 'should', 'that', 'the', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'those', 'today', 'using', 'verified', 'was',
  'were', 'what', 'when', 'where', 'which', 'with', 'would', 'your', 'you', 'assistant', 'guest',
]);

const FALLBACK_PREFIX = {
  en: 'To clarify, I was referring to:',
  fr: 'Pour clarifier, je faisais référence à :',
  es: 'Para aclararlo, me refería a:',
  it: 'Per chiarire, mi riferivo a:',
  de: 'Zur Klarstellung bezog ich mich auf:',
  ja: 'ご説明すると、次の内容を指していました：',
  zh: '为澄清起见，我指的是：',
  ar: 'للتوضيح، كنت أشير إلى:',
};

const TOOL_FAILURE_FALLBACK = {
  en: 'I am unable to verify a current result for that request just now. I can help refine it with a neighbourhood, timing, or preference.',
  fr: 'Je ne peux pas vérifier un résultat actuel pour cette demande pour le moment. Je peux vous aider à la préciser par quartier, horaire ou préférence.',
  es: 'No puedo verificar un resultado actual para esta solicitud en este momento. Puedo ayudarle a precisarla por zona, horario o preferencia.',
  it: 'Al momento non posso verificare un risultato aggiornato per questa richiesta. Posso aiutarla a precisarla per zona, orario o preferenza.',
  de: 'Ich kann für diese Anfrage gerade kein aktuelles Ergebnis verifizieren. Gern helfe ich Ihnen, sie nach Viertel, Zeitpunkt oder Vorlieben einzugrenzen.',
  ja: '現在、このご希望に合う最新の結果を確認できません。エリア、時間帯、またはご希望を絞り込むお手伝いはできます。',
  zh: '目前我无法核实与此请求匹配的最新结果。我可以协助您按区域、时间或偏好进一步细化。',
  ar: 'لا أستطيع التحقق من نتيجة حديثة لهذا الطلب الآن. يمكنني مساعدتك في تحديد الحي أو الوقت أو التفضيلات.',
};

const EXPLAIN_REFERENCE_FALLBACK = {
  en: 'That is why I asked: it helps me tailor the suggestions to what will be most useful to you.',
  fr: 'C’est pourquoi je vous l’ai demandé : cela m’aide à adapter mes idées à ce qui vous sera le plus utile.',
  es: 'Por eso se lo pregunté: me ayuda a adaptar las sugerencias a lo que le resulte más útil.',
  it: 'È per questo che gliel’ho chiesto: mi aiuta ad adattare i suggerimenti a ciò che le sarà più utile.',
  de: 'Deshalb habe ich gefragt: So kann ich die Vorschläge auf das abstimmen, was für Sie am hilfreichsten ist.',
  ja: 'そのために伺いました。お客様に最も役立つご提案に合わせるためです。',
  zh: '这就是我提问的原因：这样我可以根据对您最有帮助的内容调整建议。',
  ar: 'لهذا سألت: حتى أتمكن من تخصيص الاقتراحات لما سيكون أكثر فائدة لك.',
};

function compact(value, max = 420) {
  return typeof value === 'string'
    ? value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

function compactList(values, maxItems = 4, maxLength = 120) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => compact(value, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function latestHistoryContent(history, role) {
  const item = [...(history || [])].reverse().find((entry) => {
    const entryRole = String(entry?.role || '').toLowerCase();
    return role ? entryRole === role : compact(entry?.message ?? entry?.content);
  });
  return compact(item?.message ?? item?.content);
}

function referenceSummary(plan, history) {
  if (!KNOWN_REFERENCE_TARGETS.has(plan?.referenceTarget)) return '';
  const role = plan.referenceTarget === 'previous_request' ? 'user' : 'assistant';
  return latestHistoryContent(history, role) || compact(plan?.contextSummary);
}

function toolEntries(toolResults = {}) {
  return Object.entries(toolResults).map(([tool, result]) => ({
    tool,
    status: compact(result?.status || 'not_needed', 40),
    names: compactList([
      ...(result?.data?.services || []).map((item) => item?.name),
      ...(result?.data?.results || []).map((item) => item?.name || item?.title),
    ], 5, 120),
  }));
}

function hasToolFailure(entries) {
  return entries.some((entry) => ['unavailable', 'error', 'failed', 'no_results'].includes(entry.status));
}

export function responseModeForPlan(plan = {}, toolResults = {}) {
  const tools = toolEntries(toolResults);
  if (['complaint', 'human_takeover'].includes(plan.interactionType)) return 'escalate_to_human';
  if (hasToolFailure(tools) && (plan.toolNeeds?.externalSearch || plan.interactionType === 'external_discovery')) return 'report_tool_failure';
  if (plan.interactionType === 'cancellation' || plan.topicReset || (plan.supersededGoals || []).length) return 'acknowledge_change';
  if (plan.interactionType === 'clarification') {
    return KNOWN_REFERENCE_TARGETS.has(plan.referenceTarget)
      ? 'clarify_previous_statement'
      : 'ask_clarifying_question';
  }
  if (plan.interactionType === 'external_discovery' || plan.interactionType === 'hotel_service' || plan.interactionType === 'hotel_catalogue') {
    return (plan.activeConstraints || []).length || (plan.preferenceConstraints || []).length || (plan.rejectedEntities || []).length || plan.referenceTarget === 'previous_option'
      ? 'refine_recommendation'
      : 'recommend';
  }
  if (['guest_request', 'booking_request', 'operational_request'].includes(plan.interactionType)) return 'report_action_result';
  if (plan.interactionType === 'hotel_facts') return 'answer_question';
  return KNOWN_REFERENCE_TARGETS.has(plan.referenceTarget) ? 'explain' : 'answer_question';
}

/**
 * A compact, provider-neutral handoff from the validated semantic plan to the
 * response generator. It has no execution authority and contains no model
 * reasoning trace, secrets, or unverified information.
 */
export function buildResponseContract({ semanticPlan = {}, history = [], facts = {}, toolResults = {} } = {}) {
  const plan = semanticPlan || {};
  const tools = toolEntries(toolResults);
  const knownReference = KNOWN_REFERENCE_TARGETS.has(plan.referenceTarget);
  const mode = responseModeForPlan(plan, toolResults);
  const requiredBehavior = ['address_current_goal', 'use_only_verified_information'];
  const prohibitedBehavior = ['invent_facts_or_action_results', 'restart_known_conversation'];
  if (knownReference) requiredBehavior.push('address_resolved_reference');
  if ((plan.activeConstraints || []).length || (plan.preferenceConstraints || []).length) requiredBehavior.push('respect_active_constraints');
  if ((plan.rejectedEntities || []).length) prohibitedBehavior.push('present_rejected_entity_as_current');
  if ((plan.supersededGoals || []).length || plan.topicReset) prohibitedBehavior.push('continue_superseded_goal');
  if (mode === 'report_tool_failure') requiredBehavior.push('acknowledge_verified_tool_limitation');

  return {
    response_mode: RESPONSE_MODES.has(mode) ? mode : 'answer_question',
    active_goal: compact(plan.activeGoal || plan.interactionType || 'conversation', 80),
    reference: knownReference ? plan.referenceTarget : 'none',
    reference_summary: referenceSummary(plan, history),
    active_constraints: compactList(plan.activeConstraints),
    preference_constraints: compactList(plan.preferenceConstraints),
    rejected_entities: compactList(plan.rejectedEntities),
    superseded_goals: compactList(plan.supersededGoals),
    verified_facts: compact(facts?.text, 420),
    tool_result_summary: tools,
    required_behavior: requiredBehavior,
    prohibited_behavior: prohibitedBehavior,
  };
}

function signalTerms(value) {
  return [...new Set(compact(value, 420).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [])]
    .map((term) => term.replace(/[’'-]/g, ''))
    .filter((term) => term.length >= 4 && !SIGNAL_STOP_WORDS.has(term));
}

function matchesAnySignal(reply, sources) {
  const text = compact(reply, 800).toLowerCase();
  const terms = sources.flatMap(signalTerms);
  return !terms.length || terms.some((term) => text.includes(term));
}

function rejectedEntityReintroduced(reply, rejectedEntities) {
  const response = compact(reply, 800).toLowerCase();
  return compactList(rejectedEntities).some((entity) => {
    const index = response.indexOf(entity.toLowerCase());
    if (index < 0) return false;
    // A brief negative reference ("not Le Jardin") can acknowledge the
    // guest's choice; presenting it without such a qualifier treats it as
    // current again. This is an entity-state check, not a guest-phrase rule.
    const nearby = response.slice(Math.max(0, index - 28), index + entity.length + 28);
    return !/\b(?:not|avoid(?:ing)?|instead|rather|except|without|no longer|other than)\b/i.test(nearby);
  });
}

function supersededGoalContinued(reply, supersededGoals) {
  const response = compact(reply, 800).toLowerCase();
  return compactList(supersededGoals).some((goal) => {
    const index = response.indexOf(goal.toLowerCase());
    if (index < 0) return false;
    const nearby = response.slice(Math.max(0, index - 32), index + goal.length + 32);
    return !/\b(?:not|avoid|aside|instead|rather|cancelled|canceled|no longer|superseded|without)\b/i.test(nearby);
  });
}

export function validateResponseAdherence(model = {}, contract = {}) {
  const failures = [];
  const reply = compact(model.reply, 800);
  if (!reply) failures.push('missing_reply');
  const knownReference = contract.reference && contract.reference !== 'none' && compact(contract.reference_summary);
  // An explicit explanation/clarification must make its resolved referent
  // visible. Refinements may correctly avoid naming a rejected option, so
  // their contract is tested through active constraints instead.
  const requiresReferenceBinding = knownReference && ['clarify_previous_statement', 'answer_question', 'explain'].includes(contract.response_mode);
  if (reply && requiresReferenceBinding && !matchesAnySignal(reply, [contract.reference_summary])) {
    failures.push('resolved_reference_not_addressed');
  }
  const constraints = [...(contract.active_constraints || []), ...(contract.preference_constraints || [])];
  if (reply && contract.response_mode === 'refine_recommendation' && constraints.length && !matchesAnySignal(reply, constraints)) {
    failures.push('active_constraints_not_reflected');
  }
  if (reply && rejectedEntityReintroduced(reply, contract.rejected_entities)) failures.push('rejected_entity_reintroduced');
  if (reply && supersededGoalContinued(reply, contract.superseded_goals)) failures.push('superseded_goal_continued');
  if (reply && contract.response_mode === 'report_tool_failure') {
    const successfulNames = (contract.tool_result_summary || []).flatMap((entry) => entry.names || []);
    if (!successfulNames.length && /\b(?:found|recommend|suggest)\b/i.test(reply)) failures.push('tool_failure_presented_as_success');
  }
  return { passed: failures.length === 0, failures: [...new Set(failures)] };
}

function constrainedFallback(contract, language) {
  const constraints = [...(contract.active_constraints || []), ...(contract.preference_constraints || [])];
  const rejected = compactList(contract.rejected_entities);
  if (constraints.length || rejected.length) {
    // Deduplicate before joining — active/preference constraints can overlap
    // (the same guest phrase can satisfy both). Exact-match dedup alone is not
    // enough: the plan can also produce two DIFFERENT strings where one fully
    // contains the other (e.g. "outdoorsy" and "outdoorsy preferences"),
    // which previously still produced guest-facing text like "outdoorsy
    // preferences, outdoorsy". Collapse those to the single longer phrase.
    const dedupePhrases = (values) => {
      const cleaned = [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
      return cleaned.filter((value, index) => {
        const lower = value.toLowerCase();
        return !cleaned.some((other, otherIndex) => {
          if (otherIndex === index) return false;
          const otherLower = other.toLowerCase();
          if (otherLower === lower) return otherIndex < index;
          if (!otherLower.includes(lower)) return false;
          return other.length > value.length;
        });
      });
    };
    const uniqueConstraints = dedupePhrases(constraints);
    const uniqueRejected = dedupePhrases(rejected);
    const details = [...uniqueConstraints, ...(uniqueRejected.length ? [`avoiding ${uniqueRejected.join(', ')}`] : [])].join(', ');
    const templates = {
      en: `Understood — I will keep ${details} in mind as I refine the verified options.`,
      fr: `Bien noté — je garderai ${details} à l’esprit pour affiner les options vérifiées.`,
      es: `Entendido: tendré en cuenta ${details} al afinar las opciones verificadas.`,
    };
    return templates[language] || templates.en;
  }
  if ((contract.superseded_goals || []).length) {
    // active_goal can fall back to a raw internal enum value (e.g.
    // "hotel_service", "booking_request") when the semantic plan did not
    // produce a human-readable goal phrase. A snake_case-only string is never
    // guest-facing language, so treat it the same as a missing goal rather
    // than surface internal jargon like "I will focus on hotel_service".
    const rawGoal = compact(contract.active_goal, 120);
    const goal = rawGoal && !/^[a-z]+(?:_[a-z]+)*$/.test(rawGoal) ? rawGoal : 'your updated request';
    const templates = {
      en: `Understood — I will focus on ${goal} and leave the earlier request aside.`,
      fr: `Bien noté — je me concentre sur ${goal} et laisse de côté la demande précédente.`,
      es: `Entendido: me centraré en ${goal} y dejaré de lado la solicitud anterior.`,
    };
    return templates[language] || templates.en;
  }
  return '';
}

/** A grounded final fallback used only after both response attempts fail. */
export function contextualSafeFallback(contract = {}, language = 'en') {
  if (contract.response_mode === 'report_tool_failure') return TOOL_FAILURE_FALLBACK[language] || TOOL_FAILURE_FALLBACK.en;
  const constrained = constrainedFallback(contract, language);
  if (constrained) return constrained;
  if (contract.response_mode === 'explain' && contract.reference && contract.reference !== 'none') {
    const reference = compact(contract.reference_summary, 420);
    const prefix = FALLBACK_PREFIX[language] || FALLBACK_PREFIX.en;
    return reference
      ? `${prefix} ${reference} ${EXPLAIN_REFERENCE_FALLBACK[language] || EXPLAIN_REFERENCE_FALLBACK.en}`
      : (EXPLAIN_REFERENCE_FALLBACK[language] || EXPLAIN_REFERENCE_FALLBACK.en);
  }
  if (contract.reference && contract.reference !== 'none' && compact(contract.reference_summary)) {
    return `${FALLBACK_PREFIX[language] || FALLBACK_PREFIX.en} ${compact(contract.reference_summary, 420)}`;
  }
  // Last resort, reached only when both generation attempts failed the
  // contract. It must be a usable guest-facing answer, not a statement of
  // intent: "I will answer the current request using the verified information
  // available" promises an answer and then delivers none, which live testing
  // showed reaching guests as the entire reply. Defer to a human instead.
  const templates = {
    en: 'I do not have that detail in my verified records. Let me check with our front desk team and come back to you shortly.',
    fr: "Je n'ai pas cette information dans mes données vérifiées. Je me renseigne auprès de la réception et je reviens vers vous rapidement.",
    es: 'No dispongo de ese dato en mis registros verificados. Lo consultaré con nuestro equipo de recepción y le responderé en breve.',
  };
  return templates[language] || templates.en;
}

export function buildResponseRepairPrompt({ contract = {}, failures = [] } = {}) {
  return `Produce one corrected concierge response as JSON only. The semantic controller has already resolved the guest's intent. Do not reinterpret it, do not restart the conversation, and do not explain your process. Address the authoritative response contract using only its verified facts and tool results.\n\nRESPONSE CONTRACT:\n${JSON.stringify(contract)}\n\nFIRST-ATTEMPT ADHERENCE GAPS:\n${JSON.stringify(compactList(failures, 6, 120))}`;
}
