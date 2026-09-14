import { runExternalSearch } from './external-search/index.js';
import { runGuestRequest } from './guest-request.js';
import { runHotelFacts } from './hotel-facts.js';
import { runHotelServices } from './hotel-services.js';
import { runHumanTakeover } from './human-takeover.js';
import { serviceCategoryList, toolResult, validateToolRequest } from './schemas.js';

function requestTypeFor(category, needsHuman) {
  if (category === 'housekeeping') return 'Housekeeping';
  if (category === 'maintenance') return 'Maintenance';
  if (category === 'spa') return 'Spa & Wellness';
  if (category === 'transport') return 'Transport';
  if (category === 'restaurant') return 'Dining';
  return needsHuman ? 'General Manager' : 'Concierge';
}

function requestSummary(message, category) {
  return `${category || 'Concierge'} request: ${String(message ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 520)}`;
}

function compactTerms(values = [], max = 4) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean))].slice(0, max);
}

function searchQueryForPlan(input, plan) {
  // The model's validated state can refine a search, but it never provides a
  // provider, URL, or executable action. The current guest words remain the
  // primary query so a stale context summary cannot replace the current ask.
  return compactTerms([
    input.message,
    ...(plan?.activeConstraints || []),
    ...(plan?.preferenceConstraints || []),
    plan?.locationConstraint,
    plan?.timeConstraint,
  ], 8).join(' ').slice(0, 180);
}

// Convert a strict semantic plan into a bounded set of allowlisted requests.
// There is intentionally no autonomous recursion or model-controlled adapter.
export function buildToolRequests({ plan, classification = {}, input = {} }) {
  const needs = plan?.toolNeeds || {};
  const categories = serviceCategoryList(plan?.serviceCategories?.length ? plan.serviceCategories : (plan?.serviceCategory || classification.category));
  const requested = [];
  if (needs.hotelFacts) requested.push({ tool: 'hotel_facts', input: { category: 'general' } });
  if (needs.hotelServices) requested.push({ tool: 'hotel_services', input: { categories } });
  if (needs.externalSearch) requested.push({
    tool: 'external_search',
    input: {
      query: searchQueryForPlan(input, plan),
      category: plan?.serviceCategory || classification.category || 'experience',
      location: plan?.locationConstraint || classification.location || '',
      constraints: classification.cuisine ? ['cuisine'] : [],
      language: input.language || 'en',
    },
  });
  if (needs.guestRequest) requested.push({
    tool: 'guest_request',
    input: {
      type: requestTypeFor(plan?.serviceCategory || classification.category, needs.humanTakeover),
      service: plan?.guestGoal || '',
      summary: requestSummary(input.message, plan?.serviceCategory || classification.category),
      requested_time: '',
      party_size: null,
    },
  });
  if (needs.humanTakeover) requested.push({
    tool: 'human_takeover',
    input: { reason: plan?.guestGoal || 'Guest requires staff attention', priority: plan?.interactionType === 'complaint' ? 'urgent' : 'sensitive' },
  });
  return requested.slice(0, 5);
}

export function createToolExecutor(dependencies = {}) {
  return {
    async execute(requests = []) {
      const results = [];
      for (const request of requests.slice(0, 5)) {
        const validated = validateToolRequest(request);
        if (!validated.valid) {
          results.push(toolResult(validated.tool || request?.tool, 'invalid', { errorCode: validated.reason }));
          continue;
        }
        const args = { input: validated.input, ...dependencies };
        if (validated.tool === 'hotel_facts') results.push(await runHotelFacts(args));
        else if (validated.tool === 'hotel_services') results.push(await runHotelServices(args));
        else if (validated.tool === 'external_search') results.push(await runExternalSearch(args));
        else if (validated.tool === 'guest_request') results.push(await runGuestRequest(args));
        else if (validated.tool === 'human_takeover') results.push(await runHumanTakeover(args));
      }
      return results;
    },
  };
}

export function toolResultMap(results = []) {
  return Object.fromEntries(results.map((result) => [result.tool, result]));
}
