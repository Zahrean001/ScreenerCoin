// ============================================================
// Data Freshness & SLA Calculator — Strict Zero-False-Freshness
// ============================================================

import { DataFreshness } from '../data/types.js';

export interface FreshnessThresholds {
  tickerMaxAgeMs: number;     // e.g. 15,000 ms
  orderbookMaxAgeMs: number;  // e.g. 5,000 ms
  tradeMaxAgeMs: number;      // e.g. 10,000 ms
  candleMaxAgeMultiplier: number; // e.g. 2.0x timeframe duration
}

export const DEFAULT_FRESHNESS_THRESHOLDS: FreshnessThresholds = {
  tickerMaxAgeMs: 20_000,
  orderbookMaxAgeMs: 8_000,
  tradeMaxAgeMs: 15_000,
  candleMaxAgeMultiplier: 2.0
};

/**
 * Compute standardized DataFreshness metadata.
 * Strictly respects missing timestamps (no fake Date.now() generation).
 */
export function computeFreshness(
  sourceTimestamp: number | null | undefined,
  receivedAt: number = Date.now(),
  maxAgeMs: number = 20_000,
  isConfirmed?: boolean
): DataFreshness {
  // If source timestamp is missing or non-positive, data cannot be verified fresh
  if (!sourceTimestamp || sourceTimestamp <= 0 || !Number.isFinite(sourceTimestamp)) {
    return {
      sourceTimestamp: null,
      receivedAt,
      ageMs: -1,
      isStale: true,
      isConfirmed: isConfirmed ?? false,
      status: 'TIMESTAMP_UNAVAILABLE'
    };
  }

  const ageMs = Math.max(0, receivedAt - sourceTimestamp);
  const isStale = ageMs > maxAgeMs;

  return {
    sourceTimestamp,
    receivedAt,
    ageMs,
    isStale,
    isConfirmed: isConfirmed ?? true,
    status: isStale ? 'STALE' : 'FRESH'
  };
}

/**
 * Checks whether candle history is sufficiently fresh.
 * A 15m closed candle is stale if its close time is older than 2x timeframe (30m).
 */
export function computeCandleFreshness(
  lastCandleTimestamp: number | null | undefined,
  timeframeMinutes: number,
  isClosed: boolean,
  receivedAt: number = Date.now(),
  maxMultiplier: number = 2.0
): DataFreshness {
  if (!lastCandleTimestamp || lastCandleTimestamp <= 0) {
    return {
      sourceTimestamp: null,
      receivedAt,
      ageMs: -1,
      isStale: true,
      isConfirmed: false,
      status: 'TIMESTAMP_UNAVAILABLE'
    };
  }

  const timeframeMs = timeframeMinutes * 60_000;
  // Candle close time = start timestamp + duration
  const candleCloseTimestamp = lastCandleTimestamp + timeframeMs;
  const ageMs = Math.max(0, receivedAt - candleCloseTimestamp);
  const maxAllowedAgeMs = timeframeMs * maxMultiplier;
  const isStale = ageMs > maxAllowedAgeMs;

  return {
    sourceTimestamp: candleCloseTimestamp,
    receivedAt,
    ageMs,
    isStale,
    isConfirmed: isClosed,
    status: isStale ? 'STALE' : 'FRESH'
  };
}
