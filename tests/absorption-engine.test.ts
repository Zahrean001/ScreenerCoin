import { AbsorptionEngine } from '../src/engines/absorption.js';
import { CircularBuffer } from '../src/data/circular-buffer.js';
import { CandleData, OrderbookSnapshot, TradeData } from '../src/data/types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`PASS: ${message}`);
    passed++;
  } else {
    console.error(`FAIL: ${message}`);
    failed++;
  }
}

const engine = new AbsorptionEngine();
const now = Date.now();
const indicators = {
  volumeRatio: { '5': 1.5, '15': 2.4, '60': 1.2 },
  atr14: { '5': 1, '15': 2, '60': 3 }
} as any;
const vwapAnalysis = {
  sessionVwap: {
    vwap: 100,
    lowerBand1: 98,
    upperBand1: 102,
    lowerBand2: 96,
    upperBand2: 104,
    lowerBand3: 94,
    upperBand3: 106,
    sigma: 2,
    anchorTimestamp: now - 86_400_000
  },
  weeklyVwap: null,
  monthlyVwap: null,
  alignment: 'BULLISH_STACK',
  bandPosition: 'INSIDE_VALUE_AREA',
  isRetestingBand1: false,
  isExhaustedBand2: false,
  isClimaxBand3: false
} as any;

function candle(open: number, high: number, low: number, close: number): CandleData {
  return { timestamp: now, open, high, low, close, volume: 1000, turnover: 100_000, confirmed: true };
}

function trades(side: 'Buy' | 'Sell'): TradeData[] {
  return Array.from({ length: 10 }, (_, index) => ({
    timestamp: now - index * 1000,
    symbol: 'TESTUSDT',
    side,
    price: 100,
    size: side === 'Sell' ? 10 : 2
  }));
}

const bidSupport: OrderbookSnapshot = {
  symbol: 'TESTUSDT',
  bids: [{ price: 99.9, size: 1000 }],
  asks: [{ price: 100.1, size: 400 }],
  timestamp: now
};
const askResistance: OrderbookSnapshot = {
  symbol: 'TESTUSDT',
  bids: [{ price: 99.9, size: 400 }],
  asks: [{ price: 100.1, size: 1000 }],
  timestamp: now
};

const bullishCandles = new CircularBuffer<CandleData>(5);
bullishCandles.push(candle(99.7, 100.2, 98.0, 99.8));
const bullish = engine.analyze('LONG', 99.8, indicators, bullishCandles, trades('Sell'), bidSupport, vwapAnalysis);
assert(bullish.event === 'BULLISH_ABSORPTION', 'Bullish absorption requires sell pressure, rejection, VWAP support, and bid support');
assert(bullish.trappedSide === 'SHORT_SELLERS', 'Bullish absorption identifies trapped short sellers');

const bearishCandles = new CircularBuffer<CandleData>(5);
bearishCandles.push(candle(100.3, 102.0, 99.8, 100.2));
const bearish = engine.analyze('SHORT', 100.2, indicators, bearishCandles, trades('Buy'), askResistance, vwapAnalysis);
assert(bearish.event === 'BEARISH_ABSORPTION', 'Bearish absorption requires buy pressure, rejection, VWAP resistance, and ask resistance');
assert(bearish.trappedSide === 'LONG_BUYERS', 'Bearish absorption identifies trapped long buyers');

const insufficient = engine.analyze('LONG', 99.8, indicators, bullishCandles, trades('Sell').slice(0, 3), bidSupport, vwapAnalysis);
assert(insufficient.event === 'ABSORPTION_UNCONFIRMED', 'Insufficient trade-flow data cannot produce a confirmed absorption event');

console.log(`ABSORPTION TESTS: ${passed} PASSED, ${failed} FAILED`);
if (failed > 0) process.exit(1);
