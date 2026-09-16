import { BybitRest } from '../src/data/bybit-rest.js';
import { IncrementalATR } from '../src/indicators/incremental.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function calculateATR(candles: { high: number; low: number; close: number }[], period: number = 14): number {
  const atr = new IncrementalATR(period);
  let val: number | null = null;
  for (const c of candles) val = atr.update(c.high, c.low, c.close);
  return val ?? (candles[candles.length - 1].close * 0.02);
}

async function scanTier2Lev() {
  const rest = new BybitRest();
  const [instruments, tickerMap] = await Promise.all([
    rest.getInstruments(),
    rest.getTickers()
  ]);

  const instMap = new Map(instruments.map(i => [i.symbol, i]));
  const candidates: any[] = [];

  for (const [sym, t] of tickerMap.entries()) {
    const inst = instMap.get(sym);
    if (!inst) continue;
    if (inst.maxLeverage < 25) continue; // Min 25x leverage!
    if (t.turnover24h < 10_000_000) continue;
    if (t.lastPrice <= 0 || t.lowPrice24h <= 0) continue;

    const spreadBps = t.bid1Price > 0 ? ((t.ask1Price - t.bid1Price) / t.bid1Price) * 10000 : 999;
    if (spreadBps > 12) continue;

    const dailyRangePct = ((t.highPrice24h - t.lowPrice24h) / t.lowPrice24h) * 100;
    const absChange24h = Math.abs(t.price24hPcnt) * 100;

    if (dailyRangePct >= 18 || absChange24h >= 12) {
      candidates.push({
        symbol: sym,
        maxLeverage: inst.maxLeverage,
        price: t.lastPrice,
        dailyRangePct,
        change24h: (t.price24hPcnt * 100).toFixed(2),
        volumeUsd: t.turnover24h,
        spreadBps: spreadBps.toFixed(1)
      });
    }
  }

  candidates.sort((a, b) => b.dailyRangePct - a.dailyRangePct);
  const topPool = candidates.slice(0, 15);

  const results: any[] = [];
  const BATCH_SIZE = 5;
  for (let i = 0; i < topPool.length; i += BATCH_SIZE) {
    const batch = topPool.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (c) => {
      try {
        const klines15m = await rest.getKlines(c.symbol, '15', 30);
        if (klines15m.length < 15) return;
        const atr15m = calculateATR(klines15m, 14);
        const atrPct = (atr15m / c.price) * 100;
        results.push({
          ...c,
          atrPct: Number(atrPct.toFixed(2))
        });
      } catch (e) {}
    }));
  }

  results.sort((a, b) => (b.dailyRangePct * 0.4 + b.atrPct * 10) - (a.dailyRangePct * 0.4 + a.atrPct * 10));
  console.log(JSON.stringify(results.slice(0, 10), null, 2));
}

scanTier2Lev().catch(console.error);
