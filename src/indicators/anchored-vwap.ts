// ============================================================
// Institutional Multi-Anchor VWAP Engine (AA VWAP Pro Native)
// Computes:
// 1. Session VWAP (Anchor: 00:00:00 UTC Daily)
// 2. Weekly VWAP (Anchor: Monday 00:00:00 UTC Weekly)
// 3. Monthly VWAP (Anchor: 1st of Month 00:00:00 UTC Monthly)
// 4. Volume-Weighted Standard Deviation Bands (±1.0σ, ±2.0σ, ±3.0σ)
// ============================================================

import { CandleData, VWAPBandState, VWAPAnalysis, VWAPAlignment, VWAPBandPosition, Direction } from '../data/types.js';

export class AnchoredVWAPEngine {
  /**
   * Helper to determine if a candle starts a new UTC day (00:00 UTC).
   */
  static isNewUTCDay(currentTs: number, prevTs: number): boolean {
    const d1 = Math.floor(currentTs / 86_400_000);
    const d0 = Math.floor(prevTs / 86_400_000);
    return d1 !== d0;
  }

  /**
   * Helper to determine if a candle starts a new UTC week (Monday 00:00 UTC).
   * Note: Jan 1 1970 was Thursday (offset = 4 days = 345_600_000 ms).
   */
  static isNewUTCWeek(currentTs: number, prevTs: number): boolean {
    const w1 = Math.floor((currentTs - 345_600_000) / 604_800_000);
    const w0 = Math.floor((prevTs - 345_600_000) / 604_800_000);
    return w1 !== w0;
  }

  /**
   * Helper to determine if a candle starts a new UTC month (1st of month 00:00 UTC).
   */
  static isNewUTCMonth(currentTs: number, prevTs: number): boolean {
    const d1 = new Date(currentTs);
    const d0 = new Date(prevTs);
    return d1.getUTCFullYear() !== d0.getUTCFullYear() || d1.getUTCMonth() !== d0.getUTCMonth();
  }

  /**
   * Computes Volume-Weighted Average Price and Standard Deviation Bands from an anchor index.
   */
  static computeFromAnchor(candles: CandleData[], anchorIdx: number): VWAPBandState | null {
    if (!candles || candles.length === 0 || anchorIdx < 0 || anchorIdx >= candles.length) {
      return null;
    }

    let cumV = 0;
    let cumPV = 0;

    // Pass 1: Compute VWAP
    for (let i = anchorIdx; i < candles.length; i++) {
      const c = candles[i];
      const hlc3 = (c.high + c.low + c.close) / 3;
      const v = c.volume > 0 ? c.volume : 0;
      cumV += v;
      cumPV += hlc3 * v;
    }

    if (cumV <= 0) return null;
    const vwap = cumPV / cumV;

    // Pass 2: Volume-Weighted Standard Deviation (Variance = sum(V * (hlc3 - vwap)^2) / sum(V))
    let cumWeightedSquaredDev = 0;
    for (let i = anchorIdx; i < candles.length; i++) {
      const c = candles[i];
      const hlc3 = (c.high + c.low + c.close) / 3;
      const v = c.volume > 0 ? c.volume : 0;
      const diff = hlc3 - vwap;
      cumWeightedSquaredDev += v * diff * diff;
    }

    const variance = cumWeightedSquaredDev / cumV;
    const sigma = Math.sqrt(Math.max(0, variance));

    return {
      vwap: parseFloat(vwap.toFixed(6)),
      upperBand1: parseFloat((vwap + 1.0 * sigma).toFixed(6)),
      lowerBand1: parseFloat((vwap - 1.0 * sigma).toFixed(6)),
      upperBand2: parseFloat((vwap + 2.0 * sigma).toFixed(6)),
      lowerBand2: parseFloat((vwap - 2.0 * sigma).toFixed(6)),
      upperBand3: parseFloat((vwap + 3.0 * sigma).toFixed(6)),
      lowerBand3: parseFloat((vwap - 3.0 * sigma).toFixed(6)),
      sigma: parseFloat(sigma.toFixed(6)),
      anchorTimestamp: candles[anchorIdx].timestamp
    };
  }

  /**
   * Computes Session VWAP (Anchor: 00:00:00 UTC today).
   * Usually computed on 5m or 15m candles.
   */
  computeSessionVWAP(candles: CandleData[]): VWAPBandState | null {
    if (!candles || candles.length === 0) return null;
    const latestTs = candles[candles.length - 1].timestamp;

    // Find the first candle of today (UTC)
    let anchorIdx = 0;
    for (let i = candles.length - 1; i >= 0; i--) {
      if (AnchoredVWAPEngine.isNewUTCDay(latestTs, candles[i].timestamp)) {
        anchorIdx = i + 1;
        break;
      }
    }

    return AnchoredVWAPEngine.computeFromAnchor(candles, anchorIdx);
  }

  /**
   * Computes Weekly VWAP (Anchor: Monday 00:00:00 UTC this week).
   * Usually computed on 1h (60m) candles.
   */
  computeWeeklyVWAP(candles: CandleData[]): VWAPBandState | null {
    if (!candles || candles.length === 0) return null;
    const latestTs = candles[candles.length - 1].timestamp;

    // Find the first candle of this week (UTC)
    let anchorIdx = 0;
    for (let i = candles.length - 1; i >= 0; i--) {
      if (AnchoredVWAPEngine.isNewUTCWeek(latestTs, candles[i].timestamp)) {
        anchorIdx = i + 1;
        break;
      }
    }

    return AnchoredVWAPEngine.computeFromAnchor(candles, anchorIdx);
  }

  /**
   * Computes Monthly VWAP (Anchor: 1st of month 00:00:00 UTC).
   * Computed on 1h or Daily candles.
   */
  computeMonthlyVWAP(candles: CandleData[]): VWAPBandState | null {
    if (!candles || candles.length === 0) return null;
    const latestTs = candles[candles.length - 1].timestamp;

    // Find the first candle of this month (UTC)
    let anchorIdx = 0;
    for (let i = candles.length - 1; i >= 0; i--) {
      if (AnchoredVWAPEngine.isNewUTCMonth(latestTs, candles[i].timestamp)) {
        anchorIdx = i + 1;
        break;
      }
    }

    return AnchoredVWAPEngine.computeFromAnchor(candles, anchorIdx);
  }

  /**
   * Performs full Multi-Anchor VWAP Confluence & Band Position Analysis.
   */
  analyze(
    price: number,
    sessionVwap: VWAPBandState | null,
    weeklyVwap: VWAPBandState | null,
    monthlyVwap: VWAPBandState | null,
    direction: Direction
  ): VWAPAnalysis {
    const sVwap = sessionVwap?.vwap ?? null;
    const wVwap = weeklyVwap?.vwap ?? null;
    const mVwap = monthlyVwap?.vwap ?? null;

    // 1. Alignment Matrix
    let alignment: VWAPAlignment = 'CHOPPY_VWAP';

    if (sVwap !== null && wVwap !== null && mVwap !== null) {
      if (price > sVwap && sVwap > wVwap && wVwap > mVwap) {
        alignment = 'TRIPLE_BULLISH_STACK';
      } else if (price < sVwap && sVwap < wVwap && wVwap < mVwap) {
        alignment = 'TRIPLE_BEARISH_STACK';
      } else if (price > sVwap && sVwap > wVwap) {
        alignment = 'BULLISH_STACK';
      } else if (price < sVwap && sVwap < wVwap) {
        alignment = 'BEARISH_STACK';
      }
    } else if (sVwap !== null && wVwap !== null) {
      if (price > sVwap && sVwap > wVwap) {
        alignment = 'BULLISH_STACK';
      } else if (price < sVwap && sVwap < wVwap) {
        alignment = 'BEARISH_STACK';
      }
    }

    // 2. Band Position Analysis (relative to Session VWAP)
    let bandPosition: VWAPBandPosition = 'INSIDE_VALUE_AREA';
    let isRetestingBand1 = false;
    let isExhaustedBand2 = false;
    let isClimaxBand3 = false;
    let warning: string | null = null;

    if (sessionVwap && sessionVwap.vwap !== null && sessionVwap.sigma !== null && sessionVwap.sigma > 0) {
      const u1 = sessionVwap.upperBand1!;
      const l1 = sessionVwap.lowerBand1!;
      const u2 = sessionVwap.upperBand2!;
      const l2 = sessionVwap.lowerBand2!;
      const u3 = sessionVwap.upperBand3!;
      const l3 = sessionVwap.lowerBand3!;
      const sigma = sessionVwap.sigma;

      if (price >= u3 || price <= l3) {
        bandPosition = 'CLIMAX_BAND_3';
        isClimaxBand3 = true;
        isExhaustedBand2 = true;
        warning = price >= u3 
          ? '🚨 PARABOLIC_CLIMAX: Price extended beyond +3.0σ VWAP Band'
          : '🚨 FLUSH_CLIMAX: Price dump extended beyond -3.0σ VWAP Band';
      } else if (price >= u2 || price <= l2) {
        bandPosition = 'EXHAUSTED_BAND_2';
        isExhaustedBand2 = true;
        if (direction === 'LONG' && price >= u2) {
          warning = '⚠️ VWAP_EXHAUSTED: Price extended above +2.0σ Band (Mean reversion risk)';
        } else if (direction === 'SHORT' && price <= l2) {
          warning = '⚠️ VWAP_EXHAUSTED: Price dump extended below -2.0σ Band (Mean reversion risk)';
        }
      } else {
        // Inside Value Area (-1.0σ to +1.0σ) or between Band 1 and Band 2
        // Check if retesting Band 1 or Midline VWAP
        if (direction === 'LONG') {
          const distToU1 = Math.abs(price - u1);
          const distToMid = Math.abs(price - sessionVwap.vwap);
          if (distToU1 <= (0.25 * sigma) || distToMid <= (0.25 * sigma)) {
            bandPosition = 'RETEST_BAND_1';
            isRetestingBand1 = true;
          }
        } else if (direction === 'SHORT') {
          const distToL1 = Math.abs(price - l1);
          const distToMid = Math.abs(price - sessionVwap.vwap);
          if (distToL1 <= (0.25 * sigma) || distToMid <= (0.25 * sigma)) {
            bandPosition = 'RETEST_BAND_1';
            isRetestingBand1 = true;
          }
        }
      }
    }

    return {
      sessionVwap,
      weeklyVwap,
      monthlyVwap,
      alignment,
      bandPosition,
      isRetestingBand1,
      isExhaustedBand2,
      isClimaxBand3,
      warning
    };
  }
}
