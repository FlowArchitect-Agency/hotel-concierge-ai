import { BENCHMARK_VERSION } from './benchmark.js';
import { evaluateScenario, buildReport, validateBenchmark } from './expectations.js';
import { fixtureObservationFor } from './fixtures.js';

export function runFixtureBenchmark(scenarios) {
  const structure = validateBenchmark(scenarios);
  if (!structure.valid) return { structure, results: [], report: buildReport([]) };
  const results = scenarios.map((scenario) => ({
    ...evaluateScenario(scenario, fixtureObservationFor(scenario)),
    category: scenario.category,
    severity: scenario.severity,
  }));
  return {
    structure,
    results,
    report: buildReport(results, {
      provider: 'fixture', model: 'deterministic-fixture', gateway: 'fixture', timestamp: '2026-08-30T00:00:00.000Z', benchmark_version: BENCHMARK_VERSION,
    }),
  };
}
