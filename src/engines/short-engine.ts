// ============================================================
// Independent SHORT Scoring Engine
// ============================================================

import {
  IndicatorState,
  TickerData,
  VolatilityState,
  MarketStructure,
  Timeframe,
  OIFundingAnalysis,
  RelativeStrengthResult,
  OrderbookSnapshot,
  LiquidationData,
  MarketRegimeState,
  ShortScoreBreakdown,
  ScoreModifier,
  TrendState,
  StructureType
} from '../data/types.js';

export class ShortEngine {
  score(
    indicators: IndicatorState,
    ticker: TickerData,
    volatility: VolatilityState,
    structure: Record<Timeframe, MarketStructure>,
    oiFunding: OIFundingAnalysis,
    rsResult: RelativeStrengthResult,
    orderbook: OrderbookSnapshot | null,
    recentLiquidations: LiquidationData[],
    regime: MarketRegimeState
  ): ShortScoreBreakdown {
    const modifiers: ScoreModifier[] = [];
    let availableWeight = 0;

    // 1. Trend (Max Weight: 20)
    let trendScore = 0;
    const ema9_60 = indicators.ema9['60'];
    const ema21_60 = indicators.ema21['60'];
    const ema50_60 = indicators.ema50['60'];
    const hasEma = ema9_60 !== null && ema21_60 !== null && ema50_60 !== null;
    const hasStructure = (structure['5']?.confirmedPivotsCount ?? 0) > 0 || 
                         (structure['15']?.confirmedPivotsCount ?? 0) > 0 || 
                         (structure['60']?.confirmedPivotsCount ?? 0) > 0;

    if (hasEma || hasStructure) {
      availableWeight += 20;
      if (hasEma) {
        if (ema9_60 < ema21_60 && ema21_60 < ema50_60) {
          trendScore += 8; // Full bearish alignment
        } else if (ema9_60 < ema21_60) {
          trendScore += 5;
        }
      }
      
      const isBearish = (tf: Timeframe) => 
        structure[tf]?.trend === TrendState.BEARISH || structure[tf]?.trend === TrendState.STRONG_BEARISH;
        
      if (isBearish('5') && isBearish('15') && isBearish('60')) {
        trendScore += 6; // Full TF alignment
      } else if (isBearish('15') && isBearish('60')) {
        trendScore += 4;
      }
      
      const struct60 = structure['60']?.structures || [];
      const struct15 = structure['15']?.structures || [];
      if (struct60.includes(StructureType.LOWER_HIGH) && struct60.includes(StructureType.LOWER_LOW)) {
        trendScore += 6; // Confirmed LH + LL
      } else if (struct15.includes(StructureType.LOWER_HIGH) && struct15.includes(StructureType.LOWER_LOW)) {
        trendScore += 4;
      }
      trendScore = Math.min(20, trendScore);
    }

    // 2. Momentum (Max Weight: 15)
    let momentumScore = 0;
    const rsi15 = indicators.rsi14['15'] ?? indicators.rsi14['60'];
    const hasRoc = indicators.roc14['15'] !== null || indicators.roc14['60'] !== null;
    const vwap = indicators.vwap['15'] ?? indicators.vwap['60'];
    const hasVwap = vwap !== null && vwap > 0;

    if (rsi15 !== null || hasRoc || hasVwap) {
      availableWeight += 15;
      if (rsi15 !== null) {
        if (rsi15 >= 32 && rsi15 <= 48) {
          momentumScore += 5; // Controlled bearish momentum
        } else if (rsi15 >= 25 && rsi15 < 32) {
          momentumScore += 3; // Bearish but oversold risk
        } else if (rsi15 > 48 && rsi15 <= 55) {
          momentumScore += 2;
        }
      }
      
      const roc = indicators.roc14['15'] ?? indicators.roc14['60'] ?? 0;
      const rocFast = indicators.roc5['15'] ?? indicators.roc5['60'] ?? 0;
      if (roc < -0.005 && rocFast < roc) { // negative and accelerating down
        momentumScore += 5;
      } else if (roc < 0) {
        momentumScore += 3;
      }
      
      if (hasVwap && ticker.lastPrice < vwap) {
        momentumScore += 5; // Rejected below VWAP
      }
      momentumScore = Math.min(15, momentumScore);
    }

    // 3. Relative Weakness (Max Weight: 15)
    const relativeWeaknessScore = Math.min(15, Math.max(0, rsResult.shortScore));
    availableWeight += rsResult.availableWeight;

    // 4. Volume Expansion (Max Weight: 15)
    let volumeScore = 0;
    const volRatio15 = indicators.volumeRatio['15'] ?? indicators.volumeRatio['5'];
    if (volRatio15 !== null) {
      availableWeight += 15;
      if (volRatio15 >= 2.5) {
        volumeScore += 12;
      } else if (volRatio15 >= 1.5) {
        volumeScore += 8;
      } else if (volRatio15 >= 1.1) {
        volumeScore += 4;
      }
      
      if (ticker.price24hPcnt < 0 && volRatio15 > 1.2) {
        volumeScore += 3; // Seller aggression
      }
      volumeScore = Math.min(15, volumeScore);
    }

    // 5. Open Interest (Max Weight: 10)
    const oiScore = oiFunding.shortScore;
    availableWeight += 10 * (oiFunding.dataCompleteness ?? 1.0);

    // 6. Funding & Crowded Longs (Max Weight: 10)
    let fundingScore = 0;
    const fr = oiFunding.fundingRate;
    if (Number.isFinite(fr)) {
      availableWeight += 10;
      if (fr > 0.0005) { // Extreme positive funding (crowded longs = short fuel)
        fundingScore = 10;
      } else if (fr > 0.0002) {
        fundingScore = 7;
      } else if (fr >= 0 && fr <= 0.0002) {
        fundingScore = 5;
      } else if (fr < -0.0003) { // Negative funding (short squeeze risk penalty)
        fundingScore = 1;
      } else {
        fundingScore = 4;
      }
    }

    // 7. Orderbook (Max Weight: 10)
    let obScore = 0;
    if (orderbook && orderbook.bids.length > 0 && orderbook.asks.length > 0) {
      availableWeight += 10;
      let bidDepth = 0;
      let askDepth = 0;
      for (const b of orderbook.bids.slice(0, 10)) bidDepth += b.price * b.size;
      for (const a of orderbook.asks.slice(0, 10)) askDepth += a.price * a.size;
      
      if (askDepth > bidDepth * 1.5) {
        obScore = 10; // Heavy overhead resistance
      } else if (askDepth > bidDepth) {
        obScore = 7;
      } else if (bidDepth > askDepth * 1.5) {
        obScore = 2; // Strong bid support blocking shorts
      } else {
        obScore = 5;
      }
    } else {
      availableWeight += 5;
      obScore = 5;
    }

    // 8. Liquidation (Max Weight: 5)
    let liqScore = 0;
    if (recentLiquidations.length > 0) {
      availableWeight += 5;
      const longLiqs = recentLiquidations.filter(l => l.side === 'Sell'); // longs liquidated
      if (longLiqs.length >= 3) {
        liqScore = 5; // Long liquidation cascade
      } else if (longLiqs.length > 0) {
        liqScore = 3;
      } else {
        liqScore = 1;
      }
    } else {
      availableWeight += 2.5;
      liqScore = 2;
    }

    // Raw Score sum
    const rawScore = trendScore + momentumScore + relativeWeaknessScore + volumeScore + oiScore + fundingScore + obScore + liqScore;

    // Normalized to 100 based on observed available weight
    const normalizedScore = availableWeight > 0 ? Math.min(100, (rawScore / availableWeight) * 100) : 0;
    const dataCompleteness = Math.min(1.0, availableWeight / 100);

    let total = normalizedScore;

    // Modifiers (Regime multiplier)
    if (regime.shortModifier !== 1.0) {
      const diff = total * (regime.shortModifier - 1.0);
      total *= regime.shortModifier;
      modifiers.push({
        name: 'Market Regime',
        value: diff,
        reason: `BTC Regime modifier (${regime.shortModifier.toFixed(2)}x)`
      });
    }

    // VWAP Bearish Stack Confluence Modifier
    if (indicators.sessionVwap?.vwap && indicators.weeklyVwap?.vwap) {
      const sVwap = indicators.sessionVwap.vwap;
      const wVwap = indicators.weeklyVwap.vwap;
      const mVwap = indicators.monthlyVwap?.vwap ?? null;

      if (ticker.lastPrice < sVwap && sVwap < wVwap) {
        if (mVwap !== null && wVwap < mVwap) {
          total = Math.min(100, total + 3.0);
          modifiers.push({
            name: 'Triple VWAP Bearish Stack',
            value: 3.0,
            reason: '🏛️ TRIPLE_BEARISH_STACK: Price < Session < Weekly < Monthly VWAP'
          });
        } else {
          total = Math.min(100, total + 1.5);
          modifiers.push({
            name: 'Double VWAP Bearish Stack',
            value: 1.5,
            reason: '🏛️ BEARISH_VWAP_STACK: Price < Session < Weekly VWAP'
          });
        }
      }
    }

    total = Math.min(100, Math.max(0, total));

    return {
      trend: trendScore,
      momentum: momentumScore,
      relativeWeakness: relativeWeaknessScore,
      volumeExpansion: volumeScore,
      openInterest: oiScore,
      funding: fundingScore,
      orderbook: obScore,
      liquidation: liqScore,
      rawScore,
      availableWeight,
      normalizedScore,
      dataCompleteness,
      total,
      isDecoupledAlpha: false,
      modifiers
    };
  }
}
