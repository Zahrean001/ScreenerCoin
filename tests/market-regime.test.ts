// ============================================================
// Tests: Market Regime & BTC Realized Volatility
// ============================================================

import { MarketRegimeEngine } from '../src/engines/market-regime.js';
import { CircularBuffer } from '../src/data/circular-buffer.js';
import { IndicatorState, TickerData, CandleData, MarketRegime, VolatilityRegime, TrendState } from '../src/data/types.js';

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
  console.log('=== Running Market Regime Engine Tests ===\n');

  const engine = new MarketRegimeEngine();

  const dummyTicker: TickerData = {
    symbol: 'BTCUSDT',
    lastPrice: 70_000,
    markPrice: 70_000,
    indexPrice: 70_000,
    bid1Price: 69_999,
    bid1Size: 10,
    ask1Price: 70_001,
    ask1Size: 10,
    highPrice24h: 71_000,
    lowPrice24h: 68_000,
    prevPrice24h: 68_500,
    prevPrice1h: 69_500,
    price24hPcnt: 0.02,
    volume24h: 50_000,
    turnover24h: 3_500_000_000,
    openInterest: 20_000,
    openInterestValue: 1_400_000_000,
    fundingRate: 0.0001,
    nextFundingTime: 0,
    timestamp: Date.now()
  };

  // 1. Strong Bull Market State
  const bullIndicators: IndicatorState = {
    ema9: { '5': 69_800, '15': 69_500, '60': 69_000 },
    ema21: { '5': 69_500, '15': 69_000, '60': 68_000 },
    ema50: { '5': 69_000, '15': 68_500, '60': 67_000 },
    atr14: { '5': 200, '15': 500, '60': 1000 },
    atrPercent: { '5': 0.3, '15': 0.7, '60': 1.4 },
    rsi14: { '5': 65, '15': 65, '60': 65 }, // Bullish > 60
    roc5: { '5': 0.01, '15': 0.01, '60': 0.01 },
    roc14: { '5': 0.02, '15': 0.02, '60': 0.02 }, // Positive momentum
    vwap: { '5': 69_200, '15': 69_000, '60': 68_500 }, // Price > VWAP
    volumeSma20: { '5': 1000, '15': 2000, '60': 5000 },
    volumeRatio: { '5': 1.5, '15': 1.8, '60': 2.0 },
    lastUpdate: Date.now()
  };

  const candleBuffer = new CircularBuffer<CandleData>(30);
  for (let i = 0; i < 20; i++) {
    candleBuffer.push({
      timestamp: Date.now() - (20 - i) * 900_000,
      open: 68_000 + i * 100,
      high: 68_150 + i * 100,
      low: 67_950 + i * 100,
      close: 68_100 + i * 100,
      volume: 500,
      turnover: 35_000_000,
      confirmed: true
    });
  }

  const regimeBull = engine.analyze(bullIndicators, dummyTicker, candleBuffer);
  assert(regimeBull.regime === MarketRegime.STRONG_BULL, 'Classified as STRONG_BULL when EMA stack, RSI > 60, and Price > VWAP');
  assert(regimeBull.btcTrend === TrendState.STRONG_BULLISH, 'BTC trend is STRONG_BULLISH');
  assert(regimeBull.longModifier > 1.0, 'Long modifier boosts bullish opportunities (> 1.0x)');
  assert(regimeBull.shortModifier < 1.0, 'Short modifier dampens shorts (< 1.0x)');

  // 2. Realized Volatility Calculation on High-Vol candles
  const highVolCandles = new CircularBuffer<CandleData>(30);
  for (let i = 0; i < 20; i++) {
    const swing = (i % 2 === 0 ? 1 : -1) * (1000 + i * 100);
    highVolCandles.push({
      timestamp: Date.now() - (20 - i) * 900_000,
      open: 68_000,
      high: 68_000 + Math.abs(swing),
      low: 68_000 - Math.abs(swing),
      close: 68_000 + swing,
      volume: 1500,
      turnover: 100_000_000,
      confirmed: true
    });
  }

  const regimeHighVol = engine.analyze(bullIndicators, dummyTicker, highVolCandles);
  assert(regimeHighVol.btcRealizedVol > 0.005, 'BTC realized volatility accurately computed from returns');
  assert(regimeHighVol.btcVolatility === VolatilityRegime.HIGH || regimeHighVol.btcVolatility === VolatilityRegime.EXTREME, 'Classified as HIGH or EXTREME volatility on volatile candles');

  console.log(`\n=== Market Regime Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
