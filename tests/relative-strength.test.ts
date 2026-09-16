// ============================================================
// Tests: Relative Strength & Weakness Baselines
// ============================================================

import { RelativeStrengthEngine } from '../src/indicators/relative-strength.js';
import { TimestampedPriceRingBuffer } from '../src/data/circular-buffer.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`✅ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${msg}`);
    failed++;
  }
}

async function run() {
  console.log('=== Running Relative Strength Engine Tests ===\n');

  const rsEngine = new RelativeStrengthEngine();
  const now = 1_700_000_000_000;

  // 1. Outperforming Universe and BTC
  const symBuf = new TimestampedPriceRingBuffer(100);
  symBuf.push(now - 300_000, 100);
  symBuf.push(now, 106); // +6.0%

  const btcBuf = new TimestampedPriceRingBuffer(100);
  btcBuf.push(now - 300_000, 50_000);
  btcBuf.push(now, 50_500); // +1.0% (BTC)

  const ethBuf = new TimestampedPriceRingBuffer(100);
  ethBuf.push(now - 300_000, 3_000);
  ethBuf.push(now, 3_030); // +1.0% (ETH)

  const sectorReturn = 0.02; // +2.0% (Sector)
  const universeReturn = 0.015; // +1.5% (Universe)

  const rsResult = rsEngine.compute('SOLUSDT', symBuf, btcBuf, ethBuf, sectorReturn, universeReturn, 300_000);
  assert(rsResult.vsBTC !== null && rsResult.vsBTC > 4.5, 'vsBTC is > +4.5% (Outperforming BTC)');
  assert(rsResult.vsETH !== null && rsResult.vsETH > 4.5, 'vsETH is > +4.5% (Outperforming ETH)');
  assert(rsResult.vsSector !== null && rsResult.vsSector > 3.5, 'vsSector is > +3.5% (Outperforming Sector)');
  assert(rsResult.vsUniverse !== null && rsResult.vsUniverse > 4.0, 'vsUniverse is > +4.0% (Outperforming Universe)');
  assert(rsResult.longScore >= 13, 'Long Score is near maximum (>= 13/15) on multi-baseline outperformance');
  assert(rsResult.shortScore === 0, 'Short Score is 0 for strong leader');
  assert(rsResult.dataCompleteness === 1.0, 'Data completeness is 100% when all baselines observed');

  // 2. Underperforming Universe and BTC (Strong Short Setup)
  const weakBuf = new TimestampedPriceRingBuffer(100);
  weakBuf.push(now - 300_000, 100);
  weakBuf.push(now, 94); // -6.0%

  const rsWeak = rsEngine.compute('WEAKUSDT', weakBuf, btcBuf, ethBuf, sectorReturn, universeReturn, 300_000);
  assert(rsWeak.vsBTC !== null && rsWeak.vsBTC < -6.5, 'vsBTC is < -6.5% (Severe Relative Weakness vs BTC)');
  assert(rsWeak.shortScore >= 13, 'Short Score is near maximum (>= 13/15) for relative laggard');
  assert(rsWeak.longScore === 0, 'Long Score is 0 for relative laggard');

  // 3. Missing Sector Mapping (e.g. OTHER category)
  const rsNoSector = rsEngine.compute('SOLUSDT', symBuf, btcBuf, ethBuf, null, universeReturn, 300_000);
  assert(rsNoSector.vsSector === null, 'vsSector is explicitly null when sector is unmapped (not fake symbol return)');
  assert(rsNoSector.availableWeight === 12, 'availableWeight drops to 12 (6 BTC + 4 ETH + 2 Universe) when sector missing');
  assert(rsNoSector.longScore > 0, 'Long score normalizes cleanly based on available baselines without penalty');

  // 4. Insufficient History
  const emptyBuf = new TimestampedPriceRingBuffer(100);
  emptyBuf.push(now, 100);
  const rsEmpty = rsEngine.compute('NEWUSDT', emptyBuf, btcBuf, ethBuf, sectorReturn, universeReturn, 300_000);
  assert(rsEmpty.vsBTC === null, 'vsBTC is null when price history is insufficient');
  assert(rsEmpty.dataCompleteness === 0, 'dataCompleteness is 0.0 on missing price history');
  assert(rsEmpty.longScore === 0 && rsEmpty.shortScore === 0, 'Scores are 0 on unobserved data');

  console.log(`\n=== Relative Strength Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
