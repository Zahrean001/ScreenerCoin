// ============================================================
// Multi-Timeframe Confluence Engine (5m / 15m / 1h Alignment)
// ============================================================

import { 
  Timeframe, 
  MarketStructure, 
  TrendState, 
  IndicatorState, 
  TickerData, 
  MTFConfluenceType 
} from '../data/types.js';

export interface MTFConfluenceResult {
  type: MTFConfluenceType;
  alignmentScore: number; // 0 - 100
  bias: 'LONG' | 'SHORT' | 'NEUTRAL';
  tf5mBullish: boolean;
  tf15mBullish: boolean;
  tf1hBullish: boolean;
  description: string;
}

export class MTFConfluenceEngine {
  analyze(
    indicators: IndicatorState,
    structure: Record<Timeframe, MarketStructure>,
    ticker: TickerData,
    distanceFromTriggerATR: number = 0
  ): MTFConfluenceResult {
    // 1. 5M Structure & Momentum
    const ema9_5 = indicators.ema9['5'];
    const ema21_5 = indicators.ema21['5'];
    const struct5 = structure['5']?.trend;
    const tf5mBullish = (ema9_5 !== null && ema21_5 !== null && ema9_5 > ema21_5) ||
                        struct5 === TrendState.BULLISH || struct5 === TrendState.STRONG_BULLISH;
    const tf5mBearish = (ema9_5 !== null && ema21_5 !== null && ema9_5 < ema21_5) ||
                        struct5 === TrendState.BEARISH || struct5 === TrendState.STRONG_BEARISH;

    // 2. 15M Structure & Momentum
    const ema9_15 = indicators.ema9['15'];
    const ema21_15 = indicators.ema21['15'];
    const struct15 = structure['15']?.trend;
    const tf15mBullish = (ema9_15 !== null && ema21_15 !== null && ema9_15 > ema21_15) ||
                         struct15 === TrendState.BULLISH || struct15 === TrendState.STRONG_BULLISH;
    const tf15mBearish = (ema9_15 !== null && ema21_15 !== null && ema9_15 < ema21_15) ||
                         struct15 === TrendState.BEARISH || struct15 === TrendState.STRONG_BEARISH;

    // 3. 1H Macro Structure
    const ema9_60 = indicators.ema9['60'];
    const ema21_60 = indicators.ema21['60'];
    const struct60 = structure['60']?.trend;
    const tf1hBullish = (ema9_60 !== null && ema21_60 !== null && ema9_60 > ema21_60) ||
                        struct60 === TrendState.BULLISH || struct60 === TrendState.STRONG_BULLISH;
    const tf1hBearish = (ema9_60 !== null && ema21_60 !== null && ema9_60 < ema21_60) ||
                        struct60 === TrendState.BEARISH || struct60 === TrendState.STRONG_BEARISH;

    let type: MTFConfluenceType = 'CHOPPY_ALIGNMENT';
    let alignmentScore = 50;
    let bias: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
    let description = 'Mixed timeframe alignment across 5m/15m/1h';

    // A. Full Alignment
    if (tf5mBullish && tf15mBullish && tf1hBullish) {
      bias = 'LONG';
      if (distanceFromTriggerATR > 2.2) {
        type = 'LATE_EXPANSION';
        alignmentScore = 65;
        description = 'Full Bullish Alignment, but move is late/extended (>2x ATR)';
      } else {
        type = 'MULTI_TIMEFRAME_ALIGNMENT';
        alignmentScore = 95;
        description = 'Strong 3-Timeframe Confluence (5m+15m+1h Bullish Alignment)';
      }
    } else if (tf5mBearish && tf15mBearish && tf1hBearish) {
      bias = 'SHORT';
      if (distanceFromTriggerATR > 2.2) {
        type = 'LATE_EXPANSION';
        alignmentScore = 65;
        description = 'Full Bearish Alignment, but move is late/extended (>2x ATR)';
      } else {
        type = 'MULTI_TIMEFRAME_ALIGNMENT';
        alignmentScore = 95;
        description = 'Strong 3-Timeframe Confluence (5m+15m+1h Bearish Alignment)';
      }
    }
    // B. Early Rotation (1h consolidation/base + 15m/5m breaking out)
    else if (tf5mBullish && tf15mBullish && !tf1hBearish) {
      type = 'EARLY_ROTATION';
      alignmentScore = 85;
      bias = 'LONG';
      description = 'Early Rotation: 5m & 15m turning bullish out of 1h base';
    } else if (tf5mBearish && tf15mBearish && !tf1hBullish) {
      type = 'EARLY_ROTATION';
      alignmentScore = 85;
      bias = 'SHORT';
      description = 'Early Rotation: 5m & 15m turning bearish out of 1h distribution';
    }
    // C. Short Term Momentum (5m only, 15m/1h not yet aligned)
    else if (tf5mBullish && !tf15mBearish) {
      type = 'SHORT_TERM_MOMENTUM';
      alignmentScore = 65;
      bias = 'LONG';
      description = 'Short Term Momentum: 5m active impulse, waiting for 15m confirmation';
    } else if (tf5mBearish && !tf15mBullish) {
      type = 'SHORT_TERM_MOMENTUM';
      alignmentScore = 65;
      bias = 'SHORT';
      description = 'Short Term Momentum: 5m active impulse down, waiting for 15m confirmation';
    }
    // D. Counter-Trend (5m/15m reversing directly against 1h major trend)
    else if (tf5mBullish && tf1hBearish) {
      type = 'COUNTER_TREND_CANDIDATE';
      alignmentScore = 55;
      bias = 'LONG';
      description = 'Counter-Trend Bounce: 5m bounce pushing into 1h downtrend';
    } else if (tf5mBearish && tf1hBullish) {
      type = 'COUNTER_TREND_CANDIDATE';
      alignmentScore = 55;
      bias = 'SHORT';
      description = 'Counter-Trend Pullback: 5m pullback dipping into 1h uptrend';
    }

    return {
      type,
      alignmentScore,
      bias,
      tf5mBullish,
      tf15mBullish,
      tf1hBullish,
      description
    };
  }
}
