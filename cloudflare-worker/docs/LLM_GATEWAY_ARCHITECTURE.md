# ConciergeFlow LLM Gateway Architecture

```text
Guest
  ↓
Semantic Controller
  ↓
LLM Gateway
  ↓
Qualified model/provider
  ↓
Validated semantic plan
  ↓
Business Tool Executor
  ↓
Verified tool results
  ↓
LLM Gateway
  ↓
Response Generator
  ↓
Guest
```

## Boundary and responsibilities

`src/llm/` is the model transport boundary. It exposes normalized
`completeStructured` and `completeText` operations and owns:

- provider selection and OpenAI-compatible request conversion;
- request timeouts and normalization of provider failures;
- provider/model/purpose/latency/attempt/fallback metadata; and
- rejection of malformed structured output.

It does not own routing, guest state, hotel facts, services, external search,
bookings, Airtable writes, staff escalation, or response truthfulness.

`src/tools/` remains the independent business-tool boundary. A semantic plan
can request only `hotel_facts`, `hotel_services`, `external_search`,
`guest_request`, or `human_takeover`; the executor returns verified normalized
results. The LLM gateway never treats a model response as a tool result.

## Providers

| Configuration | Adapter | Intended use |
| --- | --- | --- |
| `LLM_PROVIDER=groq` (default) | Direct Groq adapter | Current known-good reference transport. |
| `LLM_PROVIDER=openai-compatible` | Generic `/v1/chat/completions` adapter | Approved future OpenAI-compatible provider. |
| `LLM_PROVIDER=omniroute` | Named OmniRoute adapter over the generic protocol | Development/synthetic gateway evaluation. |

The OmniRoute adapter accepts a configurable `LLM_BASE_URL`; its local default
is `http://localhost:20128/v1`, but localhost is never required by the
application architecture. Its provider identity remains `omniroute` in safe
test-only telemetry.

## Normalized request and result

The application sends a normalized request containing a purpose, complete
visible conversation messages, selected model, temperature, token limit,
optional structured schema and bounded timeout. Adapters turn that into each
provider's wire format.

Every result is normalized without credentials or hidden reasoning:

```json
{
  "status": "success | rate_limited | timeout | provider_error | invalid_output",
  "provider": "groq | omniroute | openai-compatible",
  "model": "provider model identifier",
  "content": "only usable content",
  "structured": "validated object or null",
  "latency_ms": 0,
  "attempts": 1,
  "fallback_used": false
}
```

For structured calls, the caller supplies the existing strict parser. The
gateway does not repair prose, infer missing fields, or transform an invalid
controller response into a plan. Invalid JSON or schema failure becomes
`invalid_output` and can only proceed to the controlled fallback chain.

## Qualification and fallback

`src/llm/model-qualification.js` records evidence per *provider and model*.
The current Groq Qwen model carries controller/response qualification from the
existing Task 13A/13B evidence. NVIDIA models that failed qualification are
recorded as unqualified. No entry is marked `productionApproved` yet.

The configured primary is deliberate. A fallback is different: it is attempted
only when explicitly configured **and** qualified for the requested purpose.
This prevents a free, newly discovered, or previously failed model from
quietly becoming a production fallback. The gateway never auto-routes across
an OmniRoute model pool for product traffic.

The primary selection is deterministic for every healthy turn, so a guest does
not receive randomly changing model behavior. If the primary fails, the
application passes the same complete transcript, semantic state and verified
tool context to the one controlled fallback; the gateway reports safe
failover metadata. ConciergeFlow owns the conversation state, never the
provider.

## Safe failure

If all candidates fail, the gateway returns no content and no structured plan.
The caller keeps the existing conservative service fallback. It does not
execute a provider-invented tool, fabricate a booking/availability result, or
claim staff notification.

## Development-only OmniRoute smoke test

OmniRoute is OpenAI-compatible and its upstream documentation describes a
local API at `http://localhost:20128/v1`. A real local smoke test requires a
locally running gateway, at least one configured upstream provider, and a
locally created endpoint API key. These are development credentials and are
never committed, logged, or treated as production-approved.
