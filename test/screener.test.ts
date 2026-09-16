// ============================================================
// Unit & Sanity Tests for USDT Perpetual Screener Components
// ============================================================

import { CONFIG } from '../src/config.js';
import { IncrementalEMA, IncrementalATR, IncrementalRSI, IncrementalVWAP } from '../src/indicators/incremental.js';
import { CircularBuffer, NumericRingBuffer } from '../src/data/circular-buffer.js';
import { Stage1Filter } from '../src/stages/stage1-filter.js';
import { CorrelationFilter } from '../src/ranking/correlation.js';
import { HotQueue, HotEventDetector } from '../src/ranking/hot-queue.js';
import { pctChange, spreadBps, trueRange } from '../src/utils/math.js';
import { TickerData, SymbolInfo, ScreenerCandidate, MarketRegime } from '../src/data/types.js';

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
  console.log('=== Running Screener Unit Tests ===\n');

  // 1. Math utilities
  assert(pctChange(110, 100) === 0.1, 'pctChange(110, 100) should be 0.10');
  assert(spreadBps(100, 100.1) > 9.9 && spreadBps(100, 100.1) < 10.1, 'spreadBps(100, 100.1) ≈ 10 bps');
  assert(trueRange(105, 95, 100) === 10, 'trueRange(105, 95, 100) should be 10');

  // 2. CircularBuffer
  const buf = new CircularBuffer<number>(3);
  buf.push(1);
  buf.push(2);
  buf.push(3);
  assert(buf.size === 3, 'CircularBuffer size should be 3');
  assert(buf.latest() === 3, 'CircularBuffer latest() should be 3');
  buf.push(4); // Overwrites 1
  assert(buf.size === 3, 'CircularBuffer size should remain 3 after overwrite');
  assert(buf.oldest() === 2, 'CircularBuffer oldest() should now be 2');
  assert(buf.latest() === 4, 'CircularBuffer latest() should now be 4');

  // 3. NumericRingBuffer
  const numBuf = new NumericRingBuffer(5);
  [10, 20, 30, 40, 50].forEach(v => numBuf.push(v));
  assert(numBuf.mean() === 30, 'NumericRingBuffer mean should be 30');

  // 4. Incremental Indicators
  const ema = new IncrementalEMA(3);
  ema.update(10);
  ema.update(20);
  const emaVal = ema.update(30);
  assert(emaVal !== null && emaVal > 0, 'IncrementalEMA produces valid seed');

  const rsi = new IncrementalRSI(3);
  rsi.update(10);
  rsi.update(12);
  rsi.update(14);
  const rsiVal = rsi.update(16);
  assert(rsiVal !== null && rsiVal > 50, 'IncrementalRSI bullish price action yields >50');

  const vwap = new IncrementalVWAP();
  vwap.update(100, 10);
  vwap.update(110, 10);
  assert(vwap.getValue() === 105, 'IncrementalVWAP calculates correctly');

  // 5. Stage 1 Filter
  const filter = new Stage1Filter(CONFIG);
  const tickers = new Map<string, TickerData>();
  const prevTickers = new Map<string, TickerData>();
  const instruments = new Map<string, SymbolInfo>();

  instruments.set('BTCUSDT', {
    symbol: 'BTCUSDT',
    baseCoin: 'BTC',
    quoteCoin: 'USDT',
    settleCoin: 'USDT',
    status: 'Trading',
    contractType: 'LinearPerpetual',
    tickSize: 0.1,
    qtyStep: 0.001,
    minOrderQty: 0.001,
    maxLeverage: 100,
    fundingInterval: 480,
    launchTime: 0
  });

  tickers.set('BTCUSDT', {
    symbol: 'BTCUSDT',
    lastPrice: 65000,
    markPrice: 65000,
    indexPrice: 65000,
    bid1Price: 64999.5,
    bid1Size: 10,
    ask1Price: 65000.5,
    ask1Size: 10,
    highPrice24h: 66000,
    lowPrice24h: 64000,
    prevPrice24h: 64500,
    prevPrice1h: 64800,
    price24hPcnt: 0.02,
    volume24h: 10000,
    turnover24h: 650000000, // $650M Tier A
    openInterest: 5000,
    openInterestValue: 325000000,
    fundingRate: 0.0001,
    nextFundingTime: 0,
    timestamp: Date.now()
  });

  const passedStage1 = filter.filter(tickers, prevTickers, instruments);
  assert(passedStage1.length === 1, 'Stage 1 filter accurately passed qualified USDT perpetual');
  assert(passedStage1[0].liquidityTier === 'A', 'BTC correctly classified as Liquidity Tier A');

  // 6. Hot Queue & Detector
  const hotDetector = new HotEventDetector(CONFIG);
  const prevBTC: TickerData = { ...tickers.get('BTCUSDT')!, lastPrice: 60000 }; // 8.3% spike
  const hotEvent = hotDetector.detect('BTCUSDT', tickers.get('BTCUSDT')!, prevBTC);
  assert(hotEvent !== null && hotEvent.trigger === 'PRICE_SPIKE', 'HotEventDetector caught price spike');

  const hotQ = new HotQueue();
  if (hotEvent) hotQ.push(hotEvent);
  assert(hotQ.size === 1, 'HotQueue accepted hot event');

  // 7. Correlation Filter
  const corrFilter = new CorrelationFilter();
  const candidates: ScreenerCandidate[] = [
    {
      rank: 1,
      symbol: 'SOLUSDT',
      side: 'LONG',
      finalScore: 92,
      opportunityScore: 94,
      executionScore: 86,
      rating: 'A+',
      longScore: 94,
      shortScore: 20,
      reasons: ['Strong RS'],
      liquidityTier: 'A',
      volatilityRegime: CONFIG.VOLATILITY_NORMAL as any,
      price: 150,
      priceChange1h: 0.02,
      priceChange24h: 0.05,
      volume24h: 1000000,
      openInterestValue: 50000000,
      fundingRate: 0.0001
    },
    {
      rank: 2,
      symbol: 'JUPUSDT',
      side: 'LONG',
      finalScore: 91,
      opportunityScore: 92,
      executionScore: 88,
      rating: 'A+',
      longScore: 92,
      shortScore: 20,
      reasons: ['Strong RS'],
      liquidityTier: 'B',
      volatilityRegime: CONFIG.VOLATILITY_NORMAL as any,
      price: 1.2,
      priceChange1h: 0.03,
      priceChange24h: 0.06,
      volume24h: 100000,
      openInterestValue: 10000000,
      fundingRate: 0.0001
    },
    {
      rank: 3,
      symbol: 'RAYUSDT',
      side: 'LONG',
      finalScore: 90,
      opportunityScore: 91,
      executionScore: 87,
      rating: 'A+',
      longScore: 91,
      shortScore: 20,
      reasons: ['Breakout'],
      liquidityTier: 'C',
      volatilityRegime: CONFIG.VOLATILITY_NORMAL as any,
      price: 2.5,
      priceChange1h: 0.04,
      priceChange24h: 0.08,
      volume24h: 50000,
      openInterestValue: 5000000,
      fundingRate: 0.0001
    }
  ];

  const sectorMap = new Map<string, string>([
    ['SOLUSDT', 'SOL_ECO'],
    ['JUPUSDT', 'SOL_ECO'],
    ['RAYUSDT', 'SOL_ECO']
  ]);

  const corrPenalized = corrFilter.applyPenalty(candidates, sectorMap);
  assert(corrPenalized[2].finalScore < 90, 'Correlation filter penalized 3rd member of same sector');

  console.log(`\n=== Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
