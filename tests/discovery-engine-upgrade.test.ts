// ============================================================
// Discovery Engine Upgrade Test Suite
// Unit & Regression Tests for P0/P1 Features:
// 1. MarketDataHub.get15mReturn()
// 2. MarketDataHub.seedColdStartOIDeltas()
// 3. LongEngine Decoupled Alpha detection & bear veto protection
// 4. TimingEngine MTF LATE_EXPANSION distance override
// 5. TimingEngine Orderbook imbalance modifier -> actionabilityScore & ranking
// ============================================================

import { MarketDataHub } from '../src/data/market-data-hub.js';
import { LongEngine } from '../src/engines/long-engine.js';
import { TimingEngine } from '../src/engines/timing-engine.js';
import { MTFConfluenceEngine } from '../src/engines/mtf-confluence.js';
import { FinalRanker } from '../src/ranking/final-ranker.js';
import { CorrelationFilter } from '../src/ranking/correlation.js';
import { TimestampedPriceRingBuffer, CircularBuffer } from '../src/data/circular-buffer.js';
import {
  TickerData,
  CandleData,
  IndicatorState,
  VolatilityState,
  OIFundingAnalysis,
  RelativeStrengthResult,
  MarketRegimeState,
  MarketRegime,
  TrendState,
  VolatilityRegime,
  OrderbookSnapshot,
  OIPriceState,
  CrowdingState
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
function makeDummyTicker(symbol: string, price: number, turnover: number = 30_000_000, funding: number = 0.0001): TickerData {
  return {
    symbol,
    lastPrice: price,
    prevPrice24h: price * 0.98,
    price24hPcnt: 0.02,
    highPrice24h: price * 1.05,
    lowPrice24h: price * 0.95,
    prevPrice1h: price * 0.99,
    volume24h: turnover / price,
    turnover24h: turnover,
    openInterest: 100_000,
    openInterestValue: 100_000 * price,
    fundingRate: funding,
    nextFundingTime: Date.now() + 14400_000,
    bid1Price: price * 0.999,
    bid1Size: 1000,
    ask1Price: price * 1.001,
    ask1Size: 1000,
    timestamp: Date.now()
  };
}

function makeDummyIndicators(): IndicatorState {
  const tf = { '5': 1.0, '15': 1.0, '60': 1.0 };
  return {
    ema9: { '5': 105, '15': 104, '60': 102 },
    ema21: { '5': 103, '15': 102, '60': 100 },
    ema50: { '5': 101, '15': 100, '60': 98 },
    atr14: { '5': 1.5, '15': 2.0, '60': 3.5 },
    atrPercent: { '5': 0.015, '15': 0.02, '60': 0.035 },
    rsi14: { '5': 60, '15': 58, '60': 55 },
    roc5: { '5': 0.015, '15': 0.015, '60': 0.02 },
    roc14: { '5': 0.02, '15': 0.02, '60': 0.03 },
    vwap: { '5': 104, '15': 103, '60': 101 },
    volumeSma20: { '5': 5000, '15': 15000, '60': 60000 },
    volumeRatio: { '5': 1.8, '15': 1.6, '60': 1.2 },
    lastUpdate: Date.now()
  };
}

function makeDummyVolatility(): VolatilityState {
  return {
    atrPercent5m: 0.015,
    atrPercent15m: 0.020,
    atrPercent1h: 0.035,
    realizedVol: 0.03,
    rangeExpansion: 1.2,
    volatilityPercentile: 50,
    regime: VolatilityRegime.NORMAL
  };
}

async function runTests() {
  console.log('\n====================================================');
  console.log(' RUNNING DISCOVERY ENGINE UPGRADE TARGETED TESTS   ');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // TEST 1: MarketDataHub.get15mReturn()
  // ----------------------------------------------------
  console.log('--- TEST 1: MarketDataHub.get15mReturn() ---');
  const mockRest = {} as any;
  const hub = new MarketDataHub(mockRest);

  const sym = 'TESTUSDT';
  const priceBuf = new TimestampedPriceRingBuffer(100);
  const now = Date.now();
  // 15m ago = 100, now = 105 -> return = +5% (+0.05)
  priceBuf.push(now - 900_000, 100);
  priceBuf.push(now, 105);
  hub.priceHistories.set(sym, priceBuf);

  const ret15 = hub.get15mReturn(sym, now);
  assert(ret15.value !== null && Math.abs(ret15.value - 0.05) < 0.001, 'get15mReturn correctly returns 5% price return from timestamped buffer');
  assert(ret15.window === '15m', 'get15mReturn metadata specifies window "15m"');

  // ----------------------------------------------------
  // TEST 2: seedColdStartOIDeltas() integration
  // ----------------------------------------------------
  console.log('\n--- TEST 2: seedColdStartOIDeltas() ---');
  hub.tickers.set(sym, makeDummyTicker(sym, 105));
  mockRest.getOIDelta = async (s: string) => {
    return {
      symbol: s,
      currentOI: 120_000,
      oi15mAgo: 100_000,
      oi1hAgo: 95_000,
      oiChange15mPct: 0.20, // +20% OI change
      oiChange1hPct: 0.26,
      timestamp: Date.now()
    };
  };

  const count = await hub.seedColdStartOIDeltas([sym]);
  assert(count === 1, 'seedColdStartOIDeltas seeded 1 symbol successfully');
  assert(hub.historicalOIDeltas.has(sym), 'historicalOIDeltas map contains seeded snapshot');
  assert(hub.prevTickers.has(sym), 'prevTickers synthesized accurately');
  const prev = hub.prevTickers.get(sym)!;
  assert(prev.openInterest === 100_000, 'prevTicker has accurate historical OI from 15m ago (100,000)');
  // Since 15m return was 5%, lastPrice synthesized should be 105 / 1.05 = 100
  assert(Math.abs(prev.lastPrice - 100) < 0.1, `prevTicker price synthesized via 15m return (expected ~100, got ${prev.lastPrice.toFixed(2)})`);

  // ----------------------------------------------------
  // TEST 3: LongEngine Decoupled Alpha detection
  // ----------------------------------------------------
  console.log('\n--- TEST 3: Decoupled Alpha Detection in LongEngine ---');
  const longEngine = new LongEngine();
  const ind = makeDummyIndicators();
  const vol = makeDummyVolatility();
  const struct = {
    '5': { trend: TrendState.BULLISH, lastSwingHigh: 106, lastSwingLow: 102, structures: [], confirmedPivotsCount: 4 },
    '15': { trend: TrendState.BULLISH, lastSwingHigh: 106, lastSwingLow: 100, structures: [], confirmedPivotsCount: 4 },
    '60': { trend: TrendState.BULLISH, lastSwingHigh: 108, lastSwingLow: 96, structures: [], confirmedPivotsCount: 4 }
  };
  const oiFundingNormal: OIFundingAnalysis = {
    oiPriceState: OIPriceState.LONG_BUILD,
    oiChangePercent: 0.05,
    fundingRate: 0.0001, // Healthy normal funding
    fundingPercentile: 50,
    fundingReady: true,
    fundingHistoryCount: 10,
    longShortRatio: 1.1,
    crowdingState: CrowdingState.BALANCED,
    longScore: 8,
    shortScore: 2,
    dataCompleteness: 1.0
  };

  const strongBearRegime: MarketRegimeState = {
    regime: MarketRegime.STRONG_BEAR,
    btcTrend: TrendState.STRONG_BEARISH,
    btcMomentum: -60,
    btcVolatility: VolatilityRegime.HIGH,
    btcRealizedVol: 0.04,
    btcVwapPosition: -0.03,
    longModifier: 0.50, // 50% discount in strong bear
    shortModifier: 1.30,
    timestamp: Date.now()
  };

  // Scenario A: Outperforming leader (+3.5% vs BTC)
  const rsStrongLeader: RelativeStrengthResult = {
    vsBTC: 0.035, // +3.5% vs BTC
    vsETH: 0.040,
    vsSector: 0.020,
    vsUniverse: 0.030,
    longScore: 13,
    shortScore: 2,
    availableWeight: 15,
    dataCompleteness: 1.0
  };

  const scoreA = longEngine.score(
    ind,
    makeDummyTicker('ALPHA_USDT', 105, 50_000_000, 0.0001),
    vol,
    struct,
    oiFundingNormal,
    rsStrongLeader,
    null,
    [],
    strongBearRegime
  );

  assert(scoreA.isDecoupledAlpha === true, 'Outperforming leader with healthy funding triggers isDecoupledAlpha=true');
  const alphaMod = scoreA.modifiers.find(m => m.name === 'Decoupled Alpha Leader');
  assert(alphaMod !== undefined, 'Decoupled Alpha Leader modifier applied');
  assert(scoreA.total > (scoreA.normalizedScore * 0.55), `Score protected from full 0.50x bear veto (total: ${scoreA.total.toFixed(1)}, raw: ${scoreA.normalizedScore.toFixed(1)})`);

  // Scenario B: Leader with extreme negative funding (crowded short squeeze territory)
  const oiFundingExtremeNegative: OIFundingAnalysis = {
    ...oiFundingNormal,
    fundingRate: -0.0004 // Extreme short crowding
  };
  const scoreB = longEngine.score(
    ind,
    makeDummyTicker('SQUEEZE_USDT', 105, 50_000_000, -0.0004),
    vol,
    struct,
    oiFundingExtremeNegative,
    rsStrongLeader,
    null,
    [],
    strongBearRegime
  );
  assert(scoreB.isDecoupledAlpha === false, 'Extreme negative funding is NOT classified as organic Decoupled Alpha');

  // ----------------------------------------------------
  // TEST 4: TimingEngine MTF LATE_EXPANSION Override
  // ----------------------------------------------------
  console.log('\n--- TEST 4: TimingEngine MTF LATE_EXPANSION Distance Check ---');
  const timingEngine = new TimingEngine();

  // Mock 5m/15m candles where trigger was formed in past and price is now extended > 2.5x ATR
  const c5m = new CircularBuffer<CandleData>(30);
  const c15m = new CircularBuffer<CandleData>(30);
  const basePrice = 100;
  for (let i = 0; i < 20; i++) {
    const c: CandleData = {
      timestamp: now - (20 - i) * 300_000,
      open: basePrice + i * 0.5,
      high: basePrice + i * 0.5 + 0.5,
      low: basePrice + i * 0.5 - 0.2,
      close: basePrice + i * 0.5 + 0.3,
      volume: 1000,
      turnover: 100_000
    };
    c5m.push(c);
  }
  for (let i = 0; i < 15; i++) {
    const c: CandleData = {
      timestamp: now - (15 - i) * 900_000,
      open: basePrice + i * 1.5,
      high: basePrice + i * 1.5 + 1.0,
      low: basePrice + i * 1.5 - 0.5,
      close: basePrice + i * 1.5 + 0.8,
      volume: 3000,
      turnover: 300_000
    };
    c15m.push(c);
  }

  const timingLate = timingEngine.analyze(
    makeDummyTicker('LATE_USDT', 120), // Moved +20 points (>> 2.2x ATR of 2.0)
    ind,
    vol,
    c5m,
    c15m,
    undefined,
    oiFundingNormal,
    rsStrongLeader,
    'LONG',
    75,
    0.01,
    0.03,
    undefined,
    null,
    false,
    'MULTI_TIMEFRAME_ALIGNMENT'
  );

  assert(timingLate.distanceFromTriggerATR > 2.2, `Distance from trigger ATR is extended (${timingLate.distanceFromTriggerATR}x ATR)`);
  assert(timingLate.mtfConfluence === 'LATE_EXPANSION', `MTF Confluence automatically updated to LATE_EXPANSION (got: ${timingLate.mtfConfluence})`);

  // ----------------------------------------------------
  // TEST 5: Orderbook Imbalance Modifier -> actionabilityScore & Ranking
  // ----------------------------------------------------
  console.log('\n--- TEST 5: Orderbook Imbalance Modifier on Actionability & Ranking ---');

  const heavyBidOrderbook: OrderbookSnapshot = {
    symbol: 'BOOK_TEST',
    bids: [{ price: 100, size: 5000 }, { price: 99.5, size: 4000 }], // $900k bid depth
    asks: [{ price: 100.5, size: 1000 }, { price: 101, size: 1000 }], // $200k ask depth -> ratio ~4.5x
    timestamp: now
  };

  const heavyAskOrderbook: OrderbookSnapshot = {
    symbol: 'BOOK_TEST',
    bids: [{ price: 100, size: 1000 }, { price: 99.5, size: 1000 }], // $200k bid depth
    asks: [{ price: 100.5, size: 5000 }, { price: 101, size: 4000 }], // $900k ask depth -> ratio ~0.22x
    timestamp: now
  };

  const freshC5m = new CircularBuffer<CandleData>(30);
  const freshC15m = new CircularBuffer<CandleData>(30);
  for (let i = 0; i < 20; i++) {
    freshC5m.push({
      timestamp: now - (20 - i) * 300_000,
      open: 100, high: 101, low: 99.5, close: 100.2, volume: 1000, turnover: 100_000
    });
  }
  for (let i = 0; i < 15; i++) {
    freshC15m.push({
      timestamp: now - (15 - i) * 900_000,
      open: 100, high: 101, low: 99.5, close: 100.3, volume: 3000, turnover: 300_000
    });
  }

  const timingBidSupport = timingEngine.analyze(
    makeDummyTicker('BID_USDT', 100.5),
    ind,
    vol,
    freshC5m,
    freshC15m,
    undefined,
    oiFundingNormal,
    rsStrongLeader,
    'LONG',
    75,
    0.01,
    0.02,
    undefined,
    heavyBidOrderbook
  );

  const timingAskWall = timingEngine.analyze(
    makeDummyTicker('ASK_USDT', 100.5),
    ind,
    vol,
    freshC5m,
    freshC15m,
    undefined,
    oiFundingNormal,
    rsStrongLeader,
    'LONG',
    75,
    0.01,
    0.02,
    undefined,
    heavyAskOrderbook
  );

  assert(timingBidSupport.orderbookConfidenceModifier === 5, 'Heavy bid support grants +5 confidence modifier');
  assert(timingAskWall.orderbookConfidenceModifier === -8, 'Heavy ask resistance wall applies -8 confidence penalty');
  assert(timingAskWall.orderbookWarning !== null, 'Heavy ask resistance generates orderbook warning (fakeout risk)');
  assert(
    timingBidSupport.actionabilityScore > timingAskWall.actionabilityScore,
    `Actionability score directly impacted (Bid Support: ${timingBidSupport.actionabilityScore} vs Ask Wall: ${timingAskWall.actionabilityScore})`
  );

  // Verify FinalRanker ranks the bid support candidate higher due to actionability score weighting (35%)
  const finalRanker = new FinalRanker(new CorrelationFilter());
  const qualifyingScore = { ...scoreA, total: 78, normalizedScore: 85 };
  const rankerOutput = finalRanker.rank([
    {
      symbol: 'COIN_ASK_WALL',
      longScore: qualifyingScore,
      shortScore: scoreB,
      executionScore: {
        score: 80,
        total: 80,
        slippageEstimateBps: 2,
        marketImpactBps: 2,
        effectiveSpreadBps: 2,
        suggestedPositionSizeUSD: 1000,
        suggestedLeverage: 3,
        suggestedStopLoss: 98,
        suggestedTakeProfit1: 110,
        suggestedTakeProfit2: 115,
        stopLossDistancePct: 0.02,
        riskRewardRatio: 2.5,
        passed: true
      },
      ticker: makeDummyTicker('COIN_ASK_WALL', 105),
      volatility: vol,
      liquidityTier: 'A',
      timing: { ...timingAskWall, signalCategory: 'EARLY_LONG', entryStatus: 'ACTIONABLE_NOW', chaseRiskScore: 20 },
      actionabilityScore: timingAskWall.actionabilityScore,
      signalCategory: 'EARLY_LONG',
      entryStatus: 'ACTIONABLE_NOW'
    },
    {
      symbol: 'COIN_BID_SUPPORT',
      longScore: qualifyingScore,
      shortScore: scoreB,
      executionScore: {
        score: 80,
        total: 80,
        slippageEstimateBps: 2,
        marketImpactBps: 2,
        effectiveSpreadBps: 2,
        suggestedPositionSizeUSD: 1000,
        suggestedLeverage: 3,
        suggestedStopLoss: 98,
        suggestedTakeProfit1: 110,
        suggestedTakeProfit2: 115,
        stopLossDistancePct: 0.02,
        riskRewardRatio: 2.5,
        passed: true
      },
      ticker: makeDummyTicker('COIN_BID_SUPPORT', 105),
      volatility: vol,
      liquidityTier: 'A',
      timing: { ...timingBidSupport, signalCategory: 'EARLY_LONG', entryStatus: 'ACTIONABLE_NOW', chaseRiskScore: 20 },
      actionabilityScore: timingBidSupport.actionabilityScore,
      signalCategory: 'EARLY_LONG',
      entryStatus: 'ACTIONABLE_NOW'
    }
  ], new Map(), strongBearRegime, makeDummyTicker('BTCUSDT', 75000), 0, 50);

  assert(rankerOutput.results.length >= 1, 'Ranker produced qualified results');
  assert(rankerOutput.results[0].symbol === 'COIN_BID_SUPPORT', `Candidate with bid support ranks #1 over ask resistance wall (Rank 1: ${rankerOutput.results[0].symbol})`);

  console.log('\n====================================================');
  console.log(`TARGETED TESTS FINISHED: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
