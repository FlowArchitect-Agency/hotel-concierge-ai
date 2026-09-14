# LLM-First Routing Audit

## Decision boundary

ConciergeFlow now follows a strict boundary: the model interprets language and
asks for a limited capability; deterministic code validates, executes and
describes only what is verifiably true. A model response is never an authority
to write data, confirm a booking, notify a colleague, expose a URL or invent a
hotel fact.

## A. Keep deterministic

| Area | Existing code | Why it remains code-owned |
| --- | --- | --- |
| Request and channel validation | `parseGuestInput`, CORS, access gates | Security and schema enforcement cannot rely on probabilistic output. |
| Language/script safety | `requestedResponseLanguage`, `inferLanguage` | A safe fallback is required before a provider call and for provider failure. The controller can refine language, but only to the supported allowlist. |
| Hotel/service data | `fetchServices`, `fetchFacts`, `matchingServices`, brochure/media validation | The model receives verified records; it does not create catalogue entries, prices, policies or links. |
| External result verification | `externalSearch`, `parseExternalResults`, URL and cuisine checks | Only provider-returned, verified result cards can be rendered. |
| Request writes and dashboard taxonomy | `persistConversation`, `normalizeServiceType`, Airtable field mapping | Prevents arbitrary model fields and preserves the seven approved service buckets. |
| Booking/cancellation execution | `partnerBookingOutcome`, `cancellationOutcome`, request lookup and patching | A request may be prepared, but availability/confirmation is never fabricated. |
| Urgent operational and recovery handling | escalation, housekeeping, maintenance and post-checkout handlers | Safety-critical state, human ownership and truthful notification language require deterministic protection. |
| Human ownership | input owner checks and response contract | AI must not resume or overwrite a staff-owned conversation. |
| Provider failure | `callGroq`, tool result statuses, contract validation | Failures cannot trigger invented alternatives or actions. |

## B. Move to LLM semantic understanding

| Legacy signal | New responsibility |
| --- | --- |
| `CATEGORY_RULES` | A non-authoritative fallback hint. The semantic controller chooses the category from the guest message and conversation. |
| `ITINERARY_WORDS` | A narrow fast hint only. The controller decides whether a request really needs current Paris discovery. |
| `REQUEST_WORDS` | No longer has final authority over the guest goal or an action. |
| `GREETINGS` and broad yes/no handling | The controller resolves short turns against the immediately previous assistant message and recent history. |
| `inferOpenCuisine`, `inferLocation` | Useful deterministic extraction hints. The controller is the semantic authority for whether they are still relevant after a topic switch. |
| `classifyRequest` | Produces safe, inexpensive hints for fallback and obvious UI actions; ambiguous interpretation is replaced by the semantic plan. |
| `inheritConversationContext` | Remains a conservative context extractor, while the controller resolves references such as “the other one” and “same thing tomorrow.” |
| `relationshipFollowUpResponse` | Retained only as provider-failure fallback for the known first-time-Paris engagement state. The normal path is semantic, not phrase matching. |
| `isStayPlanning`, `guestInsistsOnExternal`, semantic router | Replaced on the normal ambiguous path by a single validated controller plan. |
| Generic hotel-first/external routing | Driven by validated `hotel_services` / `external_search` capability needs, not a keyword list. |

## C. Optional safe fast paths

These preserve latency without changing the interpretation of a meaningful
natural-language conversation:

- CORS preflight, invalid input, and authenticated webhook verification.
- Explicit UI catalogue actions such as `View Services`.
- A standalone greeting or an explicit language-switch command.
- Already-safe post-checkout recovery, clear operational issue, or clear
  escalation. These are protective routes; the model is still used for normal
  conversational context where it is available.
- Deterministic rendering of verified catalogue cards, media and externally
  verified cards after a capability has been selected.

## Removed authority

The old signals remain as fallback hints so a provider outage does not erase
basic service handling. They are not allowed to force an external search or a
privileged action on an ambiguous natural-language turn. The controller’s
validated capability plan, recent history and conversation owner take
precedence; deterministic action validators remain the final gate.
