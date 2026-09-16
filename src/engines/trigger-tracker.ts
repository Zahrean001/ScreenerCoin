// ============================================================
// Phase 5: Persistent Event-First Trigger & Confirmation Tracker
// Tracks structural consolidation ranges, identifies true breakout/down events,
// separates trigger time from confirmation time, strictly invalidates stale/broken
// triggers, and NEVER invents fake triggers when none exist.
// ============================================================

import {
  CandleData,
  Direction,
  Timeframe,
  TriggerState,
  TimingWindow,
  EntryStatus,
  TriggerConfirmationStatus
} from '../data/types.js';

export interface TriggerAnalysisResult {
  triggerState?: TriggerState;
  timingWindow: TimingWindow;
  entryStatus: EntryStatus;
  elapsedSecondsSinceTrigger: number;
  secondsSinceTrigger: number;
  confirmationTimestamp?: number;
  secondsSinceConfirmation?: number;
  barsSinceTrigger: number;
  distanceFromTriggerPct: number;
  distanceFromTriggerATR: number;
  preTriggerCompressionScore: number; // 0 - 100
  isBreakoutConfirmed: boolean;
  triggerFound: boolean;
}

export class TriggerTracker {
  // Maximum age for a valid trigger before it is declared stale (45 minutes = 2700s)
  public static readonly MAX_TRIGGER_AGE_MS = 2700_000;

  // In-memory persistent trigger state per symbol
  private triggerStore: Map<string, TriggerState> = new Map();

  /**
   * Evaluates or retrieves the structural trigger for a given symbol.
   */
  public evaluateTrigger(
    symbol: string,
    candles5m: CandleData[],
    candles15m: CandleData[],
    lastPrice: number,
    direction: Direction,
    effectiveAtr: number,
    currentTimestamp: number = Date.now()
  ): TriggerAnalysisResult {
    // Prefer 5m candles for precise timing, fallback to 15m
    const candles = candles5m.length >= 10 ? candles5m : candles15m;
    const tf: Timeframe = candles5m.length >= 10 ? '5' : '15';
    const safeAtr = effectiveAtr > 0 ? effectiveAtr : (lastPrice * 0.015);

    let stored = this.triggerStore.get(symbol);

    // ============================================================
    // Trigger Invalidation Checks
    // ============================================================
    if (stored) {
      const ageMs = currentTimestamp - stored.triggerTimestamp;

      // 1. Max Age Invalidation: > 2 hours (7200s) fully purge.
      // Between 45m and 2h, keep stored so that timingWindow is LATE and elapsedSeconds is accurate!
      if (ageMs > 7200_000) {
        this.triggerStore.delete(symbol);
        stored = undefined;
      }
      // 2. Direction Invalidation
      else if (stored.direction !== direction) {
        this.triggerStore.delete(symbol);
        stored = undefined;
      }
      // 3. Structural Breakdown/Failure Invalidation
      else if (stored.direction === 'LONG') {
        // Price dropped deeply back inside the range or broke support
        if (lastPrice < stored.preTriggerRangeLow || lastPrice < (stored.triggerPrice - (0.6 * safeAtr))) {
          this.triggerStore.delete(symbol);
          stored = undefined;
        }
      } else if (stored.direction === 'SHORT') {
        // Price rallied back above range high or resistance
        if (lastPrice > stored.preTriggerRangeHigh || lastPrice > (stored.triggerPrice + (0.6 * safeAtr))) {
          this.triggerStore.delete(symbol);
          stored = undefined;
        }
      }
    }

    // ============================================================
    // Detect Structural Trigger if none actively stored
    // ============================================================
    if (!stored) {
      const detected = this.detectTriggerEvent(candles, lastPrice, direction, tf, currentTimestamp, safeAtr);
      if (detected) {
        stored = detected;
        this.triggerStore.set(symbol, stored);
      }
    }

    // ============================================================
    // RULE 3: NEVER INVENT A CURRENT TRIGGER
    // If no real trigger exists, return triggerFound = false, PRE_TRIGGER, WAITING
    // DO NOT set triggerTimestamp = currentTimestamp!
    // ============================================================
    if (!stored) {
      const consolidation = this.measureConsolidationRange(candles, Math.min(15, candles.length));
      const fallbackHigh = consolidation.high > 0 ? consolidation.high : lastPrice;
      const fallbackLow = consolidation.low > 0 ? consolidation.low : lastPrice;
      const distPct = direction === 'LONG' 
        ? (lastPrice - fallbackHigh) / fallbackHigh 
        : (fallbackLow - lastPrice) / fallbackLow;
      const distAtr = direction === 'LONG'
        ? (lastPrice - fallbackHigh) / safeAtr
        : (fallbackLow - lastPrice) / safeAtr;

      return {
        triggerState: undefined,
        timingWindow: 'PRE_TRIGGER',
        entryStatus: 'WAITING',
        elapsedSecondsSinceTrigger: 0,
        secondsSinceTrigger: 0,
        confirmationTimestamp: undefined,
        secondsSinceConfirmation: undefined,
        barsSinceTrigger: 0,
        distanceFromTriggerPct: Number((distPct * 100).toFixed(2)),
        distanceFromTriggerATR: Number(distAtr.toFixed(2)),
        preTriggerCompressionScore: consolidation.compressionScore,
        isBreakoutConfirmed: false,
        triggerFound: false
      };
    }

    // ============================================================
    // Evaluate Timing & Dual Timestamps for Valid Stored Trigger
    // ============================================================
    const elapsedSecondsSinceTrigger = Math.max(0, Math.round((currentTimestamp - stored.triggerTimestamp) / 1000));
    
    // Find how many bars have elapsed since triggerTimestamp
    let barsSince = 0;
    for (let i = candles.length - 1; i >= 0; i--) {
      if (candles[i].timestamp <= stored.triggerTimestamp) {
        barsSince = (candles.length - 1) - i;
        break;
      }
    }

    // Distance calculations from true trigger origin
    let distPct = 0;
    let distAtr = 0;

    if (stored.direction === 'LONG') {
      distPct = (lastPrice - stored.triggerPrice) / stored.triggerPrice;
      distAtr = Math.max(0, (lastPrice - stored.triggerPrice) / safeAtr);
    } else {
      distPct = (stored.triggerPrice - lastPrice) / stored.triggerPrice;
      distAtr = Math.max(0, (stored.triggerPrice - lastPrice) / safeAtr);
    }

    // Confirmation evaluation (explicit, independent of distance)
    const isBreakoutConfirmed = stored.confirmationStatus === 'CONFIRMED';
    const secondsSinceConfirmation = stored.confirmationTimestamp
      ? Math.max(0, Math.round((currentTimestamp - stored.confirmationTimestamp) / 1000))
      : undefined;

    // Pre-trigger compression score (measured strictly BEFORE trigger bar)
    const preTriggerCompressionScore = stored.preTriggerCompressionScore ?? this.calculatePreTriggerCompression(candles, stored.triggerTimestamp);

    // Determine Timing Window
    const timingWindow = this.determineTimingWindow(
      barsSince,
      elapsedSecondsSinceTrigger,
      distAtr,
      stored.confirmationStatus
    );

    // Determine Entry Status
    let entryStatus: EntryStatus = 'WAITING';
    if (elapsedSecondsSinceTrigger > 2700) {
      entryStatus = 'WAIT_PULLBACK';
    } else if (!isBreakoutConfirmed) {
      entryStatus = 'TRIGGERED';
    } else if (distAtr >= 3.5 || timingWindow === 'EXHAUSTED' || timingWindow === 'LATE') {
      entryStatus = 'TOO_LATE';
    } else if (distAtr > 1.8 || (secondsSinceConfirmation !== undefined && secondsSinceConfirmation > 600)) {
      entryStatus = 'WAIT_PULLBACK';
    } else if (distAtr <= 1.5 && (secondsSinceConfirmation === undefined || secondsSinceConfirmation <= 360)) {
      entryStatus = 'ACTIONABLE_NOW';
    } else {
      entryStatus = 'WAIT_PULLBACK';
    }

    return {
      triggerState: stored,
      timingWindow,
      entryStatus,
      elapsedSecondsSinceTrigger,
      secondsSinceTrigger: elapsedSecondsSinceTrigger,
      confirmationTimestamp: stored.confirmationTimestamp,
      secondsSinceConfirmation,
      barsSinceTrigger: barsSince,
      distanceFromTriggerPct: Number((distPct * 100).toFixed(2)),
      distanceFromTriggerATR: Number(distAtr.toFixed(2)),
      preTriggerCompressionScore,
      isBreakoutConfirmed,
      triggerFound: true
    };
  }

  /**
   * Detects the MOST RECENT valid structural trigger event from candle history.
   * Maintains activeTrigger origin across impulse expansion bars, and updates to a new
   * trigger only if the previous one failed or a new consolidation base formed.
   */
  private detectTriggerEvent(
    candles: CandleData[],
    lastPrice: number,
    direction: Direction,
    tf: Timeframe,
    currentTimestamp: number,
    safeAtr: number
  ): TriggerState | null {
    if (candles.length < 2) return null;

    const lookback = Math.min(25, candles.length);
    const window = candles.slice(-lookback);

    let activeTrigger: TriggerState | null = null;
    const avgVol = window.reduce((sum, c) => sum + c.volume, 0) / window.length;

    for (let i = 1; i < window.length; i++) {
      const candle = window[i];
      const candleRange = Math.max(0.00001, candle.high - candle.low);
      const volRatio = avgVol > 0 ? candle.volume / avgVol : 1.0;

      if (direction === 'LONG') {
        // If an active trigger exists, check if it was invalidated by a failure back into range
        if (activeTrigger) {
          if (candle.close < activeTrigger.preTriggerRangeLow || candle.close < (activeTrigger.triggerPrice - (0.6 * safeAtr))) {
            // Breakout #1 failed! Structure reset.
            activeTrigger = null;
          } else {
            // Move is continuing from activeTrigger origin!
            // Upgrade confirmation if previously unconfirmed and this bar confirms
            if (activeTrigger.confirmationStatus === 'UNCONFIRMED' && candle.close >= activeTrigger.triggerPrice) {
              activeTrigger.confirmationStatus = 'CONFIRMED';
              activeTrigger.confirmationTimestamp = candle.timestamp;
            }
            continue;
          }
        }

        // Search for breakout from prior consolidation base
        const priorRange = window.slice(Math.max(0, i - 12), i);
        if (priorRange.length < 1) continue;

        const rangeHigh = Math.max(...priorRange.map(c => Math.max(c.open, c.close)));
        const rangeLow = Math.min(...priorRange.map(c => Math.min(c.open, c.close)));
        const rangeWickHigh = Math.max(...priorRange.map(c => c.high));
        const rangeWickLow = Math.min(...priorRange.map(c => c.low));

        const avgClose = priorRange.reduce((sum, c) => sum + c.close, 0) / priorRange.length;
        const rangePct = avgClose > 0 ? (rangeWickHigh - rangeWickLow) / avgClose : 0.05;

        // If prior range had >= 3 candles and was overextended (> 4%), skip
        if (priorRange.length >= 3 && rangePct > 0.04) continue;

        // Bullish Breakout: Candle closed above prior consolidation range boundary
        if (candle.close > rangeHigh && (candle.close >= rangeWickHigh || candle.high > rangeWickHigh)) {
          const triggerPrice = rangeWickHigh;
          const closePositionInBar = (candle.close - candle.low) / candleRange;
          const isConfirmed = candle.close >= triggerPrice && (volRatio >= 1.2 || closePositionInBar >= 0.60);
          const compressionScore = this.calculatePreTriggerCompression(candles, candle.timestamp);

          activeTrigger = {
            symbol: '',
            direction: 'LONG',
            triggerPrice,
            triggerTimestamp: candle.timestamp,
            confirmationTimestamp: isConfirmed ? candle.timestamp : undefined,
            triggerTimeframe: tf,
            triggerType: 'CONSOLIDATION_RESISTANCE_BREAK',
            preTriggerRangeHigh: rangeWickHigh,
            preTriggerRangeLow: rangeWickLow,
            preTriggerDurationBars: priorRange.length,
            preTriggerDurationSeconds: priorRange.length * (tf === '5' ? 300 : 900),
            preTriggerCompressionScore: compressionScore,
            breakoutDistance: (candle.close - triggerPrice) / triggerPrice,
            breakoutVolumeRatio: Number(volRatio.toFixed(2)),
            breakoutOIChange: 0.02,
            confirmationStatus: isConfirmed ? 'CONFIRMED' : 'UNCONFIRMED'
          };
        }
      } else if (direction === 'SHORT') {
        if (activeTrigger) {
          if (candle.close > activeTrigger.preTriggerRangeHigh || candle.close > (activeTrigger.triggerPrice + (0.6 * safeAtr))) {
            // Breakdown #1 failed! Structure reset.
            activeTrigger = null;
          } else {
            // Move continuing from activeTrigger origin
            // Upgrade confirmation if previously unconfirmed and this bar confirms
            if (activeTrigger.confirmationStatus === 'UNCONFIRMED' && candle.close <= activeTrigger.triggerPrice) {
              activeTrigger.confirmationStatus = 'CONFIRMED';
              activeTrigger.confirmationTimestamp = candle.timestamp;
            }
            continue;
          }
        }

        const priorRange = window.slice(Math.max(0, i - 12), i);
        if (priorRange.length < 1) continue;

        const rangeHigh = Math.max(...priorRange.map(c => Math.max(c.open, c.close)));
        const rangeLow = Math.min(...priorRange.map(c => Math.min(c.open, c.close)));
        const rangeWickHigh = Math.max(...priorRange.map(c => c.high));
        const rangeWickLow = Math.min(...priorRange.map(c => c.low));

        const avgClose = priorRange.reduce((sum, c) => sum + c.close, 0) / priorRange.length;
        const rangePct = avgClose > 0 ? (rangeWickHigh - rangeWickLow) / avgClose : 0.05;

        if (priorRange.length >= 3 && rangePct > 0.04) continue;

        // Bearish Breakdown
        if (candle.close < rangeLow && (candle.close <= rangeWickLow || candle.low < rangeWickLow)) {
          const triggerPrice = rangeWickLow;
          const closePositionInBar = (candle.high - candle.close) / candleRange;
          const isConfirmed = candle.close <= triggerPrice && (volRatio >= 1.2 || closePositionInBar >= 0.60);
          const compressionScore = this.calculatePreTriggerCompression(candles, candle.timestamp);

          activeTrigger = {
            symbol: '',
            direction: 'SHORT',
            triggerPrice,
            triggerTimestamp: candle.timestamp,
            confirmationTimestamp: isConfirmed ? candle.timestamp : undefined,
            triggerTimeframe: tf,
            triggerType: 'CONSOLIDATION_SUPPORT_BREAK',
            preTriggerRangeHigh: rangeWickHigh,
            preTriggerRangeLow: rangeWickLow,
            preTriggerDurationBars: priorRange.length,
            preTriggerDurationSeconds: priorRange.length * (tf === '5' ? 300 : 900),
            preTriggerCompressionScore: compressionScore,
            breakoutDistance: (triggerPrice - candle.close) / triggerPrice,
            breakoutVolumeRatio: Number(volRatio.toFixed(2)),
            breakoutOIChange: 0.02,
            confirmationStatus: isConfirmed ? 'CONFIRMED' : 'UNCONFIRMED'
          };
        }
      }
    }

    if (!activeTrigger) return null;

    // Check if current lastPrice invalidated it
    if (direction === 'LONG' && lastPrice < (activeTrigger.triggerPrice - (0.6 * safeAtr))) {
      return null;
    }
    if (direction === 'SHORT' && lastPrice > (activeTrigger.triggerPrice + (0.6 * safeAtr))) {
      return null;
    }

    return activeTrigger;
  }

  /**
   * Pre-Trigger Compression Score (0–100):
   * Strictly evaluates volatility compression in the 5–12 candles BEFORE the trigger.
   */
  private calculatePreTriggerCompression(candles: CandleData[], triggerTimestamp: number): number {
    const priorCandles = candles.filter(c => c.timestamp < triggerTimestamp);
    if (priorCandles.length < 5) return 50;

    const slice = priorCandles.slice(-12);
    const maxHigh = Math.max(...slice.map(c => c.high));
    const minLow = Math.min(...slice.map(c => c.low));
    const avgClose = slice.reduce((sum, c) => sum + c.close, 0) / slice.length;

    if (avgClose <= 0) return 50;

    const rangePct = (maxHigh - minLow) / avgClose;

    if (rangePct < 0.015) return 95;  // < 1.5% range -> massive squeeze
    if (rangePct < 0.025) return 85;  // < 2.5% range -> strong compression
    if (rangePct < 0.040) return 70;  // < 4.0% range -> moderate compression
    if (rangePct < 0.060) return 50;  // < 6.0% range -> normal
    return 30; // loose range, poor compression
  }

  /**
   * Measures current consolidation range if no breakout has occurred yet.
   */
  private measureConsolidationRange(candles: CandleData[], count: number): { high: number; low: number; compressionScore: number } {
    if (candles.length === 0) {
      return { high: 0, low: 0, compressionScore: 50 };
    }
    const subset = candles.slice(-count);
    const high = Math.max(...subset.map(c => c.high));
    const low = Math.min(...subset.map(c => c.low));
    const avg = subset.reduce((sum, c) => sum + c.close, 0) / subset.length;
    const rangePct = avg > 0 ? (high - low) / avg : 0.05;

    let compressionScore = 50;
    if (rangePct < 0.02) compressionScore = 90;
    else if (rangePct < 0.035) compressionScore = 75;
    else if (rangePct < 0.05) compressionScore = 60;
    else compressionScore = 40;

    return { high, low, compressionScore };
  }

  /**
   * Determines Timing Window based on trigger age, bars elapsed, and ATR extension.
   */
  private determineTimingWindow(
    barsSince: number,
    elapsedSeconds: number,
    distAtr: number,
    status: TriggerConfirmationStatus
  ): TimingWindow {
    if (status === 'UNCONFIRMED' && distAtr < 0.3) {
      return 'TRIGGERING';
    }

    // FRESH: 0–1 bars, or elapsed time < 300s (5m), and ATR distance <= 1.2
    if ((barsSince <= 1 || elapsedSeconds <= 300) && distAtr <= 1.2) {
      return 'FRESH';
    }

    // DEVELOPING: 1–3 bars, ATR distance 1.2 - 2.2
    if (barsSince <= 3 && distAtr <= 2.2) {
      return 'DEVELOPING';
    }

    // MATURE: 3–6 bars, ATR distance 2.2 - 3.5
    if (barsSince <= 6 && distAtr <= 3.5) {
      return 'MATURE';
    }

    // EXHAUSTED: distAtr > 4.5
    if (distAtr >= 4.5) {
      return 'EXHAUSTED';
    }

    // LATE: > 6 bars or distAtr > 3.5
    return 'LATE';
  }

  /**
   * Resets stored triggers (for test isolation).
   */
  public clear(): void {
    this.triggerStore.clear();
  }
}
