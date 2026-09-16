import { CONFIG } from '../config.js';
import {
  CandleData,
  TickerData,
  IndicatorState,
  OIFundingAnalysis,
  BreakoutAnalysis
} from '../data/types.js';
import { CircularBuffer } from '../data/circular-buffer.js';

export class BreakoutEngine {
  analyze(
    candles15m: CircularBuffer<CandleData>,
    candles1h: CircularBuffer<CandleData>,
    ticker: TickerData,
    indicators: IndicatorState,
    oiFunding: OIFundingAnalysis
  ): BreakoutAnalysis {
    const lookback = CONFIG.BREAKOUT_LOOKBACK_CANDLES;
    
    let swingHigh = -Infinity;
    let swingLow = Infinity;
    
    // Simplistic swing detection on 15m
    const recentCandles = candles15m.lastN(lookback);
    if (recentCandles.length > 0) {
      // Exclude the current active candle if we want to check against past swings
      const pastCandles = recentCandles.slice(1);
      for (const c of pastCandles) {
        if (c.high > swingHigh) swingHigh = c.high;
        if (c.low < swingLow) swingLow = c.low;
      }
    }

    const price = ticker.lastPrice;
    const volumeConfirmed = (indicators.volumeRatio['15'] ?? 1) > CONFIG.BREAKOUT_VOLUME_CONFIRM;
    const oiConfirmed = oiFunding.oiChangePercent > CONFIG.BREAKOUT_OI_CONFIRM;

    let bullishBreakout = false;
    let bearishBreakdown = false;
    let failedBullishBreakout = false;
    let failedBearishBreakdown = false;
    let breakoutScore = 0;
    let level = 0;
    const reasons: string[] = [];

    if (swingHigh !== -Infinity && price > swingHigh) {
      bullishBreakout = true;
      level = swingHigh;
      if (volumeConfirmed && oiConfirmed) {
        breakoutScore = 20;
        reasons.push('Confirmed Bullish Breakout');
      } else {
        breakoutScore = 10;
        reasons.push('Unconfirmed Bullish Breakout');
      }
    } else if (swingHigh !== -Infinity && price < swingHigh) {
      // Check if previously broke above but now rejected
      const latest = recentCandles[0];
      if (latest && latest.high > swingHigh && price < swingHigh) {
        failedBullishBreakout = true;
        level = swingHigh;
        breakoutScore = -10;
        reasons.push('Failed Bullish Breakout');
      }
    }

    if (swingLow !== Infinity && price < swingLow) {
      bearishBreakdown = true;
      level = swingLow;
      if (volumeConfirmed && oiConfirmed) {
        breakoutScore = 20; // Abs score, meaning strong signal (short)
        reasons.push('Confirmed Bearish Breakdown');
      } else {
        breakoutScore = 10;
        reasons.push('Unconfirmed Bearish Breakdown');
      }
    } else if (swingLow !== Infinity && price > swingLow) {
      const latest = recentCandles[0];
      if (latest && latest.low < swingLow && price > swingLow) {
        failedBearishBreakdown = true;
        level = swingLow;
        breakoutScore = -10;
        reasons.push('Failed Bearish Breakdown');
      }
    }

    return {
      bullishBreakout,
      bearishBreakdown,
      failedBullishBreakout,
      failedBearishBreakdown,
      breakoutScore,
      level,
      volumeConfirmed,
      oiConfirmed,
      reasons
    };
  }
}
