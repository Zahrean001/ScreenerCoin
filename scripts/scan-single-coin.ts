import axios from 'axios';
import { CONFIG } from '../src/config.js';
import { BybitRest } from '../src/data/bybit-rest.js';
import { IncrementalEMA, IncrementalRSI, IncrementalATR, IncrementalVWAP } from '../src/indicators/incremental.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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

async function analyzeCoin(targetSymbol: string) {
  const rest = new BybitRest();
  console.log(`🔎 Memulai pemindaian mendalam menggunakan bot untuk ${targetSymbol}...`);

  // 1. Check instrument info
  const instruments = await rest.getInstruments();
  const inst = instruments.find(i => i.symbol === targetSymbol);
  if (!inst) {
    console.log(`⚠️ Simbol ${targetSymbol} tidak ditemukan di Bybit Linear Perpetual.`);
    // Search similar
    const similar = instruments.filter(i => i.symbol.includes('UAI') || i.symbol.startsWith('U'));
    console.log(`Kandidat serupa:`, similar.map(s => s.symbol).slice(0, 10));
    return;
  }

  // 2. Fetch live tickers
  const tickersMap = await rest.getTickers();
  const ticker = tickersMap.get(targetSymbol);
  const btcTicker = tickersMap.get('BTCUSDT');

  if (!ticker) {
    console.log(`⚠️ Ticker untuk ${targetSymbol} tidak ditemukan.`);
    return;
  }

  // 3. Fetch Multi-Timeframe Klines
  const [c5m, c15m, c1h, c4h] = await Promise.all([
    rest.getKlines(targetSymbol, '5', 100),
    rest.getKlines(targetSymbol, '15', 100),
    rest.getKlines(targetSymbol, '60', 100),
    rest.getKlines(targetSymbol, '240', 100).catch(() => [])
  ]);

  // Orderbook
  let orderbook = null;
  try {
    orderbook = await rest.getOrderbook(targetSymbol, 25);
  } catch (e) {}

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

  const close5m = c5m.map(c => c.close);
  const close15m = c15m.map(c => c.close);
  const high15m = c15m.map(c => c.high);
  const low15m = c15m.map(c => c.low);
  const vol15m = c15m.map(c => c.volume);
  const close1h = c1h.map(c => c.close);

  const ema9_5 = calculateEMA(close5m, 9);
  const ema21_5 = calculateEMA(close5m, 21);

  const ema9_15 = calculateEMA(close15m, 9);
  const ema21_15 = calculateEMA(close15m, 21);
  const ema50_15 = calculateEMA(close15m, 50);

  const ema9_1h = calculateEMA(close1h, 9);
  const ema21_1h = calculateEMA(close1h, 21);
  const ema50_1h = calculateEMA(close1h, 50);

  const rsi5 = calculateRSI(close5m, 14);
  const rsi15 = calculateRSI(close15m, 14);
  const rsi1h = calculateRSI(close1h, 14);
  const atr15 = calculateATR(c15m, 14);
  const vwap15 = calculateVWAP(c15m);

  const lastPrice = ticker.lastPrice;
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

  // LONG SCORING
  if (ema9_1h > ema21_1h && ema21_1h > ema50_1h) {
    longScore += 25;
    longConfluence.push('1H Trend Bullish Aligned (EMA 9>21>50)');
  } else if (ema9_1h > ema21_1h) {
    longScore += 15;
    longConfluence.push('1H Bullish EMA Cross (9>21)');
  }

  if (ema9_15 > ema21_15 && lastPrice >= ema21_15) {
    longScore += 20;
    longConfluence.push('15m Price Mantul di Support EMA 21');
  }

  if (rsi15 >= 50 && rsi15 <= 68) {
    longScore += 15;
    longConfluence.push(`15m Momentum Bullish Sehat (RSI ${rsi15.toFixed(1)})`);
  } else if (rsi15 < 32) {
    longScore += 15;
    longConfluence.push(`15m Oversold Bounce Opportunity (RSI ${rsi15.toFixed(1)})`);
  }

  if (lastPrice > vwap15) {
    longScore += 10;
    longConfluence.push('Price di atas VWAP 15m (Dominasi Buyer)');
  }

  if (volRatio >= 1.3 && lastPrice > prevCandle15.close) {
    longScore += 15;
    longConfluence.push(`Volume Spike (${volRatio.toFixed(1)}x rata-rata)`);
  }

  if (lastPrice >= swingHigh20 * 0.998) {
    longScore += 15;
    longConfluence.push('Breakout / Testing Resistance Swing High 20-period');
  }

  // SHORT SCORING
  if (ema9_1h < ema21_1h && ema21_1h < ema50_1h) {
    shortScore += 25;
    shortConfluence.push('1H Trend Bearish Aligned (EMA 9<21<50)');
  } else if (ema9_1h < ema21_1h) {
    shortScore += 15;
    shortConfluence.push('1H Bearish EMA Cross (9<21)');
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
    shortConfluence.push(`15m Overbought Reversal Opportunity (RSI ${rsi15.toFixed(1)})`);
  }

  if (lastPrice < vwap15) {
    shortScore += 10;
    shortConfluence.push('Price di bawah VWAP 15m (Dominasi Seller)');
  }

  if (volRatio >= 1.3 && lastPrice < prevCandle15.close) {
    shortScore += 15;
    shortConfluence.push(`Sell Volume Spike (${volRatio.toFixed(1)}x rata-rata)`);
  }

  if (lastPrice <= swingLow20 * 1.002) {
    shortScore += 15;
    shortConfluence.push('Breakdown / Testing Support Swing Low 20-period');
  }

  // Orderbook depth analysis
  let bidDepth = 0;
  let askDepth = 0;
  if (orderbook && orderbook.bids.length > 0) {
    bidDepth = orderbook.bids.slice(0, 10).reduce((acc: number, b: any) => acc + (b.price * b.size), 0);
    askDepth = orderbook.asks.slice(0, 10).reduce((acc: number, a: any) => acc + (a.price * a.size), 0);
  }

  // Regime adjustment
  if (btcRegime.includes('BULL')) {
    longScore *= 1.1;
    shortScore *= 0.9;
  } else if (btcRegime.includes('BEAR')) {
    shortScore *= 1.1;
    longScore *= 0.9;
  }

  const isConflict = Math.abs(longScore - shortScore) < 12;
  const isLong = longScore > shortScore;
  const finalScore = Math.max(longScore, shortScore);
  const confluence = isLong ? longConfluence : shortConfluence;

  let rating = 'WATCH';
  if (finalScore >= 80) rating = 'A+';
  else if (finalScore >= 68) rating = 'A';
  else if (finalScore >= 55) rating = 'B+';

  let status = 'WAIT (INCONCLUSIVE)';
  if (!isConflict) {
    if (finalScore >= 65) {
      status = isLong ? 'READY BUY' : 'READY SHORT';
    } else {
      status = isLong ? 'MONITOR PULLBACK (BUY)' : 'MONITOR PULLBACK (SHORT)';
    }
  }

  // ATR-based execution levels
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

  const result = {
    symbol: targetSymbol,
    status,
    side: isConflict ? 'CONFLICT / NEUTRAL' : isLong ? 'LONG' : 'SHORT',
    rating,
    score: Math.round(finalScore * 10) / 10,
    longScore: Math.round(longScore * 10) / 10,
    shortScore: Math.round(shortScore * 10) / 10,
    currentPrice: lastPrice,
    entryZone: `\$${entryLow.toFixed(entryLow < 1 ? (entryLow < 0.01 ? 6 : 4) : 2)} - \$${entryHigh.toFixed(entryHigh < 1 ? (entryHigh < 0.01 ? 6 : 4) : 2)}`,
    stopLoss: Number(stopLoss.toFixed(stopLoss < 1 ? (stopLoss < 0.01 ? 6 : 4) : 2)),
    takeProfit1: Number(tp1.toFixed(tp1 < 1 ? (tp1 < 0.01 ? 6 : 4) : 2)),
    takeProfit2: Number(tp2.toFixed(tp2 < 1 ? (tp2 < 0.01 ? 6 : 4) : 2)),
    riskRewardRatio: `1:${rrr}`,
    marketMetrics: {
      volume24hUsd: `\$${(ticker.turnover24h / 1e6).toFixed(2)}M`,
      openInterestUsd: `\$${(ticker.openInterestValue / 1e6).toFixed(2)}M`,
      fundingRate: `${(ticker.fundingRate * 100).toFixed(4)}%`,
      priceChange24h: `${(ticker.price24hPcnt * 100).toFixed(2)}%`,
      priceChange1h: `${(p1h * 100).toFixed(2)}%`,
      spreadBps: ticker.bid1Price > 0 ? (((ticker.ask1Price - ticker.bid1Price) / ticker.bid1Price) * 10000).toFixed(2) + ' bps' : 'N/A',
      launchDate: inst.launchTime > 0 ? new Date(inst.launchTime).toISOString().split('T')[0] : 'N/A'
    },
    technicalIndicators: {
      rsi5m: Math.round(rsi5 * 10) / 10,
      rsi15m: Math.round(rsi15 * 10) / 10,
      rsi1h: Math.round(rsi1h * 10) / 10,
      ema9_15m: Number(ema9_15.toFixed(ema9_15 < 1 ? 4 : 2)),
      ema21_15m: Number(ema21_15.toFixed(ema21_15 < 1 ? 4 : 2)),
      ema50_15m: Number(ema50_15.toFixed(ema50_15 < 1 ? 4 : 2)),
      ema9_1h: Number(ema9_1h.toFixed(ema9_1h < 1 ? 4 : 2)),
      ema21_1h: Number(ema21_1h.toFixed(ema21_1h < 1 ? 4 : 2)),
      ema50_1h: Number(ema50_1h.toFixed(ema50_1h < 1 ? 4 : 2)),
      vwap15m: Number(vwap15.toFixed(vwap15 < 1 ? 4 : 2)),
      atr15m: Number(atr15.toFixed(atr15 < 1 ? 4 : 2)),
      volRatio15m: Number(volRatio.toFixed(2))
    },
    orderbookDepth: {
      top10BidDepthUsd: `\$${(bidDepth / 1e3).toFixed(1)}K`,
      top10AskDepthUsd: `\$${(askDepth / 1e3).toFixed(1)}K`,
      orderbookBias: bidDepth > askDepth * 1.2 ? 'BUYER HEAVY' : askDepth > bidDepth * 1.2 ? 'SELLER HEAVY' : 'BALANCED'
    },
    macroContext: {
      btcPrice: btcPrice,
      regime: btcRegime
    },
    setupConfluence: confluence
  };

  console.log('\n--- SINGLE_COIN_SCAN_START ---');
  console.log(JSON.stringify(result, null, 2));
  console.log('--- SINGLE_COIN_SCAN_END ---');
}

const target = process.argv[2] || 'UAIUSDT';
analyzeCoin(target).catch(console.error);
