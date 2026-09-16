import { VolatilityState, VolatilityRegime, IndicatorState, CandleData, LiquidityTier } from '../data/types.js';
import { CircularBuffer, NumericRingBuffer } from '../data/circular-buffer.js';
import { CONFIG } from '../config.js';
import { stdDev } from '../utils/math.js';

export class VolatilityEngine {
  computeVolatility(
    symbol: string,
    indicators: IndicatorState,
    candles5m: CircularBuffer<CandleData>,
    candles15m: CircularBuffer<CandleData>,
    candles1h: CircularBuffer<CandleData>,
    volatilityHistory: NumericRingBuffer
  ): VolatilityState {
    const atrPercent5m = indicators.atrPercent['5'] ?? 0;
    const atrPercent15m = indicators.atrPercent['15'] ?? 0;
    const atrPercent1h = indicators.atrPercent['60'] ?? 0;

    let realizedVol = 0;
    const recent15m = candles15m.lastN(20);
    if (recent15m.length > 1) {
      const logReturns = [];
      for (let i = 1; i < recent15m.length; i++) {
        const prev = recent15m[i - 1].close;
        const curr = recent15m[i].close;
        if (prev > 0) {
          logReturns.push(Math.log(curr / prev));
        }
      }
      if (logReturns.length > 0) {
        realizedVol = stdDev(logReturns);
      }
    }

    let rangeExpansion = 1.0;
    const recent5m = candles5m.lastN(21);
    if (recent5m.length >= 2) {
      const currentCandle = recent5m[0];
      const currentRange = currentCandle.high - currentCandle.low;
      let sumRange = 0;
      for (let i = 1; i < recent5m.length; i++) {
        sumRange += recent5m[i].high - recent5m[i].low;
      }
      const avgRange = sumRange / (recent5m.length - 1);
      if (avgRange > 0) {
        rangeExpansion = currentRange / avgRange;
      }
    }

    if (atrPercent5m > 0) {
      volatilityHistory.push(atrPercent5m);
    }
    
    let percentile = 50;
    if (volatilityHistory.size > 10 && atrPercent5m > 0) {
      const arr = volatilityHistory.toArray().sort((a, b) => a - b);
      let count = 0;
      for (const val of arr) {
        if (val <= atrPercent5m) count++;
      }
      percentile = (count / arr.length) * 100;
    }

    let regime = VolatilityRegime.NORMAL;
    if (percentile >= CONFIG.VOLATILITY_EXTREME) regime = VolatilityRegime.EXTREME;
    else if (percentile >= CONFIG.VOLATILITY_HIGH) regime = VolatilityRegime.HIGH;
    else if (percentile >= CONFIG.VOLATILITY_ELEVATED) regime = VolatilityRegime.ELEVATED;
    else if (percentile <= CONFIG.VOLATILITY_LOW) regime = VolatilityRegime.LOW;

    return {
      atrPercent5m,
      atrPercent15m,
      atrPercent1h,
      realizedVol,
      rangeExpansion,
      volatilityPercentile: percentile,
      regime
    };
  }
}

export function getVolatilityBonus(state: VolatilityState, liquidityTier: LiquidityTier): number {
  if (state.regime === VolatilityRegime.EXTREME) {
    if (liquidityTier === 'C' || liquidityTier === 'D') return -5;
    return -2;
  }
  if (state.regime === VolatilityRegime.HIGH) {
    if (liquidityTier === 'A' || liquidityTier === 'B') return 5;
    return 3;
  }
  if (state.regime === VolatilityRegime.ELEVATED) {
    return 2;
  }
  if (state.regime === VolatilityRegime.LOW) {
    return -2;
  }
  return 0;
}
