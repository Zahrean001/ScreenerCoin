// ============================================================
// Stage 2 Signal Engine — Multi-Timeframe Scoring Orchestrator
// ============================================================

import { CandidateScores } from '../ranking/final-ranker.js';
import { 
  MarketRegimeState, 
  Timeframe, CandleTimeframe, HTFContext,
  TickerData, 
  CandleData, 
  IndicatorState, 
  VolatilityState, 
  LiquidityTier, 
  MarketStructure, 
  TrendState, 
  StructureType,
  OrderbookSnapshot, 
  TradeData, 
  LiquidationData,
  FundingState 
} from '../data/types.js';
import { CircularBuffer, NumericRingBuffer, TimestampedPriceRingBuffer } from '../data/circular-buffer.js';
import { LongEngine } from '../engines/long-engine.js';
import { ShortEngine } from '../engines/short-engine.js';
import { ExhaustionEngine } from '../engines/exhaustion.js';
import { BreakoutEngine } from '../engines/breakout.js';
import { SqueezeEngine } from '../engines/squeeze.js';
import { OIFundingEngine } from '../engines/oi-funding.js';
import { RelativeStrengthEngine } from '../indicators/relative-strength.js';
import { VolatilityEngine } from '../indicators/volatility.js';
import { CONFIG } from '../config.js';
import { Stage3Execution } from './stage3-execution.js';
import { TimingEngine } from '../engines/timing-engine.js';
import { MTFConfluenceEngine } from '../engines/mtf-confluence.js';
import { AbsorptionEngine } from '../engines/absorption.js';

export interface ScreenerHubProvider {
  tickers: Map<string, TickerData>;
  prevTickers: Map<string, TickerData>;
  historicalOIDeltas?: Map<string, any>;
  candles: Map<string, Map<CandleTimeframe, CircularBuffer<CandleData>>>;
  indicators: Map<string, IndicatorState>;
  volatilityHistory: Map<string, NumericRingBuffer>;
  orderbooks: Map<string, OrderbookSnapshot>;
  recentTrades: Map<string, CircularBuffer<TradeData>>;
  recentLiquidations: Map<string, CircularBuffer<LiquidationData>>;
  priceHistories?: Map<string, TimestampedPriceRingBuffer>;
  priceHistory5m?: Map<string, NumericRingBuffer>;
  fundingHistories?: Map<string, any>;
  fundingStates?: Map<string, FundingState>;
  getLongShortRatio?(symbol: string): { buyRatio: number; sellRatio: number; timestamp: number } | null;
  get5mReturn?(symbol: string, currentTs?: number): any;
  get15mReturn?(symbol: string, currentTs?: number): any;
  getUniverseReturn?(windowMs: number, currentTs?: number): number | null;
  getSectorReturn?(sector: string, windowMs: number, currentTs?: number): number | null;
  getCandles(symbol: string, tf: CandleTimeframe): CircularBuffer<CandleData> | undefined;
  getHTFContext?(symbol: string): HTFContext | null;
  getSymbolSector?(symbol: string): string;
}

export class Stage2Signal {
  constructor(
    private longEngine: LongEngine,
    private shortEngine: ShortEngine,
    private exhaustionEngine: ExhaustionEngine,
    private breakoutEngine: BreakoutEngine,
    private squeezeEngine: SqueezeEngine,
    private oiFundingEngine: OIFundingEngine,
    private relativeStrengthEngine: RelativeStrengthEngine,
    private volatilityEngine: VolatilityEngine,
    private stage3Execution: Stage3Execution,
    private timingEngine: TimingEngine = new TimingEngine(),
    private mtfEngine: MTFConfluenceEngine = new MTFConfluenceEngine(),
    private absorptionEngine: AbsorptionEngine = new AbsorptionEngine()
  ) {}

  analyzeCandidate(
    symbol: string, 
    hub: ScreenerHubProvider, 
    regime: MarketRegimeState,
    tier: LiquidityTier = 'B',
    priceChange5m?: number | null,
    priceChange1h?: number | null,
    discoveryLane?: any,
    htfContext?: HTFContext | null
  ): CandidateScores | null {
    const ticker = hub.tickers.get(symbol);
    const prevTicker = hub.prevTickers.get(symbol) || null;
    const indicators = hub.indicators.get(symbol);

    if (!ticker || !indicators) return null;

    // Resolve genuine 5m and 1h returns if not provided by caller
    let p5m = priceChange5m;
    if (p5m === undefined) {
      if (hub.priceHistories?.has(symbol)) {
        p5m = hub.priceHistories.get(symbol)!.getReturnOverWindow(300_000, ticker.timestamp).value;
      } else {
        p5m = null;
      }
    }

    let p1h = priceChange1h;
    if (p1h === undefined) {
      if (hub.priceHistories?.has(symbol)) {
        p1h = hub.priceHistories.get(symbol)!.getReturnOverWindow(3600_000, ticker.timestamp).value;
      } else if (ticker.lastPrice > 0 && ticker.prevPrice1h > 0) {
        p1h = (ticker.lastPrice - ticker.prevPrice1h) / ticker.prevPrice1h;
      } else {
        p1h = null;
      }
    }

    const c5m = hub.getCandles(symbol, '5');
    const c15m = hub.getCandles(symbol, '15');
    const c1h = hub.getCandles(symbol, '60');
    if (!c5m || !c15m || !c1h) return null;
    const resolvedHtfContext = htfContext ?? hub.getHTFContext?.(symbol) ?? null;

    // 1. Volatility calculation
    let volHistory = hub.volatilityHistory.get(symbol);
    if (!volHistory) {
      volHistory = new NumericRingBuffer(100);
      hub.volatilityHistory.set(symbol, volHistory);
    }
    const volatility = this.volatilityEngine.computeVolatility(
      symbol,
      indicators,
      c5m,
      c15m,
      c1h,
      volHistory
    );

    // 2. OI & Real Funding analysis
    let fundingHistory: number[] = [];
    if (hub.fundingStates && hub.fundingStates.has(symbol)) {
      const fState = hub.fundingStates.get(symbol);
      if (fState && fState.history.length > 0) {
        fundingHistory = fState.history.map((h: any) => h.rate);
      }
    } else if (hub.fundingHistories && hub.fundingHistories.has(symbol)) {
      fundingHistory = hub.fundingHistories.get(symbol).getValues();
    }

    const lsRatioData = hub.getLongShortRatio ? hub.getLongShortRatio(symbol) : null;
    const oiDelta = (hub.historicalOIDeltas && hub.historicalOIDeltas.get(symbol)) || null;
    const p15mVal = hub.get15mReturn ? hub.get15mReturn(symbol).value : null;
    const oiFunding = this.oiFundingEngine.analyze(ticker, prevTicker, fundingHistory, lsRatioData, oiDelta, p15mVal);

    // 3. Genuine Relative Strength analysis vs Universe & Sector
    const symPriceHist = (hub.priceHistories && hub.priceHistories.get(symbol)) || hub.priceHistory5m?.get(symbol) || new NumericRingBuffer(60);
    const btcPriceHist = (hub.priceHistories && hub.priceHistories.get('BTCUSDT')) || hub.priceHistory5m?.get('BTCUSDT') || new NumericRingBuffer(60);
    const ethPriceHist = (hub.priceHistories && hub.priceHistories.get('ETHUSDT')) || hub.priceHistory5m?.get('ETHUSDT') || new NumericRingBuffer(60);

    const sectorName = hub.getSymbolSector ? hub.getSymbolSector(symbol) : 'OTHER';
    const sectorReturn = hub.getSectorReturn ? hub.getSectorReturn(sectorName, 300_000, ticker.timestamp) : null;
    const universeReturn = hub.getUniverseReturn ? hub.getUniverseReturn(300_000, ticker.timestamp) : null;

    const rsResult = this.relativeStrengthEngine.compute(
      symbol,
      symPriceHist,
      btcPriceHist,
      ethPriceHist,
      sectorReturn,
      universeReturn,
      300_000
    );

    // 4. Genuine Market Structure Detection (without lookahead)
    const structure: Record<Timeframe, MarketStructure> = {
      '5': this.estimateStructure(c5m),
      '15': this.estimateStructure(c15m),
      '60': this.estimateStructure(c1h)
    };

    // 5. Orderbook & Liquidations
    const orderbook = hub.orderbooks.get(symbol) || null;
    const recentLiqs = hub.recentLiquidations.get(symbol)?.toArray() || [];

    // 6. Base Long and Short Scores
    const longScore = this.longEngine.score(
      indicators,
      ticker,
      volatility,
      structure,
      oiFunding,
      rsResult,
      orderbook,
      recentLiqs,
      regime
    );

    const shortScore = this.shortEngine.score(
      indicators,
      ticker,
      volatility,
      structure,
      oiFunding,
      rsResult,
      orderbook,
      recentLiqs,
      regime
    );

    // 7. Exhaustion Modifier (using genuine 1h return)
    const exhaustion = this.exhaustionEngine.analyze(ticker, indicators, volatility, oiFunding, p1h);
    if (exhaustion.longPenalty !== 0 || exhaustion.longReversalBonus !== 0) {
      longScore.total = Math.max(0, Math.min(100, longScore.total + exhaustion.longPenalty + exhaustion.longReversalBonus));
      if (exhaustion.longPenalty < 0) {
        longScore.modifiers.push({ name: 'Bullish Exhaustion Penalty', value: exhaustion.longPenalty, reason: 'RSI/OI/Funding overextended' });
      }
      if (exhaustion.longReversalBonus > 0) {
        longScore.modifiers.push({ name: 'Bearish Reversal Opportunity', value: exhaustion.longReversalBonus, reason: 'Oversold bounce potential' });
      }
    }

    if (exhaustion.shortPenalty !== 0 || exhaustion.shortReversalBonus !== 0) {
      shortScore.total = Math.max(0, Math.min(100, shortScore.total + exhaustion.shortPenalty + exhaustion.shortReversalBonus));
      if (exhaustion.shortPenalty < 0) {
        shortScore.modifiers.push({ name: 'Bearish Exhaustion Penalty', value: exhaustion.shortPenalty, reason: 'Oversold selling climax' });
      }
      if (exhaustion.shortReversalBonus > 0) {
        shortScore.modifiers.push({ name: 'Bullish Reversal Opportunity', value: exhaustion.shortReversalBonus, reason: 'Overbought reversal short setup' });
      }
    }

    // 8. Breakout Modifier
    const breakout = this.breakoutEngine.analyze(c15m, c1h, ticker, indicators, oiFunding);
    if (breakout.bullishBreakout) {
      longScore.total = Math.min(100, longScore.total + breakout.breakoutScore);
      longScore.modifiers.push({ name: 'Bullish Breakout Confirmed', value: breakout.breakoutScore, reason: 'Price broke resistance with vol/OI' });
    } else if (breakout.failedBullishBreakout) {
      shortScore.total = Math.min(100, shortScore.total + 10);
      shortScore.modifiers.push({ name: 'Failed Breakout Short', value: 10, reason: 'Bull trap rejection at resistance' });
    }

    if (breakout.bearishBreakdown) {
      shortScore.total = Math.min(100, shortScore.total + breakout.breakoutScore);
      shortScore.modifiers.push({ name: 'Bearish Breakdown Confirmed', value: breakout.breakoutScore, reason: 'Price lost support with vol/OI' });
    } else if (breakout.failedBearishBreakdown) {
      longScore.total = Math.min(100, longScore.total + 10);
      longScore.modifiers.push({ name: 'Failed Breakdown Long', value: 10, reason: 'Bear trap reclaim at support' });
    }

    // 9. Squeeze Modifier (using genuine 5m return)
    const squeeze = this.squeezeEngine.analyze(ticker, prevTicker, recentLiqs, oiFunding, indicators, p5m);
    if (squeeze.shortSqueeze && squeeze.longBonus > 0) {
      longScore.total = Math.min(100, longScore.total + squeeze.longBonus);
      longScore.modifiers.push({ name: 'Short Squeeze Momentum', value: squeeze.longBonus, reason: 'Short cascade acceleration' });
    }
    if (squeeze.longSqueeze && squeeze.shortBonus > 0) {
      shortScore.total = Math.min(100, shortScore.total + squeeze.shortBonus);
      shortScore.modifiers.push({ name: 'Long Squeeze Cascade', value: squeeze.shortBonus, reason: 'Long cascade liquidation' });
    }

    // 10. Direction-Aware Execution Quality (Stage 3)
    const primaryDirection: 'LONG' | 'SHORT' = longScore.total >= shortScore.total ? 'LONG' : 'SHORT';
    const recentTrades = hub.recentTrades.get(symbol)?.toArray() || [];
    const executionScore = this.stage3Execution.analyze(symbol, orderbook, ticker, recentTrades, primaryDirection);

    // 11. Phase 3: Market Phase, Early Momentum, & Entry Timing Engine
    const opportunityScore = Math.max(longScore.total, shortScore.total);
    const mtfResult = this.mtfEngine.analyze(indicators, structure, ticker);

    const timing = this.timingEngine.analyze(
      ticker,
      indicators,
      volatility,
      c5m,
      c15m,
      c1h,
      oiFunding,
      rsResult,
      primaryDirection,
      opportunityScore,
      p5m,
      p1h,
      discoveryLane,
      orderbook,
      !!longScore.isDecoupledAlpha,
      mtfResult.type
    );

    const absorption = this.absorptionEngine.analyze(
      primaryDirection,
      ticker.lastPrice,
      indicators,
      c15m,
      recentTrades,
      orderbook,
      timing.vwapAnalysis ?? null
    );
    timing.absorption = absorption;
    if (absorption.event === 'BULLISH_ABSORPTION' && primaryDirection === 'LONG') {
      timing.actionabilityScore = Math.min(100, (timing.actionabilityScore ?? 0) + 4);
    } else if (absorption.event === 'BEARISH_ABSORPTION' && primaryDirection === 'SHORT') {
      timing.actionabilityScore = Math.min(100, (timing.actionabilityScore ?? 0) + 4);
    }

    return {
      symbol,
      longScore,
      shortScore,
      executionScore,
      ticker,
      volatility,
      liquidityTier: tier,
      priceChange5m: p5m,
      priceChange1h: p1h,
      timing,
      signalCategory: timing.signalCategory,
      discoveryLabel: timing.discoveryLabel,
      moveMaturity: timing.moveMaturity,
      entryPotential: timing.entryPotential,
      mtfConfluence: timing.mtfConfluence ?? mtfResult.type,
      htfContext: resolvedHtfContext,
      oiCapitalFlow: oiFunding.capitalFlowLabel,
      vwapAnalysis: timing.vwapAnalysis,
      absorption,
      setupState: timing.setupState,
      timingWindow: timing.timingWindow,
      entryStatus: timing.entryStatus,
      actionabilityScore: timing.actionabilityScore,
      momentumStrengthScore: timing.momentumStrengthScore,
      extensionScore: timing.extensionScore,
      remainingMoveScore: timing.remainingMoveScore,
      elapsedSecondsSinceTrigger: timing.elapsedSecondsSinceTrigger,
      secondsSinceTrigger: timing.secondsSinceTrigger ?? timing.elapsedSecondsSinceTrigger,
      confirmationTimestamp: timing.confirmationTimestamp,
      secondsSinceConfirmation: timing.secondsSinceConfirmation,
      discoveryLane: timing.discoveryLane,
      triggerState: timing.triggerState
    };
  }

  /**
   * Genuine Market Structure estimation via confirmed Swing Highs and Swing Lows (pivot points).
   * Uses adaptive confirmation radius (tries k=2, falls back to k=1 if too few pivots).
   * Strictly uses past confirmed bars (no lookahead bias).
   */
  public estimateStructure(candles: CircularBuffer<CandleData>): MarketStructure {
    const list = candles.toArray();
    if (list.length < 5) {
      return {
        trend: TrendState.NEUTRAL,
        lastSwingHigh: 0,
        lastSwingLow: 0,
        structures: [],
        confirmedPivotsCount: 0
      };
    }

    interface Pivot {
      type: 'HIGH' | 'LOW';
      price: number;
      index: number;
    }

    const findPivots = (k: number): Pivot[] => {
      const result: Pivot[] = [];
      for (let i = k; i < list.length - k; i++) {
        const currHigh = list[i].high;
        const currLow = list[i].low;

        let isHigh = true;
        let isLow = true;

        for (let j = 1; j <= k; j++) {
          // Use strictly-greater for neighbours: a pivot high must be strictly higher than all k neighbours
          if (list[i - j].high > currHigh || list[i + j].high > currHigh) isHigh = false;
          if (list[i - j].low < currLow || list[i + j].low < currLow) isLow = false;
        }

        if (isHigh) result.push({ type: 'HIGH', price: currHigh, index: i });
        if (isLow) result.push({ type: 'LOW', price: currLow, index: i });
      }
      return result;
    };

    // Try k=2 first for stronger confirmation; fall back to k=1 if insufficient pivots
    let pivots = findPivots(2);
    if (pivots.length < 3 && list.length >= 5) {
      pivots = findPivots(1);
    }

    if (pivots.length < 2) {
      const latest = list[list.length - 1];
      const prev = list[list.length - 2];
      return {
        trend: latest.close > prev.close ? TrendState.BULLISH : latest.close < prev.close ? TrendState.BEARISH : TrendState.NEUTRAL,
        lastSwingHigh: list.reduce((max, c) => Math.max(max, c.high), 0),
        lastSwingLow: list.reduce((min, c) => Math.min(min, c.low), Infinity),
        structures: [],
        confirmedPivotsCount: pivots.length
      };
    }

    // Classify swing structures by comparing successive highs and successive lows
    const structures: StructureType[] = [];
    let lastHigh: Pivot | null = null;
    let prevHigh: Pivot | null = null;
    let lastLow: Pivot | null = null;
    let prevLow: Pivot | null = null;

    for (const p of pivots) {
      if (p.type === 'HIGH') {
        prevHigh = lastHigh;
        lastHigh = p;
        if (prevHigh) {
          if (lastHigh.price > prevHigh.price) structures.push(StructureType.HIGHER_HIGH);
          else if (lastHigh.price < prevHigh.price) structures.push(StructureType.LOWER_HIGH);
        }
      } else {
        prevLow = lastLow;
        lastLow = p;
        if (prevLow) {
          if (lastLow.price > prevLow.price) structures.push(StructureType.HIGHER_LOW);
          else if (lastLow.price < prevLow.price) structures.push(StructureType.LOWER_LOW);
        }
      }
    }

    const hasHH = structures.includes(StructureType.HIGHER_HIGH);
    const hasHL = structures.includes(StructureType.HIGHER_LOW);
    const hasLH = structures.includes(StructureType.LOWER_HIGH);
    const hasLL = structures.includes(StructureType.LOWER_LOW);

    let trend = TrendState.NEUTRAL;
    if (hasHH && hasHL && !hasLL) {
      trend = TrendState.STRONG_BULLISH;
    } else if (hasHH || (hasHL && !hasLL)) {
      trend = TrendState.BULLISH;
    } else if (hasLH && hasLL && !hasHH) {
      trend = TrendState.STRONG_BEARISH;
    } else if (hasLL || (hasLH && !hasHH)) {
      trend = TrendState.BEARISH;
    }

    return {
      trend,
      lastSwingHigh: lastHigh?.price ?? list[list.length - 1].high,
      lastSwingLow: lastLow?.price ?? list[list.length - 1].low,
      structures,
      confirmedPivotsCount: pivots.length
    };
  }
}
