// ============================================================
// Market Regime Engine — BTC Macro Context & Volatility Anchor
// ============================================================

import { CONFIG } from '../config.js';
import { 
  MarketRegime, 
  MarketRegimeState, 
  IndicatorState, 
  TickerData, 
  CandleData,
  TrendState, 
  VolatilityRegime 
} from '../data/types.js';
import { CircularBuffer } from '../data/circular-buffer.js';
import { pctChange, stdDev } from '../utils/math.js';

export class MarketRegimeEngine {
  analyze(
    btcIndicators: IndicatorState,
    btcTicker: TickerData,
    btcCandles15m: CircularBuffer<CandleData>
  ): MarketRegimeState {
    const price = btcTicker.lastPrice;

    // 1. EMA Alignment (30%)
    const ema9 = btcIndicators.ema9['60'];
    const ema21 = btcIndicators.ema21['60'];
    const ema50 = btcIndicators.ema50['60'];

    let emaScore = 50; // Neutral
    let btcTrend = TrendState.NEUTRAL;
    if (ema9 !== null && ema21 !== null && ema50 !== null) {
      if (ema9 > ema21 && ema21 > ema50) {
        emaScore = 100;
        btcTrend = TrendState.STRONG_BULLISH;
      } else if (ema9 > ema21) {
        emaScore = 75;
        btcTrend = TrendState.BULLISH;
      } else if (ema9 < ema21 && ema21 < ema50) {
        emaScore = 0;
        btcTrend = TrendState.STRONG_BEARISH;
      } else if (ema9 < ema21) {
        emaScore = 25;
        btcTrend = TrendState.BEARISH;
      }
    }

    // 2. RSI (20%)
    const rsi = btcIndicators.rsi14['60'] ?? 50;
    let rsiScore = 50;
    if (rsi > 60) rsiScore = 100;
    else if (rsi < 40) rsiScore = 0;
    else if (rsi > 50) rsiScore = 70;
    else if (rsi < 50) rsiScore = 30;

    // 3. VWAP (25%)
    const vwap = btcIndicators.vwap['60'];
    let vwapScore = 50;
    let vwapPosition = 0;
    if (vwap !== null && vwap > 0 && price > 0) {
      vwapPosition = pctChange(price, vwap) * 100;
      if (price > vwap) vwapScore = 100;
      else vwapScore = 0;
    }

    // 4. Momentum (25%)
    const roc = btcIndicators.roc14['60'] ?? 0;
    let momentumScore = 50;
    if (roc > 0.005) momentumScore = 100;
    else if (roc > 0) momentumScore = 70;
    else if (roc < -0.005) momentumScore = 0;
    else if (roc < 0) momentumScore = 30;

    // Combine score
    const totalScore = (emaScore * 0.30) + (rsiScore * 0.20) + (vwapScore * 0.25) + (momentumScore * 0.25);

    // Determine Regime
    let regime: MarketRegime;
    if (totalScore > 70) regime = MarketRegime.STRONG_BULL;
    else if (totalScore > 55) regime = MarketRegime.BULL;
    else if (totalScore >= 45) regime = MarketRegime.NEUTRAL;
    else if (totalScore >= 30) regime = MarketRegime.BEAR;
    else regime = MarketRegime.STRONG_BEAR;

    // 5. Real Realized Volatility Calculation from BTC 15m candles
    let btcRealizedVol = 0;
    let btcVolatility = VolatilityRegime.NORMAL;

    const recentCandles = btcCandles15m.lastN(20);
    if (recentCandles.length >= 5) {
      const logReturns: number[] = [];
      for (let i = 1; i < recentCandles.length; i++) {
        const prev = recentCandles[i - 1].close;
        const curr = recentCandles[i].close;
        if (prev > 0 && curr > 0) {
          logReturns.push(Math.log(curr / prev));
        }
      }

      if (logReturns.length >= 4) {
        btcRealizedVol = stdDev(logReturns);

        // BTC 15m return standard deviation classification
        if (btcRealizedVol >= 0.015) { // 1.5% std dev per 15m
          btcVolatility = VolatilityRegime.EXTREME;
        } else if (btcRealizedVol >= 0.008) {
          btcVolatility = VolatilityRegime.HIGH;
        } else if (btcRealizedVol >= 0.004) {
          btcVolatility = VolatilityRegime.ELEVATED;
        } else if (btcRealizedVol >= 0.0015) {
          btcVolatility = VolatilityRegime.NORMAL;
        } else {
          btcVolatility = VolatilityRegime.LOW;
        }
      }
    }

    const modifiers = CONFIG.REGIME_MODIFIERS[regime];

    return {
      regime,
      btcTrend,
      btcMomentum: (momentumScore - 50) * 2,
      btcVolatility,
      btcRealizedVol,
      btcVwapPosition: vwapPosition,
      longModifier: modifiers.long,
      shortModifier: modifiers.short,
      timestamp: Date.now()
    };
  }
}
