import { CONFIG } from '../config.js';
import {
  TickerData,
  IndicatorState,
  VolatilityState,
  OIFundingAnalysis,
  ExhaustionAnalysis
} from '../data/types.js';

export class ExhaustionEngine {
  analyze(
    ticker: TickerData,
    indicators: IndicatorState,
    volatility: VolatilityState,
    oiFunding: OIFundingAnalysis,
    priceChange1hParam?: number | null
  ): ExhaustionAnalysis {
    let bullishExhaustion = 0;
    let bearishExhaustion = 0;
    const reasons: string[] = [];

    // P1 #8: Use 1H price window as defined in CONFIG.EXHAUSTION_PRICE_THRESHOLD
    const priceChange1h = (priceChange1hParam !== undefined && priceChange1hParam !== null)
      ? priceChange1hParam
      : (ticker.lastPrice > 0 && ticker.prevPrice1h > 0)
        ? (ticker.lastPrice - ticker.prevPrice1h) / ticker.prevPrice1h
        : ticker.price24hPcnt;

    const rsi1h = indicators.rsi14['60'] ?? indicators.rsi14['15'] ?? 50;
    const volRatio = indicators.volumeRatio['15'] ?? indicators.volumeRatio['5'] ?? 1;

    // ---- Evaluate Bullish Exhaustion (Overextended Long / Top Climax) ----
    // 1. Strong upward price movement beyond threshold
    if (priceChange1h >= CONFIG.EXHAUSTION_PRICE_THRESHOLD) {
      bullishExhaustion += 20;
      reasons.push('Price extended to the upside (1H)');
    }

    // 2. High OI crowding into the upward move
    if (priceChange1h > 0 && oiFunding.oiChangePercent >= CONFIG.EXHAUSTION_OI_THRESHOLD) {
      bullishExhaustion += 20;
      reasons.push('Rapid OI build on upmove (Longs crowded)');
    }

    // 3. Extreme positive funding
    if (oiFunding.fundingRate >= CONFIG.EXHAUSTION_FUNDING_EXTREME) {
      bullishExhaustion += 20;
      reasons.push('Funding extremely positive (Longs paying high premium)');
    }

    // 4. RSI overbought
    if (rsi1h >= CONFIG.EXHAUSTION_RSI_UPPER) {
      bullishExhaustion += 20;
      reasons.push(`1H RSI >= ${CONFIG.EXHAUSTION_RSI_UPPER}`);
    }

    // 5. Volume climax on upmove
    if (priceChange1h > 0 && volRatio >= CONFIG.EXHAUSTION_VOLUME_CLIMAX) {
      bullishExhaustion += 20;
      reasons.push('Buying volume climax detected');
    }

    // ---- Evaluate Bearish Exhaustion (Overextended Short / Bottom Climax) ----
    // 1. Strong downward price movement beyond threshold
    if (priceChange1h <= -CONFIG.EXHAUSTION_PRICE_THRESHOLD) {
      bearishExhaustion += 20;
      reasons.push('Price extended to the downside (1H)');
    }

    // 2. High OI crowding strictly on down move (Shorts crowding)
    if (priceChange1h < 0 && oiFunding.oiChangePercent >= CONFIG.EXHAUSTION_OI_THRESHOLD) {
      bearishExhaustion += 20;
      reasons.push('Rapid OI build on downmove (Shorts crowded)');
    }

    // 3. Extreme negative funding
    if (oiFunding.fundingRate <= -CONFIG.EXHAUSTION_FUNDING_EXTREME) {
      bearishExhaustion += 20;
      reasons.push('Funding extremely negative (Shorts paying high premium)');
    }

    // 4. RSI oversold
    if (rsi1h <= CONFIG.EXHAUSTION_RSI_LOWER) {
      bearishExhaustion += 20;
      reasons.push(`1H RSI <= ${CONFIG.EXHAUSTION_RSI_LOWER}`);
    }

    // 5. Volume climax on downmove
    if (priceChange1h < 0 && volRatio >= CONFIG.EXHAUSTION_VOLUME_CLIMAX) {
      bearishExhaustion += 20;
      reasons.push('Selling volume climax detected');
    }

    bullishExhaustion = Math.min(100, bullishExhaustion);
    bearishExhaustion = Math.min(100, bearishExhaustion);

    return {
      bullishExhaustion,
      bearishExhaustion,
      longPenalty: -(bullishExhaustion * 0.25),
      shortReversalBonus: bullishExhaustion * 0.15,
      shortPenalty: -(bearishExhaustion * 0.25),
      longReversalBonus: bearishExhaustion * 0.15,
      reasons
    };
  }
}
