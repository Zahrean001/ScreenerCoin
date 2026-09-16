// ============================================================
// Phase 4: Market Phase, Early Momentum, & Timing Engine
// Features: Pre-trigger compression, directional momentum,
// trigger tracker integration, setup state machine, extension score,
// remaining move score, pullback setups, and actionability score.
// ============================================================

import {
  CandleData,
  TickerData,
  IndicatorState,
  VolatilityState,
  OIFundingAnalysis,
  RelativeStrengthResult,
  MarketPhase,
  PhaseClassification,
  MoveMaturity,
  SignalCategory,
  LiquiditySweepType,
  TimingAnalysis,
  Direction,
  SetupState,
  TimingWindow,
  EntryStatus,
  DiscoveryLane,
  DiscoveryLabel,
  EntryPotential,
  MTFConfluenceType,
  OrderbookSnapshot
} from '../data/types.js';
import { CircularBuffer } from '../data/circular-buffer.js';
import { TriggerTracker, TriggerAnalysisResult } from './trigger-tracker.js';
import { SetupStateMachine } from './setup-state-machine.js';
import { AnchoredVWAPEngine } from '../indicators/anchored-vwap.js';

export class TimingEngine {
  private triggerTracker = new TriggerTracker();
  private stateMachine = new SetupStateMachine();

  /**
   * Comprehensive timing analysis evaluating setup state, true structural triggers,
   * directional momentum ignition, extension, remaining move, and actionability.
   */
  public analyze(
    ticker: TickerData,
    indicators: IndicatorState,
    volatility: VolatilityState,
    candles5m: CircularBuffer<CandleData> | undefined,
    candles15m: CircularBuffer<CandleData> | undefined,
    candles1h: CircularBuffer<CandleData> | undefined,
    oiFunding: OIFundingAnalysis,
    rsResult: RelativeStrengthResult,
    direction: Direction,
    opportunityScore: number,
    priceChange5m?: number | null,
    priceChange1h?: number | null,
    discoveryLane?: DiscoveryLane,
    orderbook: OrderbookSnapshot | null = null,
    isDecoupledAlpha: boolean = false,
    mtfConfluenceType: MTFConfluenceType = 'MULTI_TIMEFRAME_ALIGNMENT'
  ): TimingAnalysis {
    const c5Array = candles5m ? candles5m.toArray() : [];
    const c15Array = candles15m ? candles15m.toArray() : [];
    const c1hArray = candles1h ? candles1h.toArray() : [];
    const lastPrice = ticker.lastPrice;

    // 1. Effective ATR calculation
    const atr15 = indicators.atr14['15'] ?? indicators.atr14['60'] ?? (lastPrice * 0.015);
    const effectiveAtr = atr15 > 0 ? atr15 : lastPrice * 0.015;

    // 2. Persistent Structural Trigger Analysis (Phase 4 TriggerTracker)
    const triggerAnalysis: TriggerAnalysisResult = this.triggerTracker.evaluateTrigger(
      ticker.symbol,
      c5Array,
      c15Array,
      lastPrice,
      direction,
      effectiveAtr,
      ticker.timestamp
    );

    const {
      triggerState,
      timingWindow,
      elapsedSecondsSinceTrigger,
      barsSinceTrigger,
      distanceFromTriggerPct,
      distanceFromTriggerATR,
      preTriggerCompressionScore
    } = triggerAnalysis;

    // 3. Liquidity Sweep & Manipulation Detection
    const sweepType = this.detectLiquiditySweep(c15Array, ticker, oiFunding);

    // 4. Setup State Machine (Phase 4 Setup Lifecycle)
    const stateMachineResult = this.stateMachine.evaluateState(
      c5Array,
      c15Array,
      indicators,
      oiFunding,
      rsResult,
      triggerAnalysis,
      sweepType,
      direction,
      priceChange5m,
      priceChange1h
    );

    // 5. Market Phase Classification (Multi-dimensional & Contextual)
    const phase = this.classifyMarketPhase(
      ticker,
      indicators,
      volatility,
      c15Array,
      c1hArray,
      oiFunding,
      rsResult,
      sweepType,
      distanceFromTriggerATR,
      priceChange1h
    );

    // 6. Direction-Aware Momentum Ignition Score (0–100)
    const momentumIgnitionScore = this.calculateMomentumIgnition(
      direction,
      indicators,
      c15Array,
      oiFunding,
      distanceFromTriggerATR,
      preTriggerCompressionScore,
      timingWindow,
      priceChange5m
    );

    // 7. Momentum Strength Score (0–100) (Separated from Ignition!)
    const momentumStrengthScore = this.calculateMomentumStrength(
      direction,
      indicators,
      priceChange1h
    );

    // 8. Momentum Deceleration Detection
    const momentumDecelerationScore = this.calculateMomentumDeceleration(
      ticker,
      indicators,
      c15Array,
      direction,
      priceChange5m,
      priceChange1h
    );

    // 9. Move Extension Score (0–100)
    const extensionScore = this.calculateExtensionScore(
      distanceFromTriggerATR,
      distanceFromTriggerPct,
      c15Array,
      direction,
      priceChange1h,
      priceChange5m
    );

    // 10. Remaining Move / Risk-Reward Score (0–100)
    const remainingMoveScore = this.calculateRemainingMoveScore(
      c15Array,
      c1hArray,
      lastPrice,
      direction,
      effectiveAtr
    );

    // 11. Distribution Risk & Accumulation Risk
    const distributionRisk = this.calculateDistributionRisk(
      ticker,
      indicators,
      c15Array,
      oiFunding,
      rsResult,
      distanceFromTriggerATR,
      momentumDecelerationScore,
      priceChange1h
    );

    const accumulationRisk = this.calculateAccumulationRisk(
      ticker,
      indicators,
      c15Array,
      oiFunding,
      rsResult,
      distanceFromTriggerATR,
      momentumDecelerationScore,
      priceChange1h
    );

    // 12. Chase Risk Score & Anti-Chase Evaluation
    const chaseResult = this.calculateChaseRisk(
      ticker,
      indicators,
      c15Array,
      direction,
      distanceFromTriggerPct,
      distanceFromTriggerATR,
      barsSinceTrigger,
      momentumDecelerationScore,
      distributionRisk,
      accumulationRisk,
      oiFunding,
      priceChange5m,
      priceChange1h
    );
    let chaseRiskScore = chaseResult.chaseRiskScore;
    const antiChaseReasons = chaseResult.antiChaseReasons;

    // 13. Move Maturity Classification
    const { moveMaturity, moveMaturityScore } = this.classifyMoveMaturity(
      distanceFromTriggerATR,
      barsSinceTrigger,
      chaseRiskScore,
      momentumDecelerationScore,
      distributionRisk,
      timingWindow
    );

    // 14. Signal Freshness (Decays as bars/seconds pass)
    const signalFreshness = this.calculateSignalFreshness(
      elapsedSecondsSinceTrigger,
      barsSinceTrigger,
      momentumIgnitionScore,
      distanceFromTriggerATR
    );

    // 15. Pullback Setup Detection
    const isPullback = this.detectPullbackSetup(
      indicators,
      c15Array,
      lastPrice,
      direction,
      distanceFromTriggerATR,
      opportunityScore,
      timingWindow,
      barsSinceTrigger
    );

    // 16. Actionability Score (0–100)
    let actionabilityScore = this.calculateActionabilityScore(
      opportunityScore,
      momentumIgnitionScore,
      signalFreshness,
      remainingMoveScore,
      indicators,
      extensionScore,
      chaseRiskScore,
      distributionRisk,
      accumulationRisk,
      direction
    );

    // 17. Timing Score
    const timingScore = Math.round((momentumIgnitionScore * 0.40) + (signalFreshness * 0.35) + (remainingMoveScore * 0.25));

    // 18. Decision Matrix -> Signal Category, Entry Status & Decision Tag
    let { signalCategory, decision, entryStatus } = this.resolveDecisionMatrix(
      direction,
      opportunityScore,
      actionabilityScore,
      timingScore,
      phase,
      stateMachineResult.state,
      timingWindow,
      moveMaturity,
      chaseRiskScore,
      distributionRisk,
      accumulationRisk,
      antiChaseReasons,
      distanceFromTriggerATR,
      distanceFromTriggerPct,
      isPullback,
      triggerAnalysis.isBreakoutConfirmed,
      triggerAnalysis.triggerFound,
      elapsedSecondsSinceTrigger,
      preTriggerCompressionScore,
      discoveryLane
    );

    // 19. Orderbook Imbalance as Confidence Modifier (Not primary trigger)
    let orderbookImbalanceRatio = 1.0;
    let orderbookConfidenceModifier = 0;
    let orderbookWarning: string | null = null;

    if (orderbook && orderbook.bids && orderbook.asks && orderbook.bids.length > 0 && orderbook.asks.length > 0) {
      let bidDepth = 0;
      let askDepth = 0;
      for (const b of orderbook.bids.slice(0, 15)) bidDepth += b.price * b.size;
      for (const a of orderbook.asks.slice(0, 15)) askDepth += a.price * a.size;
      
      if (askDepth > 0) {
        orderbookImbalanceRatio = parseFloat((bidDepth / askDepth).toFixed(2));
      }

      if (direction === 'LONG') {
        if (orderbookImbalanceRatio >= 1.8) {
          orderbookConfidenceModifier = 5;
        } else if (orderbookImbalanceRatio <= 0.55) {
          orderbookConfidenceModifier = -8;
          orderbookWarning = 'HEAVY_ASK_RESISTANCE_WALL (Fakeout risk)';
        }
      } else if (direction === 'SHORT') {
        if (orderbookImbalanceRatio <= 0.55) {
          orderbookConfidenceModifier = 5;
        } else if (orderbookImbalanceRatio >= 1.8) {
          orderbookConfidenceModifier = -8;
          orderbookWarning = 'HEAVY_BID_SUPPORT_WALL (Bounce risk)';
        }
      }
    }

    // Apply orderbook confidence modifier to actionability and timing scores
    if (orderbookConfidenceModifier !== 0) {
      actionabilityScore = Math.min(100, Math.max(0, actionabilityScore + orderbookConfidenceModifier));
    }

    // Update MTF confluence with verified distance from trigger ATR
    if (distanceFromTriggerATR > 2.2 && (mtfConfluenceType === 'MULTI_TIMEFRAME_ALIGNMENT' || mtfConfluenceType === 'EARLY_ROTATION')) {
      mtfConfluenceType = 'LATE_EXPANSION';
    }

    // 19c. Multi-Anchor VWAP Confluence & Bands Analysis (AA VWAP Pro Native)
    const anchoredVwapEngine = new AnchoredVWAPEngine();
    const vwapAnalysis = anchoredVwapEngine.analyze(
      lastPrice,
      indicators.sessionVwap ?? null,
      indicators.weeklyVwap ?? null,
      indicators.monthlyVwap ?? null,
      direction
    );

    // Anti-chasing: Band 2.0σ Exhaustion filter
    if (vwapAnalysis.isExhaustedBand2) {
      chaseRiskScore = Math.max(chaseRiskScore, 75);
      if (entryStatus === 'ACTIONABLE_NOW') {
        entryStatus = 'WAIT_PULLBACK';
      }
      if (vwapAnalysis.warning) {
        antiChaseReasons.unshift(vwapAnalysis.warning);
      }
    }

    // Pullback validation: Band 1.0σ Retest / Value Area support
    if (vwapAnalysis.isRetestingBand1 && (entryStatus === 'WAIT_PULLBACK' || entryStatus === 'WAITING')) {
      if (distanceFromTriggerATR <= 1.5 && chaseRiskScore <= 45) {
        entryStatus = 'ACTIONABLE_NOW';
        actionabilityScore = Math.min(100, actionabilityScore + 10);
      }
    }

    // 20. Map Discovery Label & Squeeze/Flush override
    let discoveryLabel: DiscoveryLabel = 'STANDARD_MOMENTUM';
    if (isDecoupledAlpha) {
      discoveryLabel = 'DECOUPLED_ALPHA';
      signalCategory = 'DECOUPLED_ALPHA';
      decision = '👑 DECOUPLED ALPHA: Strong independent momentum outperforming BTC (Leader)';
      if (entryStatus === 'WAIT_PULLBACK' && distanceFromTriggerATR <= 1.5) {
        entryStatus = 'CONFIRMED';
      }
    } else if (oiFunding.eventTag === 'SHORT_SQUEEZE_CANDIDATE') {
      discoveryLabel = 'SHORT_SQUEEZE_CANDIDATE';
      signalCategory = 'SHORT_SQUEEZE_CANDIDATE';
      decision = '⚡ SHORT SQUEEZE CANDIDATE: Negative funding & crowded shorts coiling at base';
    } else if (oiFunding.eventTag === 'LONG_FLUSH_RISK') {
      discoveryLabel = 'LONG_FLUSH_RISK';
      signalCategory = 'LONG_FLUSH_RISK';
      decision = '⚠️ LONG FLUSH RISK: Crowded longs failing resistance (Liquidation danger)';
    } else if (oiFunding.eventTag === 'OI_SUPPORTED_MOMENTUM') {
      discoveryLabel = 'OI_SUPPORTED_MOMENTUM';
    } else if (signalCategory === 'BASE_LONG' || signalCategory === 'BASE_SHORT') {
      discoveryLabel = 'PRE_BREAKOUT_BASE';
    } else if (signalCategory === 'EARLY_LONG' || signalCategory === 'EARLY_SHORT') {
      discoveryLabel = 'FRESH_BREAKOUT';
    } else if (signalCategory === 'PULLBACK_LONG' || signalCategory === 'PULLBACK_SHORT') {
      discoveryLabel = 'EARLY_ROTATION';
    } else if (moveMaturity === 'EXHAUSTED') {
      discoveryLabel = 'EXHAUSTED_MOVE';
    } else if (moveMaturity === 'LATE') {
      discoveryLabel = 'LATE_MOVER';
    }

    // 21. Map Entry Potential
    let entryPotential: EntryPotential = 'MEDIUM';
    if (
      (discoveryLabel === 'DECOUPLED_ALPHA' || discoveryLabel === 'FRESH_BREAKOUT' || discoveryLabel === 'PRE_BREAKOUT_BASE' || discoveryLabel === 'SHORT_SQUEEZE_CANDIDATE') &&
      chaseRiskScore <= 45 &&
      orderbookWarning === null
    ) {
      entryPotential = 'HIGH';
    } else if (moveMaturity === 'EXHAUSTED' || moveMaturity === 'LATE' || chaseRiskScore >= 60 || orderbookWarning !== null) {
      entryPotential = 'LOW';
    }

    return {
      phase,
      setupState: stateMachineResult.state,
      timingWindow,
      entryStatus,
      earlyMomentumScore: Math.round(momentumIgnitionScore),
      momentumIgnitionScore: Math.round(momentumIgnitionScore),
      momentumStrengthScore: Math.round(momentumStrengthScore),
      momentumDecelerationScore: Math.round(momentumDecelerationScore),
      preTriggerCompressionScore: Math.round(preTriggerCompressionScore),
      extensionScore: Math.round(extensionScore),
      remainingMoveScore: Math.round(remainingMoveScore),
      actionabilityScore: Math.round(actionabilityScore),
      moveMaturity,
      moveMaturityScore: Math.round(moveMaturityScore),
      signalFreshness: Math.round(signalFreshness),
      chaseRiskScore: Math.round(chaseRiskScore),
      distributionRisk: Math.round(distributionRisk),
      accumulationRisk: Math.round(accumulationRisk),
      distanceFromTriggerPct,
      distanceFromTriggerATR,
      elapsedSecondsSinceTrigger,
      secondsSinceTrigger: elapsedSecondsSinceTrigger,
      confirmationTimestamp: triggerAnalysis.confirmationTimestamp,
      secondsSinceConfirmation: triggerAnalysis.secondsSinceConfirmation,
      timingScore,
      signalCategory,
      sweepType,
      triggerState,
      discoveryLane,
      discoveryLabel,
      entryPotential,
      mtfConfluence: mtfConfluenceType,
      orderbookImbalanceRatio,
      orderbookConfidenceModifier,
      orderbookWarning,
      vwapAnalysis,
      antiChaseReasons,
      decision
    };
  }

  /**
   * Liquidity Sweep & Manipulation Detection.
   */
  private detectLiquiditySweep(
    c15: CandleData[],
    ticker: TickerData,
    oi: OIFundingAnalysis
  ): LiquiditySweepType {
    if (c15.length < 3) return 'NONE';

    const latest = c15[c15.length - 1];
    const pastRange = c15.slice(0, -1);
    if (pastRange.length < 2) return 'NONE';

    const minPastLow = Math.min(...pastRange.map(c => c.low));
    const maxPastHigh = Math.max(...pastRange.map(c => c.high));

    // Bullish Liquidity Sweep: dipped below past low, then closed strongly above it
    if (latest.low < minPastLow && latest.close >= minPastLow) {
      const lowerWick = Math.min(latest.open, latest.close) - latest.low;
      const body = Math.max(0.0001, Math.abs(latest.close - latest.open));
      if (lowerWick > body * 1.2 || lowerWick > (latest.low * 0.005)) {
        return 'BULLISH_LIQUIDITY_SWEEP';
      }
    }

    // Bearish Liquidity Sweep: spiked above past high, then closed strongly below it
    if (latest.high > maxPastHigh && latest.close <= maxPastHigh) {
      const upperWick = latest.high - Math.max(latest.open, latest.close);
      const body = Math.max(0.0001, Math.abs(latest.close - latest.open));
      if (upperWick > body * 1.2 || upperWick > (latest.high * 0.005)) {
        return 'BEARISH_LIQUIDITY_SWEEP';
      }
    }

    return 'NONE';
  }

  /**
   * Multi-dimensional Market Phase Classifier.
   */
  private classifyMarketPhase(
    ticker: TickerData,
    indicators: IndicatorState,
    volatility: VolatilityState,
    c15: CandleData[],
    c1h: CandleData[],
    oi: OIFundingAnalysis,
    rs: RelativeStrengthResult,
    sweep: LiquiditySweepType,
    distAtr: number,
    p1h?: number | null
  ): PhaseClassification {
    const evidence: string[] = [];
    const p1hVal = p1h !== undefined && p1h !== null ? p1h : (ticker.price24hPcnt / 4);
    const rsi15 = indicators.rsi14['15'] ?? 50;
    const volRatio = indicators.volumeRatio['15'] ?? 1.0;
    const ema9_15 = indicators.ema9['15'];
    const ema21_15 = indicators.ema21['15'];

    if (sweep === 'BULLISH_LIQUIDITY_SWEEP' || sweep === 'BEARISH_LIQUIDITY_SWEEP') {
      evidence.push('Liquidity sweep manipulation detected');
      return { label: MarketPhase.MANIPULATION, confidence: 0.85, evidence };
    }

    const upperWickCount = this.countRejectionWicks(c15, 'UPPER');
    if (distAtr >= 2.5 && (p1hVal > 0.05 || rsi15 >= 70) && (upperWickCount >= 2 || volRatio > 2.5 || oi.fundingRate > 0.0004)) {
      evidence.push(`Price extended (+${distAtr.toFixed(1)}x ATR above trigger)`);
      if (upperWickCount >= 2) evidence.push(`Multiple upper rejection wicks (${upperWickCount})`);
      if (oi.fundingRate > 0.0003) evidence.push('Funding rate crowded positive');
      return { label: MarketPhase.DISTRIBUTION, confidence: 0.82, evidence };
    }

    if (distAtr >= 3.0 || (p1hVal > 0.08 && rsi15 > 72)) {
      evidence.push(`Extended impulse (+${(p1hVal * 100).toFixed(1)}% 1H, ${distAtr.toFixed(1)}x ATR)`);
      return { label: MarketPhase.LATE_EXPANSION, confidence: 0.80, evidence };
    }

    if (p1hVal < -0.07 && (rsi15 < 25 || volRatio > 2.5)) {
      evidence.push(`Severe downside extension (${(p1hVal * 100).toFixed(1)}% 1H)`);
      return { label: MarketPhase.CAPITULATION, confidence: 0.85, evidence };
    }

    if (p1hVal < -0.02 && ema9_15 !== null && ema21_15 !== null && ema9_15 < ema21_15 && rsi15 < 45) {
      evidence.push('Bearish EMA alignment with price breaking below support');
      return { label: MarketPhase.MARKDOWN, confidence: 0.78, evidence };
    }

    if (p1hVal >= 0.005 && distAtr <= 2.0 && rsi15 >= 50 && rsi15 <= 68 && volRatio >= 1.2) {
      evidence.push('Fresh breakout with expanding volume (not climactic)');
      return { label: MarketPhase.MARKUP, confidence: 0.84, evidence };
    }

    const range10 = this.calculateRangeExpansion(c15, 10);
    if (range10 < 0.025 && Math.abs(p1hVal) < 0.02 && rsi15 >= 42 && rsi15 <= 58) {
      evidence.push('Range compression / low volatility consolidation');
      return { label: MarketPhase.ACCUMULATION, confidence: 0.76, evidence };
    }

    evidence.push('Mixed signals across timeframes');
    return { label: MarketPhase.NEUTRAL, confidence: 0.50, evidence };
  }

  /**
   * Direction-Aware Momentum Ignition Score (0–100).
   * Measures strictly how recently and cleanly momentum ignited from compression.
   */
  private calculateMomentumIgnition(
    direction: Direction,
    indicators: IndicatorState,
    c15: CandleData[],
    oi: OIFundingAnalysis,
    distAtr: number,
    preTriggerCompression: number,
    timingWindow: TimingWindow,
    p5m?: number | null
  ): number {
    let score = 0;
    const p5mVal = p5m ?? 0;

    // 1. Pre-trigger compression component (0–25 pts)
    score += (preTriggerCompression * 0.25);

    // 2. Timing Window Freshness (0–25 pts)
    if (timingWindow === 'FRESH') score += 25;
    else if (timingWindow === 'TRIGGERING') score += 20;
    else if (timingWindow === 'DEVELOPING') score += 15;
    else if (timingWindow === 'MATURE') score += 5;
    // LATE and EXHAUSTED give 0 pts

    // 3. Proximity to Trigger Base (0–20 pts)
    if (distAtr <= 0.8) score += 20;
    else if (distAtr <= 1.5) score += 15;
    else if (distAtr <= 2.2) score += 8;

    // 4. Directional Price Velocity without Overheating (0–15 pts)
    if (direction === 'LONG') {
      if (p5mVal >= 0.003 && p5mVal <= 0.018) score += 15; // 0.3% - 1.8% is ideal ignition
      else if (p5mVal > 0.018 && p5mVal <= 0.030) score += 8;
      else if (p5mVal > 0.030) score += 2; // > 3% is too parabolic!
      // Negative return gives 0 points for LONG ignition!
    } else if (direction === 'SHORT') {
      if (p5mVal <= -0.003 && p5mVal >= -0.018) score += 15;
      else if (p5mVal < -0.018 && p5mVal >= -0.030) score += 8;
      else if (p5mVal < -0.030) score += 2;
      // Positive return gives 0 points for SHORT ignition!
    }

    // 5. Volume & OI Confirmation (0–15 pts)
    const volRatio = indicators.volumeRatio['15'] ?? 1.0;
    if (volRatio >= 1.2 && volRatio <= 2.8) score += 8;
    if (oi.oiChangePercent >= 0.008) score += 7;

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Momentum Strength Score (0–100).
   * Measures ongoing trend power, separated from ignition freshness.
   */
  private calculateMomentumStrength(
    direction: Direction,
    indicators: IndicatorState,
    p1h?: number | null
  ): number {
    let score = 50;
    const p1hVal = p1h ?? 0;
    const rsi15 = indicators.rsi14['15'] ?? 50;
    const volRatio = indicators.volumeRatio['15'] ?? 1.0;

    if (direction === 'LONG') {
      if (p1hVal > 0) score += Math.min(25, p1hVal * 500);
      if (rsi15 >= 55) score += Math.min(15, (rsi15 - 50) * 0.7);
      if (volRatio > 1.2) score += 10;
    } else {
      if (p1hVal < 0) score += Math.min(25, Math.abs(p1hVal) * 500);
      if (rsi15 <= 45) score += Math.min(15, (50 - rsi15) * 0.7);
      if (volRatio > 1.2) score += 10;
    }

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Extension Score (0–100):
   * Higher = more extended / riskier to chase.
   */
  private calculateExtensionScore(
    distAtr: number,
    distPct: number,
    c15: CandleData[],
    direction: Direction,
    p1h?: number | null,
    p5m?: number | null
  ): number {
    let score = 0;
    const p1hVal = p1h ?? 0;
    const p5mVal = p5m ?? 0;

    // ATR extension
    if (distAtr >= 4.0) score += 40;
    else if (distAtr >= 2.5) score += 25;
    else if (distAtr >= 1.5) score += 12;

    // 1H extension
    if (direction === 'LONG' && p1hVal >= 0.10) score += 25;
    else if (direction === 'SHORT' && p1hVal <= -0.10) score += 25;
    else if (Math.abs(p1hVal) >= 0.05) score += 15;

    // 5m vertical candle extension
    if (Math.abs(p5mVal) >= 0.035) score += 20;

    // Consecutive impulse bars without pause
    const impulseCount = this.countConsecutiveImpulse(c15, direction === 'LONG' ? 'UP' : 'DOWN');
    if (impulseCount >= 5) score += 15;
    else if (impulseCount >= 3) score += 8;

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Remaining Move / Risk-Reward Score (0–100).
   * Measures headroom from current price to next key swing resistance/support.
   */
  private calculateRemainingMoveScore(
    c15: CandleData[],
    c1h: CandleData[],
    lastPrice: number,
    direction: Direction,
    atr: number
  ): number {
    if (c15.length < 5) return 60; // neutral fallback

    // Look for next major pivot in 15m/1h
    const lookback = Math.min(30, c15.length);
    const subset = c15.slice(-lookback);

    if (direction === 'LONG') {
      const highs = subset.map(c => c.high).filter(h => h > lastPrice);
      if (highs.length === 0) {
        return 85; // Blue sky breakout, high room!
      }
      const nextResistance = Math.min(...highs);
      const roomPct = (nextResistance - lastPrice) / lastPrice;
      const roomAtr = (nextResistance - lastPrice) / atr;

      if (roomPct >= 0.04 || roomAtr >= 2.5) return 90; // Plenty of room
      if (roomPct >= 0.025 || roomAtr >= 1.5) return 70;
      if (roomPct < 0.012 || roomAtr < 0.8) return 30; // Very little room before brick wall!
      return 55;
    } else {
      const lows = subset.map(c => c.low).filter(l => l < lastPrice);
      if (lows.length === 0) {
        return 85; // Breakdown into uncharted territory
      }
      const nextSupport = Math.max(...lows);
      const roomPct = (lastPrice - nextSupport) / lastPrice;
      const roomAtr = (lastPrice - nextSupport) / atr;

      if (roomPct >= 0.04 || roomAtr >= 2.5) return 90;
      if (roomPct >= 0.025 || roomAtr >= 1.5) return 70;
      if (roomPct < 0.012 || roomAtr < 0.8) return 30;
      return 55;
    }
  }

  /**
   * Pullback Setup Detection:
   * Trend is strong, but price retraced into discount (EMA 21 / VWAP / Base) with low extension.
   */
  private detectPullbackSetup(
    indicators: IndicatorState,
    c15: CandleData[],
    lastPrice: number,
    direction: Direction,
    distAtr: number,
    oppScore: number,
    timingWindow: TimingWindow,
    barsSinceTrigger: number
  ): boolean {
    if (oppScore < 65 || c15.length < 5) return false;
    // Cannot be pullback if price is in fresh ignition, triggering, or pre-trigger
    if (timingWindow === 'FRESH' || timingWindow === 'TRIGGERING' || timingWindow === 'PRE_TRIGGER' || barsSinceTrigger <= 1) {
      return false;
    }

    const ema21 = indicators.ema21['15'];
    if (!ema21) return false;

    if (direction === 'LONG') {
      const diffPct = Math.abs(lastPrice - ema21) / ema21;
      // Price is touching or hovering within 0.8% of EMA 21 and distAtr has retraced <= 1.2
      const latest = c15[c15.length - 1];
      const isReversing = latest.close >= latest.open; // green candle bouncing
      return diffPct <= 0.010 && distAtr <= 1.2 && isReversing;
    } else {
      const diffPct = Math.abs(lastPrice - ema21) / ema21;
      const latest = c15[c15.length - 1];
      const isReversing = latest.close <= latest.open;
      return diffPct <= 0.010 && distAtr <= 1.2 && isReversing;
    }
  }

  /**
   * Composite Actionability Score (0–100).
   * Determines true statistical priority for immediate trading.
   */
  private calculateActionabilityScore(
    oppScore: number,
    ignition: number,
    freshness: number,
    remainingMove: number,
    indicators: IndicatorState,
    extension: number,
    chaseRisk: number,
    distribRisk: number,
    accumRisk: number,
    direction: Direction
  ): number {
    let score = 50;

    score += (oppScore * 0.20);
    score += (ignition * 0.30);
    score += (freshness * 0.20);
    score += (remainingMove * 0.15);

    score -= (extension * 0.25);
    score -= (chaseRisk * 0.25);

    if (direction === 'LONG') score -= (distribRisk * 0.25);
    else score -= (accumRisk * 0.25);

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Momentum Deceleration Detector (0–100).
   */
  private calculateMomentumDeceleration(
    ticker: TickerData,
    indicators: IndicatorState,
    c15: CandleData[],
    direction: Direction,
    p5m?: number | null,
    p1h?: number | null
  ): number {
    let score = 0;
    if (c15.length < 4) return 0;

    const roc5 = indicators.roc5['15'] ?? 0;
    const roc14 = indicators.roc14['15'] ?? 0;

    if (roc14 > 0.01 && roc5 < roc14 * 0.5) score += 30;

    const b1 = Math.abs(c15[c15.length - 1].close - c15[c15.length - 1].open);
    const b2 = Math.abs(c15[c15.length - 2].close - c15[c15.length - 2].open);
    const b3 = Math.abs(c15[c15.length - 3].close - c15[c15.length - 3].open);

    if (b3 > b2 && b2 > b1 && b1 > 0) score += 30;

    const upperWickCount = this.countRejectionWicks(c15, 'UPPER');
    if (upperWickCount >= 2 && direction === 'LONG') score += 25;

    const lowerWickCount = this.countRejectionWicks(c15, 'LOWER');
    if (lowerWickCount >= 2 && direction === 'SHORT') score += 25;

    const p1hVal = p1h ?? 0;
    const p5mVal = p5m ?? 0;
    if (Math.abs(p1hVal) > 0.04 && Math.abs(p5mVal) < 0.001) score += 20;

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Distribution Risk Score (0–100).
   */
  private calculateDistributionRisk(
    ticker: TickerData,
    indicators: IndicatorState,
    c15: CandleData[],
    oi: OIFundingAnalysis,
    rs: RelativeStrengthResult,
    distAtr: number,
    decelScore: number,
    p1h?: number | null
  ): number {
    let risk = 0;
    const p1hVal = p1h ?? (ticker.price24hPcnt / 4);
    const rsi15 = indicators.rsi14['15'] ?? 50;
    const volRatio = indicators.volumeRatio['15'] ?? 1.0;

    if (distAtr >= 4.0) risk += 30;
    else if (distAtr >= 2.5) risk += 18;
    else if (distAtr >= 1.8) risk += 8;

    if (p1hVal >= 0.10) risk += 25;
    else if (p1hVal >= 0.05) risk += 15;

    const upperWicks = this.countRejectionWicks(c15, 'UPPER');
    if (volRatio >= 2.5 && upperWicks >= 1) risk += 20;
    else if (upperWicks >= 2) risk += 15;

    if (oi.fundingRate >= 0.0005) risk += 15;
    else if (oi.fundingRate >= 0.0003) risk += 8;

    if (decelScore >= 50) risk += 15;
    if (rsi15 >= 75) risk += 10;

    return Math.min(100, Math.max(0, risk));
  }

  /**
   * Accumulation Risk Score (0–100) for SHORT candidates.
   */
  private calculateAccumulationRisk(
    ticker: TickerData,
    indicators: IndicatorState,
    c15: CandleData[],
    oi: OIFundingAnalysis,
    rs: RelativeStrengthResult,
    distAtr: number,
    decelScore: number,
    p1h?: number | null
  ): number {
    let risk = 0;
    const p1hVal = p1h ?? 0;
    const rsi15 = indicators.rsi14['15'] ?? 50;
    const lowerWicks = this.countRejectionWicks(c15, 'LOWER');

    if (p1hVal <= -0.10) risk += 35;
    else if (p1hVal <= -0.06) risk += 20;

    if (lowerWicks >= 2) risk += 25;
    else if (lowerWicks >= 1) risk += 12;

    if (rsi15 <= 25) risk += 20;
    if (decelScore >= 50) risk += 15;
    if (oi.fundingRate <= -0.0004) risk += 15;

    return Math.min(100, Math.max(0, risk));
  }

  /**
   * Chase Risk Score (0–100).
   */
  private calculateChaseRisk(
    ticker: TickerData,
    indicators: IndicatorState,
    c15: CandleData[],
    direction: Direction,
    distPct: number,
    distAtr: number,
    barsSince: number,
    decelScore: number,
    distribRisk: number,
    accumRisk: number,
    oi: OIFundingAnalysis,
    p5m?: number | null,
    p1h?: number | null
  ): { chaseRiskScore: number; antiChaseReasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    const p5mVal = p5m ?? 0;
    const p1hVal = p1h ?? 0;
    const volRatio = indicators.volumeRatio['15'] ?? 1.0;

    if (distAtr >= 4.0) {
      score += 35;
      reasons.push(`Price is ${distAtr.toFixed(1)}x ATR above trigger base (Extremely extended)`);
    } else if (distAtr >= 2.5) {
      score += 25;
      reasons.push(`Price is ${distAtr.toFixed(1)}x ATR above trigger base`);
    } else if (distAtr >= 1.8) {
      score += 15;
      reasons.push(`Price is moderately extended (${distAtr.toFixed(1)}x ATR)`);
    }

    if (direction === 'LONG' || distPct > 0) {
      if (p1hVal >= 0.12) {
        score += 25;
        reasons.push(`1H return already +${(p1hVal * 100).toFixed(1)}% (Pumped heavily)`);
      } else if (p1hVal >= 0.06) {
        score += 15;
        reasons.push(`1H move already +${(p1hVal * 100).toFixed(1)}%`);
      }

      if (p5mVal >= 0.035) {
        score += 15;
        reasons.push(`5m move +${(p5mVal * 100).toFixed(1)}% (Vertical candle running)`);
      }
    } else {
      if (p1hVal <= -0.12) {
        score += 25;
        reasons.push(`1H decline already ${(p1hVal * 100).toFixed(1)}% (Crashed heavily)`);
      } else if (p1hVal <= -0.06) {
        score += 15;
        reasons.push(`1H decline ${(p1hVal * 100).toFixed(1)}%`);
      }
    }

    const consecutiveImpulse = this.countConsecutiveImpulse(c15, direction === 'LONG' ? 'UP' : 'DOWN');
    if (consecutiveImpulse >= 5) {
      score += 15;
      reasons.push(`${consecutiveImpulse} consecutive impulse candles without pullback`);
    } else if (consecutiveImpulse >= 3) {
      score += 8;
    }

    if (volRatio >= 2.8) {
      score += 15;
      reasons.push(`Volume climax detected (${volRatio.toFixed(1)}x average)`);
    }

    const upperWicks = this.countRejectionWicks(c15, 'UPPER');
    if (upperWicks >= 2 && direction === 'LONG') {
      score += 15;
      reasons.push('Multiple upper rejection wicks at current highs');
    }

    if (direction === 'LONG' && oi.fundingRate >= 0.0004) {
      score += 10;
      reasons.push('Funding rate crowded positive (Longs paying high premium)');
    } else if (direction === 'SHORT' && oi.fundingRate <= -0.0004) {
      score += 10;
      reasons.push('Funding rate crowded negative (Shorts paying high premium)');
    }

    if (direction === 'LONG' && distribRisk >= 60) {
      score += 15;
      reasons.push('High distribution risk signatures');
    }
    if (direction === 'SHORT' && accumRisk >= 60) {
      score += 15;
      reasons.push('High accumulation / bottom absorption signatures');
    }

    return {
      chaseRiskScore: Math.min(100, Math.max(0, score)),
      antiChaseReasons: reasons
    };
  }

  /**
   * Move Maturity Classification.
   */
  private classifyMoveMaturity(
    distAtr: number,
    barsSince: number,
    chaseRisk: number,
    decelScore: number,
    distribRisk: number,
    timingWindow: TimingWindow
  ): { moveMaturity: MoveMaturity; moveMaturityScore: number } {
    let maturityScore = 0;
    maturityScore += Math.min(40, (distAtr / 4.0) * 40);
    maturityScore += Math.min(20, (barsSince / 15) * 20);
    maturityScore += (chaseRisk * 0.25) + (distribRisk * 0.15);
    maturityScore = Math.min(100, Math.max(0, maturityScore));

    let moveMaturity: MoveMaturity = 'DEVELOPING';
    if (timingWindow === 'EXHAUSTED' || chaseRisk >= 75 || distribRisk >= 75 || (distAtr >= 3.5 && decelScore >= 50)) {
      moveMaturity = 'EXHAUSTED';
    } else if (timingWindow === 'LATE' || maturityScore >= 65 || distAtr >= 2.8) {
      moveMaturity = 'LATE';
    } else if (maturityScore >= 45 || distAtr >= 1.8) {
      moveMaturity = 'MATURE';
    } else if (maturityScore >= 25 || distAtr >= 1.2) {
      moveMaturity = 'DEVELOPING';
    } else {
      moveMaturity = 'EARLY';
    }

    return { moveMaturity, moveMaturityScore: maturityScore };
  }

  /**
   * Signal Freshness (0–100).
   */
  private calculateSignalFreshness(
    elapsedSeconds: number,
    barsSince: number,
    ignitionScore: number,
    distAtr: number
  ): number {
    let freshness = 100;

    // Decay by elapsed seconds (faster decay!)
    if (elapsedSeconds > 180) {
      freshness -= Math.min(40, ((elapsedSeconds - 180) / 60) * 4);
    }

    // Decay by bars elapsed
    freshness -= (barsSince - 1) * 6;

    // Decay by ATR extension
    freshness -= (distAtr * 8);

    // Boost by ignition score
    freshness += (ignitionScore * 0.2);

    return Math.min(100, Math.max(0, freshness));
  }

  /**
   * Final Decision Matrix:
   * Maps (Direction, Opportunity, Actionability, Timing, Phase, State, Window, ChaseRisk) to SignalCategory & EntryStatus.
   */
  private resolveDecisionMatrix(
    direction: Direction,
    oppScore: number,
    actionScore: number,
    timingScore: number,
    phase: PhaseClassification,
    setupState: SetupState,
    timingWindow: TimingWindow,
    maturity: MoveMaturity,
    chaseRisk: number,
    distribRisk: number,
    accumRisk: number,
    antiChaseReasons: string[],
    distAtr: number,
    distanceFromTriggerPct: number,
    isPullback: boolean,
    isConfirmed: boolean = true,
    triggerFound: boolean = true,
    elapsedSecondsSinceTrigger: number = 0,
    preTriggerCompressionScore: number = 0,
    discoveryLane?: DiscoveryLane
  ): { signalCategory: SignalCategory; decision: string; entryStatus: EntryStatus } {
    if (direction === 'WAIT' || direction === 'REJECT') {
      return { signalCategory: 'NO_TRADE', decision: 'Direction inconclusive / conflict', entryStatus: 'REJECTED' };
    }

    // RULE 7 & 29: Stale trigger check (> 45 min = 2700s) -> never EARLY_LONG/SHORT!
    if (elapsedSecondsSinceTrigger > 2700) {
      if (direction === 'LONG') {
        return {
          signalCategory: 'LATE_LONG',
          decision: 'BULLISH TREN INTACT, BUT ENTRY LATE (Trigger is stale > 45m; wait for pullback)',
          entryStatus: 'WAIT_PULLBACK'
        };
      } else {
        return {
          signalCategory: 'LATE_SHORT',
          decision: 'BEARISH TREN INTACT, BUT DUMP ALREADY HAPPENED (Trigger is stale > 45m; wait for retest)',
          entryStatus: 'WAIT_PULLBACK'
        };
      }
    }

    // Wait confirmation state (e.g. unconfirmed liquidity sweep)
    if (setupState === SetupState.WAIT_CONFIRMATION) {
      return { signalCategory: 'NO_TRADE', decision: 'Manipulation sweep detected: awaiting confirmation', entryStatus: 'WAITING' };
    }

    // Pre-Breakout / Base Compression Check (Coiling at support before expansion)
    const isBaseCompression = discoveryLane === 'LANE_A_PRE_BREAKOUT' &&
                              (timingWindow === 'PRE_TRIGGER' || setupState === SetupState.ACCUMULATION || setupState === SetupState.PRE_BREAKOUT_LONG) &&
                              preTriggerCompressionScore >= 65 && chaseRisk <= 35;

    if (!triggerFound || timingWindow === 'PRE_TRIGGER') {
      if (direction === 'LONG') {
        if (isBaseCompression && distribRisk <= 45 && distanceFromTriggerPct >= -1.5) {
          const isActionableBase = oppScore >= 75 && chaseRisk <= 20;
          return {
            signalCategory: 'BASE_LONG',
            decision: isActionableBase
              ? '💎 ACTIONABLE BASE ACCUMULATION: Coiling tightly at support with minimal downside risk'
              : '⏳ WATCHLIST BASE: Pre-breakout compression base building near key trigger',
            entryStatus: isActionableBase ? 'ACTIONABLE_NOW' : 'WAITING'
          };
        }
        return { signalCategory: 'NO_LONG', decision: 'No confirmed structural breakout trigger', entryStatus: 'WAITING' };
      } else {
        const isBaseBreakdown = discoveryLane === 'LANE_A_PRE_BREAKOUT' &&
                                (timingWindow === 'PRE_TRIGGER' || setupState === SetupState.DISTRIBUTION || setupState === SetupState.PRE_BREAKDOWN_SHORT) &&
                                preTriggerCompressionScore >= 65 && chaseRisk <= 35;
        if (isBaseBreakdown && accumRisk <= 45 && distanceFromTriggerPct <= 1.5) {
          const isActionableBaseShort = oppScore >= 75 && chaseRisk <= 20;
          return {
            signalCategory: 'BASE_SHORT',
            decision: isActionableBaseShort
              ? '📉 ACTIONABLE BASE BREAKDOWN: Coiling under resistance with tight invalidation'
              : '⏳ WATCHLIST BREAKDOWN: Pre-breakdown base compression',
            entryStatus: isActionableBaseShort ? 'ACTIONABLE_NOW' : 'WAITING'
          };
        }
        return { signalCategory: 'NO_SHORT', decision: 'No confirmed structural breakdown trigger', entryStatus: 'WAITING' };
      }
    }

    if (direction === 'LONG') {
      // 0. If price is trading below structural support base, cannot be LONG!
      if (distanceFromTriggerPct < -1.5) {
        return {
          signalCategory: 'NO_LONG',
          decision: 'Price trading below structural support',
          entryStatus: 'REJECTED'
        };
      }

      // 1. Strict Anti-Chase Gate: If extended, exhausted, or high distribution risk -> NO_LONG
      if (chaseRisk >= 70 || distribRisk >= 70 || maturity === 'EXHAUSTED' || distAtr >= 3.5 || setupState === SetupState.DISTRIBUTION) {
        const reasonStr = antiChaseReasons.slice(0, 2).join('; ') || 'High chase/distribution risk';
        return {
          signalCategory: 'NO_LONG',
          decision: `BULLISH DIRECTION, BUT TOO LATE (${reasonStr})`,
          entryStatus: 'TOO_LATE'
        };
      }

      // 2. Pullback Setup (High quality secondary entry!)
      if (isPullback && chaseRisk <= 45 && distribRisk <= 45) {
        return {
          signalCategory: 'PULLBACK_LONG',
          decision: '🎯 ACTIONABLE PULLBACK: Retraced to Support/EMA with bounce confirmation',
          entryStatus: 'ACTIONABLE_NOW'
        };
      }

      // 3. Early Long (Prime setup: ignition confirmed, fresh/developing breakout, low chase risk)
      const isFreshBreakout = (timingWindow === 'FRESH' || (timingWindow === 'DEVELOPING' && distAtr <= 1.5));
      if (isFreshBreakout && isConfirmed && (maturity === 'EARLY' || maturity === 'DEVELOPING') && chaseRisk <= 45 && timingScore >= 60 && oppScore >= 70) {
        return {
          signalCategory: 'EARLY_LONG',
          decision: '🚀 PRIORITY ENTRY: Fresh Breakout & Early Momentum Ignition',
          entryStatus: 'ACTIONABLE_NOW'
        };
      }

      // 4. Late Long (Trend bullish, but entry late -> wait for pullback)
      if (maturity === 'LATE' || chaseRisk >= 50 || timingScore < 50 || distAtr >= 2.0) {
        return {
          signalCategory: 'LATE_LONG',
          decision: 'BULLISH TREN INTACT, BUT ENTRY LATE (Wait for pullback to EMA/Support)',
          entryStatus: 'WAIT_PULLBACK'
        };
      }

      // 5. Long Continuation (Valid trend continuation with acceptable risk)
      if (oppScore >= 65 && timingScore >= 50 && chaseRisk <= 55 && distAtr <= 2.0) {
        return {
          signalCategory: 'LONG_CONTINUATION',
          decision: 'VALID CONTINUATION: Trend healthy with moderate entry risk',
          entryStatus: 'ACTIONABLE_NOW'
        };
      }

      return { signalCategory: 'NO_LONG', decision: 'Insufficient timing quality for LONG', entryStatus: 'WAITING' };
    }

    if (direction === 'SHORT') {
      // 0. If price is trading above structural resistance base, cannot be SHORT!
      if (distanceFromTriggerPct < -1.5) {
        return {
          signalCategory: 'NO_SHORT',
          decision: 'Price trading above structural resistance',
          entryStatus: 'REJECTED'
        };
      }

      // 1. Strict Anti-Chase Gate for Short: If capitulated or in bottom accumulation -> NO_SHORT
      if (chaseRisk >= 70 || accumRisk >= 70 || maturity === 'EXHAUSTED' || distAtr >= 3.5 || setupState === SetupState.CAPITULATION) {
        const reasonStr = antiChaseReasons.slice(0, 2).join('; ') || 'Capitulation / bottom absorption';
        return {
          signalCategory: 'NO_SHORT',
          decision: `BEARISH DIRECTION, BUT TOO LATE (${reasonStr})`,
          entryStatus: 'TOO_LATE'
        };
      }

      // 2. Pullback Short
      if (isPullback && chaseRisk <= 45 && accumRisk <= 45) {
        return {
          signalCategory: 'PULLBACK_SHORT',
          decision: '🎯 ACTIONABLE RETEST: Bounced to Resistance/EMA with rejection confirmation',
          entryStatus: 'ACTIONABLE_NOW'
        };
      }

      // 3. Early Short
      const isFreshBreakdown = (timingWindow === 'FRESH' || (timingWindow === 'DEVELOPING' && distAtr <= 1.5));
      if (isFreshBreakdown && isConfirmed && (maturity === 'EARLY' || maturity === 'DEVELOPING') && chaseRisk <= 45 && timingScore >= 60 && oppScore >= 70) {
        return {
          signalCategory: 'EARLY_SHORT',
          decision: '⚡ PRIORITY SHORT: Fresh Breakdown & Distribution Transition',
          entryStatus: 'ACTIONABLE_NOW'
        };
      }

      // 4. Late Short
      if (maturity === 'LATE' || chaseRisk >= 50 || timingScore < 50 || distAtr >= 2.0) {
        return {
          signalCategory: 'LATE_SHORT',
          decision: 'BEARISH TREN INTACT, BUT DUMP ALREADY HAPPENED (Wait for retest)',
          entryStatus: 'WAIT_PULLBACK'
        };
      }

      // 5. Short Continuation
      if (oppScore >= 65 && timingScore >= 50 && chaseRisk <= 55 && distAtr <= 2.0) {
        return {
          signalCategory: 'SHORT_CONTINUATION',
          decision: 'VALID CONTINUATION: Downtrend healthy with moderate risk',
          entryStatus: 'ACTIONABLE_NOW'
        };
      }

      return { signalCategory: 'NO_SHORT', decision: 'Insufficient timing quality for SHORT', entryStatus: 'WAITING' };
    }

    return { signalCategory: 'NO_TRADE', decision: 'No trade criteria met', entryStatus: 'REJECTED' };
  }

  // ---- Helper Utilities ----

  private calculateRangeExpansion(candles: CandleData[], count: number): number {
    if (candles.length < count) return 0.05;
    const subset = candles.slice(-count);
    const maxH = Math.max(...subset.map(c => c.high));
    const minL = Math.min(...subset.map(c => c.low));
    return minL > 0 ? (maxH - minL) / minL : 0.05;
  }

  private countRejectionWicks(candles: CandleData[], type: 'UPPER' | 'LOWER'): number {
    const subset = candles.slice(-5);
    let count = 0;
    for (const c of subset) {
      const body = Math.abs(c.close - c.open);
      const upperWick = c.high - Math.max(c.open, c.close);
      const lowerWick = Math.min(c.open, c.close) - c.low;

      if (type === 'UPPER' && upperWick > body * 1.2 && upperWick > (c.high * 0.003)) {
        count++;
      } else if (type === 'LOWER' && lowerWick > body * 1.2 && lowerWick > (c.low * 0.003)) {
        count++;
      }
    }
    return count;
  }

  private countConsecutiveImpulse(candles: CandleData[], type: 'UP' | 'DOWN'): number {
    const subset = candles.slice(-8);
    let count = 0;
    for (let i = subset.length - 1; i >= 0; i--) {
      const isGreen = subset[i].close > subset[i].open;
      if (type === 'UP' && isGreen) count++;
      else if (type === 'DOWN' && !isGreen) count++;
      else break;
    }
    return count;
  }
}
