import { HTFContextEngine } from '../src/engines/htf-context.js';
import { CircularBuffer } from '../src/data/circular-buffer.js';
import { CandleData } from '../src/data/types.js';

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`PASS: ${message}`); passed++; }
  else { console.error(`FAIL: ${message}`); failed++; }
}

function series(start: number, step: number, count = 60) {
  const buffer = new CircularBuffer<CandleData>(100);
  for (let i = 0; i < count; i++) {
    const close = start + step * i;
    buffer.push({
      timestamp: Date.now() - (count - i) * 3_600_000,
      open: close - 0.2,
      high: close + 0.4,
      low: close - 0.4,
      close,
      volume: 1_000,
      turnover: 100_000,
      confirmed: true
    });
  }
  return buffer;
}

const engine = new HTFContextEngine();
const bullish = engine.analyze(series(100, 1), series(100, 0.5));
assert(bullish.fourHourTrend === 'BULLISH', '4H bullish trend is detected');
assert(bullish.dailyTrend === 'BULLISH', '1D bullish trend is detected');
assert(bullish.classification === 'MACRO_ALIGNED', 'aligned 4H and 1D context is classified');
assert(bullish.dataCompleteness === 1, 'complete HTF history reports full completeness');

const incomplete = engine.analyze(series(100, 1), undefined);
assert(incomplete.dataCompleteness === 0.5, 'missing 1D history reduces completeness');
assert(incomplete.warnings.includes('1D_INSUFFICIENT_HISTORY'), 'missing 1D history is surfaced');

console.log(`HTF CONTEXT TESTS: ${passed} PASSED, ${failed} FAILED`);
if (failed > 0) process.exit(1);
