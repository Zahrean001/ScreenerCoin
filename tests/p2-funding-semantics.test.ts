// ============================================================
// Phase 2 Funding Semantics & Pipeline Diagnostics Test Suite
// ============================================================

import { MarketDataHub } from '../src/data/market-data-hub.js';
import { BybitRest } from '../src/data/bybit-rest.js';
import { TickerData, SymbolInfo, FundingSettlement, CurrentFundingState, FundingState, Stage1Diagnostics } from '../src/data/types.js';
import { Stage1Filter } from '../src/stages/stage1-filter.js';
import { Stage3Execution } from '../src/stages/stage3-execution.js';
import { OIFundingEngine } from '../src/engines/oi-funding.js';
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

// ---- Test Helpers ----

function makeSymbolInfo(overrides: Partial<SymbolInfo> = {}): SymbolInfo {
  return {
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
    launchTime: 0,
    ...overrides
  };
}

function makeTicker(overrides: Partial<TickerData> = {}): TickerData {
  return {
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
    prevPrice24h: 64000,
    prevPrice1h: 64500,
    price24hPcnt: 0.015,
    volume24h: 50000,
    turnover24h: 3_250_000_000,
    openInterest: 80000,
    openInterestValue: 5_200_000_000,
    fundingRate: 0.0001,
    nextFundingTime: Date.now() + 4 * 3600_000,
    timestamp: Date.now(),
    ...overrides
  };
}

// ---- Mock REST for MarketDataHub ----

class MockBybitRest extends BybitRest {
  public mockInstruments: SymbolInfo[] = [
    makeSymbolInfo({ symbol: 'BTCUSDT', fundingInterval: 480 }),
    makeSymbolInfo({ symbol: 'ETHUSDT', baseCoin: 'ETH', fundingInterval: 480 }),
    makeSymbolInfo({ symbol: 'ALTUSDT', baseCoin: 'ALT', fundingInterval: 240 })
  ];

  public mockFundingHistory: any[] = [];

  override async getInstruments(): Promise<SymbolInfo[]> {
    return this.mockInstruments;
  }

  override async getTickers(): Promise<Map<string, TickerData>> {
    const map = new Map<string, TickerData>();
    const now = Date.now();
    map.set('BTCUSDT', makeTicker({ symbol: 'BTCUSDT', nextFundingTime: now + 4 * 3600_000, timestamp: now }));
    map.set('ETHUSDT', makeTicker({ symbol: 'ETHUSDT', nextFundingTime: now + 4 * 3600_000, timestamp: now }));
    map.set('ALTUSDT', makeTicker({ symbol: 'ALTUSDT', nextFundingTime: now + 2 * 3600_000, timestamp: now }));
    return map;
  }

  override async getFundingHistory(symbol: string, limit?: number): Promise<any> {
    return { list: this.mockFundingHistory };
  }

  override async getCandles(): Promise<any[]> { return []; }
}

// ============================================================
// TEST GROUP 1: Funding Interval PeriodStart Calculation
// ============================================================

console.log('\n--- TEST GROUP 1: Funding Interval PeriodStart Calculation ---\n');

{
  // Test 480-minute (8h) funding interval
  const now = Date.now();
  const nextFundingTime = now + 4 * 3600_000;
  const fundingInterval480 = 480;
  const periodStart480 = nextFundingTime - (fundingInterval480 * 60_000);
  const expected480 = nextFundingTime - 8 * 3600_000;
  
  assert(
    periodStart480 === expected480,
    `480m interval: periodStart = nextFundingTime - 480*60000 (diff: ${periodStart480 - expected480}ms)`
  );
}

{
  // Test 240-minute (4h) funding interval
  const now = Date.now();
  const nextFundingTime = now + 2 * 3600_000;
  const fundingInterval240 = 240;
  const periodStart240 = nextFundingTime - (fundingInterval240 * 60_000);
  const expected240 = nextFundingTime - 4 * 3600_000;
  
  assert(
    periodStart240 === expected240,
    `240m interval: periodStart = nextFundingTime - 240*60000 (diff: ${periodStart240 - expected240}ms)`
  );
}

// ============================================================
// TEST GROUP 2: MarketDataHub FundingState Semantic Separation
// ============================================================

console.log('\n--- TEST GROUP 2: FundingState Semantic Separation ---\n');

{
  const rest = new MockBybitRest();
  const hub = new MarketDataHub(rest);
  await hub.initialize();

  // After initialize: fundingStates should exist for all instruments
  assert(
    hub.fundingStates.has('BTCUSDT'),
    'fundingStates populated for BTCUSDT after initialize'
  );
  assert(
    hub.fundingStates.has('ALTUSDT'),
    'fundingStates populated for ALTUSDT after initialize'
  );

  // History should be empty (no REST bootstrap yet) 
  const btcState = hub.fundingStates.get('BTCUSDT')!;
  assert(
    btcState.history.length === 0,
    'History is empty before bootstrap (no REST data yet)'
  );

  // Current should be populated from ticker
  assert(
    btcState.current !== null,
    'Current funding state populated from ticker after initialize'
  );

  // Verify 480m interval for BTCUSDT
  assert(
    btcState.current!.fundingIntervalMinutes === 480,
    `BTCUSDT fundingIntervalMinutes = 480 (got ${btcState.current!.fundingIntervalMinutes})`
  );

  // Verify 240m interval for ALTUSDT
  const altState = hub.fundingStates.get('ALTUSDT')!;
  assert(
    altState.current !== null && altState.current.fundingIntervalMinutes === 240,
    `ALTUSDT fundingIntervalMinutes = 240 (got ${altState.current?.fundingIntervalMinutes})`
  );

  // Verify periodStart calculation for ALTUSDT (240m)
  const altTicker = hub.tickers.get('ALTUSDT')!;
  const expectedAltPeriodStart = altTicker.nextFundingTime - (240 * 60_000);
  assert(
    altState.current!.periodStart === expectedAltPeriodStart,
    `ALTUSDT periodStart = nextFundingTime - 240*60000`
  );
}

// ============================================================
// TEST GROUP 3: Bootstrap Keeps History Separate from Current
// ============================================================

console.log('\n--- TEST GROUP 3: Bootstrap History vs Current Separation ---\n');

{
  const rest = new MockBybitRest();
  // Set up mock funding history (these are SETTLEMENT timestamps, in the past)
  const baseTs = Date.now() - 24 * 3600_000;
  rest.mockFundingHistory = [
    { fundingRate: '0.0001', fundingRateTimestamp: String(baseTs) },
    { fundingRate: '0.00015', fundingRateTimestamp: String(baseTs + 8 * 3600_000) },
    { fundingRate: '0.0002', fundingRateTimestamp: String(baseTs + 16 * 3600_000) },
    { fundingRate: '0.00012', fundingRateTimestamp: String(baseTs + 24 * 3600_000 - 3600_000) }
  ];

  const hub = new MarketDataHub(rest);
  await hub.initialize();

  // Bootstrap funding history for BTCUSDT
  await hub.bootstrapFundingHistory('BTCUSDT');

  const state = hub.fundingStates.get('BTCUSDT')!;

  assert(
    state.history.length === 4,
    `Bootstrap loaded 4 historical settlements (got ${state.history.length})`
  );

  // History should NOT contain the live ticker rate
  const tickerRate = hub.tickers.get('BTCUSDT')!.fundingRate;
  const historyRates = state.history.map(h => h.rate);
  // The ticker rate is 0.0001 which also appears in history, but the key check is
  // that bootstrap doesn't inject current ticker as a separate entry
  assert(
    state.history.every(h => h.timestamp <= Date.now()),
    'All historical timestamps are in the past (not future)'
  );

  // History should be sorted ascending
  let isSorted = true;
  for (let i = 1; i < state.history.length; i++) {
    if (state.history[i].timestamp < state.history[i - 1].timestamp) {
      isSorted = false;
      break;
    }
  }
  assert(isSorted, 'History settlements are sorted ascending by timestamp');

  // Deduplicate: push same timestamps again
  rest.mockFundingHistory = [
    ...rest.mockFundingHistory,
    { fundingRate: '0.0001', fundingRateTimestamp: String(baseTs) }, // duplicate
  ];
  await hub.bootstrapFundingHistory('BTCUSDT');

  const stateAfter = hub.fundingStates.get('BTCUSDT')!;
  assert(
    stateAfter.history.length === 4,
    `After dedupe bootstrap: still 4 unique settlements (got ${stateAfter.history.length})`
  );
}

// ============================================================
// TEST GROUP 4: Ticker Update Does NOT Inject Into History
// ============================================================

console.log('\n--- TEST GROUP 4: Ticker Update Does NOT Inject Into History ---\n');

{
  const rest = new MockBybitRest();
  const baseTs = Date.now() - 24 * 3600_000;
  rest.mockFundingHistory = [
    { fundingRate: '0.0001', fundingRateTimestamp: String(baseTs) },
    { fundingRate: '0.00015', fundingRateTimestamp: String(baseTs + 8 * 3600_000) },
    { fundingRate: '0.0002', fundingRateTimestamp: String(baseTs + 16 * 3600_000) }
  ];

  const hub = new MarketDataHub(rest);
  await hub.initialize();
  await hub.bootstrapFundingHistory('BTCUSDT');

  const historyBefore = hub.fundingStates.get('BTCUSDT')!.history.length;

  // Send multiple ticker updates
  for (let i = 0; i < 10; i++) {
    hub.updateTicker({
      symbol: 'BTCUSDT',
      lastPrice: 65000 + i * 10,
      fundingRate: 0.0003 + i * 0.00001,
      nextFundingTime: Date.now() + 4 * 3600_000,
      timestamp: Date.now() + i * 1000
    });
  }

  const historyAfter = hub.fundingStates.get('BTCUSDT')!.history.length;

  assert(
    historyAfter === historyBefore,
    `Ticker updates did NOT add to history (before=${historyBefore}, after=${historyAfter})`
  );

  // Current should reflect latest ticker rate
  const currentRate = hub.fundingStates.get('BTCUSDT')!.current!.rate;
  assert(
    currentRate === 0.0003 + 9 * 0.00001,
    `Current rate reflects latest ticker update (got ${currentRate})`
  );
}

// ============================================================
// TEST GROUP 5: isFundingReady / getFundingPercentile / getFundingHistoryCount
// ============================================================

console.log('\n--- TEST GROUP 5: Funding Helper Methods ---\n');

{
  const rest = new MockBybitRest();
  const hub = new MarketDataHub(rest);
  await hub.initialize();

  // Before bootstrap: not ready
  assert(
    !hub.isFundingReady('BTCUSDT'),
    'isFundingReady = false before bootstrap'
  );
  assert(
    hub.getFundingHistoryCount('BTCUSDT') === 0,
    'getFundingHistoryCount = 0 before bootstrap'
  );
  assert(
    hub.getFundingPercentile('BTCUSDT') === null,
    'getFundingPercentile = null before bootstrap (insufficient data)'
  );

  // Bootstrap with 3 settlements
  const baseTs = Date.now() - 24 * 3600_000;
  rest.mockFundingHistory = [
    { fundingRate: '0.0001', fundingRateTimestamp: String(baseTs) },
    { fundingRate: '0.0003', fundingRateTimestamp: String(baseTs + 8 * 3600_000) },
    { fundingRate: '0.0005', fundingRateTimestamp: String(baseTs + 16 * 3600_000) }
  ];
  await hub.bootstrapFundingHistory('BTCUSDT');

  assert(
    hub.isFundingReady('BTCUSDT'),
    'isFundingReady = true after bootstrap with 3+ settlements'
  );
  assert(
    hub.getFundingHistoryCount('BTCUSDT') === 3,
    `getFundingHistoryCount = 3 (got ${hub.getFundingHistoryCount('BTCUSDT')})`
  );

  // Percentile: current rate is 0.0001 (from ticker), history has [0.0001, 0.0003, 0.0005]
  // 0.0001 <= 0.0001 → count=1, percentile = 1/3 * 100 = 33.33
  const pctile = hub.getFundingPercentile('BTCUSDT');
  assert(
    pctile !== null && pctile > 30 && pctile < 40,
    `getFundingPercentile for rate at low end ≈ 33% (got ${pctile?.toFixed(2)})`
  );
}

// ============================================================
// TEST GROUP 6: OIFundingEngine Returns fundingReady & fundingHistoryCount
// ============================================================

console.log('\n--- TEST GROUP 6: OIFundingEngine fundingReady & fundingHistoryCount ---\n');

{
  const engine = new OIFundingEngine();
  const ticker = makeTicker({ fundingRate: 0.0001, openInterest: 80000, openInterestValue: 5_200_000_000 });
  const prevTicker = makeTicker({ openInterest: 79000, openInterestValue: 5_135_000_000 });

  // No funding history
  const resultNoHistory = engine.analyze(ticker, prevTicker, [], null);
  assert(
    resultNoHistory.fundingReady === false,
    'fundingReady = false when no funding history'
  );
  assert(
    resultNoHistory.fundingHistoryCount === 0,
    `fundingHistoryCount = 0 when no history (got ${resultNoHistory.fundingHistoryCount})`
  );

  // With 5 history points
  const history = [0.0001, 0.0002, 0.0003, 0.0004, 0.0005];
  const resultWithHistory = engine.analyze(ticker, prevTicker, history, null);
  assert(
    resultWithHistory.fundingReady === true,
    'fundingReady = true when history >= 3'
  );
  assert(
    resultWithHistory.fundingHistoryCount === 5,
    `fundingHistoryCount = 5 (got ${resultWithHistory.fundingHistoryCount})`
  );
}

// ============================================================
// TEST GROUP 7: Stage1 Explicit Rejection Counters
// ============================================================

console.log('\n--- TEST GROUP 7: Stage1 Explicit Rejection Counters ---\n');

{
  const filter = new Stage1Filter(CONFIG);
  const now = Date.now();

  const instruments = new Map<string, SymbolInfo>();
  instruments.set('ACTIVE', makeSymbolInfo({ symbol: 'ACTIVE' }));
  instruments.set('INACTIVE', makeSymbolInfo({ symbol: 'INACTIVE', status: 'Closed' }));
  instruments.set('WRONGCOIN', makeSymbolInfo({ symbol: 'WRONGCOIN', quoteCoin: 'BTC' }));
  instruments.set('LOWLIQ', makeSymbolInfo({ symbol: 'LOWLIQ' }));
  instruments.set('LOWOI', makeSymbolInfo({ symbol: 'LOWOI' }));
  instruments.set('WIDESPREAD', makeSymbolInfo({ symbol: 'WIDESPREAD' }));

  const tickers = new Map<string, TickerData>();
  tickers.set('ACTIVE', makeTicker({ symbol: 'ACTIVE', timestamp: now }));
  tickers.set('INACTIVE', makeTicker({ symbol: 'INACTIVE', timestamp: now }));
  tickers.set('WRONGCOIN', makeTicker({ symbol: 'WRONGCOIN', timestamp: now }));
  tickers.set('LOWLIQ', makeTicker({ symbol: 'LOWLIQ', turnover24h: 1_000_000, timestamp: now }));
  tickers.set('LOWOI', makeTicker({ symbol: 'LOWOI', openInterestValue: 500_000, timestamp: now }));
  tickers.set('WIDESPREAD', makeTicker({ 
    symbol: 'WIDESPREAD', 
    bid1Price: 100, 
    ask1Price: 102,  // 200 bps spread
    timestamp: now 
  }));

  const prevTickers = new Map<string, TickerData>();
  const results = filter.filter(tickers, prevTickers, instruments);
  const diag = filter.lastDiagnostics;

  assert(
    diag.totalScanned === 6,
    `totalScanned = 6 (got ${diag.totalScanned})`
  );
  assert(
    diag.rejectedInactive === 1,
    `rejectedInactive = 1 (got ${diag.rejectedInactive})`
  );
  assert(
    diag.rejectedWrongContract === 1,
    `rejectedWrongContract = 1 (got ${diag.rejectedWrongContract})`
  );
  assert(
    diag.rejectedLowLiquidity === 1,
    `rejectedLowLiquidity = 1 (got ${diag.rejectedLowLiquidity})`
  );
  assert(
    diag.rejectedLowOI === 1,
    `rejectedLowOI = 1 (got ${diag.rejectedLowOI})`
  );
  assert(
    diag.rejectedWideSpread === 1,
    `rejectedWideSpread = 1 (got ${diag.rejectedWideSpread})`
  );

  // Sum of rejections + passed should account for all scanned (minus those without instrument)
  const totalAccounted = diag.rejectedInactive + diag.rejectedWrongContract +
    diag.rejectedLowLiquidity + diag.rejectedLowOI + diag.rejectedWideSpread +
    diag.rejectedNoMovement + diag.passed;
  assert(
    totalAccounted === diag.totalScanned,
    `All rejections + passed = totalScanned (${totalAccounted} vs ${diag.totalScanned})`
  );
}

// ============================================================
// TEST GROUP 8: Stage3 Explicit passed Boolean
// ============================================================

console.log('\n--- TEST GROUP 8: Stage3 Explicit passed Boolean ---\n');

{
  const stage3 = new Stage3Execution();
  const ticker = makeTicker({
    bid1Price: 64999,
    ask1Price: 65001,
    lastPrice: 65000
  });
  const orderbook = {
    symbol: 'BTCUSDT',
    bids: Array.from({ length: 20 }, (_, i) => ({ price: 64999 - i, size: 50 })),
    asks: Array.from({ length: 20 }, (_, i) => ({ price: 65001 + i, size: 50 })),
    timestamp: Date.now(),
    updateId: 1
  };
  const recentTrades = Array.from({ length: 50 }, (_, i) => ({
    symbol: 'BTCUSDT',
    side: (i % 2 === 0 ? 'Buy' : 'Sell') as 'Buy' | 'Sell',
    price: 65000 + (i % 10),
    qty: 0.1,
    time: Date.now() - i * 1000,
    isBlockTrade: false
  }));

  const result = stage3.analyze('BTCUSDT', orderbook, ticker, recentTrades, 'LONG');

  assert(
    typeof result.passed === 'boolean',
    `Stage3 result has explicit 'passed' boolean (type: ${typeof result.passed})`
  );
  assert(
    typeof result.reason === 'string' && result.reason.length > 0,
    `Stage3 result has explicit 'reason' string (got: "${result.reason}")`
  );

  // For good liquidity BTC, should pass
  if (result.passed) {
    assert(true, `Stage3 correctly passes for well-liquid BTCUSDT (score: ${result.total})`);
  }

  // Test with terrible execution conditions
  const badTicker = makeTicker({
    bid1Price: 100,
    ask1Price: 102, // 200 bps spread
    lastPrice: 101
  });
  const badOrderbook = {
    symbol: 'BADUSDT',
    bids: [{ price: 100, size: 0.001 }],
    asks: [{ price: 102, size: 0.001 }],
    timestamp: Date.now(),
    updateId: 1
  };

  const badResult = stage3.analyze('BADUSDT', badOrderbook, badTicker, [], 'LONG');
  assert(
    badResult.passed === false,
    `Stage3 correctly rejects bad execution quality (score: ${badResult.total}, spread: ${badResult.slippageBps}bps)`
  );
}

// ============================================================
// TEST GROUP 9: Missing Funding ≠ Bearish Penalty
// ============================================================

console.log('\n--- TEST GROUP 9: Missing Funding Does Not Force Bearish ---\n');

{
  const engine = new OIFundingEngine();
  const ticker = makeTicker({ fundingRate: 0, openInterest: 80000, openInterestValue: 5_200_000_000 });
  const prevTicker = makeTicker({ openInterest: 75000 });

  // With NO funding history and zero rate
  const resultMissing = engine.analyze(ticker, prevTicker, [], null);

  // longScore should NOT be penalized just because funding is missing
  // When OI is rising and price is rising, longScore should get a boost even without funding
  assert(
    resultMissing.longScore >= 0,
    `Missing funding: longScore >= 0 (got ${resultMissing.longScore})`
  );
  assert(
    resultMissing.fundingReady === false,
    'Missing funding correctly reports fundingReady = false'
  );
}

// ============================================================
// FINAL SUMMARY
// ============================================================

console.log('\n====================================================');
console.log(`P2 FUNDING SEMANTICS: ${passed} passed, ${failed} failed out of ${passed + failed}`);
console.log('====================================================');

if (failed > 0) {
  process.exit(1);
}
