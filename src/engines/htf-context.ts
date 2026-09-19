import { CandleData, HTFContext, TrendState } from '../data/types.js';
import { CircularBuffer } from '../data/circular-buffer.js';

function ema(candles: CandleData[], period: number): number | null {
  if (candles.length < period) return null;
  const alpha = 2 / (period + 1);
  let value = candles.slice(0, period).reduce((sum, candle) => sum + candle.close, 0) / period;
  for (const candle of candles.slice(period)) value = alpha * candle.close + (1 - alpha) * value;
  return value;
}

function trend(candles: CandleData[]): TrendState {
  const closes = candles.map(c => c.close);
  const fast = ema(candles, 20);
  const slow = ema(candles, 50);
  if (fast === null || slow === null || closes.length < 5) return TrendState.NEUTRAL;
  const recent = closes.slice(-5);
  const rising = recent[recent.length - 1] > recent[0];
  if (fast > slow && rising) return TrendState.BULLISH;
  if (fast < slow && !rising) return TrendState.BEARISH;
  return TrendState.NEUTRAL;
}

export class HTFContextEngine {
  analyze(fourHour: CircularBuffer<CandleData> | undefined, daily: CircularBuffer<CandleData> | undefined): HTFContext {
    const c4h = fourHour?.toArray() ?? [];
    const c1d = daily?.toArray() ?? [];
    const fourHourTrend = trend(c4h);
    const dailyTrend = trend(c1d);
    const available = (c4h.length >= 50 ? 1 : 0) + (c1d.length >= 50 ? 1 : 0);
    const warnings: string[] = [];
    if (c4h.length < 50) warnings.push('4H_INSUFFICIENT_HISTORY');
    if (c1d.length < 50) warnings.push('1D_INSUFFICIENT_HISTORY');

    let macroBias: HTFContext['macroBias'] = 'NEUTRAL';
    if (fourHourTrend === TrendState.BULLISH && dailyTrend === TrendState.BULLISH) macroBias = 'LONG';
    else if (fourHourTrend === TrendState.BEARISH && dailyTrend === TrendState.BEARISH) macroBias = 'SHORT';

    let classification: HTFContext['classification'] = 'HTF_NEUTRAL';
    if (macroBias === 'LONG') classification = 'MACRO_ALIGNED';
    else if (macroBias === 'SHORT') classification = 'MACRO_BEARISH_RALLY';
    else if (fourHourTrend === TrendState.BULLISH && dailyTrend === TrendState.BEARISH) classification = 'EARLY_MACRO_ROTATION';
    else if (fourHourTrend === TrendState.BEARISH && dailyTrend === TrendState.BULLISH) classification = 'MACRO_BULLISH_PULLBACK';

    return {
      dailyTrend,
      fourHourTrend,
      macroBias,
      classification,
      confidence: available === 2 ? (macroBias === 'NEUTRAL' ? 55 : 85) : 35,
      dataCompleteness: available / 2,
      warnings
    };
  }
}
