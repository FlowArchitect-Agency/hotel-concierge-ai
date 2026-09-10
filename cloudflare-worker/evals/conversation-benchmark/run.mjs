import { CONVERSATION_BENCHMARK } from './benchmark.js';
import { runFixtureBenchmark } from './runner.js';

const result = runFixtureBenchmark(CONVERSATION_BENCHMARK);
console.log(JSON.stringify({
  benchmark_version: result.structure.version,
  structure: result.structure.valid ? 'PASS' : 'FAIL',
  total_scenarios: result.structure.total,
  category_counts: result.structure.category_counts,
  long_conversations: result.structure.long_conversations,
  critical_scenarios: result.structure.critical_scenarios,
  fixture_execution: `${result.report.passed}/${result.report.total}`,
  critical_failures: result.report.critical_failures,
  errors: result.structure.errors,
}, null, 2));
process.exitCode = result.structure.valid && result.report.failed === 0 ? 0 : 1;
