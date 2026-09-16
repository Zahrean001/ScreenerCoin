// ============================================================
// Relative Strength / Relative Weakness Engine
// ============================================================

import { RelativeStrengthResult } from '../data/types.js';
import { NumericRingBuffer, TimestampedPriceRingBuffer } from '../data/circular-buffer.js';
import { pctChange } from '../utils/math.js';

export class RelativeStrengthEngine {
  /**
   * Computes genuine Relative Strength / Weakness vs BTC, ETH, Sector Basket, and Universe Basket.
   */
  compute(
    symbol: string,
    symbolPriceHistory: TimestampedPriceRingBuffer | NumericRingBuffer,
    btcPriceHistory: TimestampedPriceRingBuffer | NumericRingBuffer,
    ethPriceHistory: TimestampedPriceRingBuffer | NumericRingBuffer,
    sectorReturn: number | null,
    universeReturn: number | null,
    windowMs: number = 300_000 // default 5m
  ): RelativeStrengthResult {
    let symbolReturn: number | null = null;
    let btcReturn: number | null = null;
    let ethReturn: number | null = null;

    // Calculate symbol return
    if (symbolPriceHistory instanceof TimestampedPriceRingBuffer) {
      symbolReturn = symbolPriceHistory.getReturnOverWindow(windowMs).value;
    } else {
      const curr = symbolPriceHistory.latest();
      const base = symbolPriceHistory.at(0);
      if (Number.isFinite(curr) && Number.isFinite(base) && base > 0) {
        symbolReturn = pctChange(curr, base);
      }
    }

    // Calculate BTC return
    if (btcPriceHistory instanceof TimestampedPriceRingBuffer) {
      btcReturn = btcPriceHistory.getReturnOverWindow(windowMs).value;
    } else {
      const curr = btcPriceHistory.latest();
      const base = btcPriceHistory.at(0);
      if (Number.isFinite(curr) && Number.isFinite(base) && base > 0) {
        btcReturn = pctChange(curr, base);
      }
    }

    // Calculate ETH return
    if (ethPriceHistory instanceof TimestampedPriceRingBuffer) {
      ethReturn = ethPriceHistory.getReturnOverWindow(windowMs).value;
    } else {
      const curr = ethPriceHistory.latest();
      const base = ethPriceHistory.at(0);
      if (Number.isFinite(curr) && Number.isFinite(base) && base > 0) {
        ethReturn = pctChange(curr, base);
      }
    }

    if (symbolReturn === null) {
      return {
        vsBTC: null,
        vsETH: null,
        vsSector: null,
        vsUniverse: null,
        longScore: 0,
        shortScore: 0,
        availableWeight: 0,
        dataCompleteness: 0
      };
    }

    const vsBTC = (btcReturn !== null) ? (symbolReturn - btcReturn) : null;
    const vsETH = (ethReturn !== null) ? (symbolReturn - ethReturn) : null;
    const vsSector = (sectorReturn !== null) ? (symbolReturn - sectorReturn) : null;
    const vsUniverse = (universeReturn !== null) ? (symbolReturn - universeReturn) : null;

    let longScoreRaw = 0;
    let shortScoreRaw = 0;
    let availableWeight = 0;

    // 1. Comparison vs BTC (Max Weight: 6)
    if (vsBTC !== null) {
      availableWeight += 6;
      if (vsBTC >= 0.04) longScoreRaw += 6;
      else if (vsBTC >= 0.02) longScoreRaw += 4.5;
      else if (vsBTC >= 0.005) longScoreRaw += 3;
      else if (vsBTC > 0) longScoreRaw += 1.5;

      if (vsBTC <= -0.04) shortScoreRaw += 6;
      else if (vsBTC <= -0.02) shortScoreRaw += 4.5;
      else if (vsBTC <= -0.005) shortScoreRaw += 3;
      else if (vsBTC < 0) shortScoreRaw += 1.5;
    }

    // 2. Comparison vs ETH (Max Weight: 4)
    if (vsETH !== null) {
      availableWeight += 4;
      if (vsETH >= 0.04) longScoreRaw += 4;
      else if (vsETH >= 0.02) longScoreRaw += 3;
      else if (vsETH >= 0.005) longScoreRaw += 2;
      else if (vsETH > 0) longScoreRaw += 1;

      if (vsETH <= -0.04) shortScoreRaw += 4;
      else if (vsETH <= -0.02) shortScoreRaw += 3;
      else if (vsETH <= -0.005) shortScoreRaw += 2;
      else if (vsETH < 0) shortScoreRaw += 1;
    }

    // 3. Comparison vs Sector Basket (Max Weight: 3) — null if unmapped!
    if (vsSector !== null) {
      availableWeight += 3;
      if (vsSector >= 0.03) longScoreRaw += 3;
      else if (vsSector >= 0.01) longScoreRaw += 2;
      else if (vsSector > 0) longScoreRaw += 1;

      if (vsSector <= -0.03) shortScoreRaw += 3;
      else if (vsSector <= -0.01) shortScoreRaw += 2;
      else if (vsSector < 0) shortScoreRaw += 1;
    }

    // 4. Comparison vs Universe Basket (Max Weight: 2)
    if (vsUniverse !== null) {
      availableWeight += 2;
      if (vsUniverse >= 0.03) longScoreRaw += 2;
      else if (vsUniverse >= 0.01) longScoreRaw += 1.5;
      else if (vsUniverse > 0) longScoreRaw += 0.5;

      if (vsUniverse <= -0.03) shortScoreRaw += 2;
      else if (vsUniverse <= -0.01) shortScoreRaw += 1.5;
      else if (vsUniverse < 0) shortScoreRaw += 0.5;
    }

    // Normalized to 15-point scale based on observed metrics
    const longScore = availableWeight > 0 ? Math.min(15, (longScoreRaw / availableWeight) * 15) : 0;
    const shortScore = availableWeight > 0 ? Math.min(15, (shortScoreRaw / availableWeight) * 15) : 0;
    const dataCompleteness = availableWeight / 15;

    return {
      vsBTC: vsBTC !== null ? vsBTC * 100 : null,
      vsETH: vsETH !== null ? vsETH * 100 : null,
      vsSector: vsSector !== null ? vsSector * 100 : null,
      vsUniverse: vsUniverse !== null ? vsUniverse * 100 : null,
      longScore,
      shortScore,
      availableWeight,
      dataCompleteness
    };
  }
}
