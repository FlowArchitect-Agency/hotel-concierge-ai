# ConciergeFlow Tool Architecture

## Boundary

```text
Semantic Controller
  → validated tool plan
  → bounded tool executor
  → integration/provider adapter
  → normalized, verified result
  → response generator
```

The LLM requests a capability; it never selects a provider, supplies a URL,
controls an Airtable field, or declares a write successful. `src/tools/index.js`
validates every request against `src/tools/schemas.js` and runs each of the five
capabilities at most once in a guest turn.

## Contracts

| Tool | Allowlisted input | Normalized result |
| --- | --- | --- |
| `hotel_facts` | verified fact category | hotel name plus verified matching key/value facts |
| `hotel_services` | one to three service categories | only active catalogue records and stored prices/media/URLs |
| `external_search` | query, category, location, limited constraints and language | independently verified venue cards |
| `guest_request` | approved request type, bounded summary, optional time/party size | `success` only after a deterministic writer confirms it |
| `human_takeover` | bounded reason and priority | `success` only when backend ownership is confirmed |

Every result has `{ tool, status, data, error_code, meta }`. Status is one of
`success`, `not_found`, `no_results`, `unavailable`, `error`, `invalid`,
`not_needed`, `prepared`, or `read_only`. Error codes are stable internal
categories, never raw provider response text.

## Action truthfulness and read-only mode

`guest_request` and `human_takeover` return `prepared` when an existing
deterministic workflow still needs confirmation. They return `read_only` in
test/evaluation mode and cannot call a writer. A response must not state that a
booking, request, or staff handoff exists unless the relevant backend adapter
returns `success`.

## External search providers

`src/tools/external-search/index.js` is provider-independent. It reads:

```text
EXTERNAL_SEARCH_PROVIDER
EXTERNAL_SEARCH_FALLBACK_PROVIDER
```

and selects an adapter by name. The semantic controller and response generator
know only `external_search`, never a vendor. The current ScrapingBee endpoint,
authentication header and payload are isolated in
`src/tools/external-search/providers/scrapingbee.js`.

The generic search layer verifies safe `http`/`https` links, category relevance,
cuisine and location constraints, removes generic directories and duplicates,
and passes only normalized verified results to the response generator:

```json
{
  "name": "…",
  "description": "…",
  "website_url": "https://…",
  "image_url": null,
  "location": "…",
  "category": "restaurant",
  "source_provider": "scrapingbee",
  "verified": true
}
```

A missing, expired, unauthorized or quota-exhausted ScrapingBee credential is
normalized as `unavailable` with `provider_auth_or_quota`; no HTTP detail or
credential can reach a guest. If a configured fallback adapter succeeds, its
results use the same format and the model is not told that fallback occurred.

## Adding a future provider

1. Add an adapter under `src/tools/external-search/providers/` implementing
   `search({ env, query, fetchImpl })`.
2. Return `{ provider, status, error_code, payload }`; do not expose raw
   provider errors.
3. Register the adapter only in `external-search/index.js`.
4. Add adapter fixture tests for success, authorization/quota, timeout,
   malformed data and fallback.
5. Configure its name with `EXTERNAL_SEARCH_PROVIDER` (and optionally the
   fallback variable). No semantic-controller or response-generator change is
   required.

## Observability

Read-only evaluations may receive safe test-only metadata: semantic route,
tools requested/executed, statuses, model-call counts, adapter name, fallback
flag and latency. It deliberately excludes secrets, raw upstream errors and
chain-of-thought.
