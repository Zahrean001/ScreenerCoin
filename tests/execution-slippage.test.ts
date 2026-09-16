// ============================================================
// Tests: Execution Slippage & Direction-Aware Execution Quality
// ============================================================

import { Stage3Execution } from '../src/stages/stage3-execution.js';
import { OrderbookSnapshot, TickerData, TradeData } from '../src/data/types.js';

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
  console.log('=== Running Execution & Slippage Engine Tests ===\n');

  const exec = new Stage3Execution();

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

  const dummyTrades: TradeData[] = Array.from({ length: 30 }, (_, i) => ({
    timestamp: Date.now() - (i * 1000),
    symbol: 'TESTUSDT',
    side: 'Buy',
    price: 100,
    size: 10
  }));

  // 1. Deep liquid book (Tight spread, deep liquidity, zero slippage)
  const deepOrderbook: OrderbookSnapshot = {
    symbol: 'TESTUSDT',
    timestamp: Date.now(),
    updateId: 1,
    bids: [
      { price: 99.99, size: 500 }, // $50K
      { price: 99.98, size: 1000 }, // $100K
      { price: 99.95, size: 2000 }, // $200K
    ],
    asks: [
      { price: 100.01, size: 500 }, // $50K
      { price: 100.02, size: 1000 }, // $100K
      { price: 100.05, size: 2000 }, // $200K
    ]
  };

  const longDeep = exec.evaluateExecution('TESTUSDT', 'LONG', deepOrderbook, dummyTicker, dummyTrades, 10_000);
  assert(longDeep.spreadBps < 5, 'Spread is tight (< 5 bps)');
  assert(longDeep.slippageBps !== null && longDeep.slippageBps < 3, 'Slippage is minimal (< 3 bps) for $10K LONG fill on deep book');
  assert(longDeep.executableNotional === 10_000, 'Full notional executed');
  assert(longDeep.totalScore >= 85, 'Total execution score >= 85 on deep book');

  // 2. SHORT direction on deep book (consumes BIDS)
  const shortDeep = exec.evaluateExecution('TESTUSDT', 'SHORT', deepOrderbook, dummyTicker, dummyTrades, 10_000);
  assert(shortDeep.slippageBps !== null && shortDeep.slippageBps < 3, 'SHORT slippage evaluates bid side (< 3 bps)');
  assert(shortDeep.direction === 'SHORT', 'Direction correctly tagged as SHORT');

  // 3. Multi-Level Fill on thin book (Price impact simulation)
  const thinOrderbook: OrderbookSnapshot = {
    symbol: 'TESTUSDT',
    timestamp: Date.now(),
    updateId: 2,
    bids: [
      { price: 99.90, size: 10 },  // $1K
      { price: 99.50, size: 20 },  // $2K
      { price: 98.00, size: 100 }, // $9.8K
    ],
    asks: [
      { price: 100.10, size: 10 }, // $1K (100.10)
      { price: 100.50, size: 20 }, // $2K (100.50)
      { price: 102.00, size: 100 }, // $10.2K (102.00)
    ]
  };

  const longThin = exec.evaluateExecution('TESTUSDT', 'LONG', thinOrderbook, dummyTicker, dummyTrades, 10_000);
  // $1K @ 100.10, $2K @ 100.50, $7K @ 102.00 => VWAP ~ 101.51 vs Mid 100.0 => Slippage ~ 151 bps
  assert(longThin.slippageBps !== null && longThin.slippageBps > 50, 'Multi-level fill correctly computes high slippage (> 50 bps)');
  assert(longThin.slippageScore <= 10, 'Slippage score appropriately penalized for thin book');

  // 4. Direction Asymmetry: Asks are thin, Bids are deep
  const asymmetricOrderbook: OrderbookSnapshot = {
    symbol: 'TESTUSDT',
    timestamp: Date.now(),
    updateId: 3,
    bids: [
      { price: 99.99, size: 5000 }, // $500K deep bids!
    ],
    asks: [
      { price: 100.10, size: 10 },   // $1K thin asks
      { price: 105.00, size: 10 },   // $1K very wide
    ]
  };

  const longAsym = exec.evaluateExecution('TESTUSDT', 'LONG', asymmetricOrderbook, dummyTicker, dummyTrades, 10_000);
  const shortAsym = exec.evaluateExecution('TESTUSDT', 'SHORT', asymmetricOrderbook, dummyTicker, dummyTrades, 10_000);
  assert(shortAsym.totalScore > longAsym.totalScore + 20, 'SHORT receives significantly higher execution score than LONG when bids are deep and asks are thin');

  // 5. Insufficient Depth / Partial Fill
  const shallowOrderbook: OrderbookSnapshot = {
    symbol: 'TESTUSDT',
    timestamp: Date.now(),
    updateId: 4,
    bids: [{ price: 99.90, size: 10 }], // only $1K total depth
    asks: [{ price: 100.10, size: 10 }] // only $1K total depth
  };

  const partialFill = exec.evaluateExecution('TESTUSDT', 'LONG', shallowOrderbook, dummyTicker, dummyTrades, 10_000);
  assert(partialFill.executableNotional < 10_000, 'Detected partial fill when orderbook depth is insufficient');
  assert(partialFill.reasons.some(r => r.includes('Partial fill')), 'Reason explicitly tags partial fill');

  console.log(`\n=== Execution & Slippage Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
