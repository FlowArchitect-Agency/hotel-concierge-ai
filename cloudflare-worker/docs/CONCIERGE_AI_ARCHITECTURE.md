# ConciergeFlow LLM-First Conversation Architecture

```text
Guest
  ↓
Context (recent transcript, prior assistant turn, guest/stay state, owner, language)
  ↓
Semantic Controller (LLM)
  ↓
LLM Gateway → qualified provider/model
  ↓
Validated Tool Plan
  ↓
Validated Tool Executor
  ↓
Provider Adapter → Normalized Verified Results
  ↓
Response Generator (LLM)
  ↓
LLM Gateway → qualified provider/model
  ↓
Guardrail Validation
  ↓
Guest
```

## 1. Semantic controller

`src/semantic-controller.js` constructs a single controller prompt containing
the current guest turn, eight recent turns, the immediately previous assistant
message, current owner/language, safe stay context, pending action context and
the conceptual capability names:

- `hotel_facts`
- `hotel_services`
- `external_search`
- `guest_request`
- `human_takeover`

The controller returns a JSON plan with allowlisted enums for interaction type,
service category and reference target. It may describe a goal and context, but
those strings are never used as executable instructions. Unknown enum values,
malformed JSON or an old-router/final-response payload are invalid and trigger
the conservative fallback.

The controller decides meaning. It can resolve a reply such as “No, why?”
against the prior assistant question, detect a topic reset, retain constraints
from an earlier request, or decide that a vague recommendation should remain
within a hotel conversation. It requests `external_search`, not a provider.

## 1.5 LLM gateway (separate from tools)

`src/llm/` is the provider-neutral model boundary. Both the semantic
controller and response generator use its stable structured-completion
operation. The gateway normalizes provider outcomes to `success`,
`rate_limited`, `timeout`, `provider_error`, or `invalid_output`, retaining
only safe telemetry such as provider, model, purpose, latency and attempt
count.

The gateway is intentionally not a business tool and does not see an
executable request, Airtable record ID, notification target, or arbitrary
vendor URL. It can choose only the configured primary provider and one
explicitly qualified fallback. A malformed provider response never becomes a
semantic plan: the controller parser must validate every allowlisted enum and
capability boolean first.

## 2. Validated intent and tools

`applySemanticPlan` maps only valid controller enums and capability booleans to
the internal routing representation. It cannot create an Airtable field,
arbitrary URL, booking, cancellation, staff alert or service type.

`src/tools/` is the formal capability boundary. The executor receives only
allowlisted inputs, executes each capability at most once per guest turn, and
returns a stable status (`success`, `not_found`, `no_results`, `unavailable`,
`error`, `prepared`, or `read_only`). It cannot select an arbitrary vendor,
URL, record identifier, destination or write field.

External discovery is selected conceptually; the adapter is selected by the
environment. A provider outage becomes the verified tool result:

```json
{ "external_search": { "status": "unavailable" } }
```

No provider name is exposed to the model as a capability or required by the
semantic contract. Multiple independent needs can be represented in a single
semantic plan: for example a maintenance request plus dining discovery.

## 3. Factual grounding and action truthfulness

Only code may:

- read and normalize hotel services/facts;
- verify URLs, cuisine proof and external-result provenance;
- persist a conversation/request or map its Airtable fields;
- cancel an existing request after lookup;
- normalize dashboard service types;
- construct request summaries, staff-attention presentation and media cards;
- enforce conversation ownership; and
- state the real result of an action.

The response generator receives three explicitly separated inputs:

1. **Conversational context** — the validated semantic summary and transcript.
2. **Verified facts/services** — only Airtable-backed hotel data.
3. **Verified tool results** — success, unavailable, read-only or not-needed states plus
   verified external cards when available.

`enforceContract` remains the last gate. It removes unverified external cards,
protects cuisine constraints, suppresses partner substitutions for explicit
external requests, preserves operational/escalation truthfulness and blocks
booking/availability claims that were not executed.

## 4. Fast paths and failures

Obvious greetings, explicit language switches, catalogue UI actions and clear
protective paths (operational, escalation and post-checkout recovery) may skip
one or both model calls. This improves guest latency without assigning natural
language ambiguity to regexes.

If the semantic controller fails, code does not execute a new action. A
conservative legacy fallback maintains basic service continuity. If a tool
fails, the response generator receives the failure result; it cannot use a
hotel partner as a substitute for an explicitly external request.

## 5. Model-call budget

The normal ambiguous turn uses one controller call plus one response call only
when a composed response is needed. Tool execution is conditional and bounded
to the five named capabilities—never an autonomous recursive agent loop. Safe
test-mode observability records the semantic route, requested/executed tools,
tool statuses, provider/fallback selection, model-call counters and latency;
it does not include secrets or model reasoning.
