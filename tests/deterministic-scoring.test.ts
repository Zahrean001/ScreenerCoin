// ============================================================
// Tests: Deterministic Scoring — Same Snapshot Yields Same Score
// ============================================================

import { LongEngine } from '../src/engines/long-engine.js';
import { ShortEngine } from '../src/engines/short-engine.js';
import {
  IndicatorState, TickerData, VolatilityState, MarketStructure,
  OIFundingAnalysis, RelativeStrengthResult, OrderbookSnapshot,
  LiquidationData, MarketRegimeState, MarketRegime, VolatilityRegime,
  TrendState, StructureType, OIPriceState, CrowdingState
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

function makeIndicators(): IndicatorState {
  return {
    ema9: { '5': 100.5, '15': 100.3, '60': 100.0 },
    ema21: { '5': 100.2, '15': 100.0, '60': 99.5 },
    ema50: { '5': 99.8, '15': 99.5, '60': 99.0 },
    atr14: { '5': 1.5, '15': 3.0, '60': 5.0 },
    atrPercent: { '5': 1.5, '15': 3.0, '60': 5.0 },
    rsi14: { '5': 60, '15': 62, '60': 58 },
    roc5: { '5': 0.005, '15': 0.01, '60': 0.02 },
    roc14: { '5': 0.01, '15': 0.02, '60': 0.04 },
    vwap: { '5': 99.8, '15': 99.5, '60': 99.0 },
    volumeSma20: { '5': 500, '15': 1000, '60': 3000 },
    volumeRatio: { '5': 1.2, '15': 1.5, '60': 1.3 },
    lastUpdate: Date.now()
  };
}

function makeTicker(): TickerData {
  return {
    symbol: 'TESTUSDT',
    lastPrice: 100,
    markPrice: 100,
    indexPrice: 100,
    bid1Price: 99.98,
    bid1Size: 1000,
    ask1Price: 100.02,
    ask1Size: 1000,
    highPrice24h: 105,
    lowPrice24h: 95,
    prevPrice24h: 98,
    prevPrice1h: 99,
    price24hPcnt: 0.02,
    volume24h: 100_000,
    turnover24h: 10_000_000,
    openInterest: 50_000,
    openInterestValue: 5_000_000,
    fundingRate: 0.0001,
    nextFundingTime: 0,
    timestamp: Date.now()
  };
}

function makeVolatility(): VolatilityState {
  return {
    atrPercent5m: 1.5,
    atrPercent15m: 3.0,
    atrPercent1h: 5.0,
    realizedVol: 0.012,
    rangeExpansion: 1.2,
    volatilityPercentile: 50,
    regime: VolatilityRegime.NORMAL
  };
}

function makeStructure(): Record<string, MarketStructure> {
  const s: MarketStructure = {
    trend: TrendState.BULLISH,
    lastSwingHigh: 105,
    lastSwingLow: 95,
    structures: [StructureType.HIGHER_HIGH, StructureType.HIGHER_LOW],
    confirmedPivotsCount: 4
  };
  return { '5': s, '15': s, '60': s };
}

function makeOiFunding(): OIFundingAnalysis {
  return {
    oiPriceState: OIPriceState.LONG_BUILD,
    oiChangePercent: 5.0,
    fundingRate: 0.0001,
    fundingPercentile: 50,
    longShortRatio: 1.0,
    crowdingState: CrowdingState.BALANCED,
    longScore: 8,
    shortScore: 3,
    dataCompleteness: 1.0
  };
}

function makeRS(): RelativeStrengthResult {
  return {
    vsBTC: 2.0,
    vsETH: 1.5,
    vsSector: 1.0,
    vsUniverse: 1.5,
    longScore: 10,
    shortScore: 2,
    availableWeight: 15,
    dataCompleteness: 1.0,
    sector: 'L1'
  };
}

function makeRegime(): MarketRegimeState {
  return {
    regime: MarketRegime.STRONG_BULL,
    btcTrend: TrendState.STRONG_BULLISH,
    btcVolatility: VolatilityRegime.NORMAL,
    btcRealizedVol: 0.015,
    btcMomentum: 25,
    btcVwapPosition: 0.01,
    longModifier: 1.1,
    shortModifier: 0.85,
    timestamp: Date.now()
  };
}

async function run() {
  console.log('=== Running Deterministic Scoring Tests ===\n');

  const longEngine = new LongEngine();
  const shortEngine = new ShortEngine();

  const indicators = makeIndicators();
  const ticker = makeTicker();
  const volatility = makeVolatility();
  const structure = makeStructure() as any;
  const oiFunding = makeOiFunding();
  const rs = makeRS();
  const regime = makeRegime();

  const orderbook: OrderbookSnapshot = {
    symbol: 'TESTUSDT',
    timestamp: Date.now(),
    updateId: 1,
    bids: [{ price: 99.98, size: 1000 }, { price: 99.95, size: 2000 }],
    asks: [{ price: 100.02, size: 1000 }, { price: 100.05, size: 2000 }]
  };
  const liqs: LiquidationData[] = [];

  // Run LONG engine twice with identical inputs
  const long1 = longEngine.score(indicators, ticker, volatility, structure, oiFunding, rs, orderbook, liqs, regime);
  const long2 = longEngine.score(indicators, ticker, volatility, structure, oiFunding, rs, orderbook, liqs, regime);

  assert(long1.total === long2.total, `LONG total is deterministic: ${long1.total} === ${long2.total}`);
  assert(long1.rawScore === long2.rawScore, `LONG rawScore is deterministic: ${long1.rawScore} === ${long2.rawScore}`);
  assert(long1.normalizedScore === long2.normalizedScore, 'LONG normalizedScore is deterministic');
  assert(long1.dataCompleteness === long2.dataCompleteness, 'LONG dataCompleteness is deterministic');

  // Run SHORT engine twice with identical inputs
  const short1 = shortEngine.score(indicators, ticker, volatility, structure, oiFunding, rs, orderbook, liqs, regime);
  const short2 = shortEngine.score(indicators, ticker, volatility, structure, oiFunding, rs, orderbook, liqs, regime);

  assert(short1.total === short2.total, `SHORT total is deterministic: ${short1.total} === ${short2.total}`);
  assert(short1.rawScore === short2.rawScore, `SHORT rawScore is deterministic: ${short1.rawScore} === ${short2.rawScore}`);
  assert(short1.normalizedScore === short2.normalizedScore, 'SHORT normalizedScore is deterministic');
  assert(short1.dataCompleteness === short2.dataCompleteness, 'SHORT dataCompleteness is deterministic');

  // Verify scores are non-trivial (not all zero)
  assert(long1.total > 0, `LONG score is non-trivial: ${long1.total.toFixed(1)}`);
  assert(long1.rawScore > 0, `LONG rawScore is non-trivial: ${long1.rawScore.toFixed(1)}`);

  // === Missing Data Scoring Tests ===
  console.log('\n--- Missing Data Scoring ---');

  // All null indicators
  const nullIndicators: IndicatorState = {
    ema9: { '5': null, '15': null, '60': null },
    ema21: { '5': null, '15': null, '60': null },
    ema50: { '5': null, '15': null, '60': null },
    atr14: { '5': null, '15': null, '60': null },
    atrPercent: { '5': null, '15': null, '60': null },
    rsi14: { '5': null, '15': null, '60': null },
    roc5: { '5': null, '15': null, '60': null },
    roc14: { '5': null, '15': null, '60': null },
    vwap: { '5': null, '15': null, '60': null },
    volumeSma20: { '5': null, '15': null, '60': null },
    volumeRatio: { '5': null, '15': null, '60': null },
    lastUpdate: 0
  };

  const nullRS: RelativeStrengthResult = {
    vsBTC: null, vsETH: null, vsSector: null, vsUniverse: null,
    longScore: 0, shortScore: 0, availableWeight: 0, dataCompleteness: 0, sector: null
  };

  const nullOI: OIFundingAnalysis = {
    oiPriceState: OIPriceState.NEUTRAL,
    oiChangePercent: 0,
    fundingRate: 0,
    fundingPercentile: null,
    longShortRatio: null,
    crowdingState: CrowdingState.BALANCED,
    longScore: 0,
    shortScore: 0,
    dataCompleteness: 0.0
  };

  const emptyStructure: Record<string, MarketStructure> = {
    '5': { trend: TrendState.NEUTRAL, lastSwingHigh: 0, lastSwingLow: 0, structures: [], confirmedPivotsCount: 0 },
    '15': { trend: TrendState.NEUTRAL, lastSwingHigh: 0, lastSwingLow: 0, structures: [], confirmedPivotsCount: 0 },
    '60': { trend: TrendState.NEUTRAL, lastSwingHigh: 0, lastSwingLow: 0, structures: [], confirmedPivotsCount: 0 }
  };

  const longMissing = longEngine.score(
    nullIndicators, ticker, makeVolatility(), emptyStructure as any,
    nullOI, nullRS, null, [], regime
  );

  assert(longMissing.dataCompleteness < 0.7, `Data completeness drops with missing data: ${longMissing.dataCompleteness.toFixed(2)}`);
  assert(longMissing.availableWeight < 90, `Available weight is reduced: ${longMissing.availableWeight.toFixed(1)}`);
  assert(longMissing.rawScore < 30, `Raw score correctly low on missing data: ${longMissing.rawScore.toFixed(1)}`);

  console.log(`\n=== Deterministic Scoring Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
