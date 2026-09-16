// ============================================================
// P1 & P2 Regression Test Suite: Scoring, RS, Exhaustion, Squeeze & Diagnostics
// ============================================================

import { LongEngine } from '../src/engines/long-engine.js';
import { ShortEngine } from '../src/engines/short-engine.js';
import { ExhaustionEngine } from '../src/engines/exhaustion.js';
import { SqueezeEngine } from '../src/engines/squeeze.js';
import { RelativeStrengthEngine } from '../src/indicators/relative-strength.js';
import { MarketDataHub } from '../src/data/market-data-hub.js';
import { BybitRest } from '../src/data/bybit-rest.js';
import { FinalRanker } from '../src/ranking/final-ranker.js';
import { CorrelationFilter } from '../src/ranking/correlation.js';
import { CONFIG } from '../src/config.js';
import { 
  TickerData, IndicatorState, VolatilityState, MarketStructure, 
  OIFundingAnalysis, RelativeStrengthResult, TrendState, VolatilityRegime, 
  OIPriceState, CrowdingState 
} from '../src/data/types.js';
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

async function runP1P2Tests() {
  console.log('=== Running P1 & P2 Integrity & Logic Regression Tests ===\n');

  const longEngine = new LongEngine();
  const shortEngine = new ShortEngine();
  const exhaustionEngine = new ExhaustionEngine();
  const squeezeEngine = new SqueezeEngine();

  const dummyVol: VolatilityState = {
    atrPercent5m: 1.5,
    atrPercent15m: 3.0,
    atrPercent1h: 5.0,
    realizedVol: 0.012,
    rangeExpansion: 1.2,
    volatilityPercentile: 50,
    regime: VolatilityRegime.NORMAL
  };

  const dummyRegime: any = {
    regime: 'NEUTRAL',
    btcTrend: TrendState.NEUTRAL,
    longModifier: 1.0,
    shortModifier: 1.0
  };

  // ------------------------------------------------------------
  // Test P1 #5: Missing OI / Funding Does NOT Make Score Bearish
  // ------------------------------------------------------------
  console.log('--- P1 #5: Missing Data Normalization (Not Bearish) ---');

  const strongBullIndicators: IndicatorState = {
    ema9: { '5': 105, '15': 104, '60': 102 },
    ema21: { '5': 103, '15': 102, '60': 100 },
    ema50: { '5': 101, '15': 100, '60': 98 },
    atr14: { '5': 1.5, '15': 3.0, '60': 5.0 },
    atrPercent: { '5': 1.5, '15': 3.0, '60': 5.0 },
    rsi14: { '5': 60, '15': 62, '60': 60 },
    roc5: { '5': 0.01, '15': 0.02, '60': 0.03 },
    roc14: { '5': 0.02, '15': 0.03, '60': 0.05 },
    vwap: { '5': 102, '15': 101, '60': 99 },
    volumeSma20: { '5': 500, '15': 1000, '60': 2000 },
    volumeRatio: { '5': 1.5, '15': 2.0, '60': 1.8 },
    lastUpdate: Date.now()
  };

  const bullStructure: Record<string, MarketStructure> = {
    '5': { trend: TrendState.STRONG_BULLISH, lastSwingHigh: 106, lastSwingLow: 99, structures: [], confirmedPivotsCount: 4 },
    '15': { trend: TrendState.STRONG_BULLISH, lastSwingHigh: 106, lastSwingLow: 99, structures: [], confirmedPivotsCount: 4 },
    '60': { trend: TrendState.STRONG_BULLISH, lastSwingHigh: 106, lastSwingLow: 99, structures: [], confirmedPivotsCount: 4 }
  };

  const strongRS: RelativeStrengthResult = {
    vsBTC: 3.0, vsETH: 2.5, vsSector: 2.0, vsUniverse: 2.5,
    longScore: 14, shortScore: 0, availableWeight: 15, dataCompleteness: 1.0
  };

  const tickerWithMissingOIFunding: TickerData = {
    symbol: 'NEWCOIN',
    lastPrice: 105,
    markPrice: 105,
    indexPrice: 105,
    bid1Price: 104.9,
    bid1Size: 100,
    ask1Price: 105.1,
    ask1Size: 100,
    highPrice24h: 110,
    lowPrice24h: 95,
    prevPrice24h: 98,
    prevPrice1h: 100,
    price24hPcnt: 0.07,
    volume24h: 50_000_000,
    turnover24h: 50_000_000,
    openInterest: 0,
    openInterestValue: 0,
    fundingRate: NaN, // Unobserved / missing funding
    nextFundingTime: 0,
    timestamp: Date.now()
  };

  const unobservedOI: OIFundingAnalysis = {
    oiPriceState: OIPriceState.NEUTRAL,
    oiChangePercent: 0,
    fundingRate: NaN,
    fundingPercentile: null,
    longShortRatio: null,
    crowdingState: CrowdingState.BALANCED,
    longScore: 0,
    shortScore: 0,
    dataCompleteness: 0.0
  };

  const longScoreMissingOIFunding = longEngine.score(
    strongBullIndicators,
    tickerWithMissingOIFunding,
    dummyVol,
    bullStructure as any,
    unobservedOI,
    strongRS,
    null, // pending orderbook
    [],   // pending liquidations
    dummyRegime
  );

  // Raw score is high across Trend, Momentum, RS, Volume (sum ~55 out of 65 available)
  assert(
    longScoreMissingOIFunding.normalizedScore >= 75,
    `Missing OI/Funding does NOT penalize strong setup to bearish (normalizedScore is ${longScoreMissingOIFunding.normalizedScore.toFixed(1)} >= 75)`
  );
  assert(
    longScoreMissingOIFunding.availableWeight <= 75,
    `Available weight excludes unobserved OI & Funding (availableWeight is ${longScoreMissingOIFunding.availableWeight.toFixed(1)})`
  );
  assert(
    longScoreMissingOIFunding.dataCompleteness >= 0.65 && longScoreMissingOIFunding.dataCompleteness <= 0.75,
    `Data completeness accurately reflects observed components (~72.5%, got ${(longScoreMissingOIFunding.dataCompleteness * 100).toFixed(1)}%)`
  );

  // ------------------------------------------------------------
  // Test P1 #6: Relative Strength Universe Market Median
  // ------------------------------------------------------------
  console.log('\n--- P1 #6: Relative Strength Universe Market Median ---');

  class MockRestForRS extends BybitRest {
    override async getInstruments(): Promise<any> { return []; }
    override async getTickers(): Promise<any> { return new Map(); }
  }

  const hubRS = new MarketDataHub(new MockRestForRS());
  const now = Date.now();
  const fiveMinAgo = now - 300_000;

  // Populate 7 coins with varied 5m returns:
  // Returns: [-2%, -1%, 0%, +1%, +2%, +3%, +500% (extreme outlier)]
  // Sorted returns: [-0.02, -0.01, 0, 0.01, 0.02, 0.03, 5.0]
  // Median (index 3 of 7): +0.01 (+1.0%)
  const coinReturns = [
    { sym: 'COIN1', ret: -0.02 },
    { sym: 'COIN2', ret: -0.01 },
    { sym: 'COIN3', ret: 0.00 },
    { sym: 'COIN4', ret: 0.01 }, // MEDIAN
    { sym: 'COIN5', ret: 0.02 },
    { sym: 'COIN6', ret: 0.03 },
    { sym: 'OUTLIER', ret: 5.00 } // Extreme pump
  ];

  for (const c of coinReturns) {
    const buf = new TimestampedPriceRingBuffer(50);
    buf.push(fiveMinAgo, 100);
    buf.push(now, 100 * (1 + c.ret));
    hubRS.priceHistories.set(c.sym, buf);
  }

  const universeMedian = hubRS.getUniverseReturn(300_000, now);
  assert(
    universeMedian !== null && Math.abs(universeMedian - 0.01) < 0.001,
    `Universe return uses robust market median (+1.0%), unaffected by 500% outlier (got ${((universeMedian ?? 0) * 100).toFixed(2)}%)`
  );

  // ------------------------------------------------------------
  // Test P1 #8: Exhaustion Logic & Directional Consistency
  // ------------------------------------------------------------
  console.log('\n--- P1 #8: Exhaustion Logic & Directional Consistency ---');

  // Case A: Strong upward trend with rising OI
  const upTicker: TickerData = {
    ...tickerWithMissingOIFunding,
    price24hPcnt: 0.06,
    prevPrice1h: 100,
    lastPrice: 104 // +4.0% 1h move (> 3% threshold)
  };

  const risingOI: OIFundingAnalysis = {
    oiPriceState: OIPriceState.LONG_BUILD,
    oiChangePercent: 0.08, // +8% OI
    fundingRate: 0.0001,
    fundingPercentile: 50,
    longShortRatio: 1.0,
    crowdingState: CrowdingState.BALANCED,
    longScore: 8,
    shortScore: 0,
    dataCompleteness: 1.0
  };

  const exhaustionUp = exhaustionEngine.analyze(
    upTicker,
    strongBullIndicators,
    dummyVol,
    risingOI,
    0.04 // explicit +4% 1h return
  );

  assert(
    exhaustionUp.bearishExhaustion === 0,
    'Rising OI on upward move does NOT trigger bearish exhaustion (bearishExhaustion is 0)'
  );
  assert(
    exhaustionUp.bullishExhaustion > 0,
    `Rising OI and extended price on upmove correctly tags bullish exhaustion (${exhaustionUp.bullishExhaustion} pts)`
  );

  // ------------------------------------------------------------
  // Test P1 #9: Squeeze Engine Uses Explicit Window Return
  // ------------------------------------------------------------
  console.log('\n--- P1 #9: Squeeze Engine Window Return ---');

  // Over 5m window, price accelerated +2.5% (> CONFIG.SQUEEZE_PRICE_ACCELERATION 2%)
  const squeezeIndicators: IndicatorState = {
    ...strongBullIndicators,
    volumeRatio: { '5': 2.0, '15': 2.0, '60': 1.8 } // > 1.5 required for volExpanding
  };
  const squeezeResult = squeezeEngine.analyze(
    upTicker,
    null,
    [
      { timestamp: now, symbol: 'BTCUSDT', side: 'Buy', price: 105, size: 10 },
      { timestamp: now, symbol: 'BTCUSDT', side: 'Buy', price: 105, size: 10 },
      { timestamp: now, symbol: 'BTCUSDT', side: 'Buy', price: 105, size: 10 }
    ], // 3 short liquidations
    { ...risingOI, oiChangePercent: -0.01 }, // OI contracting (shorts covering)
    squeezeIndicators,
    0.025 // +2.5% window return
  );

  assert(
    squeezeResult.shortSqueeze === true,
    'Squeeze engine successfully detected Short Squeeze via explicit 5m window return'
  );
  assert(
    squeezeResult.longBonus > 0,
    `Awarded long squeeze bonus: +${squeezeResult.longBonus}`
  );

  // ------------------------------------------------------------
  // Test P2 #12: Comprehensive Pipeline Diagnostics
  // ------------------------------------------------------------
  console.log('\n--- P2 #12: Comprehensive Pipeline Diagnostics ---');

  const ranker = new FinalRanker(new CorrelationFilter());
  const lowCompletenessCandidate: any = {
    symbol: 'COLDCOIN',
    longScore: { total: 85, trend: 15, momentum: 10, dataCompleteness: 0.3, modifiers: [] },
    shortScore: { total: 20, trend: 0, momentum: 0, dataCompleteness: 0.3, modifiers: [] },
    executionScore: { total: 50, dataCompleteness: 0.5 },
    ticker: upTicker,
    volatility: { regime: 'NORMAL' },
    liquidityTier: 'B'
  };

  const rankOutput = ranker.rank(
    [lowCompletenessCandidate],
    new Map(),
    dummyRegime,
    upTicker,
    0,
    10,
    {
      universeSize: 739,
      eligibleSymbols: 688,
      stage1Candidates: 60,
      rejectedLowLiquidity: 628
    }
  );

  assert(
    rankOutput.diagnostics !== undefined,
    'ScreenerOutput includes PipelineDiagnostics object'
  );
  assert(
    rankOutput.diagnostics.universeSize === 739,
    'Diagnostics tracks universeSize: 739'
  );
  assert(
    rankOutput.diagnostics.eligibleSymbols === 688,
    'Diagnostics tracks eligibleSymbols: 688'
  );
  assert(
    rankOutput.diagnostics.rejectionReasons.rejectedLowCompleteness === 1,
    'Diagnostics tracked rejectedLowCompleteness: 1 (candidate rejected by completeness gate)'
  );
  assert(
    rankOutput.results.length === 0,
    'Incomplete candidate correctly blocked from qualifying results'
  );

  console.log(`\n=== P1 & P2 Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runP1P2Tests().catch(err => {
  console.error(err);
  process.exit(1);
});
