import { BybitRest } from '../src/data/bybit-rest.js';
import { IncrementalEMA, IncrementalVWAP } from '../src/indicators/incremental.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function calculateEMA(prices: number[], period: number): number {
  const ema = new IncrementalEMA(period);
  let val: number | null = null;
  for (const p of prices) val = ema.update(p);
  return val ?? prices[prices.length - 1];
}

async function analyzeLevel() {
  const rest = new BybitRest();
  const symbol = 'UAIUSDT';
  
  const [c1h, c4h, tickerMap] = await Promise.all([
    rest.getKlines(symbol, '60', 60),
    rest.getKlines(symbol, '240', 30).catch(() => []),
    rest.getTickers()
  ]);

  const ticker = tickerMap.get(symbol);
  console.log(`Current Live Price: $${ticker?.lastPrice}`);

  console.log('\n--- 1H CANDLES ANALYSIS (Last 12) ---');
  c1h.slice(-12).forEach(c => {
    const d = new Date(c.timestamp).toISOString().replace('T', ' ').substring(5, 16);
    console.log(`[${d}] O:${c.open.toFixed(4)} H:${c.high.toFixed(4)} L:${c.low.toFixed(4)} C:${c.close.toFixed(4)} V:${(c.volume/1000).toFixed(0)}k`);
  });

  const close1h = c1h.map(c => c.close);
  const ema9_1h = calculateEMA(close1h, 9);
  const ema21_1h = calculateEMA(close1h, 21);
  const ema50_1h = calculateEMA(close1h, 50);

  console.log(`\n1H EMA 9: $${ema9_1h.toFixed(4)}`);
  console.log(`1H EMA 21: $${ema21_1h.toFixed(4)}`);
  console.log(`1H EMA 50: $${ema50_1h.toFixed(4)}`);

  // Check 4H EMAs & Levels
  if (c4h.length > 0) {
    const close4h = c4h.map(c => c.close);
    const ema9_4h = calculateEMA(close4h, 9);
    const ema21_4h = calculateEMA(close4h, 21);
    console.log(`\n4H EMA 9: $${ema9_4h.toFixed(4)}`);
    console.log(`4H EMA 21: $${ema21_4h.toFixed(4)}`);
    console.log('\n--- 4H RECENT CANDLES ---');
    c4h.slice(-6).forEach(c => {
      const d = new Date(c.timestamp).toISOString().replace('T', ' ').substring(5, 16);
      console.log(`[${d}] O:${c.open.toFixed(4)} H:${c.high.toFixed(4)} L:${c.low.toFixed(4)} C:${c.close.toFixed(4)} V:${(c.volume/1000).toFixed(0)}k`);
    });
  }

  // Find Fair Value Gap / Breakdown Origin on 1H
  console.log('\n--- 1H IMBALANCE / FVG / LIQUIDITY POOLS ---');
  for (let i = 2; i < c1h.length; i++) {
    const c_prev2 = c1h[i-2];
    const c_curr = c1h[i];
    if (c_prev2.low > c_curr.high) {
      const d = new Date(c1h[i-1].timestamp).toISOString().replace('T', ' ').substring(5, 16);
      console.log(`Bearish FVG at [${d}]: Gap between Low $${c_prev2.low.toFixed(4)} and High $${c_curr.high.toFixed(4)} (Mid: $${((c_prev2.low + c_curr.high)/2).toFixed(4)})`);
    }
  }
}

analyzeLevel().catch(console.error);
