// ============================================================
// Math Utilities — Statistical helpers for the screener
// ============================================================

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Linear interpolation */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Map a value from one range to another */
export function mapRange(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return outMin;
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/** Calculate percentage change */
export function pctChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return (current - previous) / previous;
}

/** Calculate basis points spread */
export function spreadBps(bid: number, ask: number): number {
  if (bid === 0 || ask === 0) return Infinity;
  const mid = (bid + ask) / 2;
  return ((ask - bid) / mid) * 10000;
}

/** Calculate simple moving average from array */
export function sma(values: number[]): number {
  if (values.length === 0) return NaN;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

/** Standard deviation */
export function stdDev(values: number[], mean?: number): number {
  if (values.length < 2) return 0;
  const avg = mean ?? sma(values);
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    const diff = values[i] - avg;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / values.length);
}

/** Calculate percentile rank of a value within a sorted array */
export function percentileRank(sortedValues: number[], value: number): number {
  if (sortedValues.length === 0) return 50;
  let count = 0;
  for (let i = 0; i < sortedValues.length; i++) {
    if (sortedValues[i] <= value) count++;
    else break;
  }
  return (count / sortedValues.length) * 100;
}

/** True Range calculation */
export function trueRange(high: number, low: number, prevClose: number): number {
  return Math.max(
    high - low,
    Math.abs(high - prevClose),
    Math.abs(low - prevClose)
  );
}

/** Normalize a score to 0-maxScore range */
export function normalizeScore(value: number, min: number, max: number, maxScore: number): number {
  if (max === min) return maxScore / 2;
  const normalized = clamp((value - min) / (max - min), 0, 1);
  return normalized * maxScore;
}

/** Inverse normalize — higher input value = lower score */
export function inverseNormalizeScore(value: number, min: number, max: number, maxScore: number): number {
  if (max === min) return maxScore / 2;
  const normalized = clamp(1 - (value - min) / (max - min), 0, 1);
  return normalized * maxScore;
}

/** Score based on thresholds: below bad, between ok, above good */
export function thresholdScore(value: number, bad: number, ok: number, good: number, maxScore: number): number {
  if (value >= good) return maxScore;
  if (value >= ok) return maxScore * 0.7;
  if (value >= bad) return maxScore * 0.4;
  return maxScore * 0.1;
}

/** Weighted average */
export function weightedAvg(values: number[], weights: number[]): number {
  let sum = 0;
  let wSum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] * weights[i];
    wSum += weights[i];
  }
  return wSum === 0 ? 0 : sum / wSum;
}

/** EMA-like decay for time-weighted values */
export function decayWeight(ageMs: number, halfLifeMs: number): number {
  return Math.exp(-0.693 * ageMs / halfLifeMs);
}

/** Compute Pearson correlation between two arrays */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denominator === 0) return 0;
  return clamp(numerator / denominator, -1, 1);
}

/** Round to N decimal places */
export function round(value: number, decimals: number = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Format number with K/M/B suffix */
export function formatCompact(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(1);
}
