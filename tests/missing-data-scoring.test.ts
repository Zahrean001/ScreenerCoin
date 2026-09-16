// ============================================================
// Tests: Missing Data & Normalization Edge Cases
// ============================================================

import { LongEngine } from '../src/engines/long-engine.js';
import { ShortEngine } from '../src/engines/short-engine.js';
import {
  IndicatorState, TickerData, VolatilityState, MarketStructure,
  OIFundingAnalysis, RelativeStrengthResult, MarketRegimeState,
  MarketRegime, VolatilityRegime, TrendState, OIPriceState, CrowdingState
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

async function run() {
  console.log('=== Running Missing Data & Completeness Scoring Tests ===\n');

  const longEngine = new LongEngine();
  const shortEngine = new ShortEngine();

  const dummyTicker: TickerData = {
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

  const dummyVol: VolatilityState = {
    atrPercent5m: 1.5,
    atrPercent15m: 3.0,
    atrPercent1h: 5.0,
    realizedVol: 0.012,
    rangeExpansion: 1.2,
    volatilityPercentile: 50,
    regime: VolatilityRegime.NORMAL
  };

  const dummyRegime: MarketRegimeState = {
    regime: MarketRegime.NEUTRAL,
    btcTrend: TrendState.NEUTRAL,
    btcVolatility: VolatilityRegime.NORMAL,
    btcRealizedVol: 0.015,
    btcMomentum: 0,
    btcVwapPosition: 0,
    longModifier: 1.0,
    shortModifier: 1.0,
    timestamp: Date.now()
  };

  const emptyStructure: Record<string, MarketStructure> = {
    '5': { trend: TrendState.NEUTRAL, lastSwingHigh: 0, lastSwingLow: 0, structures: [], confirmedPivotsCount: 0 },
    '15': { trend: TrendState.NEUTRAL, lastSwingHigh: 0, lastSwingLow: 0, structures: [], confirmedPivotsCount: 0 },
    '60': { trend: TrendState.NEUTRAL, lastSwingHigh: 0, lastSwingLow: 0, structures: [], confirmedPivotsCount: 0 }
  };

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

  // Case 1: Missing orderbook, missing liquidations, missing RS, missing OI
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

  const longCase1 = longEngine.score(nullIndicators, dummyTicker, dummyVol, emptyStructure as any, nullOI, nullRS, null, [], dummyRegime);
  assert(longCase1.dataCompleteness < 0.70, 'dataCompleteness accurately reflects missing fields');
  assert(longCase1.availableWeight < 70, 'availableWeight scales down when inputs are unobserved');
  assert(!isNaN(longCase1.total), 'total is a valid number (no NaN)');
  assert(!isNaN(longCase1.normalizedScore), 'normalizedScore is a valid number (no NaN)');

  // Case 2: Only orderbook missing, other components fully present
  const fullIndicators: IndicatorState = {
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

  const fullRS: RelativeStrengthResult = {
    vsBTC: 2.0, vsETH: 1.5, vsSector: 1.0, vsUniverse: 1.5,
    longScore: 12, shortScore: 1, availableWeight: 15, dataCompleteness: 1.0, sector: 'DEFI'
  };

  const fullOI: OIFundingAnalysis = {
    oiPriceState: OIPriceState.LONG_BUILD,
    oiChangePercent: 5.0,
    fundingRate: 0.0001,
    fundingPercentile: 60,
    longShortRatio: 1.2,
    crowdingState: CrowdingState.BALANCED,
    longScore: 8,
    shortScore: 2,
    dataCompleteness: 1.0
  };

  const longNoBook = longEngine.score(fullIndicators, dummyTicker, dummyVol, emptyStructure as any, fullOI, fullRS, null, [], dummyRegime);
  assert(longNoBook.availableWeight === 92.5, 'availableWeight is 92.5 (5pt neutral fallback for missing book, 2.5pt neutral fallback for missing liq)');
  assert(longNoBook.dataCompleteness >= 0.92, 'dataCompleteness is >= 92% with only book/liq pending');
  assert(longNoBook.total > 50, 'Score is well above baseline with strong signals despite pending book');

  console.log(`\n=== Missing Data Scoring Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
