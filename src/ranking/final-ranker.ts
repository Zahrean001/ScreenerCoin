// ============================================================
// Final Ranker — Scoring Gate, Rating, and Conflict Resolution
// ============================================================

import { 
  ScreenerCandidate, 
  ScreenerOutput, 
  MarketRegimeState, 
  Direction, 
  Rating, 
  LiquidityTier, 
  TickerData, 
  VolatilityState, 
  LongScoreBreakdown, 
  ShortScoreBreakdown, 
  ExecutionScore,
  Stage1Diagnostics,
  Stage3ExecutionResult,
  PipelineDiagnostics,
  TimingAnalysis,
  SignalCategory,
  SetupState,
  TimingWindow,
  EntryStatus,
  DiscoveryLane,
  TriggerState,
  DiscoveryLabel,
  MoveMaturity,
  EntryPotential,
  MTFConfluenceType,
  VWAPAnalysis, HTFContext,
  AbsorptionAnalysis,
  DataFreshness,
  CrossExchangeAnalysis
} from '../data/types.js';
import { CONFIG } from '../config.js';
import { CorrelationFilter } from './correlation.js';

export interface CandidateScores {
  symbol: string;
  longScore: LongScoreBreakdown;
  shortScore: ShortScoreBreakdown;
  executionScore: ExecutionScore | Stage3ExecutionResult;
  ticker: TickerData;
  volatility: VolatilityState;
  liquidityTier: LiquidityTier;
  priceChange5m?: number | null;
  priceChange1h?: number | null;
  timing?: TimingAnalysis;
  signalCategory?: SignalCategory;
  discoveryLabel?: DiscoveryLabel;
  moveMaturity?: MoveMaturity;
  entryPotential?: EntryPotential;
  mtfConfluence?: MTFConfluenceType;
  htfContext?: HTFContext | null;
  oiCapitalFlow?: string;
  vwapAnalysis?: VWAPAnalysis | null;
  absorption?: AbsorptionAnalysis | null;
  freshness?: DataFreshness;
  crossExchange?: CrossExchangeAnalysis;
  actionableBlocked?: boolean;
  setupState?: SetupState;
  timingWindow?: TimingWindow;
  entryStatus?: EntryStatus;
  actionabilityScore?: number;
  momentumStrengthScore?: number;
  extensionScore?: number;
  remainingMoveScore?: number;
  elapsedSecondsSinceTrigger?: number;
  secondsSinceTrigger?: number;
  confirmationTimestamp?: number;
  secondsSinceConfirmation?: number;
  discoveryLane?: DiscoveryLane;
  triggerState?: TriggerState;
}

export class FinalRanker {
  constructor(private correlationFilter: CorrelationFilter) {}

  rank(
    candidates: CandidateScores[],
    sectorMap: Map<string, string>,
    regime: MarketRegimeState,
    btcTicker: TickerData,
    hotQueueSize: number,
    scanLatencyMs: number,
    pipelineMeta?: {
      universeSize?: number;
      eligibleSymbols?: number;
      stage1Candidates?: number;
      stage1Diagnostics?: Stage1Diagnostics;
    }
  ): ScreenerOutput {
    let ranked: ScreenerCandidate[] = [];

    let rejectedWeakTrend = 0;
    let rejectedWeakMomentum = 0;
    let rejectedFundingConflict = 0;
    let rejectedLowCompleteness = 0;
    let rejectedLateChase = 0;
    let rejectedDistribution = 0;
    let rejectedExecutionRisk = 0;
    let rejectedScoreThreshold = 0;

    const quarantinedCandidates: ScreenerCandidate[] = [];

    for (const c of candidates) {
      let direction: Direction = 'REJECT';
      
      const isConflict = c.longScore.total >= CONFIG.CONFLICT_THRESHOLD && 
                         c.shortScore.total >= CONFIG.CONFLICT_THRESHOLD && 
                         Math.abs(c.longScore.total - c.shortScore.total) < CONFIG.DIRECTION_MARGIN;

      if (isConflict) {
        direction = 'WAIT';
        rejectedFundingConflict++;
      } else if (c.longScore.total >= c.shortScore.total + CONFIG.DIRECTION_MARGIN) {
        direction = 'LONG';
      } else if (c.shortScore.total >= c.longScore.total + CONFIG.DIRECTION_MARGIN) {
        direction = 'SHORT';
      } else {
        direction = 'WAIT';
        rejectedFundingConflict++;
      }

      const htfModifier = c.htfContext?.dataCompleteness === 1
        ? (direction === 'LONG'
          ? (c.htfContext.macroBias === 'LONG' ? 6 : c.htfContext.macroBias === 'SHORT' ? -8 : 0)
          : (c.htfContext.macroBias === 'SHORT' ? 6 : c.htfContext.macroBias === 'LONG' ? -8 : 0))
        : 0;
      const opportunityScore = direction === 'LONG' 
        ? Math.max(0, Math.min(100, c.longScore.total + htfModifier))
        : direction === 'SHORT' 
          ? Math.max(0, Math.min(100, c.shortScore.total + htfModifier))
          : Math.max(c.longScore.total, c.shortScore.total);

      // P1 #4: Cross-Exchange modifier (bounded strictly to [-5, +5])
      const rawCrossMod = c.crossExchange?.scoreModifier ?? c.timing?.crossExchange?.scoreModifier ?? 0;
      const crossMod = Math.max(-5, Math.min(5, rawCrossMod));

      const finalScore = Math.max(0, Math.min(100,
        (CONFIG.OPPORTUNITY_WEIGHT * opportunityScore) +
        (CONFIG.EXECUTION_WEIGHT * c.executionScore.total) +
        crossMod
      ));

      let rating: Rating = 'REJECT';
      if (finalScore >= CONFIG.RATING_AP) rating = 'A+';
      else if (finalScore >= CONFIG.RATING_A) rating = 'A';
      else if (finalScore >= CONFIG.RATING_BP) rating = 'B+';
      else if (finalScore >= CONFIG.RATING_WATCH) rating = 'WATCH';

      const primaryBreakdown = direction === 'LONG' ? c.longScore : c.shortScore;
      const dataCompleteness = (primaryBreakdown.dataCompleteness * 0.75) + 
                               ((c.executionScore.dataCompleteness ?? 0.8) * 0.25);

      // Diagnostic tallying
      if (primaryBreakdown.trend < 6) rejectedWeakTrend++;
      if (primaryBreakdown.momentum < 5) rejectedWeakMomentum++;
      if (c.executionScore.total < 40) rejectedExecutionRisk++;

      // P1 #5: Check minimum data completeness requirement
      const minCompleteness = (CONFIG as any).MIN_DATA_COMPLETENESS ?? 0.60;
      if (dataCompleteness < minCompleteness) {
        rejectedLowCompleteness++;
        continue; // reject candidates without sufficient observed data
      }

      if (finalScore < CONFIG.MIN_FINAL_SCORE) {
        rejectedScoreThreshold++;
      }

      if (direction === 'LONG' || direction === 'SHORT') {
        const reasons = [...primaryBreakdown.modifiers.map(m => m.name)];
        if (c.timing) {
          reasons.unshift(`${c.timing.phase.label}: ${c.timing.moveMaturity}`);
        }
        const crossEx = c.crossExchange ?? c.timing?.crossExchange;
        if (crossEx && crossMod !== 0) {
          reasons.push(`Cross-Ex: ${crossEx.status} (${crossMod > 0 ? '+' : ''}${crossMod})`);
        }
        
        const p5m = c.priceChange5m !== undefined ? c.priceChange5m : null;
        const p1h = c.priceChange1h !== undefined ? c.priceChange1h : (c.ticker.prevPrice1h > 0 ? (c.ticker.lastPrice - c.ticker.prevPrice1h) / c.ticker.prevPrice1h : null);

        const signalCat = c.timing?.signalCategory ?? (direction === 'LONG' ? 'LONG_CONTINUATION' : 'SHORT_CONTINUATION');

        const candidate: ScreenerCandidate = {
          rank: 0,
          symbol: c.symbol,
          side: direction,
          finalScore,
          opportunityScore,
          executionScore: c.executionScore.total,
          rating,
          longScore: c.longScore.total,
          shortScore: c.shortScore.total,
          dataCompleteness,
          reasons: reasons.slice(0, 4),
          liquidityTier: c.liquidityTier,
          volatilityRegime: c.volatility.regime,
          price: c.ticker.lastPrice,
          priceChange5m: p5m,
          priceChange1h: p1h,
          priceChange24h: c.ticker.price24hPcnt,
          volume24h: c.ticker.volume24h,
          openInterestValue: c.ticker.openInterestValue,
          fundingRate: c.ticker.fundingRate,
          timing: c.timing,
          signalCategory: signalCat,
          discoveryLabel: c.discoveryLabel ?? c.timing?.discoveryLabel,
          moveMaturity: c.moveMaturity ?? c.timing?.moveMaturity,
          entryPotential: c.entryPotential ?? c.timing?.entryPotential,
          mtfConfluence: c.mtfConfluence ?? c.timing?.mtfConfluence,
          htfContext: c.htfContext,
          oiCapitalFlow: c.oiCapitalFlow,
          vwapAnalysis: c.vwapAnalysis ?? c.timing?.vwapAnalysis,
          absorption: c.absorption ?? c.timing?.absorption,
          freshness: c.freshness ?? c.timing?.freshness,
          crossExchange: c.crossExchange ?? c.timing?.crossExchange,
          actionableBlocked: c.actionableBlocked ?? c.timing?.actionableBlocked ?? (c.freshness?.isStale === true),
          setupState: c.setupState,
          timingWindow: c.timingWindow,
          entryStatus: (c.actionableBlocked || c.timing?.actionableBlocked || (c.freshness?.isStale === true))
            ? 'WAITING'
            : (c.timing?.entryStatus ?? (
              (signalCat === 'EARLY_LONG' || signalCat === 'EARLY_SHORT' || signalCat === 'BASE_LONG' || signalCat === 'BASE_SHORT' || signalCat === 'PULLBACK_LONG' || signalCat === 'PULLBACK_SHORT' || signalCat === 'LONG_CONTINUATION' || signalCat === 'SHORT_CONTINUATION')
                ? 'ACTIONABLE_NOW'
                : (signalCat === 'LATE_LONG' || signalCat === 'LATE_SHORT')
                  ? 'WAIT_PULLBACK'
                  : 'WAITING'
            )),
          actionabilityScore: c.actionabilityScore,
          momentumStrengthScore: c.momentumStrengthScore,
          extensionScore: c.extensionScore,
          remainingMoveScore: c.remainingMoveScore,
          elapsedSecondsSinceTrigger: c.elapsedSecondsSinceTrigger,
          secondsSinceTrigger: c.timing?.secondsSinceTrigger ?? c.elapsedSecondsSinceTrigger,
          confirmationTimestamp: c.timing?.confirmationTimestamp,
          secondsSinceConfirmation: c.timing?.secondsSinceConfirmation,
          discoveryLane: c.discoveryLane,
          triggerState: c.triggerState
        };

        if (c.timing) {
          if (signalCat === 'NO_LONG') {
            if (c.timing.chaseRiskScore >= 70) rejectedLateChase++;
            if (c.timing.distributionRisk >= 70) rejectedDistribution++;
          } else if (signalCat === 'NO_SHORT') {
            if (c.timing.chaseRiskScore >= 70) rejectedLateChase++;
            if (c.timing.accumulationRisk >= 70) rejectedDistribution++;
          }

          // Capture candidates for Quarantined / Do Not Chase section
          if (c.timing.chaseRiskScore >= 55 || (c.timing.distanceFromTriggerATR ?? 0) >= 2.5 || candidate.entryStatus === 'TOO_LATE') {
            quarantinedCandidates.push(candidate);
          }
        }

        if (finalScore >= CONFIG.MIN_FINAL_SCORE) {
          ranked.push(candidate);
        }
      }
    }

    // Apply correlation penalty to diversify top picks
    ranked = this.correlationFilter.applyPenalty(ranked, sectorMap);
    
    // Multi-Tier Prioritization:
    // Tier 0: DECOUPLED_ALPHA (Leader outperforming BTC independently)
    // Tier 1: SHORT_SQUEEZE_CANDIDATE (Capital flow squeeze setup)
    // Tier 2: EARLY_LONG / EARLY_SHORT (Fresh Ignition)
    // Tier 3: BASE_LONG / BASE_SHORT (Pre-Breakout Base Compression)
    // Tier 4: PULLBACK_LONG / PULLBACK_SHORT (Orderly Pullback)
    // Tier 5: LONG_CONTINUATION / SHORT_CONTINUATION (Trend continuation)
    // Tier 6: LATE_LONG / LATE_SHORT (Watchlist only)
    // Tier 7: Others
    const getTier = (cand: ScreenerCandidate): number => {
      const cat = cand.signalCategory;
      const status = cand.entryStatus;
      if (cat === 'DECOUPLED_ALPHA') return 0;
      if (cat === 'SHORT_SQUEEZE_CANDIDATE') return 1;
      if (status === 'ACTIONABLE_NOW' || status === 'CONFIRMED') {
        if (cat === 'EARLY_LONG' || cat === 'EARLY_SHORT') return 2;
        if (cat === 'BASE_LONG' || cat === 'BASE_SHORT') return 3;
        if (cat === 'PULLBACK_LONG' || cat === 'PULLBACK_SHORT') return 4;
        if (cat === 'LONG_CONTINUATION' || cat === 'SHORT_CONTINUATION') return 5;
      }
      if (cat === 'LATE_LONG' || cat === 'LATE_SHORT' || status === 'WAIT_PULLBACK' || status === 'WAITING') return 6;
      return 7;
    };

    const getCompositeScore = (cand: ScreenerCandidate): number => {
      const opp = cand.opportunityScore;
      const timing = cand.timing?.timingScore ?? 50;
      const actionability = cand.actionabilityScore ?? 50;
      const exec = cand.executionScore;
      const chase = cand.timing?.chaseRiskScore ?? 30;
      return (actionability * 0.35) + (opp * 0.25) + (timing * 0.25) + (exec * 0.10) - (chase * 0.05);
    };

    ranked.sort((a, b) => {
      const tierA = getTier(a);
      const tierB = getTier(b);
      if (tierA !== tierB) return tierA - tierB;

      const scoreA = getCompositeScore(a);
      const scoreB = getCompositeScore(b);
      if (Math.abs(scoreB - scoreA) > 0.001) return scoreB - scoreA;
      if (Math.abs(b.finalScore - a.finalScore) > 0.001) return b.finalScore - a.finalScore;
      if (b.volume24h !== a.volume24h) return b.volume24h - a.volume24h;
      return a.symbol.localeCompare(b.symbol);
    });

    ranked.forEach((r, i) => { r.rank = i + 1; });

    // Strict Partitioning across 3 Sections
    const ACTIONABLE_CATS: SignalCategory[] = [
      'DECOUPLED_ALPHA', 
      'SHORT_SQUEEZE_CANDIDATE', 
      'EARLY_LONG', 
      'EARLY_SHORT', 
      'BASE_LONG', 
      'BASE_SHORT', 
      'PULLBACK_LONG', 
      'PULLBACK_SHORT', 
      'LONG_CONTINUATION', 
      'SHORT_CONTINUATION'
    ];
    const WATCHLIST_CATS: SignalCategory[] = [
      'DECOUPLED_ALPHA', 
      'SHORT_SQUEEZE_CANDIDATE', 
      'LONG_FLUSH_RISK', 
      'LATE_LONG', 
      'LATE_SHORT', 
      'BASE_LONG', 
      'BASE_SHORT'
    ];
    const REJECTED_CATS: SignalCategory[] = ['NO_LONG', 'NO_SHORT', 'NO_TRADE'];

    const actionableResults = ranked.filter(r => 
      ACTIONABLE_CATS.includes(r.signalCategory!) && 
      (r.entryStatus === 'ACTIONABLE_NOW' || r.entryStatus === 'CONFIRMED' || r.signalCategory === 'DECOUPLED_ALPHA') &&
      r.signalCategory !== 'LATE_LONG' &&
      r.signalCategory !== 'LATE_SHORT' &&
      (r.timing?.chaseRiskScore ?? 0) <= 45 &&
      !r.actionableBlocked &&
      r.freshness?.isStale !== true
    ).slice(0, CONFIG.MAX_RESULTS);

    const watchlist = ranked.filter(r => 
      !actionableResults.some(a => a.symbol === r.symbol) &&
      (WATCHLIST_CATS.includes(r.signalCategory!) || 
       r.entryStatus === 'WAIT_PULLBACK' || 
       r.entryStatus === 'WAITING' ||
       r.discoveryLane === 'LANE_D_HOT_MOVER')
    ).slice(0, 10);

    // Section 3: Do Not Chase / Quarantined
    const rejectedSignals = (quarantinedCandidates.length > 0 ? quarantinedCandidates : ranked.filter(r => 
      REJECTED_CATS.includes(r.signalCategory!) || 
      r.entryStatus === 'TOO_LATE' || 
      r.entryStatus === 'REJECTED'
    )).filter(r => !actionableResults.some(a => a.symbol === r.symbol)).slice(0, 10);

    const results = actionableResults;

    const stage3Candidates = candidates.filter(c => 
      'passed' in c.executionScore && (c.executionScore as Stage3ExecutionResult).passed === true
    ).length;

    const universeSize = pipelineMeta?.universeSize ?? candidates.length;
    const eligibleSymbols = pipelineMeta?.eligibleSymbols ?? candidates.length;
    const stage1Candidates = pipelineMeta?.stage1Candidates ?? candidates.length;
    const stage2Candidates = candidates.length;
    const qualifiedCandidates = actionableResults.length;

    const s1d = pipelineMeta?.stage1Diagnostics;
    const diagnostics: PipelineDiagnostics = {
      universeSize,
      eligibleSymbols,
      stage1Candidates,
      stage2Candidates,
      stage3Candidates,
      qualifiedCandidates,
      stage1: s1d,
      rejectionReasons: {
        stage1Inactive: s1d?.rejectedInactive ?? 0,
        stage1WrongContract: s1d?.rejectedWrongContract ?? 0,
        stage1LowLiquidity: s1d?.rejectedLowLiquidity ?? 0,
        stage1LowOI: s1d?.rejectedLowOI ?? 0,
        stage1WideSpread: s1d?.rejectedWideSpread ?? 0,
        stage1NoMovement: s1d?.rejectedNoMovement ?? 0,
        stage2WeakTrend: rejectedWeakTrend,
        stage2WeakMomentum: rejectedWeakMomentum,
        stage2Conflict: rejectedFundingConflict,
        stage2LowCompleteness: rejectedLowCompleteness,
        stage2LateChase: rejectedLateChase,
        stage2Distribution: rejectedDistribution,
        stage3ExecutionRisk: rejectedExecutionRisk,
        stage3ScoreThreshold: rejectedScoreThreshold,
        rejectedLowLiquidity: s1d?.rejectedLowLiquidity ?? 0,
        rejectedWeakTrend,
        rejectedWeakMomentum,
        rejectedFundingConflict,
        rejectedLowCompleteness,
        rejectedExecutionRisk,
        rejectedScoreThreshold,
        rejectedLateChase,
        rejectedDistribution
      }
    };

    return {
      timestamp: new Date().toISOString(),
      market: 'USDT_PERPETUAL',
      regime: regime.regime,
      btcPrice: btcTicker.lastPrice,
      btcChange1h: btcTicker.prevPrice1h > 0 ? (btcTicker.lastPrice - btcTicker.prevPrice1h) / btcTicker.prevPrice1h : 0,
      universeSize,
      eligibleSymbols,
      stage1Candidates,
      stage2Candidates,
      stage3Candidates,
      qualifiedCandidates,
      totalSymbols: universeSize,
      candidateCount: qualifiedCandidates,
      hotQueueSize,
      scanLatencyMs,
      results,
      actionableResults,
      watchlist,
      rejectedSignals,
      diagnostics
    };
  }
}
