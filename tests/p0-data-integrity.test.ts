// ============================================================
// P0 Regression Test Suite: Data Integrity & Correctness
// ============================================================

import { MarketDataHub } from '../src/data/market-data-hub.js';
import { BybitRest } from '../src/data/bybit-rest.js';
import { CandleData, TickerData, SymbolInfo } from '../src/data/types.js';
import { FinalRanker } from '../src/ranking/final-ranker.js';
import { CorrelationFilter } from '../src/ranking/correlation.js';
import { CONFIG } from '../src/config.js';

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

// Mock BybitRest
class MockBybitRest extends BybitRest {
  public mockFundingHistory = [
    { symbol: 'BTCUSDT', fundingRate: '0.0001', fundingRateTimestamp: '1700000000000' },
    { symbol: 'BTCUSDT', fundingRate: '0.0002', fundingRateTimestamp: '1700028800000' },
    { symbol: 'BTCUSDT', fundingRate: '0.00015', fundingRateTimestamp: '1700057600000' },
  ];

  override async getInstruments(): Promise<SymbolInfo[]> {
    return [{
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
    }];
  }

  override async getTickers(): Promise<Map<string, TickerData>> {
    const map = new Map<string, TickerData>();
    map.set('BTCUSDT', {
      symbol: 'BTCUSDT',
      lastPrice: 65000,
      markPrice: 65000,
      indexPrice: 65000,
      bid1Price: 64999,
      bid1Size: 10,
      ask1Price: 65001,
      ask1Size: 10,
      highPrice24h: 66000,
      lowPrice24h: 64000,
      prevPrice24h: 60000,
      prevPrice1h: 64000,
      price24hPcnt: 0.083,
      volume24h: 100000000,
      turnover24h: 100000000,
      openInterest: 50000,
      openInterestValue: 50000 * 65000,
      fundingRate: 0.0001,
      nextFundingTime: Date.now() + 8 * 3600_000,
      timestamp: Date.now()
    });
    return map;
  }

  override async getFundingHistory(symbol: string, limit: number = 50): Promise<any> {
    return { list: this.mockFundingHistory };
  }
}

async function runP0Tests() {
  console.log('=== Running P0 Data Integrity Regression Tests ===\n');

  const mockRest = new MockBybitRest();
  const hub = new MarketDataHub(mockRest);
  await hub.initialize();

  // ------------------------------------------------------------
  // Test P0 #1: Duplicate Unconfirmed Candles vs Confirmed Commit
  // ------------------------------------------------------------
  console.log('--- P0 #1: Unconfirmed vs Confirmed Candle Handling ---');
  const candleStartTime = 1700000000000; // e.g. 10:00:00

  // Send 100 unconfirmed updates for the same 15m candle
  for (let i = 0; i < 100; i++) {
    const unconfirmedCandle: CandleData = {
      timestamp: candleStartTime,
      open: 50000,
      high: 50100 + i,
      low: 49900,
      close: 50050 + i,
      volume: 10 + i,
      turnover: 500000 + i * 5000,
      confirmed: false
    };
    hub.updateCandle('BTCUSDT', '15', unconfirmedCandle);
  }

  const closedCandlesAfterUnconfirmed = hub.getCandles('BTCUSDT', '15');
  assert(
    closedCandlesAfterUnconfirmed?.size === 0,
    'Unconfirmed updates do NOT add to closed candles buffer (size is 0)'
  );

  const symInd = hub.symbolIndicators.get('BTCUSDT');
  const emaObsCountAfterUnconfirmed = (symInd?.ema9.get('15') as any)?.getObservationCount?.() ?? 0;
  assert(
    emaObsCountAfterUnconfirmed === 0,
    `Unconfirmed updates do NOT advance incremental indicator observation count (expected 0, got ${emaObsCountAfterUnconfirmed})`
  );

  // Now send confirmed candle update for this bar
  const confirmedCandle: CandleData = {
    timestamp: candleStartTime,
    open: 50000,
    high: 50200,
    low: 49900,
    close: 50150,
    volume: 110,
    turnover: 5500000,
    confirmed: true
  };
  hub.updateCandle('BTCUSDT', '15', confirmedCandle);

  assert(
    hub.getCandles('BTCUSDT', '15')?.size === 1,
    'Confirmed candle commits exactly once to closed candles buffer (size is 1)'
  );

  const emaObsCountAfterConfirmed = (symInd?.ema9.get('15') as any)?.getObservationCount?.() ?? 0;
  assert(
    emaObsCountAfterConfirmed === 1,
    `Confirmed candle advances indicator observation count by exactly 1 (expected 1, got ${emaObsCountAfterConfirmed})`
  );

  // Attempt duplicate confirmed candle with same timestamp
  hub.updateCandle('BTCUSDT', '15', confirmedCandle);
  assert(
    hub.getCandles('BTCUSDT', '15')?.size === 1,
    'Duplicate confirmed candle with same timestamp is rejected/idempotent (size remains 1)'
  );
  const emaObsCountAfterDuplicate = (symInd?.ema9.get('15') as any)?.getObservationCount?.() ?? 0;
  assert(
    emaObsCountAfterDuplicate === 1,
    'Duplicate confirmed candle does NOT advance indicator observation count again (remains 1)'
  );

  // ------------------------------------------------------------
  // Test P0 #2: Future Timestamp Prevention
  // ------------------------------------------------------------
  console.log('\n--- P0 #2: Future Timestamp Bug Prevention ---');
  const now = Date.now();
  const ongoing15mStart = now - (5 * 60 * 1000); // candle started 5 mins ago
  const ongoingCandle: CandleData = {
    timestamp: ongoing15mStart,
    open: 65000,
    high: 65200,
    low: 64900,
    close: 65100,
    volume: 50,
    turnover: 3250000,
    confirmed: false
  };

  hub.updateCandle('BTCUSDT', '15', ongoingCandle);

  const pBuf = hub.priceHistories.get('BTCUSDT');
  let hasFutureObservation = false;
  if (pBuf) {
    pBuf.toArray().forEach(p => {
      // Future timestamp tolerance: 1 second
      if (p.timestamp > now + 1000) {
        hasFutureObservation = true;
      }
    });
  }

  assert(
    !hasFutureObservation,
    'No stored price observation has a future timestamp (candle.timestamp + 15m is NOT pushed)'
  );

  // Verify initial price history chronological seeding order (24h ago -> 1h ago -> now)
  const btcPrices = pBuf ? pBuf.toArray() : [];
  assert(
    btcPrices.length >= 3,
    `Price history buffer retains all seeded chronological points (got ${btcPrices.length})`
  );
  if (btcPrices.length >= 3) {
    assert(
      btcPrices[0].timestamp < btcPrices[1].timestamp && btcPrices[1].timestamp < btcPrices[2].timestamp,
      'Seeded prices are strictly ascending in chronological order (oldest to newest)'
    );
  }

  // ------------------------------------------------------------
  // Test P0 #3: Funding History Deduplication & Bootstrap
  // ------------------------------------------------------------
  console.log('\n--- P0 #3: Funding History Deduplication & Bootstrap ---');
  const fundingBuf = hub.fundingHistories.get('BTCUSDT');
  const initialFundingSize = fundingBuf?.size ?? 0;

  // Send 100 ticker updates with nextFundingTime in the future (8 hours from now)
  const futureNextFundingTime = now + (8 * 3600_000);
  for (let i = 0; i < 100; i++) {
    hub.updateTicker({
      symbol: 'BTCUSDT',
      lastPrice: 65000 + i,
      fundingRate: 0.0001,
      nextFundingTime: futureNextFundingTime,
      timestamp: now + i * 100
    });
  }

  // Verify no future timestamp stored in funding state/histories
  const fState = hub.getFundingState ? hub.getFundingState('BTCUSDT') : null;
  const latestFunding = fundingBuf?.latest() ?? (fState?.current ? { timestamp: fState.current.periodStart, value: fState.current.rate } : null);
  assert(
    latestFunding !== null && latestFunding.timestamp <= now + 1000,
    `Funding observation timestamp is NEVER in the future (ts is ${latestFunding?.timestamp} <= now ${now})`
  );

  const fundingSizeAfter100Tickers = (fundingBuf?.size ?? 0) - initialFundingSize;
  assert(
    fundingSizeAfter100Tickers <= 1,
    `100 ticker updates with identical settlement cycle add at most 1 observation (got ${fundingSizeAfter100Tickers})`
  );

  // Bootstrap historical funding
  if (typeof (hub as any).bootstrapFundingHistory === 'function') {
    await (hub as any).bootstrapFundingHistory('BTCUSDT');
  }
  const bootstrappedValues = fundingBuf?.getValues() ?? [];
  assert(
    bootstrappedValues.length >= 3,
    `Historical funding bootstrap produces multiple distinct historical observations (got ${bootstrappedValues.length})`
  );

  // ------------------------------------------------------------
  // Test P0 #4: True priceChange5m in FinalRanker Output
  // ------------------------------------------------------------
  console.log('\n--- P0 #4: True priceChange5m in FinalRanker Output ---');
  const ranker = new FinalRanker(new CorrelationFilter());

  const dummyTicker: TickerData = {
    symbol: 'BTCUSDT',
    lastPrice: 105,
    markPrice: 105,
    indexPrice: 105,
    bid1Price: 104.9,
    bid1Size: 10,
    ask1Price: 105.1,
    ask1Size: 10,
    highPrice24h: 120,
    lowPrice24h: 90,
    prevPrice24h: 120, // -12.5% over 24h
    prevPrice1h: 100,  // +5% over 1h
    price24hPcnt: -0.125,
    volume24h: 10_000_000,
    turnover24h: 1_000_000_000,
    openInterest: 1000,
    openInterestValue: 105_000,
    fundingRate: 0.0001,
    nextFundingTime: 0,
    timestamp: now
  };

  const dummyCandidate: any = {
    symbol: 'BTCUSDT',
    longScore: {
      total: 90,
      rawScore: 90,
      availableWeight: 100,
      normalizedScore: 90,
      dataCompleteness: 1.0,
      modifiers: []
    },
    shortScore: {
      total: 20,
      rawScore: 20,
      availableWeight: 100,
      normalizedScore: 20,
      dataCompleteness: 1.0,
      modifiers: []
    },
    executionScore: {
      total: 85,
      spread: 20,
      bidDepth: 20,
      askDepth: 20,
      slippage: 25,
      tradeFrequency: 15
    },
    ticker: dummyTicker,
    volatility: { regime: 'NORMAL' },
    liquidityTier: 'A',
    priceChange5m: 0.05, // TRUE 5m return: +5.0%
    priceChange1h: 0.05
  };

  const output = ranker.rank(
    [dummyCandidate],
    new Map(),
    { regime: 'NEUTRAL' } as any,
    dummyTicker,
    0,
    5
  );

  assert(output.results.length === 1, 'Candidate qualified in final ranker');
  const res = output.results[0];
  assert(
    res.priceChange5m === 0.05,
    `priceChange5m in output is true 5m return (+0.05 / +5%), NOT 24h change (got ${res.priceChange5m})`
  );
  assert(
    res.priceChange5m !== -0.125,
    'priceChange5m is NOT 24h return (-0.125)'
  );

  console.log(`\n=== P0 Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runP0Tests().catch(err => {
  console.error(err);
  process.exit(1);
});
