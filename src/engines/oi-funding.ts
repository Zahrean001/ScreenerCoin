// ============================================================
// Open Interest & Funding Rate Engine
// ============================================================

import { 
  OIFundingAnalysis, 
  TickerData, 
  OIPriceState, 
  CrowdingState,
  OIDeltaSnapshot
} from '../data/types.js';
import { pctChange, percentileRank } from '../utils/math.js';

export class OIFundingEngine {
  analyze(
    ticker: TickerData,
    prevTicker: TickerData | null,
    fundingHistory: number[] = [],
    longShortRatioData: { buyRatio: number; sellRatio: number; timestamp: number } | null = null,
    oiDeltaSnapshot: OIDeltaSnapshot | null = null,
    priceChange15m: number | null = null
  ): OIFundingAnalysis {
    let oiPriceState = OIPriceState.NEUTRAL;
    let oiChangePercent = 0;
    let priceChangePercent = 0;
    
    let longScoreRaw = 0;
    let shortScoreRaw = 0;
    let availableWeight = 0;

    // 1. OI + Price Matrix (Weight: 60% of OI/Funding = 6 pts)
    availableWeight += 6;

    // Check if we have prevTicker OR historical OI snapshot from Bybit /v5/market/open-interest
    let hasOIData = false;
    if (prevTicker && prevTicker.lastPrice > 0 && prevTicker.openInterest > 0 && prevTicker.openInterest !== ticker.openInterest) {
      oiChangePercent = pctChange(ticker.openInterest, prevTicker.openInterest);
      priceChangePercent = pctChange(ticker.lastPrice, prevTicker.lastPrice);
      hasOIData = true;
    } else if (oiDeltaSnapshot && oiDeltaSnapshot.oi15mAgo > 0) {
      oiChangePercent = oiDeltaSnapshot.oiChange15mPct;
      priceChangePercent = priceChange15m !== null ? priceChange15m : (ticker.price24hPcnt / 96); // fallback to 15m approx
      hasOIData = true;
    }

    if (hasOIData) {
      const oiUp = oiChangePercent > 0.0005;
      const priceUp = priceChangePercent > 0.0005;
      const oiDown = oiChangePercent < -0.0005;
      const priceDown = priceChangePercent < -0.0005;

      if (oiUp && priceUp) {
        oiPriceState = OIPriceState.LONG_BUILD;
        longScoreRaw += 6;
        shortScoreRaw -= 1.5;
      } else if (oiUp && priceDown) {
        oiPriceState = OIPriceState.SHORT_BUILD;
        shortScoreRaw += 6;
        longScoreRaw -= 1.5;
      } else if (oiDown && priceUp) {
        oiPriceState = OIPriceState.SHORT_COVERING;
        longScoreRaw += 3;
        shortScoreRaw -= 1;
      } else if (oiDown && priceDown) {
        oiPriceState = OIPriceState.LONG_LIQUIDATION;
        shortScoreRaw += 3;
        longScoreRaw -= 1;
      }
    }

    // 2. Funding Rate History & Percentile (Weight: 25% = 2.5 pts)
    const fundingRate = ticker.fundingRate;
    let fundingPercentile: number | null = null;

    if (fundingHistory.length >= 3) {
      fundingPercentile = percentileRank(fundingHistory, fundingRate);
      availableWeight += 2.5;

      if (fundingRate > 0.0005) { // Extreme positive funding (>0.05%)
        shortScoreRaw += 2.5; // crowded longs, short reversal opportunity
      } else if (fundingRate < -0.0003) { // Extreme negative funding (<-0.03%)
        longScoreRaw += 2.5; // crowded shorts, long bounce opportunity
      } else if (fundingRate >= -0.0001 && fundingRate <= 0.0002) { // Normal/neutral funding
        longScoreRaw += 1.5; // healthy room for long expansion
      }
    } else if (Number.isFinite(fundingRate)) {
      // Single rate observation
      availableWeight += 1.5;
      if (fundingRate > 0.0005) shortScoreRaw += 1.5;
      else if (fundingRate < -0.0003) longScoreRaw += 1.5;
    }

    // 3. Long/Short Account Ratio (Weight: 15% = 1.5 pts)
    let longShortRatio: number | null = null;
    let lsTimestamp: number | undefined = undefined;

    if (longShortRatioData && longShortRatioData.sellRatio > 0) {
      longShortRatio = longShortRatioData.buyRatio / longShortRatioData.sellRatio;
      lsTimestamp = longShortRatioData.timestamp;
      availableWeight += 1.5;

      if (longShortRatio > 2.5) { // Crowded retail longs
        shortScoreRaw += 1.5;
      } else if (longShortRatio < 0.6) { // Crowded retail shorts
        longScoreRaw += 1.5;
      }
    }

    // 4. Contextual Crowding State
    let crowdingState = CrowdingState.BALANCED;
    if ((fundingRate > 0.0005 || (longShortRatio !== null && longShortRatio > 2.0)) && oiPriceState === OIPriceState.LONG_BUILD) {
      crowdingState = CrowdingState.EXTREME_LONG;
    } else if (fundingRate > 0.0002 || (longShortRatio !== null && longShortRatio > 1.4)) {
      crowdingState = CrowdingState.MODERATE_LONG;
    } else if ((fundingRate < -0.0003 || (longShortRatio !== null && longShortRatio < 0.6)) && oiPriceState === OIPriceState.SHORT_BUILD) {
      crowdingState = CrowdingState.EXTREME_SHORT;
    } else if (fundingRate < -0.0001 || (longShortRatio !== null && longShortRatio < 0.8)) {
      crowdingState = CrowdingState.MODERATE_SHORT;
    }

    // 5. Capital Flow Label & Squeeze/Flush Event Classification
    let capitalFlowLabel = 'NEUTRAL / UNCONFIRMED';
    if (oiPriceState === OIPriceState.LONG_BUILD) {
      capitalFlowLabel = 'LONG_BUILD (New Money Accumulation)';
    } else if (oiPriceState === OIPriceState.SHORT_BUILD) {
      capitalFlowLabel = 'SHORT_BUILD (Aggressive Short Positioning)';
    } else if (oiPriceState === OIPriceState.SHORT_COVERING) {
      capitalFlowLabel = 'SHORT_COVERING (Short Squeeze Bounce)';
    } else if (oiPriceState === OIPriceState.LONG_LIQUIDATION) {
      capitalFlowLabel = 'LONG_LIQUIDATION (Long Flush Dump)';
    }

    let eventTag: 'SHORT_SQUEEZE_CANDIDATE' | 'LONG_FLUSH_RISK' | 'OI_SUPPORTED_MOMENTUM' | 'REVERSAL_WATCH' | null = null;

    if ((fundingRate <= -0.00015 || crowdingState === CrowdingState.EXTREME_SHORT) && (priceChangePercent >= -0.005)) {
      eventTag = 'SHORT_SQUEEZE_CANDIDATE';
    } else if ((fundingRate >= 0.0003 || crowdingState === CrowdingState.EXTREME_LONG) && priceChangePercent < 0) {
      eventTag = 'LONG_FLUSH_RISK';
    } else if (oiChangePercent > 0.015 && priceChangePercent > 0.005) {
      eventTag = 'OI_SUPPORTED_MOMENTUM';
    } else if (oiChangePercent < -0.02 && Math.abs(priceChangePercent) > 0.02) {
      eventTag = 'REVERSAL_WATCH';
    }

    const maxWeight = 10;
    const dataCompleteness = Math.min(1.0, availableWeight / maxWeight);
    const longScore = availableWeight > 0 ? Math.max(0, Math.min(10, (longScoreRaw / availableWeight) * 10)) : 0;
    const shortScore = availableWeight > 0 ? Math.max(0, Math.min(10, (shortScoreRaw / availableWeight) * 10)) : 0;
    const fundingReady = fundingHistory.length >= 3;
    const fundingHistoryCount = fundingHistory.length;

    return {
      oiPriceState,
      oiChangePercent,
      fundingRate,
      fundingPercentile,
      fundingReady,
      fundingHistoryCount,
      longShortRatio,
      longShortRatioTimestamp: lsTimestamp,
      crowdingState,
      eventTag,
      capitalFlowLabel,
      longScore,
      shortScore,
      dataCompleteness
    };
  }
}
