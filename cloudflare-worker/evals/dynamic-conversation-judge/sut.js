import worker from '../../src/index.js';
import { parseSemanticControllerOutput } from '../../src/semantic-controller.js';
import { HOTEL_FIXTURES } from '../conversation-benchmark/fixtures.js';
import { roleGatewayEnvironment } from './config.js';

const ORIGIN = 'https://flowarchitect-agency.github.io';

function serviceRecords() {
  return HOTEL_FIXTURES.services.map((service) => ({ fields: {
    Name: service.name, Category: service.category, Description: service.description,
    PriceEUR: service.price_eur, Active: true, IsPartner: true,
  } }));
}

function settingRecords() {
  return Object.entries(HOTEL_FIXTURES.facts).map(([Key, Value]) => ({ fields: { Key, Value } }));
}

function externalPayload(profile) {
  if (profile === 'NO_RESULTS') return { status: 200, body: { organic_results: [] } };
  if (profile === 'UNAVAILABLE') return { status: 503, body: {} };
  if (profile === 'TIMEOUT') return { timeout: true };
  if (profile === 'ERROR') return { status: 500, body: {} };
  const results = HOTEL_FIXTURES.externalResults.map((item) => ({ title: item.name, description: item.description, url: item.url, address: 'Synthetic Paris fixture' }));
  return { status: 200, body: { organic_results: profile === 'PARTIAL_SUCCESS' ? results.slice(0, 1) : results } };
}

function modelUrlAllowed(target, env) {
  if (target.includes('api.groq.com/openai/v1/chat/completions')) return true;
  const base = String(env.LLM_BASE_URL || env.OMNIROUTE_BASE_URL || '').replace(/\/+$/, '');
  return Boolean(base && target.startsWith(base));
}

function defaultMetadata() {
  return {
    semantic_route: 'unknown', tools_requested: [], tools_executed: [], tool_statuses: {},
    controller_model_calls: 0, response_model_calls: 0, llm_provider: null, llm_model: null,
    llm_status: 'not_called', llm_latency_ms: 0, llm_attempt_count: 0, fallback_used: false, latency_ms: 0,
  };
}

function semanticPlanSummary(plan) {
  if (!plan?.valid) return null;
  return {
    valid: true, interaction_type: plan.interactionType, service_category: plan.serviceCategory,
    service_categories: plan.serviceCategories, reference_target: plan.referenceTarget,
    tool_needs: plan.toolNeeds, language: plan.language, topic_changed: plan.topicChanged,
    topic_reset: plan.topicReset, clarification_needed: plan.clarificationNeeded, guest_goal: plan.guestGoal,
    context_summary: plan.contextSummary, active_goal: plan.activeGoal,
    active_constraints: plan.activeConstraints, preference_constraints: plan.preferenceConstraints,
    referenced_entities: plan.referencedEntities, rejected_entities: plan.rejectedEntities,
    superseded_goals: plan.supersededGoals, location_constraint: plan.locationConstraint,
    time_constraint: plan.timeConstraint,
  };
}

function renderedCardEvidence(body) {
  const cards = (items = []) => items.slice(0, 12).map((item) => ({
    name: String(item?.name || '').slice(0, 160),
    category: String(item?.category || item?.service_type || '').slice(0, 64),
    source: String(item?.source || '').slice(0, 64),
    description: String(item?.description || '').slice(0, 280),
  }));
  const media = body?.media && typeof body.media === 'object'
    ? { type: String(body.media.type || '').slice(0, 48), title: String(body.media.title || '').slice(0, 180), filename: String(body.media.filename || '').slice(0, 180) }
    : null;
  return { partner_offers: cards(body?.partner_offers), recommendations: cards(body?.recommendations), media };
}

function safetyFailure(reply) {
  const text = String(reply || '');
  const failures = [];
  if (/\b(?:booking|reservation|request) (?:is |has been )?confirmed\b/i.test(text)) failures.push('fabricated_booking_confirmation');
  if (/\bavailability (?:is |has been )?confirmed\b/i.test(text)) failures.push('fabricated_availability_confirmation');
  if (/\b(?:staff|team|housekeeping|transport) (?:has been )?(?:notified|alerted|dispatched)\b/i.test(text)) failures.push('fabricated_staff_notification');
  return failures;
}

/**
 * Executes ConciergeFlow as the system under test. Every non-model dependency
 * is an in-memory fixture, and waitUntil throws if a code path tries to write.
 */
export async function runDynamicSut(env, scenario, options = {}) {
  const roleEnv = roleGatewayEnvironment(env, 'sut');
  // These satisfy the Worker configuration gate only. Network interception
  // below guarantees that neither value reaches Airtable or a search provider.
  roleEnv.AIRTABLE_API_KEY ||= 'dynamic-eval-fixture';
  roleEnv.AIRTABLE_BASE_ID ||= 'dynamic-eval-fixture';
  roleEnv.SCRAPINGBEE_API_KEY ||= 'dynamic-eval-fixture';
  const originalFetch = globalThis.fetch;
  const calls = { total: 0, controller: 0, response: 0, rate_limit: null, semantic_plan: null };
  const profile = scenario.fixture_profile || 'SUCCESS';
  globalThis.fetch = async (input, init = {}) => {
    const target = input instanceof Request ? input.url : String(input);
    if (modelUrlAllowed(target, roleEnv)) {
      const prompt = JSON.parse(init.body || '{}').messages?.[0]?.content || '';
      const controller = /semantic conversation controller/i.test(prompt);
      calls.total += 1;
      if (controller) calls.controller += 1; else calls.response += 1;
      const response = await (options.modelFetch || originalFetch)(input, init);
      if (controller && response.ok) {
        const payload = await response.clone().json().catch(() => null);
        calls.semantic_plan = semanticPlanSummary(parseSemanticControllerOutput(payload?.choices?.[0]?.message?.content || '', { language: scenario.language }));
      }
      if (response.status === 429) {
        const header = (name) => response.headers.get(name) || null;
        calls.rate_limit = {
          status: 429, observed_at: new Date().toISOString(), retry_after: header('retry-after'),
          retry_after_ms: header('retry-after-ms'), request_reset: header('x-ratelimit-reset-requests'),
          token_reset: header('x-ratelimit-reset-tokens'), rate_limit: {
            limit_requests: header('x-ratelimit-limit-requests'), remaining_requests: header('x-ratelimit-remaining-requests'),
            limit_tokens: header('x-ratelimit-limit-tokens'), remaining_tokens: header('x-ratelimit-remaining-tokens'),
            reset: header('x-ratelimit-reset'),
          },
        };
      }
      return response;
    }
    if (target.includes('/Services')) return Response.json({ records: serviceRecords() });
    if (target.includes('/Settings')) return Response.json({ records: settingRecords() });
    if (target.includes('app.scrapingbee.com/api/v1/google')) {
      const external = externalPayload(profile);
      if (external.timeout) { const error = new Error('Synthetic external-search timeout.'); error.name = 'AbortError'; throw error; }
      return Response.json(external.body, { status: external.status });
    }
    throw new Error(`Dynamic evaluation blocked an unexpected non-fixture network request: ${target}`);
  };

  const started = Date.now();
  try {
    const finalTurn = String(scenario.final_guest_turn || '');
    const response = await worker.fetch(new Request('https://worker.local/api/chat', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: finalTurn,
        sessionId: `dynamic_eval_${scenario.id}`,
        chatHistory: (scenario.conversation_history || []).map((turn) => ({ role: turn.role, message: turn.content })),
        scenario: 'pre-arrival', testMode: 'read_only', testRunId: 'task13e_demo_ai_readiness',
      }),
    }), roleEnv, {
      waitUntil() { throw new Error('Dynamic read-only evaluation attempted a prohibited persistence write.'); },
    });
    const body = await response.json();
    const observability = body.observability || defaultMetadata();
    return {
      status: response.status,
      reply: String(body.reply || ''), language: body.language || '', intent: body.intent || '',
      requires_human: Boolean(body.requires_human), provider_failure: body.provider_failure || '',
      semantic_route: observability.semantic_route, semantic_plan: calls.semantic_plan, tools_requested: observability.tools_requested || [],
      tools_executed: observability.tools_executed || [], tool_statuses: observability.tool_statuses || {},
      rendered_cards: renderedCardEvidence(body),
      response_pipeline: observability.response_pipeline || null,
      write_attempts: 0, invalid_action_arguments_reached_write_layer: false,
      deterministic_failures: safetyFailure(body.reply), ground_truth: { hotel_facts: HOTEL_FIXTURES.facts, fixture_profile: profile },
      provider_metadata: {
        provider: observability.llm_provider || null, model: observability.llm_model || null,
        gateway: 'conciergeflow-llm-gateway', timestamp: new Date().toISOString(),
        model_call_count: calls.total, controller_model_calls: calls.controller, response_model_calls: calls.response,
        latency_ms: Date.now() - started, fallback_used: Boolean(observability.fallback_used), invalid_output_count: observability.llm_status === 'invalid_output' ? 1 : 0,
      },
      rate_limit: calls.rate_limit,
    };
  } catch (error) {
    return {
      status: 0, reply: '', language: '', intent: '', requires_human: false, provider_failure: 'sut_exception',
      semantic_route: 'unknown', semantic_plan: calls.semantic_plan, tools_requested: [], tools_executed: [], tool_statuses: {}, write_attempts: 0,
      invalid_action_arguments_reached_write_layer: false, deterministic_failures: [String(error?.message || 'sut_exception').slice(0, 220)],
      ground_truth: { hotel_facts: HOTEL_FIXTURES.facts, fixture_profile: profile },
      provider_metadata: { provider: null, model: null, gateway: 'conciergeflow-llm-gateway', timestamp: new Date().toISOString(), model_call_count: calls.total, controller_model_calls: calls.controller, response_model_calls: calls.response, latency_ms: Date.now() - started, fallback_used: false, invalid_output_count: 0 },
      rate_limit: calls.rate_limit,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export function deterministicDynamicChecks(scenario, sut) {
  const failures = [...(sut?.deterministic_failures || [])];
  if (sut?.status !== 200) failures.push(`http_${sut?.status || 0}`);
  if (!String(sut?.reply || '').trim()) failures.push('missing_reply');
  const requested = new Set(sut?.tools_requested || []);
  for (const tool of scenario?.expected_tool_behavior?.required || []) if (!requested.has(tool)) failures.push(`missing_required_tool:${tool}`);
  for (const tool of scenario?.expected_tool_behavior?.forbidden || []) if (requested.has(tool)) failures.push(`forbidden_tool:${tool}`);
  if (Number(sut?.write_attempts || 0) !== 0) failures.push('read_only_write');
  if (sut?.invalid_action_arguments_reached_write_layer) failures.push('invalid_action_arguments');
  if (scenario?.language && sut?.language && scenario.language !== sut.language) failures.push('wrong_language');
  if (scenario?.critical_invariants?.includes('critical_human_escalation') && !sut?.requires_human) failures.push('ignored_critical_escalation');
  if ((scenario?.expected_tool_behavior?.required || []).includes('external_search')) {
    const expectedStatus = { NO_RESULTS: 'no_results', UNAVAILABLE: 'unavailable', TIMEOUT: 'error', ERROR: 'error', PARTIAL_SUCCESS: 'success', SUCCESS: 'success' }[scenario.fixture_profile];
    const actualStatus = sut?.tool_statuses?.external_search;
    if (expectedStatus && actualStatus && actualStatus !== expectedStatus) failures.push(`fixture_status_mismatch:${expectedStatus}`);
  }
  return { passed: failures.length === 0, critical: failures.some((failure) => /fabricated|write|invalid_action|ignored_critical|forbidden_tool/.test(failure)), failures };
}
