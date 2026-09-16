// ============================================================
// Phase 4: Setup State Machine
// Manages setup lifecycles: Accumulation -> Pre-Breakout ->
// Ignition -> Markup -> Distribution -> Breakdown -> Markdown -> Capitulation
// ============================================================

import {
  CandleData,
  IndicatorState,
  OIFundingAnalysis,
  RelativeStrengthResult,
  SetupState,
  SetupStateMachineResult,
  LiquiditySweepType,
  Direction
} from '../data/types.js';
import { TriggerAnalysisResult } from './trigger-tracker.js';

export class SetupStateMachine {
  /**
   * Evaluates the current setup state and lifecycle transition.
   */
  public evaluateState(
    candles5m: CandleData[],
    candles15m: CandleData[],
    indicators: IndicatorState,
    oi: OIFundingAnalysis,
    rs: RelativeStrengthResult,
    trigger: TriggerAnalysisResult,
    sweep: LiquiditySweepType,
    direction: Direction,
    p5m?: number | null,
    p1h?: number | null
  ): SetupStateMachineResult {
    const evidence: string[] = [];
    const p1hVal = p1h ?? 0;
    const p5mVal = p5m ?? 0;
    const rsi15 = indicators.rsi14['15'] ?? 50;
    const volRatio = indicators.volumeRatio['15'] ?? 1.0;
    const distAtr = trigger.distanceFromTriggerATR;
    const triggerTimestamp = trigger.triggerState?.triggerTimestamp ?? (Date.now() - (trigger.elapsedSecondsSinceTrigger * 1000));

    // 1. Check Liquidity Sweep & Manipulation
    if (sweep === 'BULLISH_LIQUIDITY_SWEEP') {
      if (trigger.isBreakoutConfirmed || (p5mVal > 0.003 && volRatio >= 1.2)) {
        evidence.push('Bullish liquidity sweep with confirmed reclaim & volume absorption');
        return {
          state: SetupState.BULLISH_IGNITION,
          stateConfidence: 0.88,
          stateAgeSeconds: trigger.elapsedSecondsSinceTrigger,
          stateStartedAt: triggerTimestamp,
          stateEvidence: evidence
        };
      } else {
        evidence.push('Support sweep detected, awaiting reclaim confirmation');
        return {
          state: SetupState.WAIT_CONFIRMATION,
          stateConfidence: 0.80,
          stateAgeSeconds: 0,
          stateStartedAt: Date.now(),
          stateEvidence: evidence
        };
      }
    }

    if (sweep === 'BEARISH_LIQUIDITY_SWEEP') {
      if (trigger.isBreakoutConfirmed || (p5mVal < -0.003 && volRatio >= 1.2)) {
        evidence.push('Bearish liquidity sweep with confirmed rejection & downside volume');
        return {
          state: SetupState.BEARISH_IGNITION,
          stateConfidence: 0.88,
          stateAgeSeconds: trigger.elapsedSecondsSinceTrigger,
          stateStartedAt: triggerTimestamp,
          stateEvidence: evidence
        };
      } else {
        evidence.push('Resistance sweep detected, awaiting rejection confirmation');
        return {
          state: SetupState.WAIT_CONFIRMATION,
          stateConfidence: 0.80,
          stateAgeSeconds: 0,
          stateStartedAt: Date.now(),
          stateEvidence: evidence
        };
      }
    }

    // 2. Check Capitulation (Severe panic selling, high volume climax)
    if (p1hVal <= -0.08 && (rsi15 <= 25 || volRatio >= 2.8)) {
      evidence.push(`Panic selling climax (${(p1hVal * 100).toFixed(1)}% 1H, RSI ${rsi15.toFixed(0)})`);
      return {
        state: SetupState.CAPITULATION,
        stateConfidence: 0.90,
        stateAgeSeconds: trigger.elapsedSecondsSinceTrigger,
        stateStartedAt: triggerTimestamp,
        stateEvidence: evidence
      };
    }

    // 3. Check Distribution (High price, upper rejection wicks, elevated funding, stalling price)
    if (distAtr >= 2.5 && (p1hVal > 0.05 || rsi15 >= 72) && (oi.fundingRate >= 0.0004 || volRatio > 2.5)) {
      evidence.push('Upper wicks forming at highs with crowded positive funding');
      evidence.push(`Price extended (+${distAtr.toFixed(1)}x ATR above trigger)`);
      return {
        state: SetupState.DISTRIBUTION,
        stateConfidence: 0.85,
        stateAgeSeconds: trigger.elapsedSecondsSinceTrigger,
        stateStartedAt: triggerTimestamp,
        stateEvidence: evidence
      };
    }

    // 4. Check Late Markup / Late Expansion
    if (distAtr >= 3.0 || (p1hVal > 0.08 && rsi15 > 70)) {
      evidence.push(`Impulse move is mature/late (+${(p1hVal * 100).toFixed(1)}% 1H, ${distAtr.toFixed(1)}x ATR)`);
      return {
        state: SetupState.LATE_MARKUP,
        stateConfidence: 0.82,
        stateAgeSeconds: trigger.elapsedSecondsSinceTrigger,
        stateStartedAt: triggerTimestamp,
        stateEvidence: evidence
      };
    }

    // 5. Check Late Markdown / Extended Downside
    if (distAtr >= 3.0 && p1hVal < -0.05) {
      evidence.push(`Downside move extended (${distAtr.toFixed(1)}x ATR below trigger)`);
      return {
        state: SetupState.LATE_MARKDOWN,
        stateConfidence: 0.80,
        stateAgeSeconds: trigger.elapsedSecondsSinceTrigger,
        stateStartedAt: triggerTimestamp,
        stateEvidence: evidence
      };
    }

    // 6. Check Bullish Ignition (Fresh breakout from pre-trigger compression)
    if (direction === 'LONG' && trigger.triggerFound && trigger.timingWindow === 'FRESH' && distAtr <= 1.5 && p5mVal >= 0.002) {
      evidence.push('Fresh consolidation breakout with positive 5m acceleration');
      evidence.push(`Price is ${distAtr.toFixed(1)}x ATR from trigger base (${trigger.elapsedSecondsSinceTrigger}s elapsed)`);
      if (trigger.preTriggerCompressionScore >= 70) {
        evidence.push('Pre-trigger compression confirmed');
      }
      return {
        state: SetupState.BULLISH_IGNITION,
        stateConfidence: 0.90,
        stateAgeSeconds: trigger.elapsedSecondsSinceTrigger,
        stateStartedAt: triggerTimestamp,
        stateEvidence: evidence
      };
    }

    // 7. Check Bearish Ignition (Fresh breakdown)
    if (direction === 'SHORT' && trigger.triggerFound && trigger.timingWindow === 'FRESH' && distAtr <= 1.5 && p5mVal <= -0.002) {
      evidence.push('Fresh consolidation breakdown with negative 5m acceleration');
      evidence.push(`Price is ${distAtr.toFixed(1)}x ATR below trigger base (${trigger.elapsedSecondsSinceTrigger}s elapsed)`);
      return {
        state: SetupState.BEARISH_IGNITION,
        stateConfidence: 0.90,
        stateAgeSeconds: trigger.elapsedSecondsSinceTrigger,
        stateStartedAt: triggerTimestamp,
        stateEvidence: evidence
      };
    }

    // 8. Check Early Markup (Developing uptrend, still within 1.5 - 2.5x ATR)
    if (direction === 'LONG' && trigger.isBreakoutConfirmed && distAtr <= 2.5 && p1hVal > 0.01) {
      evidence.push(`Breakout confirmed and advancing healthily (${distAtr.toFixed(1)}x ATR)`);
      return {
        state: SetupState.EARLY_MARKUP,
        stateConfidence: 0.84,
        stateAgeSeconds: trigger.elapsedSecondsSinceTrigger,
        stateStartedAt: triggerTimestamp,
        stateEvidence: evidence
      };
    }

    // 9. Check Early Markdown
    if (direction === 'SHORT' && trigger.isBreakoutConfirmed && distAtr <= 2.5 && p1hVal < -0.01) {
      evidence.push(`Breakdown confirmed and declining healthily (${distAtr.toFixed(1)}x ATR)`);
      return {
        state: SetupState.EARLY_MARKDOWN,
        stateConfidence: 0.84,
        stateAgeSeconds: trigger.elapsedSecondsSinceTrigger,
        stateStartedAt: triggerTimestamp,
        stateEvidence: evidence
      };
    }

    // 10. Check Pre-Breakout Long (Consolidation tight, pressing resistance, not yet broken)
    if (trigger.timingWindow === 'PRE_TRIGGER' && trigger.preTriggerCompressionScore >= 70 && rs.longScore > rs.shortScore) {
      evidence.push('Volatility compressed at resistance boundary, awaiting ignition');
      return {
        state: SetupState.PRE_BREAKOUT_LONG,
        stateConfidence: 0.75,
        stateAgeSeconds: 0,
        stateStartedAt: Date.now(),
        stateEvidence: evidence
      };
    }

    // 11. Check Pre-Breakdown Short
    if (trigger.timingWindow === 'PRE_TRIGGER' && trigger.preTriggerCompressionScore >= 70 && rs.shortScore > rs.longScore) {
      evidence.push('Volatility compressed at support boundary, awaiting breakdown');
      return {
        state: SetupState.PRE_BREAKDOWN_SHORT,
        stateConfidence: 0.75,
        stateAgeSeconds: 0,
        stateStartedAt: Date.now(),
        stateEvidence: evidence
      };
    }

    // 12. Check Accumulation (Range compressed, low volatility, neutral momentum)
    if (trigger.timingWindow === 'PRE_TRIGGER' || Math.abs(p1hVal) < 0.02) {
      evidence.push('Range-bound consolidation / base building');
      return {
        state: SetupState.ACCUMULATION,
        stateConfidence: 0.70,
        stateAgeSeconds: 0,
        stateStartedAt: Date.now(),
        stateEvidence: evidence
      };
    }

    evidence.push('No distinct structural setup identified');
    return {
      state: SetupState.NO_SETUP,
      stateConfidence: 0.50,
      stateAgeSeconds: 0,
      stateStartedAt: Date.now(),
      stateEvidence: evidence
    };
  }
}
