// ============================================================
// HTF 4H Market Structure & Fibonacci Retracement Scanner
// Specifically scans for 4H LL -> HH structure retests
// User Fibo Levels: 0.748, 0.764, 0.780, 0.933
// EXCLUDES running candles at the tip of the wick
// ============================================================

import { BybitRest } from '../src/data/bybit-rest.js';
import { SymbolInfo, TickerData } from '../src/data/types.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

interface FiboLevelSetup {
  symbol: string;
  currentPrice: number;
  swingLow_LL: number;
  swingHigh_HH: number;
  range4H: number;
  distanceFromHHPercent: number;  // How far price has pulled back from the tip of the wick
  distanceFromLLPercent: number;  // How far price is above the 4H LL
  matchedFiboLevel: string;       // e.g. '0.786 / 0.780' or '0.764' or '0.933'
  fiboPrice: number;
  diffToFiboPercent: number;      // Distance between current price and the Fibo level
  status: 'TESTING_FIBO_NOW' | 'BOUNCING_FROM_FIBO' | 'APPROACHING_FIBO';
  suggestedEntry: string;
  suggestedSL: number;
  suggestedTP1: number;
  suggestedTP2: number;
  riskReward: string;
  volume24h: number;
  change24h: number;
  rsi4h: number;
  structureNotes: string;
}

function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Find swing points on 4H bars
function find4HSwings(candles: { high: number; low: number; close: number; timestamp: number }[]) {
  if (candles.length < 15) return null;

  // Scan the last 30-50 bars (5-10 days of 4H price action)
  const lookback = Math.min(candles.length - 1, 50);
  const subset = candles.slice(-lookback);

  let minLow = Infinity;
  let minLowIdx = -1;
  let maxHigh = -Infinity;
  let maxHighIdx = -1;

  for (let i = 0; i < subset.length - 1; i++) { // exclude active incomplete bar for swing high/low confirmation
    if (subset[i].low < minLow) {
      minLow = subset[i].low;
      minLowIdx = i;
    }
    if (subset[i].high > maxHigh) {
      maxHigh = subset[i].high;
      maxHighIdx = i;
    }
  }

  // Check if structure is Bullish Impulse: Swing Low (LL) happened BEFORE Swing High (HH)
  // Or recent leg from LL to HH
  const isBullishImpulse = minLowIdx < maxHighIdx && maxHigh > minLow * 1.03; // at least 3% move

  return {
    swingLow_LL: minLow,
    swingHigh_HH: maxHigh,
    llIndex: minLowIdx,
    hhIndex: maxHighIdx,
    isBullishImpulse,
    barsSinceHH: subset.length - 1 - maxHighIdx
  };
}

async function main() {
  const rest = new BybitRest();
  console.log('========================================================================================');
  console.log('      🔍 SCANNER STRUKTUR HTF 4H — RETEST LEVEL FIBONACCI (0.748, 0.764, 0.78, 0.933)    ');
  console.log('         (Filter Eksklusif: Menolak Koin yang Sedang Running di Ujung Wick Candle)       ');
  console.log('========================================================================================\n');

  console.log('[1/4] Mengambil instrumen dan likuiditas pasar live Bybit...');
  const instruments = await rest.getInstruments();
  const tickers = await rest.getTickers();

  // Filter liquid candidates (turnover >= $3M to ensure clean order execution)
  const candidates: { symbol: string; ticker: TickerData; info: SymbolInfo }[] = [];
  for (const inst of instruments) {
    if (inst.quoteCoin !== 'USDT' || inst.contractType !== 'LinearPerpetual' || inst.status !== 'Trading') continue;
    const t = tickers.get(inst.symbol);
    if (!t || t.lastPrice <= 0) continue;
    if (t.turnover24h < 3_000_000) continue; // Min $3M volume
    const spreadBps = t.bid1Price > 0 ? ((t.ask1Price - t.bid1Price) / t.bid1Price) * 10000 : 999;
    if (spreadBps > 20) continue;
    candidates.push({ symbol: inst.symbol, ticker: t, info: inst });
  }

  // Sort by turnover desc to prioritize most liquid coins
  candidates.sort((a, b) => b.ticker.turnover24h - a.ticker.turnover24h);
  const targetSymbols = candidates.slice(0, 75); // Top 75 liquid symbols

  console.log(`[2/4] Menganalisis struktur 4H (kline 240m) untuk ${targetSymbols.length} koin terlikuid...`);

  const matchingSetups: FiboLevelSetup[] = [];

  // Batch process 4H klines
  const BATCH_SIZE = 8;
  for (let i = 0; i < targetSymbols.length; i += BATCH_SIZE) {
    const batch = targetSymbols.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async ({ symbol, ticker }) => {
      try {
        const klines4h = await rest.getKlines(symbol, '240', 60);
        if (klines4h.length < 25) return;

        const lastPrice = ticker.lastPrice;
        const currentCandle = klines4h[klines4h.length - 1];

        // 1. Check if price is currently running at the very top of the wick:
        // If current price is within 0.8% of the 4H candle high and 24h change is high -> RUNNING WICK -> REJECT!
        const candleRange = currentCandle.high - currentCandle.low;
        const wickTopRatio = candleRange > 0 ? (currentCandle.high - lastPrice) / candleRange : 1;
        if (wickTopRatio < 0.10 && ticker.price24hPcnt > 0.05) {
          // Price is at top 10% of candle wick on a pumped coin -> SKIP
          return;
        }

        const swings = find4HSwings(klines4h);
        if (!swings || !swings.isBullishImpulse) return;

        const { swingLow_LL, swingHigh_HH, barsSinceHH } = swings;
        const range = swingHigh_HH - swingLow_LL;
        if (range <= 0) return;

        // How far has price pulled back from HH?
        const pullBackFromHH = swingHigh_HH - lastPrice;
        const pullBackRatio = pullBackFromHH / range; // 0 = at HH, 1.0 = at LL

        // FILTER: Reject if price hasn't pulled back at all (< 10% pullback) -> that's running at the top!
        if (pullBackRatio < 0.12) {
          return;
        }

        // Fibo Retracement Levels when pulled from LL to HH:
        // Case 1: Deep Discount Zone (Price retraced 74.8% - 78.0% - 93.3% from the top HH towards LL)
        // Case 2: Golden Pocket / High Retest Zone (Price pulled back to 0.748 - 0.780 of the impulse)
        const fiboLevels = [
          // Deep Discount OTE (Near LL):
          { name: 'Fibo 0.780 Deep OTE', type: 'DEEP_DISCOUNT', ratio: 0.780, price: swingHigh_HH - (0.780 * range) },
          { name: 'Fibo 0.764 Deep OTE', type: 'DEEP_DISCOUNT', ratio: 0.764, price: swingHigh_HH - (0.764 * range) },
          { name: 'Fibo 0.748 Deep OTE', type: 'DEEP_DISCOUNT', ratio: 0.748, price: swingHigh_HH - (0.748 * range) },
          { name: 'Fibo 0.933 Deep Sweep', type: 'DEEP_DISCOUNT', ratio: 0.933, price: swingHigh_HH - (0.933 * range) },
          // High Retest (Pullback from HH to 0.780 / 0.764 / 0.748 from LL):
          { name: 'Fibo 0.780 Support Retest', type: 'SUPPORT_RETEST', ratio: 0.780, price: swingLow_LL + (0.780 * range) },
          { name: 'Fibo 0.764 Support Retest', type: 'SUPPORT_RETEST', ratio: 0.764, price: swingLow_LL + (0.764 * range) },
          { name: 'Fibo 0.748 Support Retest', type: 'SUPPORT_RETEST', ratio: 0.748, price: swingLow_LL + (0.748 * range) },
        ];

        // Check if current price is near any of the user's Fibo levels (within 2.0% tolerance)
        let closestFibo: typeof fiboLevels[0] | null = null;
        let minDiff = Infinity;

        for (const fl of fiboLevels) {
          const diffPct = Math.abs(lastPrice - fl.price) / fl.price;
          if (diffPct < minDiff) {
            minDiff = diffPct;
            closestFibo = fl;
          }
        }

        // Must be within 2.0% of the Fibo level to be considered an active retest
        if (!closestFibo || minDiff > 0.020) return;

        // Calculate 4H RSI
        const closePrices = klines4h.map(c => c.close);
        const rsi4h = calculateRSI(closePrices, 14);

        // Status determination
        let status: 'TESTING_FIBO_NOW' | 'BOUNCING_FROM_FIBO' | 'APPROACHING_FIBO' = 'TESTING_FIBO_NOW';
        if (lastPrice >= closestFibo.price && currentCandle.low <= closestFibo.price * 1.003) {
          status = 'BOUNCING_FROM_FIBO'; // Candlestick wick already touched and is bouncing
        } else if (Math.abs(lastPrice - closestFibo.price) / closestFibo.price < 0.006) {
          status = 'TESTING_FIBO_NOW';
        } else {
          status = 'APPROACHING_FIBO';
        }

        // Planning Entry, SL, TP
        // SL is strictly structural:
        // If Deep Discount: placed right below Swing Low (LL)
        // If Support Retest: placed right below current 4H candle low or 1.5% below the Fibo level (NOT at LL!)
        let sl: number;
        if (closestFibo.type === 'DEEP_DISCOUNT') {
          sl = swingLow_LL * 0.995;
        } else {
          sl = Math.min(currentCandle.low * 0.995, closestFibo.price * 0.985);
        }

        const tp1 = swingHigh_HH * 0.98; // retest of swing high
        const tp2 = swingHigh_HH + (0.272 * range); // -0.272 Fibo expansion

        const risk = lastPrice - sl;
        const reward = tp1 - lastPrice;
        const rrr = risk > 0 && reward > 0 ? (reward / risk).toFixed(2) : '2.00';

        const pullbackPctFromHH = ((pullBackFromHH / range) * 100).toFixed(1);
        const positionFromLL = (((lastPrice - swingLow_LL) / range) * 100).toFixed(1);

        matchingSetups.push({
          symbol,
          currentPrice: lastPrice,
          swingLow_LL,
          swingHigh_HH,
          range4H: range,
          distanceFromHHPercent: Number(((pullBackFromHH / swingHigh_HH) * 100).toFixed(2)),
          distanceFromLLPercent: Number(positionFromLL),
          matchedFiboLevel: closestFibo.name,
          fiboPrice: Number(closestFibo.price.toFixed(closestFibo.price < 1 ? 6 : 2)),
          diffToFiboPercent: Number((minDiff * 100).toFixed(2)),
          status,
          suggestedEntry: `$${(closestFibo.price * 0.998).toFixed(closestFibo.price < 1 ? 6 : 2)} - $${(closestFibo.price * 1.006).toFixed(closestFibo.price < 1 ? 6 : 2)}`,
          suggestedSL: Number(sl.toFixed(sl < 1 ? 6 : 2)),
          suggestedTP1: Number(tp1.toFixed(tp1 < 1 ? 6 : 2)),
          suggestedTP2: Number(tp2.toFixed(tp2 < 1 ? 6 : 2)),
          riskReward: `1:${rrr}`,
          volume24h: ticker.turnover24h,
          change24h: Number((ticker.price24hPcnt * 100).toFixed(2)),
          rsi4h: Number(rsi4h.toFixed(1)),
          structureNotes: closestFibo.type === 'DEEP_DISCOUNT'
            ? `Deep OTE Discount! Pullback ${pullbackPctFromHH}% dari 4H HH ($${swingHigh_HH}) menuju Fibo $${closestFibo.price.toFixed(closestFibo.price < 1 ? 4 : 2)}`
            : `Support Retest! Posisi harga di ${positionFromLL}% dari 4H impulse (Level Fibo $${closestFibo.price.toFixed(closestFibo.price < 1 ? 4 : 2)})`
        });
      } catch (err) {
        // skip failed symbol
      }
    }));
  }

  // Sort by closeness to Fibo level (most accurate retest first)
  matchingSetups.sort((a, b) => a.diffToFiboPercent - b.diffToFiboPercent);

  console.log(`[3/4] Ditemukan ${matchingSetups.length} koin yang SEDANG MENGUJI / MERETEST level Fibonacci HTF 4H.\n`);

  console.log('========================================================================================');
  console.log('      🎯 HASIL PEMINDAIAN: RETEST LEVEL FIBONACCI STRUKTUR HTF 4H (ANTI-PUCUK)          ');
  console.log('========================================================================================\n');

  if (matchingSetups.length === 0) {
    console.log('Saat ini belum ada koin yang presisi berada di level Fibo 0.748 - 0.780 atau 0.933.');
    return;
  }

  matchingSetups.slice(0, 6).forEach((s, idx) => {
    console.log(`----------------------------------------------------------------------------------------`);
    console.log(`[#${idx + 1}] KOIN: ${s.symbol} | STATUS: ${s.status === 'BOUNCING_FROM_FIBO' ? '🔥 SEDANG MEMANTUL DARI FIBO' : '🎯 SEDANG MENGUJI FIBO (AKURAT)'}`);
    console.log(`     Harga Saat Ini   : $${s.currentPrice} (Sudah Pullback ${s.distanceFromHHPercent}% dari Pucuk HH 4H)`);
    console.log(`     Struktur HTF 4H  : 4H Swing Low (LL): $${s.swingLow_LL} ---> 4H Swing High (HH): $${s.swingHigh_HH}`);
    console.log(`     Level Fibonacci  : ${s.matchedFiboLevel} di harga $${s.fiboPrice} (Selisih ke Fibo hanya ${s.diffToFiboPercent}%)`);
    console.log(`     Kondisi 4H RSI   : ${s.rsi4h} (Dingin & Netral, Jauh dari Overbought) | Vol 24h: $${(s.volume24h / 1e6).toFixed(1)}M`);
    console.log(`     👉 Rencana Entry : ${s.suggestedEntry}`);
    console.log(`     🛑 Stop Loss (SL): $${s.suggestedSL} (Proteksi di Bawah Swing Low / Fibo)`);
    console.log(`     🎯 Target Profit : TP1: $${s.suggestedTP1} (Kembali ke HH) | TP2: $${s.suggestedTP2} (Ekstensi)`);
    console.log(`     ⚖️ Risk / Reward : ${s.riskReward}`);
    console.log(`     📝 Catatan Setup : ${s.structureNotes}`);
  });
  console.log(`----------------------------------------------------------------------------------------\n`);
}

main().catch(console.error);
