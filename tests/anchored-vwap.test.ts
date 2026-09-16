// ============================================================
// Targeted Unit & Regression Test Suite: Multi-Anchor VWAP Engine
// Tests:
// 1. Session VWAP (00:00 UTC Daily Anchor)
// 2. Weekly VWAP (Monday 00:00 UTC Weekly Anchor)
// 3. Monthly VWAP (1st of month 00:00 UTC Monthly Anchor)
// 4. Volume-Weighted Standard Deviation Bands (±1σ, ±2σ, ±3σ)
// 5. Triple VWAP Stack Confluence (Bullish / Bearish)
// 6. Band 2.0σ Exhaustion / Anti-Chasing Detection
// 7. Band 1.0σ Retest / Value Area Detection
// 8. End-to-end IncrementalIndicators Integration
// ============================================================

import { AnchoredVWAPEngine } from '../src/indicators/anchored-vwap.js';
import { SymbolIndicators } from '../src/indicators/incremental.js';
import { CandleData } from '../src/data/types.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(message);
  }
  console.log(`✅ PASS: ${message}`);
}

function makeCandle(timestamp: number, open: number, high: number, low: number, close: number, volume: number): CandleData {
  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume,
    turnover: ((open + close) / 2) * volume,
    confirmed: true
  };
}

async function runTests() {
  console.log('====================================================');
  console.log(' RUNNING ANCHORED VWAP & BANDS TARGETED TESTS       ');
  console.log('====================================================\n');

  const engine = new AnchoredVWAPEngine();

  // --- TEST 1: Anchor Detection Helpers ---
  console.log('--- TEST 1: Anchor Detection Date Helpers ---');
  // Day transition test
  const day1 = Date.UTC(2026, 8, 15, 23, 45, 0); // Sep 15 23:45
  const day2 = Date.UTC(2026, 8, 16, 0, 15, 0);   // Sep 16 00:15
  assert(AnchoredVWAPEngine.isNewUTCDay(day2, day1), 'Correctly identifies new UTC day (00:00 UTC boundary)');
  assert(!AnchoredVWAPEngine.isNewUTCDay(day1, day1 - 3600000), 'Correctly rejects non-boundary intra-day candle');

  // Week transition test (Sunday to Monday)
  // Sep 13, 2026 was Sunday. Sep 14, 2026 was Monday.
  const sundayTs = Date.UTC(2026, 8, 13, 23, 0, 0);
  const mondayTs = Date.UTC(2026, 8, 14, 1, 0, 0);
  assert(AnchoredVWAPEngine.isNewUTCWeek(mondayTs, sundayTs), 'Correctly identifies Monday 00:00 UTC week start');
  assert(!AnchoredVWAPEngine.isNewUTCWeek(mondayTs + 86400000, mondayTs), 'Correctly rejects non-boundary intra-week candle');

  // Month transition test (Aug 31 to Sep 1)
  const aug31 = Date.UTC(2026, 7, 31, 23, 0, 0);
  const sep1 = Date.UTC(2026, 8, 1, 1, 0, 0);
  assert(AnchoredVWAPEngine.isNewUTCMonth(sep1, aug31), 'Correctly identifies 1st of month 00:00 UTC start');

  // --- TEST 2: Session VWAP Calculation & Accuracy ---
  console.log('\n--- TEST 2: Session VWAP & Isolation from Yesterday ---');
  // 3 candles yesterday (Sep 15), 3 candles today (Sep 16)
  const candlesTest2: CandleData[] = [
    // Yesterday (high price 200, huge volume 50000)
    makeCandle(Date.UTC(2026, 8, 15, 22, 0, 0), 200, 202, 198, 200, 50000),
    makeCandle(Date.UTC(2026, 8, 15, 23, 0, 0), 200, 202, 198, 200, 50000),
    makeCandle(Date.UTC(2026, 8, 15, 23, 45, 0), 200, 202, 198, 200, 50000),
    // Today (price drops to 100, volume 1000 each)
    makeCandle(Date.UTC(2026, 8, 16, 0, 0, 0), 100, 105, 95, 100, 1000),  // hlc3 = 100
    makeCandle(Date.UTC(2026, 8, 16, 1, 0, 0), 100, 102, 98, 100, 1000),  // hlc3 = 100
    makeCandle(Date.UTC(2026, 8, 16, 2, 0, 0), 100, 104, 96, 100, 1000)   // hlc3 = 100
  ];

  const sessionVwap = engine.computeSessionVWAP(candlesTest2);
  assert(sessionVwap !== null, 'Session VWAP successfully computed');
  assert(Math.abs(sessionVwap!.vwap! - 100) < 0.1, `Session VWAP isolated to today (~100), not skewed by yesterday 200 (got ${sessionVwap!.vwap})`);

  // --- TEST 3: Volume-Weighted Standard Deviation Bands ---
  console.log('\n--- TEST 3: Standard Deviation Bands (±1.0σ, ±2.0σ, ±3.0σ) ---');
  // Two bars with known dispersion:
  // Bar 1: hlc3 = 90, volume = 1000
  // Bar 2: hlc3 = 110, volume = 1000
  // VWAP = (90*1000 + 110*1000)/2000 = 100
  // Variance = (1000*(90-100)^2 + 1000*(110-100)^2) / 2000 = (100000 + 100000)/2000 = 100
  // Sigma = sqrt(100) = 10
  const candlesTest3: CandleData[] = [
    makeCandle(Date.UTC(2026, 8, 16, 0, 0, 0), 90, 95, 85, 90, 1000),
    makeCandle(Date.UTC(2026, 8, 16, 0, 15, 0), 110, 115, 105, 110, 1000)
  ];

  const bandResult = engine.computeSessionVWAP(candlesTest3);
  assert(bandResult !== null, 'Band result computed');
  assert(Math.abs(bandResult!.vwap! - 100) < 0.01, `VWAP mean is exactly 100 (got ${bandResult!.vwap})`);
  assert(Math.abs(bandResult!.sigma! - 10) < 0.01, `Sigma is exactly 10 (got ${bandResult!.sigma})`);
  assert(Math.abs(bandResult!.upperBand1! - 110) < 0.01, `Upper Band 1 (+1.0σ) is 110 (got ${bandResult!.upperBand1})`);
  assert(Math.abs(bandResult!.lowerBand1! - 90) < 0.01, `Lower Band 1 (-1.0σ) is 90 (got ${bandResult!.lowerBand1})`);
  assert(Math.abs(bandResult!.upperBand2! - 120) < 0.01, `Upper Band 2 (+2.0σ) is 120 (got ${bandResult!.upperBand2})`);
  assert(Math.abs(bandResult!.lowerBand2! - 80) < 0.01, `Lower Band 2 (-2.0σ) is 80 (got ${bandResult!.lowerBand2})`);
  assert(Math.abs(bandResult!.upperBand3! - 130) < 0.01, `Upper Band 3 (+3.0σ) is 130 (got ${bandResult!.upperBand3})`);
  assert(Math.abs(bandResult!.lowerBand3! - 70) < 0.01, `Lower Band 3 (-3.0σ) is 70 (got ${bandResult!.lowerBand3})`);

  // --- TEST 4: Triple VWAP Confluence Analysis ---
  console.log('\n--- TEST 4: Multi-Anchor Confluence Matrix ---');
  // Bullish Stack: Price (105) > Session (100) > Weekly (95) > Monthly (90)
  const mockSession = { ...bandResult!, vwap: 100, upperBand1: 110, lowerBand1: 90, upperBand2: 120, lowerBand2: 80, sigma: 10 };
  const mockWeekly = { ...bandResult!, vwap: 95 };
  const mockMonthly = { ...bandResult!, vwap: 90 };

  const analysisBullish = engine.analyze(105, mockSession, mockWeekly, mockMonthly, 'LONG');
  assert(analysisBullish.alignment === 'TRIPLE_BULLISH_STACK', `Correctly identifies TRIPLE_BULLISH_STACK (got: ${analysisBullish.alignment})`);
  assert(analysisBullish.bandPosition === 'INSIDE_VALUE_AREA', `Price at 105 is INSIDE_VALUE_AREA (got: ${analysisBullish.bandPosition})`);

  // Bearish Stack: Price (85) < Session (90) < Weekly (95) < Monthly (100)
  const mockSessionBear = { ...bandResult!, vwap: 90, upperBand1: 100, lowerBand1: 80, upperBand2: 110, lowerBand2: 70, sigma: 10 };
  const mockWeeklyBear = { ...bandResult!, vwap: 95 };
  const mockMonthlyBear = { ...bandResult!, vwap: 100 };

  const analysisBearish = engine.analyze(85, mockSessionBear, mockWeeklyBear, mockMonthlyBear, 'SHORT');
  assert(analysisBearish.alignment === 'TRIPLE_BEARISH_STACK', `Correctly identifies TRIPLE_BEARISH_STACK (got: ${analysisBearish.alignment})`);

  // --- TEST 5: Band 2.0σ Anti-Chasing Filter ---
  console.log('\n--- TEST 5: Band 2.0σ Anti-Chasing Gate ---');
  // Price at 122 is above Upper Band 2 (120)
  const analysisExhausted = engine.analyze(122, mockSession, mockWeekly, mockMonthly, 'LONG');
  assert(analysisExhausted.isExhaustedBand2 === true, 'Band 2.0σ Exhaustion flag triggered');
  assert(analysisExhausted.bandPosition === 'EXHAUSTED_BAND_2', 'Band position classified as EXHAUSTED_BAND_2');
  assert(analysisExhausted.warning !== null && analysisExhausted.warning.includes('VWAP_EXHAUSTED'), `Warning generated (${analysisExhausted.warning})`);

  // --- TEST 6: Band 1.0σ Retest Pullback ---
  console.log('\n--- TEST 6: Band 1.0σ Retest Zone Detection ---');
  // Price at 109.5 is pulling back right at Upper Band 1 (110)
  const analysisRetest = engine.analyze(109.5, mockSession, mockWeekly, mockMonthly, 'LONG');
  assert(analysisRetest.isRetestingBand1 === true, 'Band 1.0σ Retest flag triggered');
  assert(analysisRetest.bandPosition === 'RETEST_BAND_1', 'Band position classified as RETEST_BAND_1');

  // --- TEST 7: SymbolIndicators Integration ---
  console.log('\n--- TEST 7: SymbolIndicators End-to-End ---');
  const indicators = new SymbolIndicators();
  for (const c of candlesTest2) {
    indicators.updateFromCandle('15', c);
  }
  const state = indicators.getState();
  assert(state.sessionVwap !== undefined && state.sessionVwap !== null, 'SymbolIndicators state contains sessionVwap');
  assert(Math.abs(state.sessionVwap!.vwap! - 100) < 0.1, `Session VWAP in state matches expected ~100 (got: ${state.sessionVwap!.vwap})`);
  assert(state.vwap['15'] === state.sessionVwap!.vwap, 'Backwards-compatible state.vwap[15] matches sessionVwap');

  console.log('\n====================================================');
  console.log(' ALL ANCHORED VWAP & BANDS TESTS PASSED (100%)      ');
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
