import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { contextualNonSequitur, evaluateReadinessScenario } from '../evals/demo-ai-readiness/assertions.js';
import { freshReadinessCheckpoint, loadReadinessCheckpoint, saveReadinessCheckpoint } from '../evals/demo-ai-readiness/checkpoint.js';
import { DEMO_READINESS_CATEGORIES, DEMO_READINESS_SCENARIOS, scenariosByCategory } from '../evals/demo-ai-readiness/scenarios.js';

function sut(overrides = {}) {
  return {
    status: 200, reply: 'I can explain why I asked and help with the next step.', language: 'en', requires_human: false,
    semantic_plan: { valid: true, interaction_type: 'conversation', reference_target: 'previous_question', guest_goal: 'Explain why the hotel asks', context_summary: 'Returning visitor question', service_category: null, service_categories: [] },
    tools_requested: [], tools_executed: [], tool_statuses: {}, write_attempts: 0, deterministic_failures: [],
    ...overrides,
  };
}

test('demo readiness suite has exactly 50 distinct hand-authored scenarios in the required distribution', () => {
  assert.equal(DEMO_READINESS_SCENARIOS.length, 50);
  assert.equal(new Set(DEMO_READINESS_SCENARIOS.map((item) => item.id)).size, 50);
  const groups = scenariosByCategory();
  assert.deepEqual(Object.fromEntries(DEMO_READINESS_CATEGORIES.map((category) => [category, groups[category].length])), {
    context: 10, change_of_mind: 10, multi_intent: 7, long_context: 6, language: 6, complaint_takeover: 5, grounding: 6,
  });
  assert.ok(groups.long_context.every((item) => item.conversation_history.length >= 10));
});

test('contextual non-sequitur detector rejects generic acknowledgement that ignores the active question', () => {
  const scenario = DEMO_READINESS_SCENARIOS.find((item) => item.id === 'dar-ctx-01');
  const result = contextualNonSequitur(scenario, sut({ reply: "Of course. I'll be here whenever you're ready." }));
  assert.ok(result.includes('contextual_non_sequitur:generic_acknowledgement'));
});

test('readiness assertions preserve structural tools and reject fabricated action claims without exact-answer matching', () => {
  const scenario = DEMO_READINESS_SCENARIOS.find((item) => item.id === 'dar-grd-06');
  const result = evaluateReadinessScenario(scenario, sut({
    reply: 'Your booking is confirmed and the spa team has been notified.',
    semantic_plan: { valid: true, interaction_type: 'booking_request', reference_target: 'none', guest_goal: 'Prepare massage request', context_summary: '', service_category: 'spa', service_categories: ['spa'] },
    tools_requested: ['hotel_services', 'guest_request'],
  }));
  assert.equal(result.critical, true);
  assert.ok(result.failures.includes('critical:action_fabrication'));
});

test('readiness checkpoints preserve the baseline hash and do not contain credentials', () => {
  const checkpoint = freshReadinessCheckpoint({ mainCheckpointPath: 'C:/tmp/main.json', mainCheckpointHash: 'ABC', sut: { provider: 'groq', model: 'test', configured: true } });
  assert.equal(checkpoint.main_checkpoint.hash_before, 'ABC');
  assert.equal(JSON.stringify(checkpoint).includes('API_KEY'), false);
});

test('readiness checkpoint resumes redacted response-pipeline diagnostic records unchanged', () => {
  const checkpointPath = path.join(os.tmpdir(), `conciergeflow-readiness-observability-${process.pid}-${Date.now()}.json`);
  const checkpoint = freshReadinessCheckpoint({ mainCheckpointPath: 'C:/tmp/main.json', mainCheckpointHash: 'ABC', sut: { provider: 'groq', model: 'test', configured: true } });
  checkpoint.results['dar-ctx-01'] = {
    id: 'dar-ctx-01', status: 'passed', transcript: [], sut: {
      response_pipeline: {
        attempts: [{ attempt: 1, adherence_result: 'FAIL', failure_codes: ['response_mode_mismatch'], failure_severity: { response_mode_mismatch: 'METADATA' } }],
        final_response_source: 'CONTEXTUAL_SAFE_FALLBACK', initial_rejected: true, repair_rejected: true,
      },
    }, assertions: { passed: true },
  };
  try {
    saveReadinessCheckpoint(checkpointPath, checkpoint);
    const resumed = loadReadinessCheckpoint(checkpointPath, { mainCheckpointPath: 'C:/tmp/main.json', mainCheckpointHash: 'ABC' });
    assert.deepEqual(resumed.results['dar-ctx-01'].sut.response_pipeline, checkpoint.results['dar-ctx-01'].sut.response_pipeline);
    assert.equal(JSON.stringify(resumed).includes('API_KEY'), false);
    assert.equal(JSON.stringify(resumed).includes('chain_of_thought'), false);
  } finally {
    fs.rmSync(checkpointPath, { force: true });
  }
});
