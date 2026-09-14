# Dynamic unseen conversation evaluations

`dynamic-conversation-eval-v1` complements the permanent `concierge-benchmark-v1` suite. The permanent suite protects known regressions; this evaluator generates previously unseen guest conversations to measure generalization.

## Three isolated roles

The evaluator deliberately separates three prompts and responsibilities:

1. **Generator** produces only scenario metadata and behavioral expectations. It never sees ConciergeFlow replies.
2. **System under test (SUT)** is the local ConciergeFlow Worker. It never receives expectations, judge criteria, or judge output.
3. **Judge** receives the transcript, allowed synthetic ground truth, tool observations, behavioral constraints, and final reply. It does not receive provider/model/fallback metadata and cannot modify the SUT response.

Every role uses the provider-neutral Task 13B.5 gateway. These optional local variables allow different providers/models without changing production configuration:

```text
DYNAMIC_GENERATOR_PROVIDER / DYNAMIC_GENERATOR_MODEL
DYNAMIC_SUT_PROVIDER / DYNAMIC_SUT_MODEL
DYNAMIC_JUDGE_PROVIDER / DYNAMIC_JUDGE_MODEL
```

Role-specific API/base-url settings are supported for approved local providers. Values must remain in private environment configuration. When SUT and judge resolve to the same model, reports state `LIMITED — SAME MODEL`; that is not presented as independent validation.

## Run and resume

```powershell
npm run dynamic-evals:run
npm run dynamic-evals:run -- --seed hotel-owner-review-001
```

Ordinary runs create a new random seed. `--seed` reproduces the same checkpoint identity. The default checkpoint is outside the repository in `%TEMP%/conciergeflow-dynamic-conversation-eval-v1.json`; it stores scenario content and sanitized role metadata, never keys or authorization headers.

Generation, SUT execution, judge calibration, primary judging, and optional second judging each checkpoint after every completed item. HTTP 429 records a sanitized rate-limit state and stops with `RATE_LIMIT_WAIT_REQUIRED`; rerunning resumes from the first incomplete item.

## Unseen generation and validation

Each full run targets 105 new scenarios, exceeding the 100-scenario minimum. A deterministic coverage planner creates all 105 scenario blueprints before generation. Each blueprint fixes the category, language-switch details, intent count, fixture, tool classes, context length, escalation level, and optional natural-language style traits. The generator receives exactly one blueprint per call and writes the natural transcript; it never sees the permanent 200-scenario dataset or a preferred concierge response.

The local evaluator validates the generated transcript against that exact blueprint. Failed output receives its specific structural errors in a bounded regeneration prompt (three attempts per blueprint). A failed blueprint is replaced by another blueprint with the same coverage contribution; after the bounded replacement limit the run stops rather than looping indefinitely. The evaluator never inserts or repairs turns locally.

`prior_turn_count` always means individual user/assistant history messages, excluding the final guest turn and all system messages. Long histories use an even 10–20 message count: they start with a guest message, alternate, end with an assistant message, and then receive the final guest turn. This gives one unambiguous representation to the generator, parser, and validator.

For a small generator-efficiency diagnostic, `stratified-sample.js` selects ten distinct first-attempt blueprints—one per primary category—and stores results in a separate local checkpoint. It never mutates the 105-scenario baseline, never performs regeneration, and therefore measures first-attempt quality without allowing a difficult blueprint family to consume the entire sample.

The validator checks the generator schema, blueprint contract, tool allowlists, fixture profiles, categories, languages, long-context shape, language-switch evidence, multi-intent evidence, escalation, and credential-like content. It rejects candidates against both the permanent benchmark and same-run accepted scenarios using normalized exact matching, token/phrase overlap, and repeated conversation-structure signals. These are practical safeguards, not a claim of semantic-perfect duplicate detection.

The required distribution includes at least 15 contextual, 15 multi-intent, and 15 language cases; at least 10 complaints, tool/provider-failure, long-conversation, and typo/slang/informal cases; and coverage of every evaluation category.

## Fixture-isolated SUT execution

The local Worker always runs with `testMode: "read_only"`. Airtable facts/services and external-search responses are substituted from the permanent benchmark’s synthetic fixtures. Guest-request and human-takeover tools remain read-only; `waitUntil` throws if any persistence path is scheduled. The evaluator blocks every unexpected non-model network request.

Supported fixture profiles include `SUCCESS`, `NO_RESULTS`, `UNAVAILABLE`, `TIMEOUT`, `ERROR`, `PARTIAL_SUCCESS`, `READ_ONLY`, and `DUPLICATE`.

## Deterministic checks first

Before judging, each result is checked for response presence, valid required/forbidden tools, language, read-only writes, malformed write-layer arguments, critical escalation, and claims such as fabricated booking/availability/staff-notification success. A deterministic critical failure remains a failure even when a judge score is high.

## Blind LLM judge

The structured judge scores these dimensions from 0–4:

- contextual understanding, relevance, naturalness, helpfulness
- factual grounding and tool-selection appropriateness
- action truthfulness and language handling
- topic/state changes and escalation/safety

It also returns `overall_pass`, `critical_failure`, failure categories, a short rationale, and confidence. No chain-of-thought is requested. Borderline average scores or low confidence trigger a second judge call; material disagreement is flagged for human review.

Before a run, ten intentionally clear judge-validation cases cover excellent behavior, irrelevant behavior, fabricated booking/facts/external results, wrong language, honest provider unavailability, and missed escalation. At least 9/10 must be classified correctly or the run stops with `JUDGE RELIABILITY BLOCKER`.

## Reporting and failure promotion

Reports retain category/severity/language, transcript, semantic route, tool results, assistant reply, deterministic failures, judge output, and separate generator/SUT/judge call metrics. Provider/model/fallback metadata is stored outside the blind judge prompt.

`failure-export.js` creates review-only candidate fixtures. It never changes `concierge-benchmark-v1`; a human must review a candidate and deliberately add it to a new permanent benchmark version later.

## Provider comparison

The fixed dynamic-eval version, seed, role provider/model configuration, timestamps, latency/call counts, rate-limit information, and judge-independence label make later candidate-model comparisons interpretable. Thresholds are not automatically lowered after a weak model run.
