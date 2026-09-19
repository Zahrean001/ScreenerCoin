// ============================================================
// P0 Tests: Freshness SLA, Concurrency Limiter, & Staleness Gates
// ============================================================

import { computeFreshness, computeCandleFreshness } from '../src/utils/freshness.js';
import { ConcurrencyLimiter, CircuitBreaker } from '../src/utils/concurrency-limiter.js';
import { FinalRanker } from '../src/ranking/final-ranker.js';
import { CorrelationFilter } from '../src/ranking/correlation.js';
import { 
  TickerData, VolatilityState, ExecutionScore, LongScoreBreakdown, 
  ShortScoreBreakdown, TimingAnalysis, MarketRegimeState 
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

async function runTests() {
  console.log('====================================================');
  console.log(' RUNNING P0 FRESHNESS, CONCURRENCY & STALENESS TESTS ');
  console.log('====================================================\n');

  // --- TEST 1: AgeMs & Missing Timestamp Behavior ---
  console.log('--- TEST 1: computeFreshness determinism ---');
  const now = 1700000020000;
  const validTs = 1700000010000; // 10s ago
  const fresh = computeFreshness(validTs, now, 15_000);
  assert(fresh.ageMs === 10_000, 'ageMs correctly computed as 10,000ms');
  assert(fresh.isStale === false, '10s old is not stale within 15s SLA');
  assert(fresh.status === 'FRESH', 'Status is FRESH');

  const staleTs = 1700000000000; // 20s ago
  const stale = computeFreshness(staleTs, now, 15_000);
  assert(stale.ageMs === 20_000, 'ageMs correctly computed as 20,000ms');
  assert(stale.isStale === true, '20s old is stale past 15s SLA');
  assert(stale.status === 'STALE', 'Status is STALE');

  const missingTs = computeFreshness(null, now, 15_000);
  assert(missingTs.status === 'TIMESTAMP_UNAVAILABLE', 'Null timestamp yields TIMESTAMP_UNAVAILABLE');
  assert(missingTs.isStale === true, 'Missing timestamp is treated as stale for safety');
  assert(missingTs.sourceTimestamp === null, 'sourceTimestamp remains null, not faked Date.now()');

  // --- TEST 2: Candle Freshness & Confirmation ---
  console.log('\n--- TEST 2: Candle Freshness & Confirmation ---');
  const candleStart = 1700000000000;
  // 15m candle closes at candleStart + 900_000
  const candleClose = candleStart + 15 * 60_000;
  const recentCheck = candleClose + 5 * 60_000; // 5 min after close
  const freshCandle = computeCandleFreshness(candleStart, 15, true, recentCheck, 2.0);
  assert(freshCandle.isConfirmed === true, 'Closed candle reports isConfirmed=true');
  assert(freshCandle.isStale === false, 'Candle 5m after close is fresh (< 30m max)');

  const unconfirmed = computeCandleFreshness(candleStart, 15, false, recentCheck, 2.0);
  assert(unconfirmed.isConfirmed === false, 'Forming candle reports isConfirmed=false');

  const oldCheck = candleClose + 35 * 60_000; // 35 min after close (> 30m)
  const staleCandle = computeCandleFreshness(candleStart, 15, true, oldCheck, 2.0);
  assert(staleCandle.isStale === true, 'Candle 35m after close is marked stale');

  // --- TEST 3: Stale Data Blocks ACTIONABLE_NOW in FinalRanker ---
  console.log('\n--- TEST 3: Stale Bybit Data Blocks ACTIONABLE_NOW ---');
  const mockTicker: TickerData = {
    symbol: 'STALE_COIN_USDT',
    lastPrice: 100,
    markPrice: 100,
    indexPrice: 100,
    bid1Price: 99.9,
    bid1Size: 10,
    ask1Price: 100.1,
    ask1Size: 10,
    highPrice24h: 105,
    lowPrice24h: 95,
    prevPrice24h: 98,
    prevPrice1h: 99,
    price24hPcnt: 0.02,
    volume24h: 1_000_000,
    turnover24h: 100_000_000,
    openInterest: 50_000,
    openInterestValue: 5_000_000,
    fundingRate: 0.0001,
    nextFundingTime: Date.now() + 10_000_000,
    timestamp: Date.now() - 40_000 // 40s ago
  };

  const mockVolatility: VolatilityState = {
    atr14: 1.5,
    atrPercent: 0.015,
    realizedVol24h: 0.03,
    bollingerBandWidth: 0.04,
    historicalVolWindow: [1.5],
    isCompressing: false,
    compressionRatio: 1.0,
    regime: 'NORMAL'
  };

  const mockExec: ExecutionScore = {
    score: 85,
    total: 85,
    spreadCost: 0.0002,
    slippageEst: 0.0005,
    marketDepthScore: 85,
    liquidityTier: 'A',
    suggestedStopLoss: 98,
    stopLossDistancePct: 0.02,
    suggestedTakeProfit1: 104,
    takeProfit1DistancePct: 0.04,
    riskRewardRatio: 2.0,
    dataCompleteness: 1.0
  };

  const mockLong: LongScoreBreakdown = {
    trend: 18,
    momentum: 14,
    relativeStrength: 13,
    volumeExpansion: 13,
    openInterest: 8,
    funding: 8,
    orderbook: 8,
    liquidation: 4,
    rawScore: 86,
    availableWeight: 100,
    normalizedScore: 86,
    dataCompleteness: 1.0,
    total: 86,
    modifiers: [{ name: 'Strong Trend', value: 5, reason: 'EMA stacked' }]
  };

  const mockShort: ShortScoreBreakdown = {
    trend: 5,
    momentum: 5,
    relativeWeakness: 5,
    volumeExpansion: 5,
    openInterest: 5,
    funding: 5,
    orderbook: 5,
    liquidation: 2,
    rawScore: 32,
    availableWeight: 100,
    normalizedScore: 32,
    dataCompleteness: 1.0,
    total: 32,
    modifiers: []
  };

  const mockTiming: TimingAnalysis = {
    phase: { phase: 'EARLY_EXPANSION', label: 'Fresh Breakout', confidence: 85 },
    momentumIgnitionScore: 85,
    chaseRiskScore: 20, // Low chase risk
    actionabilityScore: 90,
    entryStatus: 'ACTIONABLE_NOW',
    signalFreshness: 90,
    distanceFromTriggerPct: 0.5,
    distanceFromTriggerATR: 0.4,
    timingScore: 88,
    signalCategory: 'EARLY_LONG',
    sweepType: 'NONE',
    antiChaseReasons: [],
    decision: 'BUY',
    // Stale Bybit data attached:
    freshness: {
      sourceTimestamp: Date.now() - 40_000,
      receivedAt: Date.now(),
      ageMs: 40_000,
      isStale: true,
      status: 'STALE'
    },
    actionableBlocked: true
  };

  const ranker = new FinalRanker(new CorrelationFilter());
  const regime: MarketRegimeState = {
    regime: 'RANGING',
    trend: 'SIDEWAYS',
    btcCorrelation: 0.5,
    volatility: 'NORMAL',
    timestamp: Date.now()
  };

  const output = ranker.rank(
    [{
      symbol: 'STALE_COIN_USDT',
      longScore: mockLong,
      shortScore: mockShort,
      executionScore: mockExec,
      ticker: mockTicker,
      volatility: mockVolatility,
      liquidityTier: 'A',
      timing: mockTiming,
      signalCategory: 'EARLY_LONG',
      actionableBlocked: true,
      freshness: mockTiming.freshness
    }],
    new Map(),
    regime,
    mockTicker,
    Date.now()
  );

  assert(output.results.length === 0, 'Stale Bybit candidate MUST NOT be in actionableResults');
  const allOutput = (output.results || []).concat(output.watchlist || []).concat(output.rejectedSignals || []);
  const staleCand = allOutput.find(c => c.symbol === 'STALE_COIN_USDT');
  assert(staleCand !== undefined, 'Stale candidate present in ranker output');
  assert(staleCand?.entryStatus === 'WAITING', 'Stale candidate entryStatus downgraded to WAITING');

  // --- TEST 4: Concurrency Limiter ---
  console.log('\n--- TEST 4: Concurrency Limiter Strict Maximum ---');
  const limiter = new ConcurrencyLimiter(3);
  let peakConcurrency = 0;
  let running = 0;

  const tasks = Array.from({ length: 9 }, async (_, idx) => {
    return limiter.run(async () => {
      running++;
      if (running > peakConcurrency) peakConcurrency = running;
      await new Promise(r => setTimeout(r, 20));
      running--;
      return idx;
    });
  });

  const results = await Promise.all(tasks);
  assert(results.length === 9, 'All 9 tasks completed');
  assert(peakConcurrency === 3, `Peak concurrency was exactly 3 (got: ${peakConcurrency})`);

  // --- TEST 5: Circuit Breaker Failure Threshold & Cooldown ---
  console.log('\n--- TEST 5: Circuit Breaker State Machine ---');
  const breaker = new CircuitBreaker(5, 50); // 50ms cooldown for fast test
  assert(breaker.getState() === 'CLOSED', 'Initial state is CLOSED');
  assert(breaker.isOpen() === false, 'isOpen() is false initially');

  // Record 4 failures
  for (let i = 0; i < 4; i++) breaker.recordFailure();
  assert(breaker.getState() === 'CLOSED', 'State still CLOSED after 4 failures');

  // 5th failure trips breaker
  breaker.recordFailure();
  assert(breaker.getState() === 'OPEN', 'Breaker tripped to OPEN on 5th failure');
  assert(breaker.isOpen() === true, 'isOpen() returns true while OPEN');

  // Wait for cooldown
  await new Promise(r => setTimeout(r, 60));
  assert(breaker.isOpen() === false, 'isOpen() returns false after cooldown (probe allowed)');
  assert(breaker.getState() === 'HALF_OPEN', 'State transitions to HALF_OPEN after cooldown');

  // Record success -> resets to CLOSED
  breaker.recordSuccess();
  assert(breaker.getState() === 'CLOSED', 'Successful probe resets state to CLOSED');
  assert(breaker.getConsecutiveFailures() === 0, 'Consecutive failures reset to 0');

  console.log('====================================================');
  console.log(`P0 TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
