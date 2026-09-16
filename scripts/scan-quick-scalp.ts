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

async function scanQuickScalpCoins() {
  const rest = new BybitRest();
  console.log('🔍 Memindai koin spesialis SCALP CEPAT: TP Dekat tapi ROE / Profit Besar...');

  const [instruments, tickerMap] = await Promise.all([
    rest.getInstruments(),
    rest.getTickers()
  ]);

  const instMap = new Map(instruments.map(i => [i.symbol, i]));
  const candidates: any[] = [];

  for (const [sym, t] of tickerMap.entries()) {
    const inst = instMap.get(sym);
    if (!inst) continue;
    if (inst.maxLeverage < 20) continue; // Min 20x-75x leverage
    if (t.turnover24h < 15_000_000) continue; // Min $15M liquidity
    if (t.lastPrice <= 0 || t.lowPrice24h <= 0) continue;

    const spreadBps = t.bid1Price > 0 ? ((t.ask1Price - t.bid1Price) / t.bid1Price) * 10000 : 999;
    if (spreadBps > 8) continue; // Spread sangat rapat (max 8 bps) agar TP dekat tidak kemakan fee

    const dailyRangePct = ((t.highPrice24h - t.lowPrice24h) / t.lowPrice24h) * 100;
    if (dailyRangePct >= 18 || Math.abs(t.price24hPcnt) >= 12) {
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

  // Ambil 12 kandidat teraktif
  candidates.sort((a, b) => b.dailyRangePct - a.dailyRangePct);
  const topPool = candidates.slice(0, 12);

  const results: any[] = [];
  const BATCH_SIZE = 4;
  for (let i = 0; i < topPool.length; i += BATCH_SIZE) {
    const batch = topPool.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (c) => {
      try {
        const [c1m, c5m, c15m] = await Promise.all([
          rest.getKlines(c.symbol, '1', 30),
          rest.getKlines(c.symbol, '5', 30),
          rest.getKlines(c.symbol, '15', 30)
        ]);

        if (c5m.length < 15) return;

        // 1m and 5m candle ranges in %
        const ranges1m = c1m.map(k => ((k.high - k.low) / k.low) * 100);
        const avg1m = ranges1m.reduce((a, b) => a + b, 0) / ranges1m.length;

        const ranges5m = c5m.map(k => ((k.high - k.low) / k.low) * 100);
        const avg5m = ranges5m.reduce((a, b) => a + b, 0) / ranges5m.length;

        const atr15m = calculateATR(c15m, 14);
        const atrPct = (atr15m / c.price) * 100;

        const close5m = c5m.map(k => k.close);
        const ema9_5m = calculateEMA(close5m, 9);
        const ema21_5m = calculateEMA(close5m, 21);
        const rsi5m = calculateRSI(close5m, 14);

        const close15m = c15m.map(k => k.close);
        const ema9_15m = calculateEMA(close15m, 9);
        const ema21_15m = calculateEMA(close15m, 21);
        const rsi15m = calculateRSI(close15m, 14);

        // Arah momentum scalping saat ini
        let scalpDirection: 'LONG' | 'SHORT' = 'LONG';
        let setupType = 'MOMENTUM_CONTINUATION';
        if (c.price > ema9_5m && ema9_5m > ema21_5m) {
          scalpDirection = 'LONG';
          setupType = 'LONG_PULLBACK_EMA9';
        } else if (c.price < ema9_5m && ema9_5m < ema21_5m) {
          scalpDirection = 'SHORT';
          setupType = 'SHORT_REJECTION_EMA9';
        } else {
          scalpDirection = rsi5m > 50 ? 'LONG' : 'SHORT';
          setupType = 'MEAN_REVERSION';
        }

        // Hitung "TP Dekat" (hanya 1.0x - 1.5x ATR 5m, setara 1-2 lilin scalping)
        const scalpMovePct = Number((avg5m * 1.2).toFixed(2)); // Target pergerakan harga %
        const levUsed = Math.min(c.maxLeverage, 25); // Baseline lev 25x
        const estimatedROE_25x = (scalpMovePct * 25).toFixed(0);
        const estimatedROE_MaxLev = (scalpMovePct * c.maxLeverage).toFixed(0);

        let tpPrice: number;
        let slPrice: number;
        if (scalpDirection === 'LONG') {
          tpPrice = c.price * (1 + (scalpMovePct / 100));
          slPrice = c.price * (1 - ((scalpMovePct * 0.7) / 100));
        } else {
          tpPrice = c.price * (1 - (scalpMovePct / 100));
          slPrice = c.price * (1 + ((scalpMovePct * 0.7) / 100));
        }

        results.push({
          symbol: c.symbol,
          price: c.price,
          maxLeverage: c.maxLeverage,
          scalpDirection,
          setupType,
          avg1mSwing: Number(avg1m.toFixed(2)),
          avg5mSwing: Number(avg5m.toFixed(2)),
          atrPct: Number(atrPct.toFixed(2)),
          scalpMovePct: `${scalpMovePct}%`,
          estimatedROE_25x: `+${estimatedROE_25x}%`,
          estimatedROE_MaxLev: `+${estimatedROE_MaxLev}% (${c.maxLeverage}x)`,
          entryNow: c.price,
          tpDekat: Number(tpPrice.toFixed(tpPrice < 1 ? 5 : 3)),
          slKetat: Number(slPrice.toFixed(slPrice < 1 ? 5 : 3)),
          spreadBps: c.spreadBps,
          volume24h: `$${(c.volumeUsd / 1e6).toFixed(1)}M`
        });
      } catch (e) {}
    }));
  }

  // Prioritaskan yang pergerakan 5m-nya paling besar & potensi ROE tertinggi
  results.sort((a, b) => parseFloat(b.estimatedROE_25x) - parseFloat(a.estimatedROE_25x));

  console.log('\n--- SCALP_HIGH_ROE_OUTPUT ---');
  console.log(JSON.stringify(results.slice(0, 6), null, 2));
}

scanQuickScalpCoins().catch(console.error);
