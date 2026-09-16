// ============================================================
// Master Test Runner for USDT Perpetual Screener
// ============================================================

import { execSync } from 'node:child_process';

const testSuites = [
  'test/screener.test.ts',
  'tests/p0-data-integrity.test.ts',
  'tests/p1-p2-regression.test.ts',
  'tests/price-window.test.ts',
  'tests/relative-strength.test.ts',
  'tests/execution-slippage.test.ts',
  'tests/market-regime.test.ts',
  'tests/market-structure.test.ts',
  'tests/deterministic-scoring.test.ts',
  'tests/missing-data-scoring.test.ts',
  'tests/p2-funding-semantics.test.ts',
  'tests/p3-timing-phase.test.ts',
  'tests/p4-early-discovery.test.ts',
  'tests/p5-event-discovery.test.ts',
  'tests/discovery-engine-upgrade.test.ts',
  'tests/absorption-engine.test.ts',
  'tests/anchored-vwap.test.ts'
];

console.log('====================================================');
console.log('  RUNNING ALL PRODUCTION LOGIC CORRECTION TEST SUITES ');
console.log('====================================================\n');

let totalSuites = testSuites.length;
let passedSuites = 0;
let failedSuites = 0;

for (const suite of testSuites) {
  try {
    console.log(`>>> Executing ${suite}...`);
    const output = execSync(`node node_modules/tsx/dist/cli.mjs ${suite}`, { encoding: 'utf-8' });
    console.log(output);
    passedSuites++;
  } catch (err: any) {
    console.error(`❌ Suite Failed: ${suite}`);
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.error(err.stderr);
    failedSuites++;
  }
}

console.log('====================================================');
console.log(`TOTAL SUITES: ${totalSuites} | PASSED: ${passedSuites} | FAILED: ${failedSuites}`);
console.log('====================================================');

if (failedSuites > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL TEST SUITES PASSED SUCCESSFULLY (100%)');
}
