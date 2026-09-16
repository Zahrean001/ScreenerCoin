// ============================================================
// Phase 3 Test Suite: Early Momentum, Market Phase, & Anti-Chase
// Verifies Test A through Test J & Mandatory Current Issue Regression
// ============================================================

import { TimingEngine } from '../src/engines/timing-engine.js';
import { FinalRanker, CandidateScores } from '../src/ranking/final-ranker.js';
import { CorrelationFilter } from '../src/ranking/correlation.js';
import { CircularBuffer } from '../src/data/circular-buffer.js';
import {
  TickerData,
  CandleData,
  IndicatorState,
  VolatilityState,
  VolatilityRegime,
  OIFundingAnalysis,
  RelativeStrengthResult,
  MarketPhase,
  MarketRegimeState,
  MarketRegime,
  TrendState,
  LongScoreBreakdown,
  ShortScoreBreakdown,
  ExecutionScore
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

// ---- Helpers to build synthetic scenarios ----

function makeTicker(overrides: Partial<TickerData> = {}): TickerData {
  return {
    symbol: 'TESTUSDT',
    lastPrice: 100,
    markPrice: 100,
    indexPrice: 100,
    bid1Price: 99.98,
    bid1Size: 100,
    ask1Price: 100.02,
    ask1Size: 100,
    highPrice24h: 105,
    lowPrice24h: 95,
    prevPrice24h: 98,
    prevPrice1h: 99,
    price24hPcnt: 0.02,
    volume24h: 100000,
    turnover24h: 10_000_000,
    openInterest: 50000,
    openInterestValue: 5_000_000,
    fundingRate: 0.0001,
    nextFundingTime: Date.now() + 4 * 3600_000,
    timestamp: Date.now(),
    ...overrides
  };
}

function makeIndicators(overrides: Partial<IndicatorState> = {}): IndicatorState {
  return {
    ema9: { '5': 99.5, '15': 99, '60': 98 },
    ema21: { '5': 99.2, '15': 98.5, '60': 97.5 },
    ema50: { '5': 98.8, '15': 98, '60': 96.5 },
    atr14: { '5': 0.8, '15': 1.5, '60': 2.5 },
    atrPercent: { '5': 0.8, '15': 1.5, '60': 2.5 },
    rsi14: { '5': 55, '15': 58, '60': 56 },
    roc5: { '5': 0.01, '15': 0.015, '60': 0.02 },
    roc14: { '5': 0.015, '15': 0.02, '60': 0.03 },
    vwap: { '5': 99.5, '15': 99.2, '60': 98.5 },
    volumeSma20: { '5': 500, '15': 1500, '60': 5000 },
    volumeRatio: { '5': 1.5, '15': 1.6, '60': 1.4 },
    lastUpdate: Date.now(),
    ...overrides
  };
}

function makeVolatility(): VolatilityState {
  return {
    atrPercent5m: 0.8,
    atrPercent15m: 1.5,
    atrPercent1h: 2.5,
    realizedVol: 0.02,
    rangeExpansion: 1.2,
    volatilityPercentile: 50,
    regime: VolatilityRegime.NORMAL
  };
}

function makeOIFunding(overrides: Partial<OIFundingAnalysis> = {}): OIFundingAnalysis {
  return {
    longScore: 8,
    shortScore: 2,
    fundingRate: 0.0001,
    oiChangePercent: 0.02,
    oiVelocity: 0.01,
    reasons: ['Healthy OI build'],
    dataCompleteness: 1.0,
    fundingReady: true,
    fundingHistoryCount: 5,
    ...overrides
  };
}

function makeRS(): RelativeStrengthResult {
  return {
    vsBTC: 0.015,
    vsETH: 0.012,
    vsSector: null,
    vsUniverse: 0.014,
    longScore: 12,
    shortScore: 0,
    availableWeight: 12,
    dataCompleteness: 1.0,
    reasons: ['Strong vs benchmark']
  };
}

function makeCandles(prices: { o: number; h: number; l: number; c: number; v?: number }[]): CircularBuffer<CandleData> {
  const buf = new CircularBuffer<CandleData>(prices.length + 10);
  const baseTime = Date.now() - prices.length * 15 * 60_000;
  for (let i = 0; i < prices.length; i++) {
    buf.push({
      timestamp: baseTime + i * 15 * 60_000,
      open: prices[i].o,
      high: prices[i].h,
      low: prices[i].l,
      close: prices[i].c,
      volume: prices[i].v ?? 1000,
      turnover: (prices[i].v ?? 1000) * prices[i].c,
      confirmed: true
    });
  }
  return buf;
}

const timingEngine = new TimingEngine();

// ============================================================
// TEST A: Accumulation -> Breakout Transition (Expected: EARLY_LONG)
// ============================================================

console.log('\n--- TEST A: Accumulation -> Breakout (Expected: EARLY_LONG) ---');
{
  // 15 bars of tight range (98-100), followed by bar 16 breaking out to 101.2 (+1.2%)
  const candles: { o: number; h: number; l: number; c: number }[] = [];
  for (let i = 0; i < 15; i++) {
    candles.push({ o: 99, h: 100, l: 98.5, c: 99.2 });
  }
  candles.push({ o: 99.5, h: 101.5, l: 99.5, c: 101.2 }); // breakout bar!

  const c15 = makeCandles(candles);
  const ticker = makeTicker({ lastPrice: 101.2, prevPrice1h: 99.5, price24hPcnt: 0.017 });
  const indicators = makeIndicators({
    rsi14: { '5': 60, '15': 62, '60': 55 },
    volumeRatio: { '5': 1.8, '15': 1.8, '60': 1.3 }
  });

  const res = timingEngine.analyze(
    ticker,
    indicators,
    makeVolatility(),
    undefined,
    c15,
    undefined,
    makeOIFunding({ oiChangePercent: 0.02 }),
    makeRS(),
    'LONG',
    85,
    0.008, // 5m return +0.8%
    0.017  // 1h return +1.7%
  );

  assert(
    res.signalCategory === 'EARLY_LONG',
    `Test A Signal Category is EARLY_LONG (got ${res.signalCategory})`
  );
  assert(
    res.moveMaturity === 'EARLY' || res.moveMaturity === 'DEVELOPING',
    `Test A Move Maturity is EARLY (got ${res.moveMaturity})`
  );
  assert(
    res.chaseRiskScore <= 45,
    `Test A Chase Risk Score is LOW (got ${res.chaseRiskScore})`
  );
  assert(
    res.momentumIgnitionScore >= 60,
    `Test A Momentum Ignition Score is HIGH (got ${res.momentumIgnitionScore})`
  );
}

// ============================================================
// TEST B: MANDATORY REGRESSION TEST (Current Problem: Already Pumped +15%)
// Expected: NOT LONG (NO_LONG or LATE_LONG)
// ============================================================

console.log('\n--- TEST B (MANDATORY): Already Pumped +15% at Top Wick (Expected: NO_LONG / LATE_LONG) ---');
{
  // 6 consecutive large green expansion bars pumping from 85 to 100 (+17%)
  const candles: { o: number; h: number; l: number; c: number; v?: number }[] = [
    { o: 85, h: 86, l: 84.5, c: 85.5 },
    { o: 85.5, h: 89, l: 85.5, c: 88.5 },
    { o: 88.5, h: 92, l: 88, c: 91.5 },
    { o: 91.5, h: 95, l: 91, c: 94.5 },
    { o: 94.5, h: 98, l: 94, c: 97.5 },
    { o: 97.5, h: 100.5, l: 97, c: 100, v: 4500 } // volume climax
  ];

  const c15 = makeCandles(candles);
  // Price is far above trigger base ($86), 1h move +15%, 5m move +4.5%
  const ticker = makeTicker({
    symbol: 'PUMPED_COIN',
    lastPrice: 100,
    prevPrice1h: 87, // +15% 1H
    price24hPcnt: 0.17
  });

  const indicators = makeIndicators({
    rsi14: { '5': 82, '15': 79, '60': 76 }, // heavily overbought
    volumeRatio: { '5': 3.5, '15': 3.2, '60': 2.8 }, // volume climax
    roc5: { '5': 0.005, '15': 0.02, '60': 0.05 } // fast ROC slowing down!
  });

  const oiFunding = makeOIFunding({
    fundingRate: 0.0006, // extreme positive crowded funding
    oiChangePercent: 0.08
  });

  const res = timingEngine.analyze(
    ticker,
    indicators,
    makeVolatility(),
    undefined,
    c15,
    undefined,
    oiFunding,
    makeRS(),
    'LONG',
    92, // Raw LongEngine would give 92
    0.045, // 5m return +4.5%
    0.15   // 1h return +15%
  );

  assert(
    res.signalCategory === 'NO_LONG' || res.signalCategory === 'LATE_LONG',
    `Test B: Pumped coin rejected from normal buy (Expected NO_LONG / LATE_LONG, got ${res.signalCategory})`
  );
  assert(
    res.signalCategory !== 'EARLY_LONG',
    'Test B: Pumped coin is NOT categorized as EARLY_LONG'
  );
  assert(
    res.chaseRiskScore >= 70,
    `Test B: Chase Risk Score is HIGH (got ${res.chaseRiskScore})`
  );
  assert(
    res.distanceFromTriggerATR >= 3.0,
    `Test B: Distance from trigger ATR is extended (got ${res.distanceFromTriggerATR}x ATR)`
  );
  assert(
    res.antiChaseReasons.length >= 2,
    `Test B: Anti-chase reasons generated (got ${res.antiChaseReasons.length} reasons)`
  );
}

// ============================================================
// TEST C: Distribution Detection (High OI, stalling price, upper wicks)
// Expected: distributionRisk high, NO_LONG
// ============================================================

console.log('\n--- TEST C: Distribution Signatures (Expected: distributionRisk HIGH -> NO_LONG) ---');
{
  // Price repeatedly testing 100 with long upper wicks and failing to close higher
  const candles: { o: number; h: number; l: number; c: number }[] = [
    { o: 95, h: 99, l: 94, c: 98 },
    { o: 98, h: 100.8, l: 97.5, c: 98.2 }, // upper rejection wick 1
    { o: 98.2, h: 100.9, l: 97.8, c: 98.1 }, // upper rejection wick 2
    { o: 98.1, h: 100.7, l: 97.9, c: 98.0 }  // upper rejection wick 3
  ];

  const c15 = makeCandles(candles);
  const ticker = makeTicker({ lastPrice: 98.0, prevPrice1h: 95, price24hPcnt: 0.08 });
  const indicators = makeIndicators({
    rsi14: { '5': 68, '15': 71, '60': 66 },
    volumeRatio: { '5': 2.8, '15': 2.6, '60': 2.0 },
    roc5: { '5': -0.002, '15': 0.005, '60': 0.03 } // negative 5m ROC
  });

  const oiFunding = makeOIFunding({
    fundingRate: 0.0005,
    oiChangePercent: 0.06 // OI increasing while price stalls!
  });

  const res = timingEngine.analyze(
    ticker,
    indicators,
    makeVolatility(),
    undefined,
    c15,
    undefined,
    oiFunding,
    makeRS(),
    'LONG',
    80,
    -0.002,
    0.06
  );

  assert(
    res.distributionRisk >= 60,
    `Test C: Distribution Risk is elevated (got ${res.distributionRisk})`
  );
  assert(
    res.signalCategory === 'NO_LONG' || res.signalCategory === 'LATE_LONG',
    `Test C: Distribution blocks normal entry (got ${res.signalCategory})`
  );
}

// ============================================================
// TEST D: Breakdown Beginning after Distribution (Expected: EARLY_SHORT)
// ============================================================

console.log('\n--- TEST D: Breakdown Ignition (Expected: EARLY_SHORT) ---');
{
  // 12 bars of tight consolidation at 99-100 range, then clean break below 98 support with volume
  const candles: { o: number; h: number; l: number; c: number }[] = [];
  for (let i = 0; i < 12; i++) {
    candles.push({ o: 99.2, h: 100.0, l: 98.5, c: 99.0 });
  }
  candles.push(
    { o: 99.0, h: 99.8, l: 98.2, c: 98.8 },
    { o: 98.8, h: 99.0, l: 97.2, c: 97.4 } // breakdown bar
  );

  const c15 = makeCandles(candles);
  const ticker = makeTicker({ lastPrice: 97.4, prevPrice1h: 99.5, price24hPcnt: -0.025 });
  const indicators = makeIndicators({
    ema9: { '5': 97.8, '15': 98.2, '60': 99 },
    ema21: { '5': 98.2, '15': 98.8, '60': 99.5 },
    rsi14: { '5': 42, '15': 44, '60': 48 },
    volumeRatio: { '5': 1.8, '15': 1.7, '60': 1.3 }
  });

  const res = timingEngine.analyze(
    ticker,
    indicators,
    makeVolatility(),
    undefined,
    c15,
    undefined,
    makeOIFunding({ oiChangePercent: 0.02, fundingRate: 0.0001 }),
    makeRS(),
    'SHORT',
    85,
    -0.008,
    -0.021
  );

  assert(
    res.signalCategory === 'EARLY_SHORT',
    `Test D Signal Category is EARLY_SHORT (got ${res.signalCategory})`
  );
  assert(
    res.chaseRiskScore <= 45,
    `Test D Chase Risk Score is LOW (got ${res.chaseRiskScore})`
  );
}

// ============================================================
// TEST E: Capitulation after -15% dump (Expected: NO_SHORT / LATE_SHORT)
// ============================================================

console.log('\n--- TEST E: Capitulation Dump (Expected: NO_SHORT / LATE_SHORT) ---');
{
  const candles: { o: number; h: number; l: number; c: number; v?: number }[] = [
    { o: 100, h: 100, l: 96, c: 96.5 },
    { o: 96.5, h: 96.5, l: 92, c: 92.5 },
    { o: 92.5, h: 92.5, l: 87, c: 87.5 },
    { o: 87.5, h: 88, l: 82, c: 83, v: 5000 } // climax panic dump
  ];

  const c15 = makeCandles(candles);
  const ticker = makeTicker({ lastPrice: 83, prevPrice1h: 96, price24hPcnt: -0.17 });
  const indicators = makeIndicators({
    rsi14: { '5': 18, '15': 21, '60': 25 }, // oversold
    volumeRatio: { '5': 3.8, '15': 3.5, '60': 2.8 }
  });

  const oiFunding = makeOIFunding({
    fundingRate: -0.0006, // extreme negative crowded shorts
    oiChangePercent: 0.08
  });

  const res = timingEngine.analyze(
    ticker,
    indicators,
    makeVolatility(),
    undefined,
    c15,
    undefined,
    oiFunding,
    makeRS(),
    'SHORT',
    90,
    -0.04,
    -0.14
  );

  assert(
    res.signalCategory === 'NO_SHORT' || res.signalCategory === 'LATE_SHORT',
    `Test E: Capitulated dump rejected from normal short (got ${res.signalCategory})`
  );
  assert(
    res.signalCategory !== 'EARLY_SHORT',
    'Test E: Capitulation is NOT categorized as EARLY_SHORT'
  );
}

// ============================================================
// TEST F: Anti-Chase Gate in FinalRanker (NO_LONG filtered out)
// ============================================================

console.log('\n--- TEST F: FinalRanker Anti-Chase Gate Filters out NO_LONG ---');
{
  const ranker = new FinalRanker(new CorrelationFilter());

  const dummyBreakdown: LongScoreBreakdown = {
    trend: 18, momentum: 14, relativeStrength: 13, volumeExpansion: 13,
    openInterest: 9, funding: 8, orderbook: 8, liquidation: 4,
    rawScore: 87, availableWeight: 100, normalizedScore: 87, dataCompleteness: 1.0,
    total: 87, modifiers: []
  };

  const shortBreakdown: ShortScoreBreakdown = {
    trend: 2, momentum: 2, relativeStrength: 0, volumeExpansion: 2,
    openInterest: 2, funding: 2, orderbook: 2, liquidation: 1,
    rawScore: 13, availableWeight: 100, normalizedScore: 13, dataCompleteness: 1.0,
    total: 13, modifiers: []
  };

  const execScore: ExecutionScore = {
    spreadScore: 25, slippageScore: 25, depthScore: 25, imbalanceScore: 15,
    total: 90, slippageBps: 2, marketImpactBps: 1
  };

  // Candidate with NO_LONG due to high chase risk
  const candidateScores: CandidateScores[] = [{
    symbol: 'PUMPUSDT',
    longScore: dummyBreakdown,
    shortScore: shortBreakdown,
    executionScore: execScore,
    ticker: makeTicker({ symbol: 'PUMPUSDT', lastPrice: 100, price24hPcnt: 0.18 }),
    volatility: makeVolatility(),
    liquidityTier: 'A',
    timing: {
      phase: { label: MarketPhase.LATE_EXPANSION, confidence: 0.8, evidence: ['Overextended'] },
      earlyMomentumScore: 10,
      momentumIgnitionScore: 10,
      momentumDecelerationScore: 65,
      moveMaturity: 'EXHAUSTED',
      moveMaturityScore: 85,
      signalFreshness: 20,
      chaseRiskScore: 88,
      distributionRisk: 75,
      accumulationRisk: 10,
      distanceFromTriggerPct: 12.5,
      distanceFromTriggerATR: 4.5,
      timingScore: 25,
      signalCategory: 'NO_LONG',
      sweepType: 'NONE',
      antiChaseReasons: ['Price 4.5x ATR above trigger base'],
      decision: 'BULLISH DIRECTION, BUT TOO LATE'
    },
    signalCategory: 'NO_LONG'
  }];

  const regime: MarketRegimeState = {
    regime: MarketRegime.STRONG_BULL,
    btcTrend: TrendState.STRONG_BULLISH,
    btcMomentum: 10,
    btcVolatility: VolatilityRegime.NORMAL,
    btcRealizedVol: 0.02,
    btcVwapPosition: 1,
    longModifier: 1.1,
    shortModifier: 0.9,
    timestamp: Date.now()
  };

  const output = ranker.rank(
    candidateScores,
    new Map(),
    regime,
    makeTicker({ symbol: 'BTCUSDT', lastPrice: 80000 }),
    0,
    10
  );

  assert(
    output.results.length === 0,
    'Test F: NO_LONG candidate is NOT included in qualified results'
  );
  assert(
    output.diagnostics.rejectionReasons.rejectedLateChase >= 1,
    `Test F: rejectedLateChase counter incremented (got ${output.diagnostics.rejectionReasons.rejectedLateChase})`
  );
}

// ============================================================
// TEST G: FinalRanker Prioritizes EARLY_LONG over Extended Candidates
// ============================================================

console.log('\n--- TEST G: Ranking Prioritizes EARLY_LONG over Late Continuation ---');
{
  const ranker = new FinalRanker(new CorrelationFilter());

  const execScore: ExecutionScore = {
    spreadScore: 25, slippageScore: 25, depthScore: 25, imbalanceScore: 15,
    total: 85, slippageBps: 2, marketImpactBps: 1
  };

  const longBreakdownEarly: LongScoreBreakdown = {
    trend: 16, momentum: 13, relativeStrength: 12, volumeExpansion: 12,
    openInterest: 8, funding: 8, orderbook: 7, liquidation: 3,
    rawScore: 79, availableWeight: 100, normalizedScore: 79, dataCompleteness: 1.0,
    total: 82, modifiers: []
  };

  const longBreakdownLate: LongScoreBreakdown = {
    trend: 19, momentum: 15, relativeStrength: 15, volumeExpansion: 15,
    openInterest: 9, funding: 8, orderbook: 8, liquidation: 4,
    rawScore: 93, availableWeight: 100, normalizedScore: 93, dataCompleteness: 1.0,
    total: 95, // higher raw score!
    modifiers: []
  };

  const shortBreakdown: ShortScoreBreakdown = {
    trend: 2, momentum: 2, relativeStrength: 0, volumeExpansion: 2,
    openInterest: 2, funding: 2, orderbook: 2, liquidation: 1,
    rawScore: 13, availableWeight: 100, normalizedScore: 13, dataCompleteness: 1.0,
    total: 13, modifiers: []
  };

  const candidates: CandidateScores[] = [
    // Candidate 1: Higher raw score (95), but LATE_LONG
    {
      symbol: 'LATECOIN',
      longScore: longBreakdownLate,
      shortScore: shortBreakdown,
      executionScore: execScore,
      ticker: makeTicker({ symbol: 'LATECOIN', lastPrice: 100, price24hPcnt: 0.14 }),
      volatility: makeVolatility(),
      liquidityTier: 'A',
      timing: {
        phase: { label: MarketPhase.LATE_EXPANSION, confidence: 0.75, evidence: [] },
        earlyMomentumScore: 30,
        momentumIgnitionScore: 30,
        momentumDecelerationScore: 40,
        moveMaturity: 'LATE',
        moveMaturityScore: 70,
        signalFreshness: 35,
        chaseRiskScore: 58,
        distributionRisk: 50,
        accumulationRisk: 10,
        distanceFromTriggerPct: 8.5,
        distanceFromTriggerATR: 3.2,
        timingScore: 48,
        signalCategory: 'LATE_LONG',
        sweepType: 'NONE',
        antiChaseReasons: ['Price 3.2x ATR above base'],
        decision: 'Wait for pullback'
      },
      signalCategory: 'LATE_LONG'
    },
    // Candidate 2: Lower raw score (82), but EARLY_LONG with high ignition
    {
      symbol: 'EARLYCOIN',
      longScore: longBreakdownEarly,
      shortScore: shortBreakdown,
      executionScore: execScore,
      ticker: makeTicker({ symbol: 'EARLYCOIN', lastPrice: 50, price24hPcnt: 0.015 }),
      volatility: makeVolatility(),
      liquidityTier: 'A',
      timing: {
        phase: { label: MarketPhase.MARKUP, confidence: 0.85, evidence: [] },
        earlyMomentumScore: 88,
        momentumIgnitionScore: 88,
        momentumDecelerationScore: 10,
        moveMaturity: 'EARLY',
        moveMaturityScore: 15,
        signalFreshness: 95,
        chaseRiskScore: 18,
        distributionRisk: 12,
        accumulationRisk: 10,
        distanceFromTriggerPct: 1.1,
        distanceFromTriggerATR: 0.8,
        timingScore: 92,
        signalCategory: 'EARLY_LONG',
        sweepType: 'NONE',
        antiChaseReasons: [],
        decision: 'Priority Long'
      },
      signalCategory: 'EARLY_LONG'
    }
  ];

  const regime: MarketRegimeState = {
    regime: MarketRegime.STRONG_BULL,
    btcTrend: TrendState.STRONG_BULLISH,
    btcMomentum: 10,
    btcVolatility: VolatilityRegime.NORMAL,
    btcRealizedVol: 0.02,
    btcVwapPosition: 1,
    longModifier: 1.0,
    shortModifier: 1.0,
    timestamp: Date.now()
  };

  const output = ranker.rank(
    candidates,
    new Map(),
    regime,
    makeTicker({ symbol: 'BTCUSDT', lastPrice: 80000 }),
    0,
    10
  );

  // Phase 5 Rule 22: results = actionableResults only. LATE_LONG is quarantined to watchlist.
  assert(
    output.results.length >= 1,
    `Test G: EARLYCOIN qualified in results (got ${output.results.length})`
  );
  assert(
    output.results[0].symbol === 'EARLYCOIN',
    `Test G: EARLYCOIN is ranked #1 in results (got ${output.results[0].symbol})`
  );
  assert(
    output.results[0].signalCategory === 'EARLY_LONG',
    'Test G: Rank #1 is tagged with EARLY_LONG category'
  );
  assert(
    output.watchlist && output.watchlist.some((w: any) => w.symbol === 'LATECOIN'),
    'Test G: LATECOIN is quarantined to watchlist (Rule 22)'
  );
}

// ============================================================
// TEST H: Fresh Breakout with Low Extension (Expected: EARLY_LONG)
// ============================================================

console.log('\n--- TEST H: Fresh Breakout with Low Extension ---');
{
  const candles: { o: number; h: number; l: number; c: number }[] = [
    { o: 10.0, h: 10.2, l: 9.8, c: 10.0 },
    { o: 10.0, h: 10.2, l: 9.9, c: 10.1 },
    { o: 10.1, h: 10.4, l: 10.0, c: 10.35 } // fresh break of 10.2
  ];

  const c15 = makeCandles(candles);
  const ticker = makeTicker({ lastPrice: 10.35, prevPrice1h: 10.1, price24hPcnt: 0.025 });
  const indicators = makeIndicators({
    atr14: { '5': 0.1, '15': 0.15, '60': 0.25 },
    rsi14: { '5': 62, '15': 64, '60': 58 },
    volumeRatio: { '5': 1.6, '15': 1.6, '60': 1.2 }
  });

  const res = timingEngine.analyze(
    ticker,
    indicators,
    makeVolatility(),
    undefined,
    c15,
    undefined,
    makeOIFunding({ oiChangePercent: 0.02 }),
    makeRS(),
    'LONG',
    82,
    0.01,
    0.025
  );

  assert(
    res.signalCategory === 'EARLY_LONG',
    `Test H: Fresh breakout is EARLY_LONG (got ${res.signalCategory})`
  );
  assert(
    res.distanceFromTriggerATR <= 1.5,
    `Test H: Price still near base (${res.distanceFromTriggerATR}x ATR)`
  );
}

// ============================================================
// TEST I: Bearish Liquidity Sweep Detection
// ============================================================

console.log('\n--- TEST I: Bearish Liquidity Sweep (Manipulation) ---');
{
  // Price spiked through 50 resistance to 52, but closed at 49.5 with huge upper wick
  const candles: { o: number; h: number; l: number; c: number }[] = [
    { o: 48, h: 50, l: 47.5, c: 49 },
    { o: 49, h: 50, l: 48.5, c: 49.5 },
    { o: 49.5, h: 52.0, l: 49.0, c: 49.6 } // spike to 52, closed at 49.6 -> 2.4 wick vs 0.1 body!
  ];

  const c15 = makeCandles(candles);
  const ticker = makeTicker({ lastPrice: 49.6, price24hPcnt: 0.03 });
  const indicators = makeIndicators({
    rsi14: { '5': 65, '15': 66, '60': 60 }
  });

  const res = timingEngine.analyze(
    ticker,
    indicators,
    makeVolatility(),
    undefined,
    c15,
    undefined,
    makeOIFunding(),
    makeRS(),
    'LONG',
    75,
    0.005,
    0.02
  );

  assert(
    res.sweepType === 'BEARISH_LIQUIDITY_SWEEP',
    `Test I: Detected BEARISH_LIQUIDITY_SWEEP (got ${res.sweepType})`
  );
  assert(
    res.phase.label === MarketPhase.MANIPULATION,
    `Test I: Phase classified as MANIPULATION (got ${res.phase.label})`
  );
}

// ============================================================
// TEST J: Fresh Breakdown with Low Extension (Expected: EARLY_SHORT)
// ============================================================

console.log('\n--- TEST J: Fresh Breakdown with Low Extension ---');
{
  const candles: { o: number; h: number; l: number; c: number }[] = [
    { o: 50, h: 50.5, l: 49.0, c: 49.5 },
    { o: 49.5, h: 50.0, l: 48.8, c: 49.0 },
    { o: 49.0, h: 49.2, l: 47.8, c: 48.0 } // fresh breakdown of 48.8
  ];

  const c15 = makeCandles(candles);
  const ticker = makeTicker({ lastPrice: 48.0, prevPrice1h: 49.5, price24hPcnt: -0.025 });
  const indicators = makeIndicators({
    atr14: { '5': 0.5, '15': 0.8, '60': 1.2 },
    rsi14: { '5': 40, '15': 42, '60': 46 },
    volumeRatio: { '5': 1.7, '15': 1.6, '60': 1.3 }
  });

  const res = timingEngine.analyze(
    ticker,
    indicators,
    makeVolatility(),
    undefined,
    c15,
    undefined,
    makeOIFunding({ oiChangePercent: 0.025 }),
    makeRS(),
    'SHORT',
    84,
    -0.012,
    -0.028
  );

  assert(
    res.signalCategory === 'EARLY_SHORT',
    `Test J: Fresh breakdown is EARLY_SHORT (got ${res.signalCategory})`
  );
  assert(
    res.chaseRiskScore <= 45,
    `Test J: Chase Risk is LOW (got ${res.chaseRiskScore})`
  );
}

// ============================================================
// FINAL SUMMARY
// ============================================================

console.log('\n====================================================');
console.log(`PHASE 3 TIMING & PHASE TESTS: ${passed} passed, ${failed} failed out of ${passed + failed}`);
console.log('====================================================');

if (failed > 0) {
  process.exit(1);
}
