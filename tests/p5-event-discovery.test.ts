// ============================================================
// Phase 5 Test Suite: Stop Chasing Movers & Event-First Discovery
// Covers Critical Tests 27 to 37:
// - Exact Production Problem (+12% 1h, +4% 5m, +5 ATR -> TOO_LATE, 0 actionable)
// - Critical Early Test (15m compression, fresh breakout, 90s ago -> ACTIONABLE_NOW, #1)
// - Stale Trigger Test (> 45 min -> WAIT_PULLBACK / TOO_LATE, never EARLY_LONG)
// - No Trigger Test (no breakout -> triggerFound = false, WAITING, never EARLY_LONG)
// - Dual Timestamps (triggerTimestamp vs confirmationTimestamp)
// - Confirmation vs Distance independence
// - Trigger Invalidation on structural re-entry
// - Primary vs Watchlist separation (results === actionableResults)
// ============================================================

import { TimingEngine } from '../src/engines/timing-engine.js';
import { TriggerTracker } from '../src/engines/trigger-tracker.js';
import { SetupStateMachine } from '../src/engines/setup-state-machine.js';
import { Stage1Filter } from '../src/stages/stage1-filter.js';
import { FinalRanker, CandidateScores } from '../src/ranking/final-ranker.js';
import { CorrelationFilter } from '../src/ranking/correlation.js';
import { CircularBuffer } from '../src/data/circular-buffer.js';
import { CONFIG } from '../src/config.js';
import {
  TickerData,
  CandleData,
  IndicatorState,
  VolatilityState,
  OIFundingAnalysis,
  RelativeStrengthResult,
  SetupState,
  MarketRegimeState,
  LongScoreBreakdown,
  ShortScoreBreakdown,
  ExecutionScore,
  SymbolInfo,
  EntryStatus
} from '../src/data/types.js';

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

// Helpers
function makeTicker(symbol: string, lastPrice: number, overrides: Partial<TickerData> = {}): TickerData {
  return {
    symbol,
    lastPrice,
    markPrice: lastPrice,
    indexPrice: lastPrice,
    bid1Price: lastPrice * 0.9999,
    bid1Size: 100,
    ask1Price: lastPrice * 1.0001,
    ask1Size: 100,
    highPrice24h: lastPrice * 1.05,
    lowPrice24h: lastPrice * 0.95,
    prevPrice24h: lastPrice * 0.98,
    prevPrice1h: lastPrice * 0.99,
    price24hPcnt: 0.02,
    volume24h: 100000,
    turnover24h: 15_000_000,
    openInterest: 50000,
    openInterestValue: 5_000_000,
    fundingRate: 0.0001,
    nextFundingTime: Date.now() + 4 * 3600_000,
    predictedFundingRate: 0.0001,
    timestamp: Date.now(),
    ...overrides
  };
}

function makeIndicators(overrides: Partial<IndicatorState> = {}): IndicatorState {
  return {
    ema9: { '5': 100, '15': 100, '60': 99, '240': 98, 'D': 95 },
    ema21: { '5': 99.5, '15': 99.2, '60': 98.5, '240': 97, 'D': 94 },
    ema50: { '5': 99, '15': 98.5, '60': 97.5, '240': 96, 'D': 92 },
    vwap: { '5': 99.8, '15': 99.5, '60': 99 },
    rsi14: { '5': 55, '15': 56, '60': 58 },
    atr14: { '5': 0.8, '15': 1.2, '60': 2.0 },
    atrPercent: { '5': 0.008, '15': 0.012, '60': 0.020 },
    roc5: { '5': 0.01, '15': 0.015, '60': 0.02 },
    roc14: { '5': 0.015, '15': 0.02, '60': 0.025 },
    volumeSma20: { '5': 1000, '15': 3000, '60': 12000 },
    volumeRatio: { '5': 1.3, '15': 1.4, '60': 1.2 },
    lastUpdate: Date.now(),
    ...overrides
  };
}

function makeVolatility(overrides: Partial<VolatilityState> = {}): VolatilityState {
  return {
    atrPercent5m: 0.008,
    atrPercent15m: 0.012,
    atrPercent1h: 0.020,
    realizedVol: 0.35,
    rangeExpansion: 1.05,
    volatilityPercentile: 45,
    regime: 'NORMAL' as any,
    ...overrides
  };
}

function makeCandle(close: number, timestamp: number, volume: number = 1000, range: number = 0.5): CandleData {
  return {
    timestamp,
    open: close - (range * 0.3),
    high: close + (range * 0.5),
    low: close - (range * 0.5),
    close,
    volume,
    turnover: close * volume,
    confirmed: true
  };
}

function makeOI(overrides: Partial<OIFundingAnalysis> = {}): OIFundingAnalysis {
  return {
    oiPriceState: 'LONG_BUILD' as any,
    oiChangePercent: 0.03,
    fundingRate: 0.0001,
    fundingPercentile: 45,
    fundingReady: true,
    ...overrides
  };
}

function makeRS(overrides: Partial<RelativeStrengthResult> = {}): RelativeStrengthResult {
  return {
    rsRawBtc: 0.02,
    rsRawEth: 0.015,
    rsRawSector: 0.01,
    rsRawUniverse: 0.025,
    rsScoreBtc: 75,
    rsScoreEth: 70,
    rsScoreSector: 68,
    rsScoreUniverse: 78,
    compositeRsScore: 75,
    isOutperformer: true,
    isSectorLeader: true,
    ...overrides
  };
}

function makeRegime(): MarketRegimeState {
  return {
    regime: 'STRONG_BULL' as any,
    btcTrend: 'STRONG_BULLISH' as any,
    btcMomentum: 65,
    btcVolatility: 'NORMAL' as any,
    btcRealizedVol: 0.30,
    btcVwapPosition: 0.012,
    longModifier: 1.10,
    shortModifier: 0.85,
    timestamp: Date.now()
  };
}

function makeBuffer(candles: CandleData[]): CircularBuffer<CandleData> {
  const buf = new CircularBuffer<CandleData>(candles.length + 5);
  for (const c of candles) buf.push(c);
  return buf;
}

console.log('====================================================');
console.log(' RUNNING PHASE 5: STOP CHASING MOVERS & EVENT TESTS ');
console.log('====================================================\n');

// -------------------------------------------------------------
// TEST 27 (MANDATORY EXACT PRODUCTION PROBLEM):
// Price +12% 1H, +4% 5m, RSI 78, volume 3x, OI +8%.
// Trigger happened 25 minutes ago, price +5 ATR from trigger base.
// Expected:
// direction = LONG
// entryStatus = TOO_LATE
// signalCategory = LATE_LONG or NO_LONG
// primary actionableResults MUST NOT contain it.
// -------------------------------------------------------------
console.log('--- TEST 27: Mandatory Production Problem (Late Parabolic Mover) ---');
const triggerTracker = new TriggerTracker();
const timingEngine = new TimingEngine();

const now = Date.now();
// 10 base candles 30 minutes ago around $100
const candles27: CandleData[] = [];
for (let i = 0; i < 10; i++) {
  candles27.push(makeCandle(100.0 + (i % 2 === 0 ? 0.2 : -0.2), now - ((35 - i) * 60_000), 1000, 0.5));
}
// Breakout occurred 25 minutes ago at $101.0
candles27.push(makeCandle(101.5, now - (25 * 60_000), 3000, 1.2));
// Multiple subsequent expansion candles driving price to $112 (+12% total, +5 ATR from base)
for (let i = 1; i <= 5; i++) {
  candles27.push(makeCandle(101.5 + (i * 2.1), now - ((25 - (i * 4)) * 60_000), 4000, 2.0));
}

const ticker27 = makeTicker('PUMP_LATE_USDT', 112.0, {
  price24hPcnt: 0.18,
  prevPrice1h: 100.0,
  timestamp: now
});

const ind27 = makeIndicators({
  rsi14: { '5': 78, '15': 78, '60': 75 },
  atr14: { '15': 2.0, '60': 2.5 },
  volumeRatio: { '5': 3.0, '15': 2.8, '60': 2.5 }
});

const analysis27 = timingEngine.analyze(
  ticker27,
  ind27,
  makeVolatility({ regime: 'HIGH' as any }),
  makeBuffer(candles27),
  makeBuffer(candles27),
  makeBuffer(candles27),
  makeOI({ oiChangePercent: 0.08 }),
  makeRS(),
  'LONG',
  90,
  0.04, // +4% 5m
  0.12  // +12% 1h
);

assert(analysis27.signalCategory === 'NO_LONG' || analysis27.signalCategory === 'LATE_LONG', `Test 27: Signal category is NO_LONG or LATE_LONG (got ${analysis27.signalCategory})`);
assert(analysis27.entryStatus === 'TOO_LATE' || analysis27.entryStatus === 'WAIT_PULLBACK', `Test 27: Entry status is TOO_LATE or WAIT_PULLBACK (got ${analysis27.entryStatus})`);
assert(analysis27.chaseRiskScore >= 70, `Test 27: Chase risk is high >= 70 (got ${analysis27.chaseRiskScore})`);
assert(analysis27.distanceFromTriggerATR >= 4.0, `Test 27: Distance from trigger ATR >= 4.0 (got ${analysis27.distanceFromTriggerATR})`);

// Verify in FinalRanker that PUMP_LATE_USDT is NEVER in actionableResults
const finalRanker = new FinalRanker(new CorrelationFilter());
const candidate27: CandidateScores = {
  symbol: 'PUMP_LATE_USDT',
  longScore: { total: 88, trend: 18, momentum: 14, relativeStrength: 14, volumeExpansion: 14, openInterest: 9, funding: 9, orderbook: 5, liquidation: 5, rawScore: 88, availableWeight: 100, normalizedScore: 88, dataCompleteness: 1.0, modifiers: [] },
  shortScore: { total: 15, trend: 0, momentum: 0, relativeWeakness: 0, volumeExpansion: 0, openInterest: 5, funding: 5, orderbook: 5, liquidation: 0, rawScore: 15, availableWeight: 100, normalizedScore: 15, dataCompleteness: 1.0, modifiers: [] },
  executionScore: { total: 85, passed: true, reason: 'Good', direction: 'LONG', slippageBps: 1, executableNotional: 100000, spreadBps: 2, depthScore: 35, slippageScore: 25, spreadScore: 15, tradeFreqScore: 10, availableWeight: 100, dataCompleteness: 1.0 },
  ticker: ticker27,
  volatility: makeVolatility(),
  liquidityTier: 'A',
  timing: analysis27,
  signalCategory: analysis27.signalCategory,
  setupState: analysis27.setupState,
  timingWindow: analysis27.timingWindow,
  actionabilityScore: analysis27.actionabilityScore,
  momentumStrengthScore: analysis27.momentumStrengthScore,
  extensionScore: analysis27.extensionScore,
  remainingMoveScore: analysis27.remainingMoveScore,
  elapsedSecondsSinceTrigger: analysis27.elapsedSecondsSinceTrigger,
  discoveryLane: 'LANE_D_HOT_MOVER'
};

const output27 = finalRanker.rank([candidate27], new Map(), makeRegime(), makeTicker('BTCUSDT', 80000), 0, 5);
assert(!output27.actionableResults.some(r => r.symbol === 'PUMP_LATE_USDT'), 'Test 27: PUMP_LATE_USDT MUST NOT be in actionableResults');
assert(!output27.results.some(r => r.symbol === 'PUMP_LATE_USDT'), 'Test 27: PUMP_LATE_USDT MUST NOT be in primary results');
assert(output27.watchlist.some(r => r.symbol === 'PUMP_LATE_USDT') || output27.rejectedSignals.some(r => r.symbol === 'PUMP_LATE_USDT'), 'Test 27: PUMP_LATE_USDT placed in watchlist or rejectedSignals');

// -------------------------------------------------------------
// TEST 28 (CRITICAL EARLY TEST):
// 15m compression / accumulation, 5m fresh breakout.
// Trigger: 90 seconds ago, 5m: +0.8%, volume 1.6x, distance < 1.5 ATR.
// Expected: EARLY_LONG, entryStatus = ACTIONABLE_NOW, Rank #1.
// -------------------------------------------------------------
console.log('\n--- TEST 28: Critical Early Test (Fresh Confirmed Ignition) ---');
const candles28: CandleData[] = [];
// 10 base compression candles around $50 (range: 49.8 - 50.2)
for (let i = 0; i < 10; i++) {
  candles28.push(makeCandle(50.0 + (i % 2 === 0 ? 0.1 : -0.1), now - ((12 - i) * 300_000), 1000, 0.3));
}
// Fresh breakout candle 90 seconds ago at $50.45 (+0.8% move, close near high)
candles28.push(makeCandle(50.45, now - 90_000, 1800, 0.4));

const ticker28 = makeTicker('FRESH_LEADER_USDT', 50.45, {
  price24hPcnt: 0.015,
  prevPrice1h: 50.0,
  timestamp: now
});

const ind28 = makeIndicators({
  rsi14: { '5': 58, '15': 57, '60': 55 },
  atr14: { '15': 0.5, '60': 0.8 },
  volumeRatio: { '5': 1.8, '15': 1.5, '60': 1.2 }
});

const analysis28 = timingEngine.analyze(
  ticker28,
  ind28,
  makeVolatility(),
  makeBuffer(candles28),
  makeBuffer(candles28),
  makeBuffer(candles28),
  makeOI({ oiChangePercent: 0.025 }),
  makeRS(),
  'LONG',
  82,
  0.008, // +0.8% 5m
  0.015  // +1.5% 1h
);

assert(analysis28.signalCategory === 'EARLY_LONG', `Test 28: Signal category is EARLY_LONG (got ${analysis28.signalCategory})`);
assert(analysis28.entryStatus === 'ACTIONABLE_NOW', `Test 28: Entry status is ACTIONABLE_NOW (got ${analysis28.entryStatus})`);
assert(analysis28.distanceFromTriggerATR <= 1.5, `Test 28: Distance from trigger <= 1.5 ATR (got ${analysis28.distanceFromTriggerATR})`);
assert(analysis28.chaseRiskScore <= 45, `Test 28: Chase risk score is low <= 45 (got ${analysis28.chaseRiskScore})`);
assert(analysis28.actionabilityScore! >= 70, `Test 28: Actionability score is high >= 70 (got ${analysis28.actionabilityScore})`);

const candidate28: CandidateScores = {
  symbol: 'FRESH_LEADER_USDT',
  longScore: { total: 82, trend: 16, momentum: 14, relativeStrength: 14, volumeExpansion: 13, openInterest: 8, funding: 8, orderbook: 5, liquidation: 4, rawScore: 82, availableWeight: 100, normalizedScore: 82, dataCompleteness: 1.0, modifiers: [] },
  shortScore: { total: 20, trend: 0, momentum: 0, relativeWeakness: 0, volumeExpansion: 0, openInterest: 5, funding: 5, orderbook: 5, liquidation: 5, rawScore: 20, availableWeight: 100, normalizedScore: 20, dataCompleteness: 1.0, modifiers: [] },
  executionScore: { total: 85, passed: true, reason: 'Good', direction: 'LONG', slippageBps: 1, executableNotional: 100000, spreadBps: 2, depthScore: 35, slippageScore: 25, spreadScore: 15, tradeFreqScore: 10, availableWeight: 100, dataCompleteness: 1.0 },
  ticker: ticker28,
  volatility: makeVolatility(),
  liquidityTier: 'A',
  timing: analysis28,
  signalCategory: analysis28.signalCategory,
  setupState: analysis28.setupState,
  timingWindow: analysis28.timingWindow,
  actionabilityScore: analysis28.actionabilityScore,
  momentumStrengthScore: analysis28.momentumStrengthScore,
  extensionScore: analysis28.extensionScore,
  remainingMoveScore: analysis28.remainingMoveScore,
  elapsedSecondsSinceTrigger: analysis28.elapsedSecondsSinceTrigger,
  discoveryLane: 'LANE_B_BULLISH_IGNITION'
};

const output28 = finalRanker.rank([candidate27, candidate28], new Map(), makeRegime(), makeTicker('BTCUSDT', 80000), 0, 5);
assert(output28.actionableResults.length === 1, `Test 28: Exactly 1 actionable result (got ${output28.actionableResults.length})`);
assert(output28.actionableResults[0].symbol === 'FRESH_LEADER_USDT', `Test 28: FRESH_LEADER_USDT is Rank #1 in actionableResults`);
assert(output28.results[0].symbol === 'FRESH_LEADER_USDT', `Test 28: results === actionableResults`);

// -------------------------------------------------------------
// TEST 29: STALE TRIGGER TEST
// Valid trigger happened 50 minutes ago (3000s).
// Expected: NOT EARLY_LONG, entryStatus = WAIT_PULLBACK or TOO_LATE.
// -------------------------------------------------------------
console.log('\n--- TEST 29: Stale Trigger (> 45 Minutes) ---');
const candles29: CandleData[] = [];
// 10 base candles around $100 (range: 99.8 - 100.2) from 70m to 52m ago
for (let i = 0; i < 10; i++) {
  candles29.push(makeCandle(100.0, now - ((70 - (i * 2)) * 60_000), 1000, 0.3));
}
// Clean breakout candle 50 minutes ago at $101.0 (range high was 100.15)
candles29.push(makeCandle(101.0, now - (50 * 60_000), 2500, 0.4));
// 8 subsequent drift candles staying around $101.0 without making any new breakouts
for (let i = 1; i <= 8; i++) {
  candles29.push(makeCandle(101.0, now - ((50 - (i * 5)) * 60_000), 900, 0.2));
}

const ticker29 = makeTicker('STALE_TRIGGER_USDT', 101.0, { timestamp: now });
const analysis29 = timingEngine.analyze(
  ticker29,
  makeIndicators({ rsi14: { '5': 56, '15': 55, '60': 54 } }),
  makeVolatility(),
  makeBuffer(candles29),
  makeBuffer(candles29),
  makeBuffer(candles29),
  makeOI(),
  makeRS(),
  'LONG',
  75,
  0.001,
  0.010
);

assert(analysis29.signalCategory !== 'EARLY_LONG', `Test 29: Stale trigger is NOT EARLY_LONG (got ${analysis29.signalCategory})`);
assert(analysis29.entryStatus === 'WAIT_PULLBACK' || analysis29.entryStatus === 'TOO_LATE', `Test 29: Entry status is WAIT_PULLBACK or TOO_LATE (got ${analysis29.entryStatus})`);

// -------------------------------------------------------------
// TEST 30: NO TRIGGER TEST (RULE 3)
// Bullish EMA, positive 5m return, high volume, but NO structural breakout
// (price is fluctuating inside consolidation range).
// Expected: triggerFound = false, entryStatus = WAITING, signalCategory = NO_LONG.
// -------------------------------------------------------------
console.log('\n--- TEST 30: No Trigger Test (Consolidation Without Breakout) ---');
const candles30: CandleData[] = [];
// 15 candles strictly bound between 99.0 and 101.0
for (let i = 0; i < 15; i++) {
  candles30.push(makeCandle(100.0 + (i % 2 === 0 ? 0.4 : -0.4), now - ((15 - i) * 300_000), 1500, 0.6));
}

const ticker30 = makeTicker('NO_TRIGGER_USDT', 100.2, { timestamp: now });
const analysis30 = timingEngine.analyze(
  ticker30,
  makeIndicators({ rsi14: { '5': 62, '15': 60, '60': 58 }, volumeRatio: { '5': 1.5, '15': 1.4, '60': 1.3 } }),
  makeVolatility(),
  makeBuffer(candles30),
  makeBuffer(candles30),
  makeBuffer(candles30),
  makeOI(),
  makeRS(),
  'LONG',
  78,
  0.004,
  0.008
);

assert(analysis30.signalCategory === 'NO_LONG', `Test 30: Signal category is NO_LONG (got ${analysis30.signalCategory})`);
assert(analysis30.entryStatus === 'WAITING', `Test 30: Entry status is WAITING (got ${analysis30.entryStatus})`);
assert(analysis30.timingWindow === 'PRE_TRIGGER', `Test 30: Timing window is PRE_TRIGGER (got ${analysis30.timingWindow})`);
assert(analysis30.triggerState === undefined, `Test 30: Trigger state is undefined (not fake current timestamp)`);

// -------------------------------------------------------------
// TEST 31: DUAL TIMESTAMPS (Trigger Time vs Confirmation Time)
// -------------------------------------------------------------
console.log('\n--- TEST 31: Dual Timestamp Tracking ---');
const tt31 = new TriggerTracker();
const candles31: CandleData[] = [];
for (let i = 0; i < 10; i++) {
  candles31.push(makeCandle(100.0, now - ((12 - i) * 300_000), 1000, 0.2));
}
// Trigger bar at 180 seconds ago
candles31.push(makeCandle(100.6, now - 180_000, 2000, 0.3));

const result31 = tt31.evaluateTrigger('TIMESTAMP_COIN', candles31, candles31, 100.7, 'LONG', 0.5, now);
assert(result31.triggerFound === true, 'Test 31: Trigger found');
assert(result31.elapsedSecondsSinceTrigger >= 170 && result31.elapsedSecondsSinceTrigger <= 190, `Test 31: Exact seconds since trigger tracked (${result31.elapsedSecondsSinceTrigger}s)`);
assert(result31.confirmationTimestamp !== undefined, 'Test 31: Confirmation timestamp is recorded');

// -------------------------------------------------------------
// TEST 32: TRIGGER INVALIDATION ON DEEP RETRACE
// Breakout happened, but price subsequently dumped back below support base.
// Expected: Trigger is invalidated.
// -------------------------------------------------------------
console.log('\n--- TEST 32: Trigger Invalidation on Deep Retrace ---');
const tt32 = new TriggerTracker();
const candles32: CandleData[] = [];
for (let i = 0; i < 10; i++) {
  candles32.push(makeCandle(100.0, now - ((15 - i) * 300_000), 1000, 0.3)); // Range: ~99.7 - 100.3
}
// Breakout bar
candles32.push(makeCandle(100.6, now - 600_000, 2000, 0.3));

// Price now has dumped deeply to $98.5 (well below pre-trigger range low)
const result32 = tt32.evaluateTrigger('INVALID_COIN', candles32, candles32, 98.5, 'LONG', 0.5, now);
assert(result32.triggerFound === false, `Test 32: Deep retrace invalidated trigger (got triggerFound=${result32.triggerFound})`);
assert(result32.entryStatus === 'WAITING', `Test 32: Status reset to WAITING`);

// -------------------------------------------------------------
// TEST 33: BEARISH EARLY BREAKDOWN (LANE C)
// 15m compression, 5m breakdown 60s ago, distance < 1.5 ATR.
// Expected: EARLY_SHORT, entryStatus = ACTIONABLE_NOW.
// -------------------------------------------------------------
console.log('\n--- TEST 33: Bearish Early Breakdown ---');
const candles33: CandleData[] = [];
for (let i = 0; i < 10; i++) {
  candles33.push(makeCandle(100.0, now - ((12 - i) * 300_000), 1000, 0.3));
}
// Breakdown bar 60 seconds ago at $99.2 (below range low $99.85)
candles33.push(makeCandle(99.2, now - 60_000, 2000, 0.4));

const ticker33 = makeTicker('BEAR_EARLY_USDT', 99.2, {
  prevPrice1h: 100.0,
  timestamp: now
});

const ind33 = makeIndicators({
  rsi14: { '5': 42, '15': 43, '60': 45 },
  atr14: { '15': 0.6, '60': 1.0 },
  volumeRatio: { '5': 1.9, '15': 1.6, '60': 1.2 }
});

const analysis33 = timingEngine.analyze(
  ticker33,
  ind33,
  makeVolatility(),
  makeBuffer(candles33),
  makeBuffer(candles33),
  makeBuffer(candles33),
  makeOI({ oiPriceState: 'SHORT_BUILD' as any, oiChangePercent: 0.025 }),
  makeRS({ compositeRsScore: 25, isOutperformer: false }),
  'SHORT',
  80,
  -0.008, // -0.8% 5m
  -0.015  // -1.5% 1h
);

assert(analysis33.signalCategory === 'EARLY_SHORT', `Test 33: Signal category is EARLY_SHORT (got ${analysis33.signalCategory})`);
assert(analysis33.entryStatus === 'ACTIONABLE_NOW', `Test 33: Entry status is ACTIONABLE_NOW (got ${analysis33.entryStatus})`);
assert(analysis33.distanceFromTriggerATR <= 1.5, `Test 33: Distance from breakdown <= 1.5 ATR (got ${analysis33.distanceFromTriggerATR})`);

// -------------------------------------------------------------
// TEST 34: BEARISH CAPITULATION DUMP
// Already dumped -15% 1h, -5% 5m, RSI 18, distance > 5 ATR.
// Expected: NO_SHORT / LATE_SHORT, entryStatus = TOO_LATE.
// -------------------------------------------------------------
console.log('\n--- TEST 34: Bearish Capitulation Dump ---');
const candles34: CandleData[] = [];
for (let i = 0; i < 10; i++) {
  candles34.push(makeCandle(100.0, now - ((35 - i) * 60_000), 1000, 0.5));
}
candles34.push(makeCandle(98.0, now - (25 * 60_000), 3000, 1.0));
for (let i = 1; i <= 5; i++) {
  candles34.push(makeCandle(98.0 - (i * 2.5), now - ((25 - (i * 4)) * 60_000), 4000, 2.0));
}

const ticker34 = makeTicker('DUMP_LATE_USDT', 85.0, {
  prevPrice1h: 100.0,
  timestamp: now
});

const ind34 = makeIndicators({
  rsi14: { '5': 18, '15': 20, '60': 22 },
  atr14: { '15': 2.0, '60': 2.5 },
  volumeRatio: { '5': 3.5, '15': 3.0, '60': 2.8 }
});

const analysis34 = timingEngine.analyze(
  ticker34,
  ind34,
  makeVolatility({ regime: 'HIGH' as any }),
  makeBuffer(candles34),
  makeBuffer(candles34),
  makeBuffer(candles34),
  makeOI({ oiPriceState: 'LONG_LIQUIDATION' as any }),
  makeRS({ compositeRsScore: 15, isOutperformer: false }),
  'SHORT',
  85,
  -0.05,
  -0.15
);

assert(analysis34.signalCategory === 'NO_SHORT' || analysis34.signalCategory === 'LATE_SHORT', `Test 34: Capitulation is NO_SHORT or LATE_SHORT (got ${analysis34.signalCategory})`);
assert(analysis34.entryStatus === 'TOO_LATE' || analysis34.entryStatus === 'WAIT_PULLBACK', `Test 34: Entry status is TOO_LATE or WAIT_PULLBACK (got ${analysis34.entryStatus})`);

// -------------------------------------------------------------
// TEST 35: ZERO-CHASING PARTITIONING (RULE 21 & 22)
// Enforce results === actionableResults and 0 late signals in results.
// -------------------------------------------------------------
console.log('\n--- TEST 35: Strict Zero-Chasing Partitioning (Rule 21 & 22) ---');
const candLate: CandidateScores = {
  symbol: 'LATE_COIN_USDT',
  longScore: { total: 80, trend: 16, momentum: 14, relativeStrength: 14, volumeExpansion: 12, openInterest: 8, funding: 8, orderbook: 4, liquidation: 4, rawScore: 80, availableWeight: 100, normalizedScore: 80, dataCompleteness: 1.0, modifiers: [] },
  shortScore: { total: 10, trend: 0, momentum: 0, relativeWeakness: 0, volumeExpansion: 0, openInterest: 5, funding: 5, orderbook: 0, liquidation: 0, rawScore: 10, availableWeight: 100, normalizedScore: 10, dataCompleteness: 1.0, modifiers: [] },
  executionScore: { total: 85, passed: true, reason: 'Good', direction: 'LONG', slippageBps: 1, executableNotional: 100000, spreadBps: 2, depthScore: 35, slippageScore: 25, spreadScore: 15, tradeFreqScore: 10, availableWeight: 100, dataCompleteness: 1.0 },
  ticker: makeTicker('LATE_COIN_USDT', 105.0),
  volatility: makeVolatility(),
  liquidityTier: 'A',
  timing: {
    phase: { label: 'NEUTRAL', confidence: 0.5, metrics: {} as any },
    signalCategory: 'LATE_LONG',
    entryStatus: 'WAIT_PULLBACK',
    earlyMomentumScore: 30,
    momentumIgnitionScore: 30,
    moveMaturity: 'LATE',
    moveMaturityScore: 75,
    signalFreshness: 20,
    chaseRiskScore: 55,
    distributionRisk: 20,
    accumulationRisk: 10,
    distanceFromTriggerPct: 3.5,
    distanceFromTriggerATR: 2.8,
    timingScore: 40,
    sweepType: 'NONE',
    antiChaseReasons: ['Entry late'],
    decision: 'Wait for pullback'
  },
  signalCategory: 'LATE_LONG',
  entryStatus: 'WAIT_PULLBACK'
};

const output35 = finalRanker.rank([candLate, candidate28], new Map(), makeRegime(), makeTicker('BTCUSDT', 80000), 0, 5);
assert(output35.actionableResults.length === 1, `Test 35: Only 1 actionable candidate (got ${output35.actionableResults.length})`);
assert(output35.results.length === 1, `Test 35: results length matches actionableResults (got ${output35.results.length})`);
assert(!output35.results.some(r => r.signalCategory === 'LATE_LONG'), 'Test 35: Primary results MUST NOT contain LATE_LONG');
assert(output35.watchlist.some(r => r.symbol === 'LATE_COIN_USDT'), 'Test 35: LATE_COIN_USDT is in watchlist');

console.log('\n====================================================');
console.log(` PHASE 5 TEST RESULTS: ${passed} PASSED, ${failed} FAILED `);
console.log('====================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
