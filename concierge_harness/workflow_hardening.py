"""Idempotently harden the canonical n8n workflow for safe regression testing.

This module is deliberately data-driven rather than a second workflow export: it
updates only the known ConciergeFlow nodes, validates the graph, and writes the
same canonical JSON that the deploy command uses.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CANONICAL = ROOT / "lllll.json"
BACKUP_DIR = ROOT / "concierge_harness" / "backups"

INBOUND_GATE = "Test Gate · Inbound Log"
AI_LOG_GATE = "Test Gate · AI Logs"
REQUEST_GATE = "Test Gate · Request Creation"


def _node_map(workflow: dict) -> dict:
    return {node["name"]: node for node in workflow.get("nodes", [])}


def _code_node(name: str, node_id: str, position: list[int], js_code: str, notes: str) -> dict:
    return {
        "parameters": {"jsCode": js_code},
        "id": node_id,
        "name": name,
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": position,
        "notes": notes,
    }


def _ensure_node(workflow: dict, node: dict) -> None:
    nodes = _node_map(workflow)
    existing = nodes.get(node["name"])
    if existing is None:
        workflow["nodes"].append(node)
    else:
        existing.clear()
        existing.update(node)


def _connection(*targets: str) -> dict:
    return {
        "main": [[{"node": target, "type": "main", "index": 0} for target in targets]]
    }


def _node_name_containing(nodes: dict, fragment: str) -> str:
    matches = [name for name in nodes if fragment in name]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one node containing {fragment!r}, got {matches!r}")
    return matches[0]


def harden_external_search(workflow: dict) -> None:
    """Add a factual on-demand web-search branch without contaminating partner data."""
    nodes = _node_map(workflow)
    lookup_services = _node_name_containing(nodes, "Lookup Services")
    fetch_history = _node_name_containing(nodes, "Fetch History")
    response_node = _node_name_containing(nodes, "Respond")

    # Search is invoked only after an empty partner lookup and only for a
    # concrete service intent.  The old export pretended live search occurred;
    # this branch returns actual, structured Google results from ScrapingBee.
    nodes["Check Results"]["parameters"]["jsCode"] = r"""
const query = $items('Build Service Query', 0, 0)[0]?.json || $json;
const rows = $input.all().map(item => item.json);
const normalized = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const textValue = value => Array.isArray(value) ? value.map(textValue).join(' ') : (value && typeof value === 'object' ? JSON.stringify(value) : String(value || ''));
function serviceFrom(row) {
  const f = row.fields || row.json?.fields || row.json || row || {};
  return {
    name: f.Name || f.name || '', category: f.Category || f.category || '',
    description: f.Description || f.description || '',
    tags: f.Tags || f.tags || '', sub_type: f.SubType || f['Sub Type'] || f.sub_type || '',
    price: f.PriceEUR ?? f['Price EUR'] ?? null,
    duration: f.DurationMins ?? f['Duration (mins)'] ?? null,
    location: f.Location || f.location || '', phone: f.PhoneNumber || f['Phone Number'] || '',
  };
}
const catalogServices = rows.map(serviceFrom).filter(service => service.name);
const cuisineTerms = Array.isArray(query.cuisine_terms) ? query.cuisine_terms.map(normalized).filter(Boolean) : [];
// A named cuisine is a hard catalog constraint.  A broad Restaurant record is
// not a valid match unless its own fields explicitly establish that cuisine.
const matchesCuisine = service => !cuisineTerms.length || cuisineTerms.some(term =>
  normalized([service.name, service.category, service.description, textValue(service.tags), service.sub_type].join(' ')).includes(term)
);
const services = catalogServices.filter(matchesCuisine);
const excludedPartnerNames = catalogServices.filter(service => !matchesCuisine(service)).map(service => service.name);
const foundPartners = services.length > 0;
const fmtPrice = value => value == null || value === '' ? 'price on request' : `EUR ${Number(value).toFixed(0)}`;
const formattedServices = foundPartners
  ? services.map((service, index) => `${index + 1}. ${service.name} (${service.category}) - ${fmtPrice(service.price)}${service.duration ? `, ${service.duration} min` : ''}\n   ${service.description || ''}`.trimEnd()).join('\n\n')
  : '(no matching partner services found in the hotel catalog)';
return [{ json: {
  ...query, found_partners: foundPartners,
  needs_scrape: !foundPartners && Boolean(query.has_service_intent),
  services_count: services.length, services_raw: services, excluded_partner_names: excludedPartnerNames,
  formatted_services_for_ai: formattedServices,
} }];
""".strip()

    _ensure_node(
        workflow,
        {
            "parameters": {
                "conditions": {
                    "combinator": "and",
                    "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                    "conditions": [{
                        "leftValue": "={{ $json.needs_scrape }}",
                        "rightValue": True,
                        "operator": {"type": "boolean", "operation": "equals"},
                    }],
                },
                "options": {},
            },
            "id": "8215b601-8d4f-429f-a874-3d21df01d0a1",
            "name": "IF External Search Needed",
            "type": "n8n-nodes-base.if",
            "typeVersion": 2,
            "position": [-600, 304],
            "notes": "Routes only unmatched service requests to the external-search provider.",
        },
    )
    _ensure_node(
        workflow,
        _code_node(
            "Build External Search",
            "8215b601-8d4f-429f-a874-3d21df01d0a2",
            [-400, 176],
            r"""
const city = String($json.hotel_city || 'Paris').trim();
const subject = String($json.category || 'local service').trim();
const guestTerms = String($json.message || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 220);
const search = `${subject} ${city} ${guestTerms}`.replace(/\s+/g, ' ').trim();
return [{ json: { ...$json, external_search_query: search, external_search_attempted: true } }];
""".strip(),
            "Builds a bounded, location-specific query. The guest message is never treated as a trusted result.",
        ),
    )
    _ensure_node(
        workflow,
        {
            "parameters": {
                "method": "GET",
                "url": "https://app.scrapingbee.com/api/v1/store/google",
                "sendHeaders": True,
                "headerParameters": {
                    "parameters": [{"name": "Authorization", "value": "={{ 'Bearer ' + $env.SCRAPINGBEE_API_KEY }}"}]
                },
                "sendQuery": True,
                "queryParameters": {
                    "parameters": [
                        {"name": "search", "value": "={{ $json.external_search_query }}"},
                        {"name": "country_code", "value": "fr"},
                        {"name": "language", "value": "en"},
                        {"name": "light_request", "value": "true"},
                    ]
                },
                "options": {"timeout": 30000, "response": {"response": {"responseFormat": "json"}}},
            },
            "id": "8215b601-8d4f-429f-a874-3d21df01d0a3",
            "name": "HTTP External Search",
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 4.2,
            "position": [-176, 176],
            "onError": "continueRegularOutput",
            "notes": "Uses ScrapingBee's structured Google API (light request), not fragile Google HTML scraping.",
        },
    )
    _ensure_node(
        workflow,
        _code_node(
            "Parse External Search",
            "8215b601-8d4f-429f-a874-3d21df01d0a4",
            [48, 176],
            r"""
let context = {};
try { context = $('Build External Search').first().json || {}; } catch (_) { context = {}; }
const raw = $input.first()?.json || {};
const seen = new Set();
const options = [];
function add(result, kind) {
  const name = String(result.title || result.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  // Organic Google hits are often listicles and directory pages, not a
  // bookable venue.  Only structured local/hotel records are safe to offer.
  if (kind === 'organic' || /\b(best|top|meilleurs?|restaurants? indiens?|tripadvisor|thefork|guide)\b/i.test(name)) return;
  if (!name || seen.has(name.toLowerCase())) return;
  seen.add(name.toLowerCase());
  options.push({
    name,
    rating: result.review ?? result.rating ?? null,
    reviews_count: result.review_count ?? result.reviews_count ?? null,
    address: result.address || 'Paris (address to be verified by the hotel team)',
    link: result.website || result.url || null,
    snippet: String(result.description || result.snippet || '').slice(0, 260),
    category: context.category || 'other', source: 'external_web_search', result_kind: kind,
    availability: 'not verified',
  });
}
for (const result of Array.isArray(raw.local_results) ? raw.local_results : []) add(result, 'local');
for (const result of Array.isArray(raw.hotel_results) ? raw.hotel_results : []) add(result, 'hotel');
const external = options.slice(0, 5);
const formatted = external.length
  ? `Required cuisine or specialty: ${context.requested_cuisine || 'none'}\n` + external.map((item, index) => `${index + 1}. ${item.name} - EXTERNAL, NON-PARTNER OPTION${item.rating != null ? `; rating ${item.rating}${item.reviews_count ? ` (${item.reviews_count} reviews)` : ''}` : ''}${item.address ? `; ${item.address}` : ''}${item.snippet ? `\n   ${item.snippet}` : ''}`).join('\n\n')
  : '(the external search returned no usable options)';
return [{ json: {
  ...context, external_search_attempted: true, external_search_success: external.length > 0,
  external_options: external, external_options_count: external.length,
  formatted_external_for_ai: formatted,
} }];
""".strip(),
            "Normalizes structured results. It never marks external providers as hotel partners or confirms availability.",
        ),
    )

    shape = nodes["Shape History"]["parameters"]["jsCode"]
    old_context = "let context = {};\ntry { context = $('Check Results').first().json || {}; } catch (_) { context = {}; }\n"
    new_context = (
        "let context = {};\n"
        "try { const external = $('Parse External Search').first().json || {}; if (external.external_search_attempted) context = external; } catch (_) {}\n"
        "if (!context.user_id) { try { context = $('Check Results').first().json || {}; } catch (_) { context = {}; } }\n"
    )
    if old_context in shape:
        nodes["Shape History"]["parameters"]["jsCode"] = shape.replace(old_context, new_context, 1)
    elif "Parse External Search" not in shape:
        raise ValueError("Could not preserve external results in Shape History")

    nodes["Build AI Context"]["parameters"]["jsCode"] = r"""
let context = {};
try { context = $('Shape History').first().json || {}; } catch (_) { context = $json; }
const rows = $input.all().map(item => item.json);
const facts = rows.map(item => item.fields || item.json?.fields || item.json || item || {})
  .filter(fields => fields.Key)
  .map(fields => `- ${fields.Key}: ${fields.Value ?? ''}`).join('\n');
context.hotel_facts = facts || context.hotel_facts || '(hotel facts not loaded)';
const userMessage = [
  '=== GUEST MESSAGE ===', context.message || '',
  '=== REQUIRED CUISINE OR SPECIALTY (hard constraint; none means no constraint) ===', context.requested_cuisine || 'none',
  '=== CONVERSATION HISTORY ===', context.history_text || '(no history)',
  '=== PARTNER SERVICES (preferred, hotel catalog) ===', context.formatted_services_for_ai || '(no matching partners)',
  '=== EXTERNAL SEARCH RESULTS (non-partner; availability and prices are unverified) ===', context.formatted_external_for_ai || '(no external search performed)',
  '=== HOTEL FACTS ===', context.hotel_facts,
  '=== INSTRUCTIONS ===', 'Reply in the guest language. A required cuisine or specialty is a hard constraint: never offer or reuse a venue that does not explicitly match it, even if it appears in history. Prefer matching partner services. If external options are present, name only those options and state that the hotel team will verify availability. Output JSON only.',
].join('\n\n');
return [{ json: { ...context, ai_user_message: userMessage, ai_temperature: 0.3, ai_model_hint: 'qwen/qwen3.6-27b' } }];
""".strip()

    groq_name = _node_name_containing(nodes, "Groq")
    groq = nodes[groq_name]["parameters"]["jsCode"]
    concise_system_prompt = r'''const SYSTEM_PROMPT = `You are the hotel's concierge. Return JSON only, never Markdown.

Rules: Reply entirely in the language of the latest guest message. Use only facts in PARTNER SERVICES, EXTERNAL SEARCH RESULTS, HOTEL FACTS, and conversation history. A REQUIRED CUISINE OR SPECIALTY is a hard constraint: never recommend, reuse, or create a request for a venue that does not explicitly match it, even if it appears in conversation history. Prefer matching partner services. If a listed partner has a known price, state it. Never say a booking or availability is confirmed; say the hotel team will verify and confirm it. External results are non-partner suggestions: mention only their exact names, never invent a price, rating, address, URL, or availability. If no external options exist, say the team will research them.

JSON schema: {"reply_text":"string","language_detected":"ISO-639-1","intent":"faq|service_request|smalltalk|other","service_type":"spa|restaurant|tour|transport|experience|other|null","requests":[{"service_name":"string|null","source":"partner|external|other","summary":"staff action","est_value_eur":null,"is_upsell":false}],"requires_human":true}`;'''
    groq, prompt_replacements = re.subn(
        r"const SYSTEM_PROMPT = `.*?`;",
        concise_system_prompt,
        groq,
        count=1,
        flags=re.DOTALL,
    )
    if prompt_replacements != 1:
        raise ValueError("Could not install the concise concierge system prompt")
    nodes[groq_name]["parameters"]["jsCode"] = groq

    nodes[response_node]["parameters"]["responseBody"] = (
        "={{ { reply: $json.reply_text, language: $json.language_detected, intent: $json.intent, "
        "external_option_names: $json.test_mode ? (($json.external_options || []).map(option => option.name)) : [], "
        "provider_failure: $json.test_mode ? ($json.groq_failure_code || null) : null } }}"
    )

    connections = workflow.setdefault("connections", {})
    connections[lookup_services] = _connection("Check Results")
    connections["Check Results"] = _connection("IF External Search Needed")
    connections["IF External Search Needed"] = {
        "main": [
            [{"node": "Build External Search", "type": "main", "index": 0}],
            [{"node": fetch_history, "type": "main", "index": 0}],
        ]
    }
    connections["Build External Search"] = _connection("HTTP External Search")
    connections["HTTP External Search"] = _connection("Parse External Search")
    connections["Parse External Search"] = _connection(fetch_history)


def harden(workflow: dict) -> dict:
    """Apply the narrow, repeatable workflow changes and return the workflow."""
    nodes = _node_map(workflow)
    required = {
        "Normalize Incoming",
        "Build Service Query",
        "Groq · Ultra-Fast AI (70B)",
        "Parse AI Output",
        "Airtable · Log Inbound",
        "Airtable · Log AI Reply (Background)",
        "Airtable · Create Requests (Background)",
        "Respond · Web Widget (INSTANT)",
    }
    missing = sorted(required - set(nodes))
    if missing:
        raise ValueError(f"Unexpected workflow shape; required nodes missing: {missing}")

    normalize = nodes["Normalize Incoming"]["parameters"]["jsCode"]
    old_normalize_return = (
        "const user_id = `${prefix}:${userIdRaw}`;\n"
        "return [{ json: { user_id, channel, message, language, guest_name: guestName, "
        "received_at: new Date().toISOString(), raw: body } }];"
    )
    new_normalize_return = (
        "const user_id = `${prefix}:${userIdRaw}`;\n"
        "const requestedTestMode = String(body.testMode || '');\n"
        "const test_mode = ['read_only', 'write_verified'].includes(requestedTestMode) ? requestedTestMode : null;\n"
        "const test_run_id = String(body.testRunId || '').slice(0, 80);\n"
        "return [{ json: { user_id, channel, message, language, guest_name: guestName, "
        "received_at: new Date().toISOString(), test_mode, test_run_id, raw: body } }];"
    )
    if old_normalize_return in normalize:
        nodes["Normalize Incoming"]["parameters"]["jsCode"] = normalize.replace(
            old_normalize_return, new_normalize_return
        )
    elif "test_mode" not in normalize:
        raise ValueError("Could not find the expected Normalize Incoming return statement")

    normalize = nodes["Normalize Incoming"]["parameters"]["jsCode"]
    if "function inferLanguage" not in normalize:
        language_helper = (
            "function inferLanguage(text) {\n"
            "  const value = String(text || '').toLowerCase();\n"
            "  if (/[\\u0600-\\u06ff]/.test(value)) return 'ar';\n"
            "  if (/[\\u3040-\\u30ff]/.test(value)) return 'ja';\n"
            "  if (/[\\u4e00-\\u9fff]/.test(value)) return 'zh';\n"
            "  if (/\\b(hallo|wie geht|ihnen|bitte|danke)\\b/.test(value)) return 'de';\n"
            "  if (/\\b(avete|disponibilita|cena|stasera|vorrei)\\b/.test(value)) return 'it';\n"
            "  if (/\\b(necesito|aeropuerto|manana|quiero|reserva)\\b/.test(value)) return 'es';\n"
            "  if (/\\b(quel|prix|demain|bonjour|voudrais|reserver)\\b/.test(value)) return 'fr';\n"
            "  return 'en';\n"
            "}\n"
        )
        marker = "if (!message || !message.trim()) message = '[empty or unsupported message]';\n"
        if marker not in normalize:
            raise ValueError("Could not add deterministic language hint")
        normalize = normalize.replace(marker, marker + language_helper + "language = language || inferLanguage(message);\n", 1)
        nodes["Normalize Incoming"]["parameters"]["jsCode"] = normalize

    query = nodes["Build Service Query"]["parameters"]["jsCode"]
    old_query_return = (
        "return [{ json: { category: primaryCategory, filterByFormula: formula, "
        "has_service_intent: hasServiceIntent, message: $json.message, language: $json.language, "
        "user_id: $json.user_id, channel: $json.channel } }];"
    )
    new_query_return = (
        "return [{ json: { ...$json, category: primaryCategory, filterByFormula: formula, "
        "has_service_intent: hasServiceIntent } }];"
    )
    if old_query_return in query:
        nodes["Build Service Query"]["parameters"]["jsCode"] = query.replace(
            old_query_return, new_query_return
        )
    elif "...$json" not in query:
        raise ValueError("Could not find the expected Build Service Query return statement")

    query = nodes["Build Service Query"]["parameters"]["jsCode"]
    if "externalDiscoveryTerms" not in query:
        query = query.replace(
            "let formula = primaryCategory ? `AND({Active}=TRUE(), {Category}=\"${primaryCategory}\")` : `{Active}=TRUE()`;",
            "let formula = primaryCategory ? `AND({Active}=TRUE(), {Category}=\"${primaryCategory}\")` : 'FALSE()';",
            1,
        )
        old_intent = "const hasServiceIntent = !isTrivialGreeting && (!!primaryCategory || requestVerbs.some(v => msg.includes(v)));"
        new_intent = (
            "const externalDiscoveryTerms = ['pub', 'bar', 'live music', 'nightlife', 'concert', 'theatre', 'theater', 'club', 'escape room', 'pizza', 'sushi', 'vegan'];\n"
            "const hasServiceIntent = !isTrivialGreeting && (!!primaryCategory || requestVerbs.some(v => msg.includes(v)) || externalDiscoveryTerms.some(v => msg.includes(v)));"
        )
        if old_intent not in query:
            raise ValueError("Could not add out-of-catalog search intent detection")
        query = query.replace(old_intent, new_intent, 1)
        nodes["Build Service Query"]["parameters"]["jsCode"] = query

    query = nodes["Build Service Query"]["parameters"]["jsCode"]
    if "requested_cuisine" not in query:
        cuisine_detection = (
            "const CUISINES = [\n"
            "  { id: 'indian', terms: ['indian', 'indien', 'indienne', 'indiano', 'indiana', '\\u0647\\u0646\\u062f\\u064a', '\\u30a4\\u30f3\\u30c9\\u6599\\u7406', '\\u5370\\u5ea6\\u83dc'] },\n"
            "  { id: 'japanese', terms: ['japanese', 'japonais', 'japonaise', 'giapponese', 'japones', '\\u65e5\\u672c\\u6599\\u7406', 'sushi'] },\n"
            "  { id: 'italian', terms: ['italian', 'italien', 'italienne', 'italiano', 'italiana', 'pizza'] },\n"
            "  { id: 'vegan', terms: ['vegan', 'vegetalien', 'vegano', '\\u30f4\\u30a3\\u30fc\\u30ac\\u30f3'] },\n"
            "  { id: 'vegetarian', terms: ['vegetarian', 'vegetarien', 'vegetariano', '\\u30d9\\u30b8\\u30bf\\u30ea\\u30a2\\u30f3'] },\n"
            "  { id: 'thai', terms: ['thai', 'thailandais', 'tailandese'] },\n"
            "  { id: 'chinese', terms: ['chinese', 'chinois', 'chino', '\\u4e2d\\u56fd\\u6599\\u7406', '\\u4e2d\\u83dc'] },\n"
            "  { id: 'halal', terms: ['halal', '\\u062d\\u0644\\u0627\\u0644'] },\n"
            "];\n"
            "const requestedCuisine = CUISINES.find(cuisine => cuisine.terms.some(term => matchesKeyword(msg, term))) || null;\n"
        )
        marker = "const hasServiceIntent = !isTrivialGreeting && (!!primaryCategory || requestVerbs.some(v => msg.includes(v)) || externalDiscoveryTerms.some(v => msg.includes(v)));\n"
        if marker not in query:
            raise ValueError("Could not add cuisine constraint detection")
        query = query.replace(marker, cuisine_detection + marker, 1)
        old_return = "has_service_intent: hasServiceIntent } }];"
        new_return = "has_service_intent: hasServiceIntent, requested_cuisine: requestedCuisine?.id || null, cuisine_terms: requestedCuisine?.terms || [] } }];"
        if old_return not in query:
            raise ValueError("Could not return cuisine constraint")
        query = query.replace(old_return, new_return, 1)
        nodes["Build Service Query"]["parameters"]["jsCode"] = query

    groq = nodes["Groq · Ultra-Fast AI (70B)"]["parameters"]["jsCode"]
    groq, model_replacements = re.subn(
        r"const GROQ_MODEL = '[^']+';",
        "const GROQ_MODEL = $env.GROQ_MODEL || 'qwen/qwen3.6-27b';\nconst GROQ_FALLBACK_MODEL = $env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b';",
        groq,
        count=1,
    )
    groq = groq.replace(
        "const GROQ_MODEL = $env.GROQ_MODEL || 'llama-3.3-70b-versatile';",
        "const GROQ_MODEL = $env.GROQ_MODEL || 'qwen/qwen3.6-27b';\nconst GROQ_FALLBACK_MODEL = $env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b';",
    )
    groq = groq.replace(
        "const GROQ_MODEL = $env.GROQ_MODEL || 'llama-3.1-8b-instant';",
        "const GROQ_MODEL = $env.GROQ_MODEL || 'qwen/qwen3.6-27b';\nconst GROQ_FALLBACK_MODEL = $env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b';",
    )
    if model_replacements == 0 and "const GROQ_MODEL = $env.GROQ_MODEL || 'qwen/qwen3.6-27b';" not in groq:
        raise ValueError("Could not configure the Groq model fallback")
    groq, replacements = re.subn(
        r"const GROQ_API_KEY = '[^']*';",
        "const GROQ_API_KEY = $env.GROQ_API_KEY || '';",
        groq,
        count=1,
    )
    if replacements == 0 and "const GROQ_API_KEY = $env.GROQ_API_KEY || '';" not in groq:
        raise ValueError("Could not replace the literal provider key")
    if "# REQUEST CAPTURE" not in groq and "JSON schema:" not in groq:
        marker = "# MEMORY & LANGUAGE"
        insertion = (
            "# REQUEST CAPTURE (lead only)\\n"
            "Never say a booking or availability is confirmed. For a clear service request, say the team will confirm it and output one request for staff. Use source=partner when a listed partner is offered and est_value_eur when its price is known.\\n\\n"
        )
        if marker not in groq:
            raise ValueError("Could not find the system-prompt insertion point")
        groq = groq.replace(marker, insertion + marker, 1)
        groq = groq.replace(
            '"requests":[{"service_name":"<string|null>","summary":"<string>","is_upsell":<boolean>}]',
            '"requests":[{"service_name":"<string|null>","source":"<partner|other>","summary":"<staff action>","est_value_eur":<number|null>,"is_upsell":<boolean>}]',
            1,
        )
    groq = groq.replace("temperature: 0.4, max_tokens: 700,", "temperature: 0.2, max_tokens: 260,")
    groq = groq.replace("temperature: 0.3, max_tokens: 420,", "temperature: 0.2, max_tokens: 260,")
    if "function _requestForModel" not in groq:
        old_call = (
            "async function _callGroq() {\n"
            "  return await _helpers.httpRequest({ method: 'POST', url: GROQ_URL, headers: { 'Authorization': 'Bearer ' + GROQ_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody), json: true, timeout: 15000 });\n"
            "}"
        )
        new_call = (
            "function _requestForModel(model) {\n"
            "  const options = model.startsWith('qwen/') ? { reasoning_effort: 'none', reasoning_format: 'hidden' }\n"
            "    : (model.startsWith('openai/gpt-oss-') ? { reasoning_effort: 'low', reasoning_format: 'hidden' } : {});\n"
            "  return { ...requestBody, model, ...options };\n"
            "}\n"
            "async function _callGroq(model) {\n"
            "  return await _helpers.httpRequest({ method: 'POST', url: GROQ_URL, headers: { 'Authorization': 'Bearer ' + GROQ_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(_requestForModel(model)), json: true, timeout: 15000 });\n"
            "}"
        )
        if old_call not in groq:
            raise ValueError("Could not install model-specific Groq request options")
        groq = groq.replace(old_call, new_call, 1)
        groq = groq.replace("let aiContent = '';", "let aiContent = '';\nlet ai_model_used = '';", 1)
        groq = groq.replace(
            "  try {\n    const response = await _callGroq();",
            "  try {\n    const selectedModel = attempt < 3 ? GROQ_MODEL : GROQ_FALLBACK_MODEL;\n    const response = await _callGroq(selectedModel);\n    ai_model_used = selectedModel;",
            1,
        )
        groq = groq.replace(
            "return [{ json: { ...context, message: { content: aiContent }, ai_raw: aiContent, groq_failure_code } }];",
            "return [{ json: { ...context, message: { content: aiContent }, ai_raw: aiContent, groq_failure_code, ai_model_used } }];",
            1,
        )
    if "let groq_failure_code = '';" not in groq:
        groq = groq.replace(
            "let aiContent = '';\nfor (let attempt",
            "let aiContent = '';\nlet groq_failure_code = '';\nfor (let attempt",
            1,
        )
        groq = groq.replace(
            "  } catch (e) { aiContent = ''; }",
            "  } catch (e) {\n"
            "    const status = Number(e?.statusCode || e?.status || e?.response?.statusCode || e?.response?.status || 0);\n"
            "    groq_failure_code = Number.isFinite(status) && status > 0 ? `http_${status}` : 'request_error';\n"
            "    aiContent = '';\n"
            "  }",
            1,
        )
        groq = groq.replace(
            "return [{ json: { ...context, message: { content: aiContent }, ai_raw: aiContent } }];",
            "return [{ json: { ...context, message: { content: aiContent }, ai_raw: aiContent, groq_failure_code } }];",
            1,
        )
    nodes["Groq · Ultra-Fast AI (70B)"]["parameters"]["jsCode"] = groq

    parse_output = nodes["Parse AI Output"]["parameters"]["jsCode"]
    language_expression = "language_detected: normalizeLanguage($json.language || parsed.language_detected || 'unknown'),"
    if "function normalizeLanguage(value)" not in parse_output:
        normalizer = (
            "function normalizeLanguage(value) {\n"
            "  const raw = String(value || '').trim().toLowerCase();\n"
            "  const aliases = { english: 'en', french: 'fr', spanish: 'es', german: 'de', italian: 'it', japanese: 'ja', chinese: 'zh', arabic: 'ar' };\n"
            "  return aliases[raw] || raw.split(/[-_]/)[0].slice(0, 2) || 'unknown';\n"
            "}\n"
        )
        parse_output = normalizer + parse_output
    parse_output = re.sub(
        r"language_detected: str\(parsed\.language_detected \|\| 'unknown'\)(?:\.slice\(0, 5\)\.toLowerCase\(\)|\.toLowerCase\(\)\.split\(/\[-_\]/\)\[0\]\.slice\(0, 2\)),",
        language_expression,
        parse_output,
        count=1,
    )
    parse_output = parse_output.replace(
        "language_detected: normalizeLanguage(parsed.language_detected || 'unknown'),",
        language_expression,
        1,
    )
    if language_expression not in parse_output:
        raise ValueError("Could not normalize the model language code")
    nodes["Parse AI Output"]["parameters"]["jsCode"] = parse_output

    _ensure_node(
        workflow,
        _code_node(
            INBOUND_GATE,
            "7b6d2a3e-f210-4d74-8b95-ced6a8b9e001",
            [-1120, 608],
            "// Regression traffic must never pollute the live Conversations table.\n"
            "return $json.test_mode === 'read_only' ? [] : $input.all();",
            "Blocks read-only regression traffic; production and write-audit traffic pass through.",
        ),
    )
    _ensure_node(
        workflow,
        _code_node(
            AI_LOG_GATE,
            "7b6d2a3e-f210-4d74-8b95-ced6a8b9e002",
            [848, 520],
            "// Keep normal production logging, but make broad regressions read-only.\n"
            "return $json.test_mode === 'read_only' ? [] : $input.all();",
            "Blocks read-only regression traffic before assistant and request writes.",
        ),
    )
    _ensure_node(
        workflow,
        _code_node(
            REQUEST_GATE,
            "7b6d2a3e-f210-4d74-8b95-ced6a8b9e003",
            [1088, 520],
            "// Only explicit AI lead records may reach Airtable Requests.\n"
            "return Array.isArray($json.requests) && $json.requests.length > 0 ? $input.all() : [];",
            "Prevents blank Request rows for greetings, FAQs, and provider failures.",
        ),
    )
    _ensure_node(
        workflow,
        _code_node(
            "Enforce Concierge Contract",
            "7b6d2a3e-f210-4d74-8b95-ced6a8b9e004",
            [640, 304],
            r"""
const result = { ...$json };
const options = Array.isArray(result.external_options) ? result.external_options.filter(option => option?.name) : [];
let reply = String(result.reply_text || '').trim();
const normalized = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const cuisine = String(result.requested_cuisine || '').trim();
const excludedPartners = Array.isArray(result.excluded_partner_names) ? result.excluded_partner_names.filter(Boolean) : [];
const mentionsExcludedPartner = cuisine && excludedPartners.some(name => normalized(reply).includes(normalized(name)));
const noVettedCuisineOption = cuisine && !result.found_partners && options.length === 0;
const grounded = options.some(option => normalized(reply).includes(normalized(option.name)));
// A generic partner must never leak through once a specific cuisine excluded it.
// This guard also overrides a stale recommendation in conversation history.
if (mentionsExcludedPartner || noVettedCuisineOption) {
  reply = '';
  result.requests = mentionsExcludedPartner && Array.isArray(result.requests)
    ? result.requests.filter(request => !excludedPartners.some(name => normalized(request?.service_name).includes(normalized(name))))
    : [];
}
if (options.length && (!grounded || mentionsExcludedPartner)) {
  const names = options.slice(0, 2).map(option => option.name).join('; ');
  const language = String(result.language_detected || 'en').toLowerCase();
  const additions = {
    fr: `Suggestions non partenaires issues de notre recherche : ${names}. Notre equipe verifiera la disponibilite avant toute confirmation.`,
    es: `Sugerencias no asociadas de nuestra busqueda: ${names}. Nuestro equipo verificara la disponibilidad antes de confirmar cualquier solicitud.`,
    de: `Nicht-Partner-Vorschlage aus unserer Suche: ${names}. Unser Team pruft die Verfugbarkeit vor jeder Bestatigung.`,
    it: `Suggerimenti non partner dalla nostra ricerca: ${names}. Il nostro team verifichera la disponibilita prima di qualsiasi conferma.`,
    ja: `外部検索による提案です: ${names}。ホテルチームが空き状況を確認してからご連絡します。`,
    zh: `以下是外部搜索到的非合作伙伴建议：${names}。酒店团队会先核实可用性，再为您确认。`,
    ar: `اقتراحات من بحث خارجي وليست شركاء للفندق: ${names}. سيتحقق فريق الفندق من التوفر قبل أي تأكيد.`,
    en: `Non-partner suggestions from our current search: ${names}. Our team will verify availability before confirming any request.`,
  };
  const addition = additions[language] || additions.en;
  reply = mentionsExcludedPartner ? addition : (reply ? `${reply}\n\n${addition}` : addition);
}
if (!reply && cuisine) {
  const labels = { indian: 'Indian', japanese: 'Japanese', italian: 'Italian', vegan: 'vegan', vegetarian: 'vegetarian', thai: 'Thai', chinese: 'Chinese', halal: 'halal' };
  reply = `I do not have a verified ${labels[cuisine] || cuisine} partner recommendation in the hotel catalog. Our team will research a suitable option and confirm the next steps.`;
}
const partnerServices = Array.isArray(result.services_raw) ? result.services_raw.filter(service => service?.name) : [];
const namesPartner = partnerServices.some(service => normalized(reply).includes(normalized(service.name)));
// When a matching catalog service exists, a generic acknowledgement is not
// enough: expose at least one grounded option and its known price, without
// pretending that its availability has been confirmed.
if (result.has_service_intent && partnerServices.length && !namesPartner) {
  const service = partnerServices[0];
  const price = service.price == null || service.price === '' ? '' : `EUR ${Number(service.price).toFixed(0)}`;
  const duration = service.duration ? `${service.duration} min` : '';
  const details = [price, duration].filter(Boolean).join(', ');
  const language = String(result.language_detected || 'en').toLowerCase();
  const additions = {
    fr: `Option partenaire : ${service.name}${details ? ` (${details})` : ''}. Notre equipe verifiera la disponibilite avant toute confirmation.`,
    es: `Opcion de nuestro socio: ${service.name}${details ? ` (${details})` : ''}. Nuestro equipo verificara la disponibilidad antes de confirmar.`,
    de: `Partneroption: ${service.name}${details ? ` (${details})` : ''}. Unser Team pruft die Verfugbarkeit vor jeder Bestatigung.`,
    it: `Opzione partner: ${service.name}${details ? ` (${details})` : ''}. Il nostro team verifichera la disponibilita prima di confermare.`,
    ja: `提携先の選択肢は${service.name}${details ? `（${details}）` : ''}です。ホテルチームが空き状況を確認してからご連絡します。`,
    zh: `合作伙伴选项：${service.name}${details ? `（${details}）` : ''}。酒店团队会先核实可用性，再为您确认。`,
    ar: `خيار شريك الفندق: ${service.name}${details ? ` (${details})` : ''}. سيتحقق فريق الفندق من التوفر قبل أي تأكيد.`,
    en: `Partner option: ${service.name}${details ? ` (${details})` : ''}. Our team will verify availability before confirming any request.`,
  };
  reply = reply ? `${reply}\n\n${additions[language] || additions.en}` : (additions[language] || additions.en);
}
result.reply_text = reply || 'Our hotel team will be pleased to assist and confirm the next steps.';
return [{ json: result }];
""".strip(),
            "Ensures external replies cite actual search results and retain the no-confirmation policy.",
        ),
    )

    connections = workflow.setdefault("connections", {})
    connections["Normalize Incoming"] = _connection(INBOUND_GATE, "Build Service Query")
    connections[INBOUND_GATE] = _connection("Airtable · Log Inbound")
    connections["Parse AI Output"] = _connection("Enforce Concierge Contract")
    connections["Enforce Concierge Contract"] = _connection("Respond · Web Widget (INSTANT)", AI_LOG_GATE)
    connections[AI_LOG_GATE] = _connection("Airtable · Log AI Reply (Background)", REQUEST_GATE)
    connections[REQUEST_GATE] = _connection("Airtable · Create Requests (Background)")

    harden_external_search(workflow)
    validate(workflow)
    return workflow


def validate(workflow: dict) -> None:
    """Reject malformed graphs and any remaining literal Groq key before deployment."""
    nodes = _node_map(workflow)
    if len(nodes) != len(workflow.get("nodes", [])):
        raise ValueError("Workflow has duplicate node names")
    for source, outputs in workflow.get("connections", {}).items():
        if source not in nodes:
            raise ValueError(f"Connection source is missing: {source}")
        for branches in outputs.values():
            for branch in branches:
                for target in branch:
                    if target.get("node") not in nodes:
                        raise ValueError(f"Connection target is missing: {target.get('node')}")
    groq = nodes["Groq · Ultra-Fast AI (70B)"]["parameters"]["jsCode"]
    if re.search(r"const GROQ_API_KEY = '(?!')", groq):
        raise ValueError("Refusing to save a literal GROQ_API_KEY in the workflow")
    for name in (INBOUND_GATE, AI_LOG_GATE, REQUEST_GATE):
        if name not in nodes:
            raise ValueError(f"Missing regression safety node: {name}")


def _write_atomically(path: Path, workflow: dict) -> None:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=path.parent) as handle:
        json.dump(workflow, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
        temp_path = Path(handle.name)
    os.replace(temp_path, path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate without writing")
    args = parser.parse_args(argv)

    with CANONICAL.open(encoding="utf-8-sig") as handle:
        workflow = json.load(handle)
    original_workflow = json.loads(json.dumps(workflow))
    hardened = harden(workflow)
    if args.check:
        print("Workflow hardening check: PASS")
        return 0

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = BACKUP_DIR / f"canonical_before_hardening_{stamp}_redacted.json"
    redacted = original_workflow
    redacted_groq = _node_map(redacted)["Groq · Ultra-Fast AI (70B)"]["parameters"]["jsCode"]
    _node_map(redacted)["Groq · Ultra-Fast AI (70B)"]["parameters"]["jsCode"] = re.sub(
        r"const GROQ_API_KEY = '[^']*';", "const GROQ_API_KEY = '<redacted>';", redacted_groq, count=1
    )
    _write_atomically(backup, redacted)
    _write_atomically(CANONICAL, hardened)
    print(f"Hardened canonical workflow; backup: {backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
