import { dynamicConversationText } from './schema.js';

/**
 * Produces a review-only regression candidate. It never mutates the permanent
 * benchmark; a human must deliberately promote it in a later benchmark version.
 */
export function exportFailureCandidate({ scenario, sut, deterministic, judge } = {}) {
  return {
    status: 'candidate_requires_human_review', candidate_benchmark_version: 'unassigned',
    source_dynamic_id: scenario?.id || '', category: scenario?.category || '', severity: scenario?.severity || '', language: scenario?.language || '',
    conversation: dynamicConversationText(scenario), semantic_goal: scenario?.semantic_goal || '',
    expected_tool_behavior: scenario?.expected_tool_behavior || {}, forbidden_behavior: scenario?.forbidden_behavior || [],
    critical_invariants: scenario?.critical_invariants || [], fixture_profile: scenario?.fixture_profile || '',
    observed: {
      semantic_route: sut?.semantic_route || '', semantic_plan: sut?.semantic_plan || null, tools_requested: sut?.tools_requested || [], tool_statuses: sut?.tool_statuses || {},
      assistant_response: sut?.reply || '', deterministic_failures: deterministic?.failures || [],
      judge: judge?.judgement ? { overall_pass: judge.judgement.overall_pass, critical_failure: judge.judgement.critical_failure, failure_categories: judge.judgement.failure_categories, short_rationale: judge.judgement.short_rationale } : null,
      provider_metadata: sut?.provider_metadata || null,
    },
    promotion_note: 'A human must review this dynamic failure before adding it to a new permanent benchmark version. No automatic benchmark mutation occurred.',
  };
}
