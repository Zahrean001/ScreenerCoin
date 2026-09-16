// ============================================================
// Phase 4 Test Suite: Early Momentum Discovery & Triple-Tier Partitioning
// Tests 1 to 12 + Mandatory Current Problem Test + Mandatory Early Momentum Test
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
  SymbolInfo
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
    ema55: { '5': 99, '15': 98.5, '60': 97.5, '240': 96, 'D': 92 },
    sma200: { '15': 97, '60': 95, '240': 92, 'D': 90 },
    vwap: { '5': 99.8, '15': 99.5, '60': 99 },
    rsi14: { '5': 55, '15': 56, '60': 58 },
    atr14: { '5': 0.8, '15': 1.2, '60': 2.0 },
    volumeRatio: { '5': 1.3, '15': 1.4, '60': 1.2 },
    roc5: { '15': 0.015 },
    roc14: { '15': 0.02 },
    macd: { '15': { macd: 0.2, signal: 0.1, histogram: 0.1 } },
    bollingerBands: { '15': { upper: 102, middle: 100, lower: 98, bandwidth: 0.04, percentB: 0.6 } },
    ...overrides
  };
}

function makeVolatility(overrides: Partial<VolatilityState> = {}): VolatilityState {
  return {
    atr: 1.2,
    atrPercent: 0.012,
    atrSmaRatio: 1.05,
    bbWidth: 0.04,
    bbWidthPercentile: 45,
    historicalVolatility: 0.35,
    parkinsonVol: 0.32,
    regime: 'NORMAL',
    isExpanding: false,
    isCompressing: false,
    ...overrides
  };
}

function makeOIFunding(overrides: Partial<OIFundingAnalysis> = {}): OIFundingAnalysis {
  return {
    oiChangePercent: 0.015,
    oiInterpretation: 'LONG_ACCUMULATION',
    predictedRate: 0.0001,
    rateVelocity: 0,
    regime: 'NORMAL',
    historicalRates: [0.0001, 0.0001, 0.0001],
    volumeOiRatio: 3.0,
    fundingRate: 0.0001,
    fundingPercentile: 50,
    isCrowded: false,
    squeezeRisk: 'LOW',
    oiZScore: 0.5,
    ...overrides
  };
}

function makeRS(overrides: Partial<RelativeStrengthResult> = {}): RelativeStrengthResult {
  return {
    rsRatio5m: 1.1,
    rsRatio15m: 1.2,
    rsRatio1h: 1.15,
    rsRatio4h: 1.05,
    rsScore: 75,
    longScore: 12,
    shortScore: 3,
    betaToBtc: 1.0,
    correlationToBtc: 0.7,
    alpha5m: 0.005,
    alpha1h: 0.01,
    relativeVolume: 1.3,
    ...overrides
  };
}

function makeBreakdown(total: number): LongScoreBreakdown {
  return {
    trend: Math.min(20, total * 0.25),
    momentum: Math.min(15, total * 0.20),
    relativeStrength: Math.min(15, total * 0.20),
    volumeExpansion: Math.min(15, total * 0.15),
    openInterest: Math.min(10, total * 0.10),
    funding: 8,
    orderbook: 7,
    liquidation: 3,
    rawScore: total,
    total,
    penalties: [],
    modifiers: [{ name: 'Setup Mod', value: 5, reason: 'Valid setup' }],
    dataCompleteness: 0.9
  };
}

function makeCandles(count: number, basePrice: number, rangeSpread: number, trendPct: number = 0): CandleData[] {
  const list: CandleData[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const time = now - (count - i) * 300_000;
    const center = basePrice * (1 + (trendPct * (i / count)));
    const open = center - (rangeSpread * 0.2);
    const close = center + (rangeSpread * 0.2);
    const high = center + (rangeSpread * 0.5);
    const low = center - (rangeSpread * 0.5);
    list.push({
      timestamp: time,
      open,
      high,
      low,
      close,
      volume: 1000,
      turnover: 1000 * center
    });
  }
  return list;
}

export async function runPhase4Tests() {
  console.log('\n====================================================');
  console.log(' RUNNING PHASE 4: EARLY MOMENTUM DISCOVERY TESTS   ');
  console.log('====================================================\n');

  const timingEngine = new TimingEngine();
  const triggerTracker = new TriggerTracker();
  const stateMachine = new SetupStateMachine();

  // ----------------------------------------------------
  // TEST 1: Clean Early Breakout (Lane B Ignition)
  // ----------------------------------------------------
  {
    console.log('--- TEST 1: Clean Early Breakout (Fresh Ignition) ---');
    // 10 candles tight accumulation (100 +/- 0.5) then 1 breakout candle to 101.2 (+1.2%)
    const candles = makeCandles(12, 100, 1.0);
    // last candle breaks out cleanly
    candles.push({
      timestamp: Date.now() - 60_000,
      open: 100.2,
      high: 101.5,
      low: 100.1,
      close: 101.2,
      volume: 2500,
      turnover: 250000
    });

    const c5Buf = new CircularBuffer<CandleData>(20);
    const c15Buf = new CircularBuffer<CandleData>(20);
    candles.forEach(c => { c5Buf.push(c); c15Buf.push(c); });

    const ticker = makeTicker('EARLY_COIN', 101.2);
    const indicators = makeIndicators({
      volumeRatio: { '5': 1.8, '15': 1.6, '60': 1.2 },
      atr14: { '5': 0.8, '15': 1.0, '60': 1.5 }
    });

    const analysis = timingEngine.analyze(
      ticker,
      indicators,
      makeVolatility(),
      c5Buf,
      c15Buf,
      undefined,
      makeOIFunding({ oiChangePercent: 0.02 }),
      makeRS(),
      'LONG',
      85,
      0.008, // 5m return +0.8%
      0.015, // 1h return +1.5%
      'LANE_B_BULLISH_IGNITION'
    );

    assert(analysis.signalCategory === 'EARLY_LONG', `Test 1: Must be EARLY_LONG (got ${analysis.signalCategory})`);
    assert(analysis.momentumIgnitionScore >= 60, `Test 1: High ignition score >= 60 (got ${analysis.momentumIgnitionScore})`);
    assert(analysis.chaseRiskScore <= 45, `Test 1: Low chase risk <= 45 (got ${analysis.chaseRiskScore})`);
    assert(analysis.distanceFromTriggerATR <= 1.5, `Test 1: Distance from trigger ATR <= 1.5 (got ${analysis.distanceFromTriggerATR})`);
  }

  // ----------------------------------------------------
  // TEST 2: Extended Breakout (Chase Risk Veto)
  // ----------------------------------------------------
  {
    console.log('\n--- TEST 2: Extended Breakout (Already moved +12%) ---');
    const candles = makeCandles(15, 100, 1.0);
    // price advanced from 100 to 112 (+12%)
    candles.push({
      timestamp: Date.now() - 3600_000,
      open: 100.5,
      high: 102.0,
      low: 100.2,
      close: 101.8,
      volume: 3000,
      turnover: 300000
    });
    // multiple impulse candles
    for (let i = 1; i <= 6; i++) {
      candles.push({
        timestamp: Date.now() - (6 - i) * 600_000,
        open: 102 + (i * 1.5),
        high: 102 + (i * 1.8),
        low: 102 + (i * 1.4),
        close: 102 + (i * 1.7),
        volume: 3500,
        turnover: 380000
      });
    }

    const c5Buf = new CircularBuffer<CandleData>(25);
    const c15Buf = new CircularBuffer<CandleData>(25);
    candles.forEach(c => { c5Buf.push(c); c15Buf.push(c); });

    const ticker = makeTicker('LATE_COIN', 112.5);
    const indicators = makeIndicators({
      rsi14: { '5': 78, '15': 76, '60': 74 },
      volumeRatio: { '5': 2.8, '15': 2.5, '60': 2.0 },
      atr14: { '5': 1.0, '15': 1.2, '60': 1.5 }
    });

    const analysis = timingEngine.analyze(
      ticker,
      indicators,
      makeVolatility(),
      c5Buf,
      c15Buf,
      undefined,
      makeOIFunding({ fundingRate: 0.0005 }),
      makeRS(),
      'LONG',
      85,
      0.025,
      0.12, // +12% 1h return
      'LANE_D_HOT_MOVER'
    );

    assert(analysis.signalCategory !== 'EARLY_LONG', `Test 2: Must NOT be EARLY_LONG (got ${analysis.signalCategory})`);
    assert(analysis.signalCategory === 'NO_LONG' || analysis.signalCategory === 'LATE_LONG', `Test 2: Must be NO_LONG or LATE_LONG (got ${analysis.signalCategory})`);
    assert(analysis.chaseRiskScore >= 50, `Test 2: High chase risk >= 50 (got ${analysis.chaseRiskScore})`);
  }

  // ----------------------------------------------------
  // TEST 3: High Score Without Fresh Trigger
  // ----------------------------------------------------
  {
    console.log('\n--- TEST 3: High Score Without Fresh Trigger ---');
    // Wide range chop (no recent breakout)
    const candles = makeCandles(20, 100, 8.0); // 8% range chop

    const c5Buf = new CircularBuffer<CandleData>(20);
    const c15Buf = new CircularBuffer<CandleData>(20);
    candles.forEach(c => { c5Buf.push(c); c15Buf.push(c); });

    const ticker = makeTicker('CHOP_COIN', 102);
    const indicators = makeIndicators({
      rsi14: { '5': 65, '15': 64, '60': 62 }
    });

    const analysis = timingEngine.analyze(
      ticker,
      indicators,
      makeVolatility(),
      c5Buf,
      c15Buf,
      undefined,
      makeOIFunding(),
      makeRS(),
      'LONG',
      80,
      0.001,
      0.005
    );

    assert(analysis.signalCategory !== 'EARLY_LONG', `Test 3: Must NOT qualify as EARLY_LONG without fresh trigger (got ${analysis.signalCategory})`);
  }

  // ----------------------------------------------------
  // TEST 4: Distribution Vetoes Bullish Direction
  // ----------------------------------------------------
  {
    console.log('\n--- TEST 4: Distribution Veto Overrides Bullish Direction ---');
    const candles = makeCandles(15, 100, 1.5);
    // Pump followed by stalling and upper rejection wicks
    candles.push({
      timestamp: Date.now() - 600_000,
      open: 107,
      high: 110,
      low: 106.8,
      close: 107.2, // long upper wick
      volume: 4000,
      turnover: 430000
    });
    candles.push({
      timestamp: Date.now() - 300_000,
      open: 107.2,
      high: 109.8,
      low: 106.5,
      close: 106.9, // second long upper wick
      volume: 4200,
      turnover: 450000
    });

    const c5Buf = new CircularBuffer<CandleData>(20);
    const c15Buf = new CircularBuffer<CandleData>(20);
    candles.forEach(c => { c5Buf.push(c); c15Buf.push(c); });

    const ticker = makeTicker('DISTRIB_COIN', 106.9);
    const indicators = makeIndicators({
      rsi14: { '5': 72, '15': 71, '60': 68 },
      volumeRatio: { '5': 2.6, '15': 2.7, '60': 2.2 },
      atr14: { '15': 1.2 }
    });

    const analysis = timingEngine.analyze(
      ticker,
      indicators,
      makeVolatility(),
      c5Buf,
      c15Buf,
      undefined,
      makeOIFunding({ fundingRate: 0.0006 }), // extreme positive funding
      makeRS(),
      'LONG',
      90, // very high bullish score!
      -0.003,
      0.07
    );

    assert(analysis.distributionRisk >= 60, `Test 4: Distribution risk high >= 60 (got ${analysis.distributionRisk})`);
    assert(analysis.signalCategory === 'NO_LONG', `Test 4: Must resolve to NO_LONG despite high score (got ${analysis.signalCategory})`);
  }

  // ----------------------------------------------------
  // TEST 5: Early Breakdown (Bearish Ignition)
  // ----------------------------------------------------
  {
    console.log('\n--- TEST 5: Early Breakdown (Lane C Bearish Ignition) ---');
    const candles = makeCandles(12, 100, 1.2);
    // breakdown candle below support
    candles.push({
      timestamp: Date.now() - 60_000,
      open: 99.8,
      high: 99.9,
      low: 98.6,
      close: 98.8,
      volume: 2400,
      turnover: 238000
    });

    const c5Buf = new CircularBuffer<CandleData>(20);
    const c15Buf = new CircularBuffer<CandleData>(20);
    candles.forEach(c => { c5Buf.push(c); c15Buf.push(c); });

    const ticker = makeTicker('SHORT_IGNITE', 98.8);
    const indicators = makeIndicators({
      rsi14: { '5': 42, '15': 44, '60': 46 },
      volumeRatio: { '5': 1.7, '15': 1.6, '60': 1.3 },
      atr14: { '15': 1.0 }
    });

    const analysis = timingEngine.analyze(
      ticker,
      indicators,
      makeVolatility(),
      c5Buf,
      c15Buf,
      undefined,
      makeOIFunding({ oiChangePercent: 0.015 }),
      makeRS({ shortScore: 12, longScore: 3 }),
      'SHORT',
      82,
      -0.009, // 5m return -0.9%
      -0.018,
      'LANE_C_BEARISH_IGNITION'
    );

    assert(analysis.signalCategory === 'EARLY_SHORT', `Test 5: Must be EARLY_SHORT (got ${analysis.signalCategory})`);
    assert(analysis.momentumIgnitionScore >= 60, `Test 5: High bearish ignition score >= 60 (got ${analysis.momentumIgnitionScore})`);
  }

  // ----------------------------------------------------
  // TEST 6: Extended Breakdown (Dump Chase)
  // ----------------------------------------------------
  {
    console.log('\n--- TEST 6: Extended Breakdown (Already dumped -15%) ---');
    const candles = makeCandles(15, 100, 1.0);
    // price collapsed to 85 (-15%)
    for (let i = 1; i <= 6; i++) {
      candles.push({
        timestamp: Date.now() - (6 - i) * 600_000,
        open: 100 - (i * 2.2),
        high: 100 - (i * 2.0),
        low: 100 - (i * 2.6),
        close: 100 - (i * 2.5),
        volume: 3800,
        turnover: 320000
      });
    }

    const c5Buf = new CircularBuffer<CandleData>(25);
    const c15Buf = new CircularBuffer<CandleData>(25);
    candles.forEach(c => { c5Buf.push(c); c15Buf.push(c); });

    const ticker = makeTicker('DUMPED_COIN', 85);
    const indicators = makeIndicators({
      rsi14: { '5': 18, '15': 22, '60': 25 },
      volumeRatio: { '5': 2.9, '15': 2.8, '60': 2.0 },
      atr14: { '15': 1.5 }
    });

    const analysis = timingEngine.analyze(
      ticker,
      indicators,
      makeVolatility(),
      c5Buf,
      c15Buf,
      undefined,
      makeOIFunding({ fundingRate: -0.0006 }),
      makeRS({ shortScore: 14, longScore: 1 }),
      'SHORT',
      85,
      -0.025,
      -0.15
    );

    assert(analysis.signalCategory !== 'EARLY_SHORT', `Test 6: Must NOT be EARLY_SHORT (got ${analysis.signalCategory})`);
    assert(analysis.signalCategory === 'NO_SHORT' || analysis.signalCategory === 'LATE_SHORT', `Test 6: Must be NO_SHORT or LATE_SHORT (got ${analysis.signalCategory})`);
  }

  // ----------------------------------------------------
  // TEST 7: Hot Mover Lane Stage 1 Allocation
  // ----------------------------------------------------
  {
    console.log('\n--- TEST 7: Multi-Lane Discovery Quotas ---');
    const stage1 = new Stage1Filter(CONFIG);

    const tickers = new Map<string, TickerData>();
    // Coin A: Lane B (Fresh 5m ignition)
    tickers.set('COIN_B', makeTicker('COIN_B', 10, { turnover24h: 30_000_000, price24hPcnt: 0.03 }));
    // Coin A: Lane A (Consolidating tight base)
    tickers.set('COIN_A', makeTicker('COIN_A', 5, { turnover24h: 25_000_000, price24hPcnt: 0.01, prevPrice1h: 4.98 }));
    // Coin D: Lane D (Hot mover +18%)
    tickers.set('COIN_D', makeTicker('COIN_D', 20, { turnover24h: 80_000_000, price24hPcnt: 0.18, prevPrice1h: 17 }));

    const prevTickers = new Map<string, TickerData>();
    tickers.forEach((t, sym) => prevTickers.set(sym, t));

    // Fake hub with custom returns
    const fakeHub = {
      get5mReturn: (sym: string) => {
        if (sym === 'COIN_B') return { value: 0.008, dataPointsAvailable: 5 };
        if (sym === 'COIN_A') return { value: 0.001, dataPointsAvailable: 5 };
        return { value: 0.035, dataPointsAvailable: 5 };
      },
      get1hReturn: (sym: string) => {
        if (sym === 'COIN_B') return { value: 0.015, dataPointsAvailable: 60 };
        if (sym === 'COIN_A') return { value: 0.005, dataPointsAvailable: 60 };
        return { value: 0.18, dataPointsAvailable: 60 };
      },
      getVolumeAcceleration: (sym: string) => sym === 'COIN_B' ? 1.5 : 1.0
    };

    const instruments = new Map<string, SymbolInfo>();
    tickers.forEach((_, sym) => {
      instruments.set(sym, {
        symbol: sym,
        baseCoin: sym.replace('USDT', ''),
        quoteCoin: 'USDT',
        status: 'Trading',
        contractType: 'LinearPerpetual',
        pricePrecision: 2,
        quantityPrecision: 1,
        minOrderQty: 0.1,
        maxOrderQty: 10000,
        fundingInterval: 480
      } as any);
    });

    const results = stage1.filter(tickers, prevTickers, instruments, fakeHub as any);
    const coinB = results.find(r => r.symbol === 'COIN_B');
    const coinA = results.find(r => r.symbol === 'COIN_A');
    const coinD = results.find(r => r.symbol === 'COIN_D');

    assert(coinB !== undefined && coinB.discoveryLane === 'LANE_B_BULLISH_IGNITION', 'Test 7: COIN_B classified in Lane B');
    assert(coinA !== undefined && coinA.discoveryLane === 'LANE_A_PRE_BREAKOUT', 'Test 7: COIN_A classified in Lane A');
    assert(coinD !== undefined && coinD.discoveryLane === 'LANE_D_HOT_MOVER', 'Test 7: COIN_D classified in Lane D');
  }

  // ----------------------------------------------------
  // TEST 8: Pullback Long
  // ----------------------------------------------------
  {
    console.log('\n--- TEST 8: Pullback Long Re-Entry ---');
    const candles = makeCandles(15, 100, 1.0);
    // Breakout up to 105, then pulled back to EMA21 (100.5) with green bounce
    candles.push({ timestamp: Date.now() - 900_000, open: 104, high: 105, low: 103.5, close: 104.5, volume: 2000, turnover: 200000 });
    candles.push({ timestamp: Date.now() - 600_000, open: 104.5, high: 104.5, low: 101.5, close: 101.8, volume: 1200, turnover: 120000 }); // pullback
    candles.push({ timestamp: Date.now() - 300_000, open: 101.8, high: 102.2, low: 101.2, close: 102.0, volume: 1800, turnover: 180000 }); // bounce

    const c5Buf = new CircularBuffer<CandleData>(20);
    const c15Buf = new CircularBuffer<CandleData>(20);
    candles.forEach(c => { c5Buf.push(c); c15Buf.push(c); });

    const ticker = makeTicker('PULLBACK_COIN', 102.0);
    const indicators = makeIndicators({
      ema21: { '5': 101.8, '15': 101.8, '60': 100, '240': 98, 'D': 95 },
      rsi14: { '5': 52, '15': 54, '60': 58 },
      atr14: { '15': 1.2 }
    });

    const analysis = timingEngine.analyze(
      ticker,
      indicators,
      makeVolatility(),
      c5Buf,
      c15Buf,
      undefined,
      makeOIFunding(),
      makeRS(),
      'LONG',
      78,
      0.003,
      0.02
    );

    assert(analysis.signalCategory === 'PULLBACK_LONG' || analysis.signalCategory === 'EARLY_LONG', `Test 8: Must resolve to PULLBACK_LONG or EARLY_LONG (got ${analysis.signalCategory})`);
  }

  // ----------------------------------------------------
  // TEST 9 & 10: Liquidity Sweeps (Unconfirmed vs Confirmed Reclaim)
  // ----------------------------------------------------
  {
    console.log('\n--- TEST 9 & 10: Liquidity Sweeps ---');
    const candles9 = makeCandles(10, 100, 1.5);
    // Unconfirmed sweep: Low pierced, but closed below low
    candles9.push({
      timestamp: Date.now(),
      open: 98.5,
      high: 98.8,
      low: 97.2,
      close: 97.8,
      volume: 1500,
      turnover: 150000
    });
    const c15Buf9 = new CircularBuffer<CandleData>(15);
    candles9.forEach(c => c15Buf9.push(c));

    const analysis9 = timingEngine.analyze(
      makeTicker('SWEEP_UNCONFIRMED', 97.8),
      makeIndicators(),
      makeVolatility(),
      undefined,
      c15Buf9,
      undefined,
      makeOIFunding(),
      makeRS(),
      'LONG',
      75
    );
    assert(analysis9.signalCategory === 'NO_TRADE' || analysis9.setupState === SetupState.WAIT_CONFIRMATION || analysis9.signalCategory === 'NO_LONG', `Test 9: Sweep without confirmed reclaim is not actionable long (got ${analysis9.signalCategory})`);

    // Test 10: Confirmed Sweep Reclaim
    const candles10 = makeCandles(10, 100, 1.5);
    // Pierced below 99.25, but closed strong hammer at 100.5 with high volume
    candles10.push({
      timestamp: Date.now(),
      open: 99.5,
      high: 100.8,
      low: 98.0,
      close: 100.6,
      volume: 3200,
      turnover: 320000
    });
    const c15Buf10 = new CircularBuffer<CandleData>(15);
    candles10.forEach(c => c15Buf10.push(c));

    const analysis10 = timingEngine.analyze(
      makeTicker('SWEEP_RECLAIM', 100.6),
      makeIndicators({ volumeRatio: { '5': 2.0, '15': 1.8, '60': 1.2 } }),
      makeVolatility(),
      undefined,
      c15Buf10,
      undefined,
      makeOIFunding({ oiChangePercent: 0.02 }),
      makeRS(),
      'LONG',
      85,
      0.008
    );
    assert(analysis10.sweepType === 'BULLISH_LIQUIDITY_SWEEP', `Test 10: Bullish sweep detected (got ${analysis10.sweepType})`);
    assert(analysis10.signalCategory === 'EARLY_LONG' || analysis10.setupState === SetupState.BULLISH_IGNITION, `Test 10: Confirmed sweep resolved to EARLY_LONG or BULLISH_IGNITION (got ${analysis10.signalCategory})`);
  }

  // ----------------------------------------------------
  // TEST 11: False Breakout
  // ----------------------------------------------------
  {
    console.log('\n--- TEST 11: False Breakout (Upper Rejection Wick) ---');
    const candles = makeCandles(10, 100, 1.2);
    // Spiked to 102.5, but rejected back to 99.8
    candles.push({
      timestamp: Date.now(),
      open: 100.2,
      high: 102.5,
      low: 99.6,
      close: 99.8,
      volume: 2500,
      turnover: 250000
    });
    const c15Buf = new CircularBuffer<CandleData>(15);
    candles.forEach(c => c15Buf.push(c));

    const analysis = timingEngine.analyze(
      makeTicker('FALSE_BREAKOUT', 99.8),
      makeIndicators(),
      makeVolatility(),
      undefined,
      c15Buf,
      undefined,
      makeOIFunding(),
      makeRS(),
      'LONG',
      75
    );
    assert(analysis.signalCategory !== 'EARLY_LONG', `Test 11: False breakout must NOT be EARLY_LONG (got ${analysis.signalCategory})`);
  }

  // ----------------------------------------------------
  // TEST 12: Bearish Ignition Breakdown
  // ----------------------------------------------------
  {
    console.log('\n--- TEST 12: Bearish Breakdown Confirmation ---');
    const candles = makeCandles(12, 100, 1.0);
    // breakdown confirmation candle
    candles.push({
      timestamp: Date.now() - 30_000,
      open: 99.5,
      high: 99.6,
      low: 98.4,
      close: 98.7,
      volume: 2200,
      turnover: 218000
    });
    const c15Buf = new CircularBuffer<CandleData>(15);
    candles.forEach(c => c15Buf.push(c));

    const analysis = timingEngine.analyze(
      makeTicker('BEAR_CONFIRMED', 98.7),
      makeIndicators({ volumeRatio: { '5': 1.6, '15': 1.5, '60': 1.2 } }),
      makeVolatility(),
      undefined,
      c15Buf,
      undefined,
      makeOIFunding({ oiChangePercent: 0.018 }),
      makeRS({ shortScore: 12, longScore: 2 }),
      'SHORT',
      84,
      -0.007
    );
    assert(analysis.signalCategory === 'EARLY_SHORT', `Test 12: Bearish breakdown confirmed as EARLY_SHORT (got ${analysis.signalCategory})`);
  }

  // ----------------------------------------------------
  // TEST 13 (MANDATORY CURRENT PROBLEM TEST):
  // Coin +15% 1H, +4.5% 5m, RSI 79, climax volume -> MUST be NO_LONG
  // ----------------------------------------------------
  {
    console.log('\n--- TEST 13: Mandatory Current Problem Test (Parabolic Late Mover) ---');
    const candles = makeCandles(15, 100, 1.0);
    candles.push({
      timestamp: Date.now() - 300_000,
      open: 110,
      high: 115.5,
      low: 109.5,
      close: 115.0, // +15% run
      volume: 5000,
      turnover: 575000
    });
    const c15Buf = new CircularBuffer<CandleData>(20);
    candles.forEach(c => c15Buf.push(c));

    const ticker = makeTicker('PUMP_AND_DUMP', 115.0);
    const indicators = makeIndicators({
      rsi14: { '5': 82, '15': 79, '60': 76 },
      volumeRatio: { '5': 3.5, '15': 3.2, '60': 2.5 },
      atr14: { '15': 1.5 }
    });

    const analysis = timingEngine.analyze(
      ticker,
      indicators,
      makeVolatility(),
      undefined,
      c15Buf,
      undefined,
      makeOIFunding({ fundingRate: 0.0008 }),
      makeRS(),
      'LONG',
      92, // even with 92 direction score!
      0.045, // +4.5% 5m move
      0.150  // +15% 1h move
    );

    assert(analysis.signalCategory === 'NO_LONG', `Test 13: Must resolve strictly to NO_LONG (got ${analysis.signalCategory})`);
    assert(analysis.chaseRiskScore >= 70, `Test 13: Extreme chase risk >= 70 (got ${analysis.chaseRiskScore})`);

    // Verify FinalRanker segregates it from actionable results!
    const ranker = new FinalRanker(new CorrelationFilter());
    const candidateScore: CandidateScores = {
      symbol: 'PUMP_AND_DUMP',
      longScore: makeBreakdown(92),
      shortScore: makeBreakdown(40),
      executionScore: { total: 85, passed: true } as any,
      ticker,
      volatility: makeVolatility(),
      liquidityTier: 'A',
      timing: analysis,
      signalCategory: analysis.signalCategory,
      priceChange5m: 0.045,
      priceChange1h: 0.150
    };

    const output = ranker.rank([candidateScore], new Map(), { regime: 'BULL_TREND' } as any, ticker, 0, 10);
    assert(!output.actionableResults?.some(r => r.symbol === 'PUMP_AND_DUMP'), 'Test 13: PUMP_AND_DUMP must NOT appear in actionableResults');
    assert(output.rejectedSignals?.some(r => r.symbol === 'PUMP_AND_DUMP'), 'Test 13: PUMP_AND_DUMP must appear in rejectedSignals');
  }

  // ----------------------------------------------------
  // TEST 14 (MANDATORY EARLY MOMENTUM TEST):
  // Accumulation 12 candles, trigger 90s ago, +0.8% move, vol 1.8x, OI up -> EARLY_LONG
  // ----------------------------------------------------
  {
    console.log('\n--- TEST 14: Mandatory Early Momentum Test (Fresh Base Breakout) ---');
    const candles = makeCandles(12, 100, 1.0);
    candles.push({
      timestamp: Date.now() - 90_000, // triggered 90 seconds ago
      open: 100.2,
      high: 101.1,
      low: 100.1,
      close: 100.8, // +0.8%
      volume: 2400,
      turnover: 242000
    });
    const c5Buf = new CircularBuffer<CandleData>(15);
    const c15Buf = new CircularBuffer<CandleData>(15);
    candles.forEach(c => { c5Buf.push(c); c15Buf.push(c); });

    const ticker = makeTicker('FRESH_LEADER', 100.8);
    const indicators = makeIndicators({
      volumeRatio: { '5': 1.8, '15': 1.7, '60': 1.2 },
      atr14: { '5': 0.7, '15': 0.9, '60': 1.4 }
    });

    const analysis = timingEngine.analyze(
      ticker,
      indicators,
      makeVolatility(),
      c5Buf,
      c15Buf,
      undefined,
      makeOIFunding({ oiChangePercent: 0.015 }),
      makeRS(),
      'LONG',
      88,
      0.008,
      0.012
    );

    assert(analysis.signalCategory === 'EARLY_LONG', `Test 14: Must resolve to EARLY_LONG (got ${analysis.signalCategory})`);
    assert((analysis.actionabilityScore ?? 0) >= 70, `Test 14: High actionability score >= 70 (got ${analysis.actionabilityScore})`);

    // Verify FinalRanker places it #1 in actionableResults!
    const ranker = new FinalRanker(new CorrelationFilter());
    const candidateScore: CandidateScores = {
      symbol: 'FRESH_LEADER',
      longScore: makeBreakdown(88),
      shortScore: makeBreakdown(35),
      executionScore: { total: 90, passed: true } as any,
      ticker,
      volatility: makeVolatility(),
      liquidityTier: 'A',
      timing: analysis,
      signalCategory: analysis.signalCategory,
      actionabilityScore: analysis.actionabilityScore,
      priceChange5m: 0.008,
      priceChange1h: 0.012
    };

    const output = ranker.rank([candidateScore], new Map(), { regime: 'BULL_TREND' } as any, ticker, 0, 10);
    assert(output.actionableResults?.[0]?.symbol === 'FRESH_LEADER', 'Test 14: FRESH_LEADER must be #1 in actionableResults');
  }

  console.log(`\n====================================================`);
  console.log(` PHASE 4 TEST RESULTS: ${passed} PASSED, ${failed} FAILED `);
  console.log(`====================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase4Tests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
