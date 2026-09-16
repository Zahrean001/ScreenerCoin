// ============================================================
// Tests: Market Structure & Swing Pivot Point Analysis
// ============================================================

import { Stage2Signal } from '../src/stages/stage2-signal.js';
import { CircularBuffer } from '../src/data/circular-buffer.js';
import { CandleData, TrendState, StructureType } from '../src/data/types.js';

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
  console.log('=== Running Market Structure Engine Tests ===\n');

  // We can instantiate Stage2Signal with minimal stub engines to test estimateStructure directly
  const stage2 = new Stage2Signal(
    {} as any, {} as any, {} as any, {} as any, 
    {} as any, {} as any, {} as any, {} as any, {} as any
  );

  // 1. Clear Bullish Structure: Higher Highs + Higher Lows (Wave pattern)
  // Wave: Low 1 (idx 0), High 1 (idx 2), Low 2 (idx 4, HL), High 2 (idx 6, HH), Low 3 (idx 8, HL), High 3 (idx 10, HH)
  const bullCandles = new CircularBuffer<CandleData>(30);
  const bullPrices = [
    // Low 1 trough
    { h: 102, l: 98, c: 100 },   // idx 0: low=98 (trough)
    { h: 105, l: 100, c: 104 },  // idx 1: low=100
    { h: 110, l: 103, c: 109 },  // idx 2: HIGH 1 (peak, h=110)
    { h: 107, l: 102, c: 105 },  // idx 3: low=102
    { h: 105, l: 101, c: 103 },  // idx 4: LOW 2 (trough, l=101, HL vs idx 0 l=98)
    { h: 114, l: 106, c: 112 },  // idx 5: low=106
    { h: 120, l: 110, c: 119 },  // idx 6: HIGH 2 (peak, h=120, HH vs idx 2 h=110)
    { h: 116, l: 109, c: 114 },  // idx 7: low=109
    { h: 114, l: 108, c: 112 },  // idx 8: LOW 3 (trough, l=108, HL vs idx 4 l=101)
    { h: 124, l: 116, c: 122 },  // idx 9: low=116
    { h: 130, l: 121, c: 129 },  // idx 10: HIGH 3 (peak, h=130, HH vs idx 6 h=120)
    { h: 128, l: 123, c: 127 },  // idx 11
    { h: 129, l: 124, c: 128 },  // idx 12
  ];

  bullPrices.forEach((p, i) => {
    bullCandles.push({
      timestamp: Date.now() - (bullPrices.length - i) * 60_000,
      open: p.c - 1,
      high: p.h,
      low: p.l,
      close: p.c,
      volume: 1000,
      turnover: 100_000,
      confirmed: true
    });
  });

  const structBull = stage2.estimateStructure(bullCandles);
  assert(structBull.structures.includes(StructureType.HIGHER_HIGH), 'Identified Higher Highs (HH)');
  assert(structBull.structures.includes(StructureType.HIGHER_LOW), 'Identified Higher Lows (HL)');
  assert(structBull.trend === TrendState.STRONG_BULLISH || structBull.trend === TrendState.BULLISH, 'Trend classified as BULLISH');
  assert(structBull.confirmedPivotsCount >= 3, 'Multiple confirmed swing points detected');

  // 2. Clear Bearish Structure: Lower Highs + Lower Lows
  // High 1: 100, Low 1: 90, High 2: 95 (LH), Low 2: 85 (LL), High 3: 90 (LH), Low 3: 80 (LL)
  const bearCandles = new CircularBuffer<CandleData>(30);
  const bearPrices = [
    { h: 98, l: 94, c: 96 },
    { h: 102, l: 97, c: 100 }, // High 1 (peak)
    { h: 96, l: 92, c: 93 },
    { h: 93, l: 89, c: 90 },  // Low 1 (valley)
    { h: 95, l: 91, c: 94 },  // High 2 (LH)
    { h: 92, l: 87, c: 88 },
    { h: 88, l: 84, c: 85 },  // Low 2 (LL)
    { h: 90, l: 86, c: 89 },  // High 3 (LH)
    { h: 86, l: 81, c: 82 },
    { h: 82, l: 79, c: 80 },  // Low 3 (LL)
    { h: 83, l: 80, c: 81 },
    { h: 82, l: 80, c: 81 },
  ];

  bearPrices.forEach((p, i) => {
    bearCandles.push({
      timestamp: Date.now() - (bearPrices.length - i) * 60_000,
      open: p.c + 1,
      high: p.h,
      low: p.l,
      close: p.c,
      volume: 1000,
      turnover: 100_000,
      confirmed: true
    });
  });

  const structBear = stage2.estimateStructure(bearCandles);
  assert(structBear.structures.includes(StructureType.LOWER_HIGH), 'Identified Lower Highs (LH)');
  assert(structBear.structures.includes(StructureType.LOWER_LOW), 'Identified Lower Lows (LL)');
  assert(structBear.trend === TrendState.STRONG_BEARISH || structBear.trend === TrendState.BEARISH, 'Trend classified as BEARISH');

  // 3. Insufficient History (< 5 candles)
  const shortCandles = new CircularBuffer<CandleData>(10);
  shortCandles.push({ timestamp: 1, open: 10, high: 11, low: 9, close: 10, volume: 10, turnover: 100, confirmed: true });
  const structShort = stage2.estimateStructure(shortCandles);
  assert(structShort.structures.length === 0, 'No structures fabricated for insufficient candle count');
  assert(structShort.confirmedPivotsCount === 0, 'Confirmed pivots count is 0 on insufficient bars');

  console.log(`\n=== Market Structure Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
