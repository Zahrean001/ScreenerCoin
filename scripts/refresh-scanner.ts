import { BybitRest } from '../src/data/bybit-rest.js';
import { IncrementalATR, IncrementalEMA, IncrementalRSI } from '../src/indicators/incremental.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function calculateATR(candles: { high: number; low: number; close: number }[], period: number = 14): number {
  const atr = new IncrementalATR(period);
  let val: number | null = null;
  for (const c of candles) val = atr.update(c.high, c.low, c.close);
  return val ?? (candles[candles.length - 1].close * 0.02);
}

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

async function refreshAll() {
  const rest = new BybitRest();
  console.log('🔄 Memperbarui seluruh data pasar live (UAI + Koin Volatil High Leverage)...');

  const [instruments, tickerMap] = await Promise.all([
    rest.getInstruments(),
    rest.getTickers()
  ]);

  const instMap = new Map(instruments.map(i => [i.symbol, i]));

  // 1. UPDATE UAIUSDT
  const uaiTicker = tickerMap.get('UAIUSDT');
  let uaiData: any = null;
  if (uaiTicker) {
    const [c15m_uai, c1h_uai] = await Promise.all([
      rest.getKlines('UAIUSDT', '15', 30),
      rest.getKlines('UAIUSDT', '60', 30)
    ]);
    const close15m = c15m_uai.map(c => c.close);
    const close1h = c1h_uai.map(c => c.close);
    const ema21_15m = calculateEMA(close15m, 21);
    const ema50_15m = calculateEMA(close15m, 50);
    const ema21_1h = calculateEMA(close1h, 21);
    const ema50_1h = calculateEMA(close1h, 50);
    const rsi15m = calculateRSI(close15m, 14);

    uaiData = {
      price: uaiTicker.lastPrice,
      high24h: uaiTicker.highPrice24h,
      low24h: uaiTicker.lowPrice24h,
      change24h: (uaiTicker.price24hPcnt * 100).toFixed(2),
      rsi15m: rsi15m.toFixed(1),
      ema21_15m: ema21_15m.toFixed(4),
      ema50_15m: ema50_15m.toFixed(4),
      ema21_1h: ema21_1h.toFixed(4),
      ema50_1h: ema50_1h.toFixed(4),
      recentCandles15m: c15m_uai.slice(-4).map(c => ({
        time: new Date(c.timestamp).toLocaleTimeString(),
        O: c.open.toFixed(4),
        H: c.high.toFixed(4),
        L: c.low.toFixed(4),
        C: c.close.toFixed(4),
        vol: (c.volume / 1000).toFixed(0) + 'k'
      }))
    };
  }

  // 2. SCAN TOP VOLATILE WITH LEVERAGE >= 25x
  const candidates: any[] = [];
  for (const [sym, t] of tickerMap.entries()) {
    const inst = instMap.get(sym);
    if (!inst) continue;
    if (inst.maxLeverage < 25) continue; // Min 25x leverage
    if (t.turnover24h < 12_000_000) continue; // Min $12M volume
    if (t.lastPrice <= 0 || t.lowPrice24h <= 0) continue;

    const spreadBps = t.bid1Price > 0 ? ((t.ask1Price - t.bid1Price) / t.bid1Price) * 10000 : 999;
    if (spreadBps > 10) continue;

    const dailyRangePct = ((t.highPrice24h - t.lowPrice24h) / t.lowPrice24h) * 100;
    const absChange24h = Math.abs(t.price24hPcnt) * 100;

    if (dailyRangePct >= 15 || absChange24h >= 10) {
      candidates.push({
        symbol: sym,
        maxLeverage: inst.maxLeverage,
        price: t.lastPrice,
        dailyRangePct,
        change24h: (t.price24hPcnt * 100).toFixed(2),
        volumeUsd: t.turnover24h,
        fundingRate: (t.fundingRate * 100).toFixed(4),
        spreadBps: spreadBps.toFixed(1)
      });
    }
  }

  candidates.sort((a, b) => b.dailyRangePct - a.dailyRangePct);
  const topList = candidates.slice(0, 10);

  const volatileResults: any[] = [];
  await Promise.all(topList.map(async (c) => {
    try {
      const [c1m, c5m, c15m] = await Promise.all([
        rest.getKlines(c.symbol, '1', 20),
        rest.getKlines(c.symbol, '5', 20),
        rest.getKlines(c.symbol, '15', 30)
      ]);

      const ranges1m = c1m.map(k => ((k.high - k.low) / k.low) * 100);
      const avg1m = ranges1m.reduce((a, b) => a + b, 0) / ranges1m.length;

      const ranges5m = c5m.map(k => ((k.high - k.low) / k.low) * 100);
      const avg5m = ranges5m.reduce((a, b) => a + b, 0) / ranges5m.length;

      const atr15m = calculateATR(c15m, 14);
      const atrPct = (atr15m / c.price) * 100;

      const close15m = c15m.map(k => k.close);
      const ema9 = calculateEMA(close15m, 9);
      const ema21 = calculateEMA(close15m, 21);
      const rsi15m = calculateRSI(close15m, 14);

      let bias = 'NEUTRAL / RANGE';
      if (ema9 > ema21 && rsi15m > 50) bias = 'BULLISH MOMENTUM';
      else if (ema9 < ema21 && rsi15m < 50) bias = 'BEARISH TREND';

      volatileResults.push({
        ...c,
        atrPct: Number(atrPct.toFixed(2)),
        avg1mSwing: Number(avg1m.toFixed(2)),
        avg5mSwing: Number(avg5m.toFixed(2)),
        bias,
        rsi15m: Number(rsi15m.toFixed(1))
      });
    } catch (e) {}
  }));

  volatileResults.sort((a, b) => (b.avg5mSwing * 2 + b.atrPct * 1.5) - (a.avg5mSwing * 2 + a.atrPct * 1.5));

  console.log('\n--- LIVE_REFRESH_OUTPUT_START ---');
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    uaiStatus: uaiData,
    topVolatileHighLev: volatileResults.slice(0, 6)
  }, null, 2));
  console.log('--- LIVE_REFRESH_OUTPUT_END ---');
}

refreshAll().catch(console.error);
