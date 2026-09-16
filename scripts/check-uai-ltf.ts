import { BybitRest } from '../src/data/bybit-rest.js';
import { IncrementalEMA, IncrementalRSI, IncrementalATR, IncrementalVWAP } from '../src/indicators/incremental.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function calculateEMA(prices: number[], period: number): number {
  const ema = new IncrementalEMA(period);
  let val: number | null = null;
  for (const p of prices) val = ema.update(p);
  return val ?? prices[prices.length - 1];
}

function calculateRSI(prices: number[], period: number = 14): number {
  const rsi = new IncrementalRSI(period);
  let val: number | null = null;
  for (const p of prices) val = rsi.update(p);
  return val ?? 50;
}

async function checkLTF() {
  const rest = new BybitRest();
  const symbol = 'UAIUSDT';
  
  const [tickerMap, c1m, c5m, c15m, c1h, ob] = await Promise.all([
    rest.getTickers(),
    rest.getKlines(symbol, '1', 60),
    rest.getKlines(symbol, '5', 60),
    rest.getKlines(symbol, '15', 60),
    rest.getKlines(symbol, '60', 60),
    rest.getOrderbook(symbol, 20).catch(() => null)
  ]);

  const ticker = tickerMap.get(symbol);
  if (!ticker) {
    console.log('Ticker not found');
    return;
  }

  const lastPrice = ticker.lastPrice;
  const close1m = c1m.map(c => c.close);
  const close5m = c5m.map(c => c.close);
  const close15m = c15m.map(c => c.close);
  const close1h = c1h.map(c => c.close);

  console.log('--- UAIUSDT LIVE UPDATE ---');
  console.log(`Current Price: $${lastPrice}`);
  console.log(`24h Price Change: ${(ticker.price24hPcnt * 100).toFixed(2)}%`);
  console.log(`24h High: $${ticker.highPrice24h} | 24h Low: $${ticker.lowPrice24h}`);
  console.log(`Funding Rate: ${(ticker.fundingRate * 100).toFixed(4)}%`);
  console.log(`Open Interest USD: $${(ticker.openInterestValue / 1e6).toFixed(2)}M`);
  
  // LTF indicators
  const rsi1m = calculateRSI(close1m, 14);
  const rsi5m = calculateRSI(close5m, 14);
  const rsi15m = calculateRSI(close15m, 14);
  const rsi1h = calculateRSI(close1h, 14);

  const ema9_5m = calculateEMA(close5m, 9);
  const ema21_5m = calculateEMA(close5m, 21);
  const ema50_5m = calculateEMA(close5m, 50);

  const ema9_15m = calculateEMA(close15m, 9);
  const ema21_15m = calculateEMA(close15m, 21);
  const ema50_15m = calculateEMA(close15m, 50);

  const ema9_1h = calculateEMA(close1h, 9);
  const ema21_1h = calculateEMA(close1h, 21);
  const ema50_1h = calculateEMA(close1h, 50);

  console.log('\n--- MULTI-TIMEFRAME STRUCTURE ---');
  console.log(`1m RSI: ${rsi1m.toFixed(1)}`);
  console.log(`5m RSI: ${rsi5m.toFixed(1)} | EMA9: $${ema9_5m.toFixed(4)} | EMA21: $${ema21_5m.toFixed(4)} | EMA50: $${ema50_5m.toFixed(4)}`);
  console.log(`15m RSI: ${rsi15m.toFixed(1)} | EMA9: $${ema9_15m.toFixed(4)} | EMA21: $${ema21_15m.toFixed(4)} | EMA50: $${ema50_15m.toFixed(4)}`);
  console.log(`1h RSI: ${rsi1h.toFixed(1)} | EMA9: $${ema9_1h.toFixed(4)} | EMA21: $${ema21_1h.toFixed(4)} | EMA50: $${ema50_1h.toFixed(4)}`);

  console.log('\n--- RECENT 5M CANDLES (Last 6) ---');
  c5m.slice(-6).forEach((c, i) => {
    const time = new Date(c.timestamp).toLocaleTimeString();
    console.log(`[${time}] O:$${c.open.toFixed(4)} H:$${c.high.toFixed(4)} L:$${c.low.toFixed(4)} C:$${c.close.toFixed(4)} Vol:${c.volume.toFixed(0)}`);
  });

  console.log('\n--- RECENT 15M CANDLES (Last 6) ---');
  c15m.slice(-6).forEach((c, i) => {
    const time = new Date(c.timestamp).toLocaleTimeString();
    console.log(`[${time}] O:$${c.open.toFixed(4)} H:$${c.high.toFixed(4)} L:$${c.low.toFixed(4)} C:$${c.close.toFixed(4)} Vol:${c.volume.toFixed(0)}`);
  });

  if (ob && ob.asks) {
    console.log('\n--- TOP ASK WALLS (Resistance) ---');
    ob.asks.slice(0, 8).forEach(a => {
      console.log(`Price: $${a.price.toFixed(4)} | Size: ${a.size} | Value: $${(a.price * a.size).toFixed(1)}`);
    });
  }
}

checkLTF().catch(console.error);
