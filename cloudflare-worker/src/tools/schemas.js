// The semantic controller can request only these conceptual capabilities.  It
// never provides a provider name, URL, credential, record ID, or arbitrary
// execution field.
export const TOOL_NAMES = Object.freeze([
  'hotel_facts',
  'hotel_services',
  'external_search',
  'guest_request',
  'human_takeover',
]);

export const TOOL_STATUSES = Object.freeze([
  'success',
  'not_found',
  'no_results',
  'unavailable',
  'error',
  'invalid',
  'not_needed',
  'prepared',
  'read_only',
]);

export const SERVICE_CATEGORIES = Object.freeze([
  'accommodation', 'spa', 'restaurant', 'transport', 'tour', 'experience',
  'itinerary', 'housekeeping', 'maintenance',
]);

export const FACT_CATEGORIES = Object.freeze([
  'general', 'hotel', 'check_in', 'check_out', 'breakfast', 'wifi', 'parking',
  'policies', 'hours', 'location', 'accessibility',
]);

export const REQUEST_TYPES = Object.freeze([
  'Housekeeping', 'Maintenance', 'Spa & Wellness', 'Transport', 'Dining',
  'Concierge', 'General Manager',
]);

const TOOL_SET = new Set(TOOL_NAMES);
const SERVICE_CATEGORY_SET = new Set(SERVICE_CATEGORIES);
const FACT_CATEGORY_SET = new Set(FACT_CATEGORIES);
const REQUEST_TYPE_SET = new Set(REQUEST_TYPES);

function cleanText(value, max = 240) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function arrayOfAllowed(values, allowed, max = 3) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => cleanText(value, 48)).filter((value) => allowed.has(value)))].slice(0, max);
}

export function toolResult(tool, status, { data = null, errorCode = null, meta = {} } = {}) {
  return {
    tool: TOOL_SET.has(tool) ? tool : 'unknown',
    status: TOOL_STATUSES.includes(status) ? status : 'error',
    data,
    error_code: errorCode ? cleanText(errorCode, 80) : null,
    meta: meta && typeof meta === 'object' ? meta : {},
  };
}

export function validateToolRequest(request) {
  const tool = cleanText(request?.tool, 48);
  const input = request?.input && typeof request.input === 'object' && !Array.isArray(request.input) ? request.input : {};
  if (!TOOL_SET.has(tool)) return { valid: false, tool, reason: 'unsupported_tool' };

  if (tool === 'hotel_facts') {
    const category = FACT_CATEGORY_SET.has(cleanText(input.category, 48)) ? cleanText(input.category, 48) : 'general';
    return { valid: true, tool, input: { category } };
  }
  if (tool === 'hotel_services') {
    const categories = arrayOfAllowed(input.categories ?? [input.category], SERVICE_CATEGORY_SET);
    return { valid: true, tool, input: { categories } };
  }
  if (tool === 'external_search') {
    const category = SERVICE_CATEGORY_SET.has(cleanText(input.category, 48)) ? cleanText(input.category, 48) : 'experience';
    const language = ['en', 'fr', 'es', 'it', 'de', 'ar', 'ja', 'zh'].includes(cleanText(input.language, 8)) ? cleanText(input.language, 8) : 'en';
    const query = cleanText(input.query, 180);
    if (!query) return { valid: false, tool, reason: 'missing_query' };
    return {
      valid: true,
      tool,
      input: {
        query,
        category,
        location: cleanText(input.location, 100),
        constraints: arrayOfAllowed(input.constraints, new Set(['open_late', 'romantic', 'quiet', 'non_touristy', 'cuisine', 'accessible']), 4),
        language,
      },
    };
  }
  if (tool === 'guest_request') {
    const type = REQUEST_TYPE_SET.has(cleanText(input.type, 48)) ? cleanText(input.type, 48) : '';
    const partySize = Number(input.party_size);
    if (!type || !cleanText(input.summary, 600)) return { valid: false, tool, reason: 'invalid_request_fields' };
    return {
      valid: true,
      tool,
      input: {
        type,
        service: cleanText(input.service, 140),
        summary: cleanText(input.summary, 600),
        requested_time: cleanText(input.requested_time, 80),
        party_size: Number.isInteger(partySize) && partySize > 0 && partySize <= 20 ? partySize : null,
      },
    };
  }
  const reason = cleanText(input.reason, 240);
  return reason
    ? { valid: true, tool, input: { reason, priority: ['routine', 'sensitive', 'urgent'].includes(cleanText(input.priority, 16)) ? cleanText(input.priority, 16) : 'routine' } }
    : { valid: false, tool, reason: 'missing_escalation_reason' };
}

export function serviceCategoryList(value) {
  return arrayOfAllowed(Array.isArray(value) ? value : [value], SERVICE_CATEGORY_SET);
}
