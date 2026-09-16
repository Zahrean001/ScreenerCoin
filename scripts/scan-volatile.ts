import { BybitRest } from '../src/data/bybit-rest.js';
import { IncrementalATR } from '../src/indicators/incremental.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function calculateATR(candles: { high: number; low: number; close: number }[], period: number = 14): number {
  const atr = new IncrementalATR(period);
  let val: number | null = null;
  for (const c of candles) val = atr.update(c.high, c.low, c.close);
  return val ?? (candles[candles.length - 1].close * 0.02);
}

async function scanVolatileCoins() {
  const rest = new BybitRest();
  console.log('🔍 Memindai seluruh universe Bybit Perpetual untuk koin bervolatilitas ekstrim...');

  const [instruments, tickerMap] = await Promise.all([
    rest.getInstruments(),
    rest.getTickers()
  ]);

  const validSymbols = new Set(instruments.map(i => i.symbol));
  const candidates: any[] = [];

  for (const [sym, t] of tickerMap.entries()) {
    if (!validSymbols.has(sym)) continue;
    if (t.turnover24h < 8_000_000) continue; // Min $8M volume agar likuiditas aman
    if (t.lastPrice <= 0 || t.lowPrice24h <= 0) continue;

    const spreadBps = t.bid1Price > 0 ? ((t.ask1Price - t.bid1Price) / t.bid1Price) * 10000 : 999;
    if (spreadBps > 15) continue; // Spread harus rapat

    const dailyRangePct = ((t.highPrice24h - t.lowPrice24h) / t.lowPrice24h) * 100;
    const absChange24h = Math.abs(t.price24hPcnt) * 100;

    // Filter yang range 24 jamnya di atas 20%
    if (dailyRangePct >= 20 || absChange24h >= 15) {
      candidates.push({
        symbol: sym,
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
  const topVolatile = candidates.slice(0, 15);

  console.log(`Mengambil klines 15m untuk ${topVolatile.length} koin teratas...`);

  const results: any[] = [];
  const BATCH_SIZE = 5;
  for (let i = 0; i < topVolatile.length; i += BATCH_SIZE) {
    const batch = topVolatile.slice(i, i + BATCH_SIZE);
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

  // Sort by atrPct (volatilitas per candle 15m) & dailyRangePct
  results.sort((a, b) => (b.atrPct * 1.5 + b.dailyRangePct * 0.1) - (a.atrPct * 1.5 + a.dailyRangePct * 0.1));

  console.log('\n--- VOLATILITY_SCAN_RESULT ---');
  console.log(JSON.stringify(results.slice(0, 8), null, 2));
}

scanVolatileCoins().catch(console.error);
