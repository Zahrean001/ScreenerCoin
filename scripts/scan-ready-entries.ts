import axios from 'axios';
import { CONFIG } from '../src/config.js';
import { BybitRest } from '../src/data/bybit-rest.js';
import { IncrementalEMA, IncrementalRSI, IncrementalATR, IncrementalVWAP } from '../src/indicators/incremental.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export interface ActionableTradeSetup {
  rank: number;
  symbol: string;
  category: 'NEW_LISTING' | 'TOP_LIQUID' | 'TRENDING_MOVER';
  launchDate?: string;
  side: 'LONG' | 'SHORT';
  rating: 'A+' | 'A' | 'B+';
  score: number;
  status: 'READY BUY' | 'READY SHORT';
  currentPrice: number;
  entryZone: string;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskReward: string;
  rsi15m: number;
  rsi1h: number;
  change24h: string;
  change1h: string;
  volume24hUsd: string;
  fundingRate: string;
  setupConfluence: string[];
}

function calculateEMA(prices: number[], period: number): number {
  const ema = new IncrementalEMA(period);
  let val: number | null = null;
  for (const p of prices) {
    val = ema.update(p);
  }
  return val ?? prices[prices.length - 1];
}

function calculateRSI(prices: number[], period: number = 14): number {
  const rsi = new IncrementalRSI(period);
  let val: number | null = null;
  for (const p of prices) {
    val = rsi.update(p);
  }
  return val ?? 50;
}

function calculateATR(candles: { high: number; low: number; close: number }[], period: number = 14): number {
  const atr = new IncrementalATR(period);
  let val: number | null = null;
  for (const c of candles) {
    val = atr.update(c.high, c.low, c.close);
  }
  return val ?? (candles[candles.length - 1].close * 0.015);
}

function calculateVWAP(candles: { close: number; volume: number }[]): number {
  const vwap = new IncrementalVWAP();
  let val: number | null = null;
  for (const c of candles) {
    val = vwap.update(c.close, c.volume);
  }
  return val ?? candles[candles.length - 1].close;
}

async function runLiveScanner() {
  const rest = new BybitRest();

  console.log('🔄 Mengambil data pasar live Bybit Linear USDT Perpetual...');
  const instruments = await rest.getInstruments();
  const validInstrumentsMap = new Map(instruments.map(i => [i.symbol, i]));

  const tickersMap = await rest.getTickers();
  console.log(`✅ Loaded ${instruments.length} instruments dan ${tickersMap.size} tickers.`);

  // 1. Newest Listed Instruments (Sort by launchTime desc)
  const newestCandidates: any[] = [];
  // 2. High Volume / Momentum Candidates
  const liquidCandidates: any[] = [];

  for (const [sym, ticker] of tickersMap.entries()) {
    const inst = validInstrumentsMap.get(sym);
    if (!inst) continue;
    if (ticker.lastPrice <= 0) continue;
    if (ticker.turnover24h < 1_500_000) continue; // Minimum $1.5M volume for new coins

    const spreadBps = ticker.bid1Price > 0 ? ((ticker.ask1Price - ticker.bid1Price) / ticker.bid1Price) * 10000 : 999;
    if (spreadBps > 20) continue;

    const launchTime = inst.launchTime || 0;
    const launchDate = launchTime > 0 ? new Date(launchTime).toISOString().split('T')[0] : 'Unknown';

    const candObj = {
      symbol: sym,
      ticker,
      volume: ticker.turnover24h,
      priceChange24h: ticker.price24hPcnt,
      fundingRate: ticker.fundingRate,
      launchTime,
      launchDate
    };

    // If launched recently (or top by launchTime)
    newestCandidates.push(candObj);

    if (ticker.turnover24h >= 8_000_000 && ticker.openInterestValue >= 1_500_000 && spreadBps <= 15) {
      liquidCandidates.push(candObj);
    }
  }

  // Sort newest by launchTime desc
  newestCandidates.sort((a, b) => b.launchTime - a.launchTime);
  const topNewest = newestCandidates.slice(0, 30);

  // Sort liquid by turnover desc
  liquidCandidates.sort((a, b) => b.volume - a.volume);
  const topLiquid = liquidCandidates.slice(0, 35);

  // Combine unique targets
  const targetMap = new Map<string, any>();
  for (const item of topNewest) {
    targetMap.set(item.symbol, { ...item, category: 'NEW_LISTING' });
  }
  for (const item of topLiquid) {
    if (!targetMap.has(item.symbol)) {
      targetMap.set(item.symbol, { ...item, category: 'TOP_LIQUID' });
    }
  }

  const combinedTargets = Array.from(targetMap.values());
  console.log(`🔎 Menganalisis ${combinedTargets.length} koin (termasuk ${topNewest.length} koin listing terbaru & ${topLiquid.length} top liquid)...`);

  // BTC Regime
  const btcCandles15m = await rest.getKlines('BTCUSDT', '15', 50);
  const btcClose15m = btcCandles15m.map(c => c.close);
  const btcEma9 = calculateEMA(btcClose15m, 9);
  const btcEma21 = calculateEMA(btcClose15m, 21);
  const btcEma50 = calculateEMA(btcClose15m, 50);
  const btcPrice = btcClose15m[btcClose15m.length - 1];
  const btcRegime = (btcEma9 > btcEma21 && btcEma21 > btcEma50) ? 'STRONG_BULL' :
                    (btcEma9 > btcEma21) ? 'BULL' :
                    (btcEma9 < btcEma21 && btcEma21 < btcEma50) ? 'STRONG_BEAR' :
                    (btcEma9 < btcEma21) ? 'BEAR' : 'NEUTRAL';

  console.log(`📊 Macro Context: BTC \$${btcPrice.toFixed(2)} | Regime: ${btcRegime}`);

  const results: ActionableTradeSetup[] = [];

  const BATCH_SIZE = 6;
  for (let i = 0; i < combinedTargets.length; i += BATCH_SIZE) {
    const batch = combinedTargets.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (item) => {
      try {
        const sym = item.symbol;
        const [c5m, c15m, c1h] = await Promise.all([
          rest.getKlines(sym, '5', 60),
          rest.getKlines(sym, '15', 60),
          rest.getKlines(sym, '60', 60)
        ]);

        if (c15m.length < 25 || c1h.length < 25) return;

        const close15m = c15m.map(c => c.close);
        const high15m = c15m.map(c => c.high);
        const low15m = c15m.map(c => c.low);
        const vol15m = c15m.map(c => c.volume);
        const close1h = c1h.map(c => c.close);

        const ema9_15 = calculateEMA(close15m, 9);
        const ema21_15 = calculateEMA(close15m, 21);
        const ema50_15 = calculateEMA(close15m, 50);

        const ema9_1h = calculateEMA(close1h, 9);
        const ema21_1h = calculateEMA(close1h, 21);
        const ema50_1h = calculateEMA(close1h, 50);

        const rsi15 = calculateRSI(close15m, 14);
        const rsi1h = calculateRSI(close1h, 14);
        const atr15 = calculateATR(c15m, 14);
        const vwap15 = calculateVWAP(c15m);

        const lastPrice = item.ticker.lastPrice;
        const lastCandle15 = c15m[c15m.length - 1];
        const prevCandle15 = c15m[c15m.length - 2];

        const avgVol20 = vol15m.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        const volRatio = avgVol20 > 0 ? lastCandle15.volume / avgVol20 : 1.0;

        const swingHigh20 = Math.max(...high15m.slice(-21, -1));
        const swingLow20 = Math.min(...low15m.slice(-21, -1));

        let longScore = 0;
        let shortScore = 0;
        const longConfluence: string[] = [];
        const shortConfluence: string[] = [];

        // LONG CHECKS
        if (ema9_1h > ema21_1h && ema21_1h > ema50_1h) {
          longScore += 25;
          longConfluence.push('1H Trend Bullish Aligned (EMA 9>21>50)');
        } else if (ema9_1h > ema21_1h) {
          longScore += 15;
          longConfluence.push('1H Bullish EMA Cross');
        }

        if (ema9_15 > ema21_15 && lastPrice >= ema21_15) {
          longScore += 20;
          longConfluence.push('15m Price Mantul di Support EMA 21');
        }

        if (rsi15 >= 50 && rsi15 <= 68) {
          longScore += 15;
          longConfluence.push(`15m Momentum Sehat (RSI ${rsi15.toFixed(1)})`);
        } else if (rsi15 < 32) {
          longScore += 15;
          longConfluence.push(`15m Oversold Bounce Area (RSI ${rsi15.toFixed(1)})`);
        }

        if (lastPrice > vwap15) {
          longScore += 10;
          longConfluence.push('Di atas VWAP 15m (Bullish Buyer Pressure)');
        }

        if (volRatio >= 1.3 && lastPrice > prevCandle15.close) {
          longScore += 15;
          longConfluence.push(`Volume Spike (${volRatio.toFixed(1)}x avg)`);
        }

        if (lastPrice >= swingHigh20 * 0.998) {
          longScore += 15;
          longConfluence.push('Breakout / Testing Resistance 20-period');
        }

        // SHORT CHECKS
        if (ema9_1h < ema21_1h && ema21_1h < ema50_1h) {
          shortScore += 25;
          shortConfluence.push('1H Trend Bearish Aligned (EMA 9<21<50)');
        } else if (ema9_1h < ema21_1h) {
          shortScore += 15;
          shortConfluence.push('1H Bearish EMA Cross');
        }

        if (ema9_15 < ema21_15 && lastPrice <= ema21_15) {
          shortScore += 20;
          shortConfluence.push('15m Price Tertahan di Resistance EMA 21');
        }

        if (rsi15 <= 50 && rsi15 >= 32) {
          shortScore += 15;
          shortConfluence.push(`15m Momentum Bearish Sehat (RSI ${rsi15.toFixed(1)})`);
        } else if (rsi15 > 70) {
          shortScore += 15;
          shortConfluence.push(`15m Overbought Reversal Area (RSI ${rsi15.toFixed(1)})`);
        }

        if (lastPrice < vwap15) {
          shortScore += 10;
          shortConfluence.push('Di bawah VWAP 15m (Seller Dominance)');
        }

        if (volRatio >= 1.3 && lastPrice < prevCandle15.close) {
          shortScore += 15;
          shortConfluence.push(`Sell Volume Spike (${volRatio.toFixed(1)}x avg)`);
        }

        if (lastPrice <= swingLow20 * 1.002) {
          shortScore += 15;
          shortConfluence.push('Breakdown / Testing Support 20-period');
        }

        // Apply Market Regime Modifier
        if (btcRegime.includes('BEAR')) {
          shortScore *= 1.1;
          longScore *= 0.9;
        } else if (btcRegime.includes('BULL')) {
          longScore *= 1.1;
          shortScore *= 0.9;
        }

        // Strict non-WAIT filter
        const diff = Math.abs(longScore - shortScore);
        if (diff < 15) return; // Inconclusive / WAIT -> reject

        const isLong = longScore > shortScore;
        const finalScore = isLong ? longScore : shortScore;
        const confluence = isLong ? longConfluence : shortConfluence;

        if (finalScore < 50) return;

        let rating: 'A+' | 'A' | 'B+' = 'B+';
        if (finalScore >= 80) rating = 'A+' ;
        else if (finalScore >= 65) rating = 'A';

        const atr = atr15 > 0 ? atr15 : lastPrice * 0.015;
        let entryLow: number;
        let entryHigh: number;
        let stopLoss: number;
        let tp1: number;
        let tp2: number;

        if (isLong) {
          entryLow = lastPrice * 0.997;
          entryHigh = lastPrice * 1.003;
          stopLoss = lastPrice - (1.5 * atr);
          tp1 = lastPrice + (2.0 * atr);
          tp2 = lastPrice + (3.5 * atr);
        } else {
          entryLow = lastPrice * 0.997;
          entryHigh = lastPrice * 1.003;
          stopLoss = lastPrice + (1.5 * atr);
          tp1 = lastPrice - (2.0 * atr);
          tp2 = lastPrice - (3.5 * atr);
        }

        const risk = Math.abs(lastPrice - stopLoss);
        const reward = Math.abs(tp1 - lastPrice);
        const rrr = risk > 0 ? (reward / risk).toFixed(2) : '1.33';

        const price1hAgo = close1h[close1h.length - 2] || lastPrice;
        const p1h = (lastPrice - price1hAgo) / price1hAgo;

        results.push({
          rank: 0,
          symbol: sym,
          category: item.category,
          launchDate: item.launchDate,
          side: isLong ? 'LONG' : 'SHORT',
          rating,
          score: Math.round(finalScore * 10) / 10,
          status: isLong ? 'READY BUY' : 'READY SHORT',
          currentPrice: lastPrice,
          entryZone: `\$${entryLow.toFixed(entryLow < 1 ? 4 : 2)} - \$${entryHigh.toFixed(entryHigh < 1 ? 4 : 2)}`,
          stopLoss: Number(stopLoss.toFixed(stopLoss < 1 ? 4 : 2)),
          takeProfit1: Number(tp1.toFixed(tp1 < 1 ? 4 : 2)),
          takeProfit2: Number(tp2.toFixed(tp2 < 1 ? 4 : 2)),
          riskReward: `1:${rrr}`,
          rsi15m: Math.round(rsi15 * 10) / 10,
          rsi1h: Math.round(rsi1h * 10) / 10,
          change24h: `${(item.priceChange24h * 100).toFixed(2)}%`,
          change1h: `${(p1h * 100).toFixed(2)}%`,
          volume24hUsd: `\$${(item.volume / 1e6).toFixed(1)}M`,
          fundingRate: `${(item.fundingRate * 100).toFixed(4)}%`,
          setupConfluence: confluence
        });
      } catch (err) {
        // Continue loop
      }
    }));
  }

  // Sort: Rating A+ first, then score desc, then volume desc
  results.sort((a, b) => b.score - a.score || parseFloat(b.volume24hUsd.replace(/[^0-9.]/g, '')) - parseFloat(a.volume24hUsd.replace(/[^0-9.]/g, '')));
  results.forEach((r, idx) => { r.rank = idx + 1; });

  const finalOutput = {
    timestamp: new Date().toISOString(),
    macro: {
      btcPrice: btcPrice,
      regime: btcRegime
    },
    totalCandidatesAnalyzed: combinedTargets.length,
    actionableSetupsCount: results.length,
    newListingSetups: results.filter(r => r.category === 'NEW_LISTING').slice(0, 5),
    topMarketSetups: results.slice(0, 8)
  };

  console.log('\n--- SCAN_RESULT_START ---');
  console.log(JSON.stringify(finalOutput, null, 2));
  console.log('--- SCAN_RESULT_END ---');
}

runLiveScanner().catch(console.error);
