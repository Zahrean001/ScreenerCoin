import { CONFIG } from '../config.js';
import {
  TickerData,
  LiquidationData,
  OIFundingAnalysis,
  IndicatorState,
  SqueezeAnalysis
} from '../data/types.js';
import { pctChange } from '../utils/math.js';

export class SqueezeEngine {
  analyze(
    ticker: TickerData,
    prevTicker: TickerData | null,
    recentLiquidations: LiquidationData[],
    oiFunding: OIFundingAnalysis,
    indicators: IndicatorState,
    priceWindowReturn?: number | null
  ): SqueezeAnalysis {
    let shortSqueeze = false;
    let longSqueeze = false;
    let squeezeIntensity = 0;
    let longBonus = 0;
    let shortBonus = 0;
    const reasons: string[] = [];

    // P1 #9: Use explicit window price return (e.g. 5m or 1m) rather than tick-to-tick noise
    const priceChange = (priceWindowReturn !== undefined && priceWindowReturn !== null)
      ? priceWindowReturn
      : prevTicker
        ? pctChange(ticker.lastPrice, prevTicker.lastPrice)
        : 0;
    const shortLiqs = recentLiquidations.filter(l => l.side === 'Buy').length;
    const longLiqs = recentLiquidations.filter(l => l.side === 'Sell').length;

    const volExpanding = (indicators.volumeRatio['5'] ?? 1) > 1.5;

    // Short squeeze logic
    if (priceChange > CONFIG.SQUEEZE_PRICE_ACCELERATION && shortLiqs >= CONFIG.SQUEEZE_LIQUIDATION_THRESHOLD) {
      if (oiFunding.oiChangePercent < 0 && volExpanding) {
        shortSqueeze = true;
        squeezeIntensity = Math.min(100, (shortLiqs / CONFIG.SQUEEZE_LIQUIDATION_THRESHOLD) * 50);
        longBonus = Math.min(10, 5 + (squeezeIntensity / 20));
        reasons.push(`Short Squeeze: ${shortLiqs} liqs, price accelerating`);
      }
    }

    // Long squeeze logic
    if (priceChange < -CONFIG.SQUEEZE_PRICE_ACCELERATION && longLiqs >= CONFIG.SQUEEZE_LIQUIDATION_THRESHOLD) {
      if (oiFunding.oiChangePercent < 0 && volExpanding) {
        longSqueeze = true;
        squeezeIntensity = Math.min(100, (longLiqs / CONFIG.SQUEEZE_LIQUIDATION_THRESHOLD) * 50);
        shortBonus = Math.min(10, 5 + (squeezeIntensity / 20));
        reasons.push(`Long Squeeze: ${longLiqs} liqs, price dropping`);
      }
    }

    // Post-squeeze exhaustion
    const rsi = indicators.rsi14['15'] ?? 50;
    if (shortSqueeze && rsi > 75) {
      longBonus = Math.max(0, longBonus - 5);
      reasons.push('Squeeze extended (RSI > 75), bonus reduced');
    }
    if (longSqueeze && rsi < 25) {
      shortBonus = Math.max(0, shortBonus - 5);
      reasons.push('Squeeze extended (RSI < 25), bonus reduced');
    }

    return {
      shortSqueeze,
      longSqueeze,
      squeezeIntensity,
      longBonus,
      shortBonus,
      reasons
    };
  }
}
