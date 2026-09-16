// ============================================================
// Independent LONG Scoring Engine
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
  LongScoreBreakdown,
  ScoreModifier,
  TrendState,
  StructureType
} from '../data/types.js';

export class LongEngine {
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
  ): LongScoreBreakdown {
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
        if (ema9_60 > ema21_60 && ema21_60 > ema50_60) {
          trendScore += 8; // Full bullish stack
        } else if (ema9_60 > ema21_60) {
          trendScore += 5; // Fast above mid
        }
      }
      
      const isBullish = (tf: Timeframe) => 
        structure[tf]?.trend === TrendState.BULLISH || structure[tf]?.trend === TrendState.STRONG_BULLISH;
        
      if (isBullish('5') && isBullish('15') && isBullish('60')) {
        trendScore += 6; // Full TF alignment
      } else if (isBullish('15') && isBullish('60')) {
        trendScore += 4;
      }
      
      const struct60 = structure['60']?.structures || [];
      const struct15 = structure['15']?.structures || [];
      if (struct60.includes(StructureType.HIGHER_HIGH) && struct60.includes(StructureType.HIGHER_LOW)) {
        trendScore += 6; // Confirmed HH + HL
      } else if (struct15.includes(StructureType.HIGHER_HIGH) && struct15.includes(StructureType.HIGHER_LOW)) {
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
        if (rsi15 >= 52 && rsi15 <= 68) {
          momentumScore += 5; // Healthy bullish zone without overbought
        } else if (rsi15 > 68 && rsi15 <= 75) {
          momentumScore += 3; // Strong but elevated
        } else if (rsi15 >= 45 && rsi15 < 52) {
          momentumScore += 2;
        }
      }
      
      const roc = indicators.roc14['15'] ?? indicators.roc14['60'] ?? 0;
      const rocFast = indicators.roc5['15'] ?? indicators.roc5['60'] ?? 0;
      if (roc > 0.005 && rocFast > roc) { // positive and accelerating
        momentumScore += 5;
      } else if (roc > 0) {
        momentumScore += 3;
      }
      
      if (hasVwap && ticker.lastPrice > vwap) {
        momentumScore += 5; // Above VWAP support
      }
      momentumScore = Math.min(15, momentumScore);
    }

    // 3. Relative Strength (Max Weight: 15)
    const relativeStrengthScore = Math.min(15, Math.max(0, rsResult.longScore));
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
      
      if (ticker.price24hPcnt > 0 && volRatio15 > 1.2) {
        volumeScore += 3; // Buyer aggression
      }
      volumeScore = Math.min(15, volumeScore);
    }

    // 5. Open Interest (Max Weight: 10)
    const oiScore = oiFunding.longScore;
    availableWeight += 10 * (oiFunding.dataCompleteness ?? 1.0);

    // 6. Funding Rate Context (Max Weight: 10)
    let fundingScore = 0;
    const fr = oiFunding.fundingRate;
    if (Number.isFinite(fr)) {
      availableWeight += 10;
      if (fr <= 0 && fr > -0.0005) { // Neutral to slight negative
        fundingScore = 10;
      } else if (fr > 0 && fr <= 0.0002) { // Normal positive
        fundingScore = 7;
      } else if (fr > 0.0002 && fr <= 0.0005) { // Elevated
        fundingScore = 4;
      } else if (fr > 0.0005) { // Extreme positive (crowded longs penalty)
        fundingScore = 1;
      } else { // Deep negative
        fundingScore = 8;
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
      
      if (bidDepth > askDepth * 1.5) {
        obScore = 10;
      } else if (bidDepth > askDepth) {
        obScore = 7;
      } else if (askDepth > bidDepth * 1.5) {
        obScore = 2;
      } else {
        obScore = 5;
      }
    } else {
      availableWeight += 5;
      obScore = 5; // Neutral baseline when orderbook not yet loaded
    }

    // 8. Liquidation (Max Weight: 5)
    let liqScore = 0;
    if (recentLiquidations.length > 0) {
      availableWeight += 5;
      const shortLiqs = recentLiquidations.filter(l => l.side === 'Buy'); // shorts liquidated
      if (shortLiqs.length >= 3) {
        liqScore = 5;
      } else if (shortLiqs.length > 0) {
        liqScore = 3;
      } else {
        liqScore = 1;
      }
    } else {
      availableWeight += 2.5;
      liqScore = 2;
    }

    // Raw Score sum
    const rawScore = trendScore + momentumScore + relativeStrengthScore + volumeScore + oiScore + fundingScore + obScore + liqScore;
    
    // Normalized to 100 based on observed available weight
    const normalizedScore = availableWeight > 0 ? Math.min(100, (rawScore / availableWeight) * 100) : 0;
    const dataCompleteness = Math.min(1.0, availableWeight / 100);

    let total = normalizedScore;

    // Check for Decoupled Alpha:
    // Outperform BTC consistently (vsBTC >= +2% or relativeStrengthScore >= 11/15), turnover >= $20M,
    // sound trend, and normal healthy funding (-0.02% to +0.04%).
    const isDecoupledAlpha = (
      rsResult && ((rsResult.vsBTC !== null && rsResult.vsBTC >= 0.02) || relativeStrengthScore >= 11) &&
      ticker.turnover24h >= 20_000_000 &&
      trendScore >= 8 &&
      rawScore >= 50 &&
      oiFunding.fundingRate >= -0.0002 && oiFunding.fundingRate <= 0.0004
    );

    // Modifiers (Regime multiplier)
    if (isDecoupledAlpha && regime.longModifier < 1.0) {
      // Preserve alpha: do not crush with full bear veto, reward decoupled leader strength
      const protectedModifier = Math.max(0.88, regime.longModifier * 1.55);
      const diff = total * (protectedModifier - 1.0);
      total *= protectedModifier;
      const btcDiffStr = rsResult.vsBTC !== null ? `${(rsResult.vsBTC * 100).toFixed(1)}% vs BTC` : 'Strong RS';
      modifiers.push({
        name: 'Decoupled Alpha Leader',
        value: diff,
        reason: `👑 DECOUPLED_ALPHA: Strong idiosyncratic RS (${btcDiffStr}) protected from full BTC bear veto`
      });
    } else if (regime.longModifier !== 1.0) {
      const diff = total * (regime.longModifier - 1.0);
      total *= regime.longModifier;
      modifiers.push({
        name: 'Market Regime',
        value: diff,
        reason: `BTC Regime modifier (${regime.longModifier.toFixed(2)}x)`
      });
    }

    // VWAP Stack Confluence Modifier
    if (indicators.sessionVwap?.vwap && indicators.weeklyVwap?.vwap) {
      const sVwap = indicators.sessionVwap.vwap;
      const wVwap = indicators.weeklyVwap.vwap;
      const mVwap = indicators.monthlyVwap?.vwap ?? null;

      if (ticker.lastPrice > sVwap && sVwap > wVwap) {
        if (mVwap !== null && wVwap > mVwap) {
          total = Math.min(100, total + 3.0);
          modifiers.push({
            name: 'Triple VWAP Bullish Stack',
            value: 3.0,
            reason: '🏛️ TRIPLE_BULLISH_STACK: Price > Session > Weekly > Monthly VWAP'
          });
        } else {
          total = Math.min(100, total + 1.5);
          modifiers.push({
            name: 'Double VWAP Bullish Stack',
            value: 1.5,
            reason: '🏛️ BULLISH_VWAP_STACK: Price > Session > Weekly VWAP'
          });
        }
      }
    }

    total = Math.min(100, Math.max(0, total));

    return {
      trend: trendScore,
      momentum: momentumScore,
      relativeStrength: relativeStrengthScore,
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
      isDecoupledAlpha: !!isDecoupledAlpha,
      modifiers
    };
  }
}
