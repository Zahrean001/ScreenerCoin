import { BybitRest } from '../src/data/bybit-rest.js';
import { IncrementalATR } from '../src/indicators/incremental.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function calculateATR(candles: { high: number; low: number; close: number }[], period: number = 14): number {
  const atr = new IncrementalATR(period);
  let val: number | null = null;
  for (const c of candles) val = atr.update(c.high, c.low, c.close);
  return val ?? (candles[candles.length - 1].close * 0.02);
}

async function scanHighLevVolatile() {
  const rest = new BybitRest();
  console.log('🔍 Memindai koin bervolatilitas tinggi dengan LEVERAGE BESAR (50x - 100x)...');

  const [instruments, tickerMap] = await Promise.all([
    rest.getInstruments(),
    rest.getTickers()
  ]);

  const instMap = new Map(instruments.map(i => [i.symbol, i]));
  const candidates: any[] = [];

  for (const [sym, t] of tickerMap.entries()) {
    const inst = instMap.get(sym);
    if (!inst) continue;
    if (inst.maxLeverage < 50) continue; // Filter LEVERAGE MINIMAL 50x (50x, 75x, 100x)
    if (t.turnover24h < 15_000_000) continue; // Min $15M volume agar likuiditas dalam
    if (t.lastPrice <= 0 || t.lowPrice24h <= 0) continue;

    const spreadBps = t.bid1Price > 0 ? ((t.ask1Price - t.bid1Price) / t.bid1Price) * 10000 : 999;
    if (spreadBps > 10) continue; // Spread harus sangat rapat

    const dailyRangePct = ((t.highPrice24h - t.lowPrice24h) / t.lowPrice24h) * 100;
    const absChange24h = Math.abs(t.price24hPcnt) * 100;

    // Filter yang range 24 jamnya cukup aktif (>= 12%)
    if (dailyRangePct >= 12 || absChange24h >= 8) {
      candidates.push({
        symbol: sym,
        maxLeverage: inst.maxLeverage,
        price: t.lastPrice,
        high24h: t.highPrice24h,
        low24h: t.lowPrice24h,
        dailyRangePct,
        change24h: (t.price24hPcnt * 100).toFixed(2),
        volumeUsd: t.turnover24h,
        fundingRate: (t.fundingRate * 100).toFixed(4),
        spreadBps: spreadBps.toFixed(1)
      });
    }
  }

  // Sort by dailyRangePct descending
  candidates.sort((a, b) => b.dailyRangePct - a.dailyRangePct);
  const topPool = candidates.slice(0, 18);

  console.log(`Menghitung ATR 15m untuk ${topPool.length} koin ber-leverage tinggi...`);

  const results: any[] = [];
  const BATCH_SIZE = 6;
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
          atr15m,
          atrPct: Number(atrPct.toFixed(2))
        });
      } catch (e) {}
    }));
  }

  // Sort by combination of daily range, ATR% and maxLeverage
  results.sort((a, b) => (b.dailyRangePct * 0.5 + b.atrPct * 10) - (a.dailyRangePct * 0.5 + a.atrPct * 10));

  console.log('\n--- HIGH_LEV_VOLATILITY_RESULT ---');
  console.log(JSON.stringify(results.slice(0, 10), null, 2));
}

scanHighLevVolatile().catch(console.error);
