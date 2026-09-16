// ============================================================
// Core Type Definitions — USDT Perpetual Screener
// ============================================================

// ---- Exchange / Instrument Metadata ----

export interface SymbolInfo {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  settleCoin: string;
  status: string;
  contractType: string;
  tickSize: number;
  qtyStep: number;
  minOrderQty: number;
  maxLeverage: number;
  fundingInterval: number; // minutes
  launchTime: number;
}

// ---- Market Data ----

export interface TickerData {
  symbol: string;
  lastPrice: number;
  markPrice: number;
  indexPrice: number;
  bid1Price: number;
  bid1Size: number;
  ask1Price: number;
  ask1Size: number;
  highPrice24h: number;
  lowPrice24h: number;
  prevPrice24h: number;
  prevPrice1h: number;
  price24hPcnt: number;
  volume24h: number;      // base coin
  turnover24h: number;    // USDT
  openInterest: number;   // base coin
  openInterestValue: number; // USDT
  fundingRate: number;
  nextFundingTime: number;
  timestamp: number;
}

export interface CandleData {
  timestamp: number;   // start time ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;      // base coin
  turnover: number;    // USDT
  confirmed: boolean;
}

export interface TradeData {
  timestamp: number;
  symbol: string;
  side: 'Buy' | 'Sell';
  price: number;
  size: number;
}

export interface LiquidationData {
  timestamp: number;
  symbol: string;
  side: 'Buy' | 'Sell'; // Buy = short liquidated, Sell = long liquidated
  price: number;
  size: number;
}

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface OrderbookSnapshot {
  symbol: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp: number;
  updateId: number;
}

// ---- Metric Metadata ----

export interface PriceWindowMetric {
  value: number | null; // e.g. +0.035 for +3.5%
  sourceTimestamp: number;
  referenceTimestamp: number;
  window: '5m' | '15m' | '1h';
  dataPointsAvailable: number;
}

// ---- VWAP Multi-Anchor & Bands Types ----
export interface VWAPBandState {
  vwap: number | null;
  upperBand1: number | null; // +1.0σ (Value Area High / Retest Zone)
  lowerBand1: number | null; // -1.0σ (Value Area Low / Retest Zone)
  upperBand2: number | null; // +2.0σ (Exhaustion / Do Not Chase)
  lowerBand2: number | null; // -2.0σ (Exhaustion / Do Not Chase)
  upperBand3: number | null; // +3.0σ (Climax Anomaly)
  lowerBand3: number | null; // -3.0σ (Climax Anomaly)
  sigma: number | null;
  anchorTimestamp: number;
}

export type VWAPAlignment = 
  | 'TRIPLE_BULLISH_STACK' 
  | 'TRIPLE_BEARISH_STACK' 
  | 'BULLISH_STACK' 
  | 'BEARISH_STACK' 
  | 'CHOPPY_VWAP';

export type VWAPBandPosition = 
  | 'INSIDE_VALUE_AREA' 
  | 'RETEST_BAND_1' 
  | 'EXHAUSTED_BAND_2' 
  | 'CLIMAX_BAND_3';

export interface VWAPAnalysis {
  sessionVwap: VWAPBandState | null;
  weeklyVwap: VWAPBandState | null;
  monthlyVwap: VWAPBandState | null;
  alignment: VWAPAlignment;
  bandPosition: VWAPBandPosition;
  isRetestingBand1: boolean;
  isExhaustedBand2: boolean;
  isClimaxBand3: boolean;
  warning?: string | null;
}

export type AbsorptionEvent =
  | 'BULLISH_ABSORPTION'
  | 'BEARISH_ABSORPTION'
  | 'ABSORPTION_UNCONFIRMED';

export interface AbsorptionAnalysis {
  event: AbsorptionEvent;
  confidence: number;
  aggressiveSellRatio: number;
  aggressiveBuyRatio: number;
  volumeRatio: number | null;
  rejectionWickPercent: number | null;
  location: 'VWAP_SUPPORT' | 'VWAP_RESISTANCE' | 'STRUCTURAL' | 'UNCONFIRMED';
  trappedSide?: 'SHORT_SELLERS' | 'LONG_BUYERS';
  evidence: string[];
}

// ---- Indicator State ----

export interface IndicatorState {
  // EMA values per timeframe
  ema9: Record<Timeframe, number | null>;
  ema21: Record<Timeframe, number | null>;
  ema50: Record<Timeframe, number | null>;

  // ATR
  atr14: Record<Timeframe, number | null>;
  atrPercent: Record<Timeframe, number | null>;

  // RSI
  rsi14: Record<Timeframe, number | null>;

  // ROC
  roc5: Record<Timeframe, number | null>;
  roc14: Record<Timeframe, number | null>;

  // VWAP
  vwap: Record<Timeframe, number | null>;
  sessionVwap?: VWAPBandState | null;
  weeklyVwap?: VWAPBandState | null;
  monthlyVwap?: VWAPBandState | null;
  vwapAnalysis?: VWAPAnalysis | null;

  // Volume
  volumeSma20: Record<Timeframe, number | null>;
  volumeRatio: Record<Timeframe, number | null>;

  // Derived
  lastUpdate: number;
}

export interface VolatilityState {
  atrPercent5m: number;
  atrPercent15m: number;
  atrPercent1h: number;
  realizedVol: number;
  rangeExpansion: number;
  volatilityPercentile: number; // 0-100
  regime: VolatilityRegime;
}

export const enum VolatilityRegime {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  ELEVATED = 'ELEVATED',
  HIGH = 'HIGH',
  EXTREME = 'EXTREME',
}

// ---- Market Structure ----

export const enum StructureType {
  HIGHER_HIGH = 'HH',
  HIGHER_LOW = 'HL',
  LOWER_HIGH = 'LH',
  LOWER_LOW = 'LL',
}

export const enum TrendState {
  STRONG_BULLISH = 'STRONG_BULLISH',
  BULLISH = 'BULLISH',
  NEUTRAL = 'NEUTRAL',
  BEARISH = 'BEARISH',
  STRONG_BEARISH = 'STRONG_BEARISH',
}

export interface MarketStructure {
  trend: TrendState;
  lastSwingHigh: number;
  lastSwingLow: number;
  structures: StructureType[];
  confirmedPivotsCount: number;
}

// ---- Phase 3: Market Phase & Timing Engine Types ----

export const enum MarketPhase {
  ACCUMULATION = 'ACCUMULATION',
  MANIPULATION = 'MANIPULATION',
  MARKUP = 'MARKUP',
  LATE_EXPANSION = 'LATE_EXPANSION',
  DISTRIBUTION = 'DISTRIBUTION',
  MARKDOWN = 'MARKDOWN',
  CAPITULATION = 'CAPITULATION',
  NEUTRAL = 'NEUTRAL',
}

export interface PhaseClassification {
  label: MarketPhase;
  confidence: number; // 0.0 - 1.0
  evidence: string[];
}

export type MoveMaturity = 'EARLY' | 'DEVELOPING' | 'MATURE' | 'LATE' | 'EXHAUSTED';

export type EntryPotential = 'HIGH' | 'MEDIUM' | 'LOW';

export type DiscoveryLabel = 
  | 'DECOUPLED_ALPHA'
  | 'FRESH_BREAKOUT'
  | 'EARLY_ROTATION'
  | 'OI_SUPPORTED_MOMENTUM'
  | 'SHORT_SQUEEZE_CANDIDATE'
  | 'LONG_FLUSH_RISK'
  | 'PRE_BREAKOUT_BASE'
  | 'LATE_MOVER'
  | 'EXHAUSTED_MOVE'
  | 'STANDARD_MOMENTUM';

export type MTFConfluenceType = 
  | 'MULTI_TIMEFRAME_ALIGNMENT'
  | 'SHORT_TERM_MOMENTUM'
  | 'COUNTER_TREND_CANDIDATE'
  | 'EARLY_ROTATION'
  | 'LATE_EXPANSION'
  | 'CHOPPY_ALIGNMENT';

export interface OIDeltaSnapshot {
  symbol: string;
  currentOI: number;
  oi15mAgo: number;
  oi1hAgo: number;
  oiChange15mPct: number;
  oiChange1hPct: number;
  timestamp: number;
}

export type SignalCategory = 
  | 'DECOUPLED_ALPHA'
  | 'SHORT_SQUEEZE_CANDIDATE'
  | 'LONG_FLUSH_RISK'
  | 'EARLY_LONG'
  | 'BASE_LONG'
  | 'LONG_CONTINUATION'
  | 'PULLBACK_LONG'
  | 'LATE_LONG'
  | 'NO_LONG'
  | 'EARLY_SHORT'
  | 'BASE_SHORT'
  | 'SHORT_CONTINUATION'
  | 'PULLBACK_SHORT'
  | 'LATE_SHORT'
  | 'NO_SHORT'
  | 'NO_TRADE';

export type LiquiditySweepType = 
  | 'BULLISH_LIQUIDITY_SWEEP'
  | 'BEARISH_LIQUIDITY_SWEEP'
  | 'FALSE_BREAKOUT'
  | 'FALSE_BREAKDOWN'
  | 'NONE';

// ---- Phase 4 Setup State & Trigger Event Types ----

export const enum SetupState {
  NO_SETUP = 'NO_SETUP',
  ACCUMULATION = 'ACCUMULATION',
  PRE_BREAKOUT_LONG = 'PRE_BREAKOUT_LONG',
  BULLISH_IGNITION = 'BULLISH_IGNITION',
  EARLY_MARKUP = 'EARLY_MARKUP',
  LATE_MARKUP = 'LATE_MARKUP',
  DISTRIBUTION = 'DISTRIBUTION',
  PRE_BREAKDOWN_SHORT = 'PRE_BREAKDOWN_SHORT',
  BEARISH_IGNITION = 'BEARISH_IGNITION',
  EARLY_MARKDOWN = 'EARLY_MARKDOWN',
  LATE_MARKDOWN = 'LATE_MARKDOWN',
  CAPITULATION = 'CAPITULATION',
  WAIT_CONFIRMATION = 'WAIT_CONFIRMATION',
}

export interface SetupStateMachineResult {
  state: SetupState;
  stateConfidence: number; // 0.0 - 1.0
  stateAgeSeconds: number;
  stateStartedAt: number;
  stateEvidence: string[];
}

export type EntryStatus = 
  | 'WAITING'
  | 'TRIGGERED'
  | 'CONFIRMED'
  | 'ACTIONABLE_NOW'
  | 'WAIT_PULLBACK'
  | 'TOO_LATE'
  | 'REJECTED';

export type TriggerConfirmationStatus = 'UNCONFIRMED' | 'CONFIRMED' | 'FAILED';

export interface TriggerState {
  symbol: string;
  direction: Direction;
  triggerPrice: number;
  triggerTimestamp: number;          // exact time breakout/breakdown event began
  confirmationTimestamp?: number;    // exact time breakout/down confirmed
  triggerTimeframe: Timeframe;
  triggerType: string;
  preTriggerRangeHigh: number;
  preTriggerRangeLow: number;
  preTriggerDurationBars?: number;
  preTriggerDurationSeconds?: number;
  preTriggerCompressionScore?: number;
  breakoutDistance: number;
  breakoutVolumeRatio: number;
  breakoutOIChange: number;
  confirmationStatus: TriggerConfirmationStatus;
  invalidationReason?: string;
}

export type TimingWindow = 
  | 'PRE_TRIGGER'
  | 'TRIGGERING'
  | 'FRESH'
  | 'DEVELOPING'
  | 'MATURE'
  | 'LATE'
  | 'EXHAUSTED';

export type DiscoveryLane = 
  | 'LANE_A_PRE_BREAKOUT'
  | 'LANE_B_BULLISH_IGNITION'
  | 'LANE_C_BEARISH_IGNITION'
  | 'LANE_D_HOT_MOVER';

export interface TimingAnalysis {
  phase: PhaseClassification;
  setupState?: SetupState;
  timingWindow?: TimingWindow;
  entryStatus?: EntryStatus;
  earlyMomentumScore: number;         // 0 - 100
  momentumIgnitionScore: number;      // 0 - 100
  momentumStrengthScore?: number;     // 0 - 100
  momentumDecelerationScore: number;  // 0 - 100
  preTriggerCompressionScore?: number;// 0 - 100
  extensionScore?: number;            // 0 - 100
  remainingMoveScore?: number;        // 0 - 100
  actionabilityScore?: number;        // 0 - 100
  moveMaturity: MoveMaturity;
  moveMaturityScore: number;          // 0 - 100 (higher = older/more mature)
  signalFreshness: number;            // 0 - 100 (higher = newer trigger)
  chaseRiskScore: number;             // 0 - 100 (higher = riskier to chase)
  distributionRisk: number;           // 0 - 100
  accumulationRisk: number;           // 0 - 100
  distanceFromTriggerPct: number;     // percentage move from breakout/down origin
  distanceFromTriggerATR: number;     // ATR-normalized distance from trigger
  elapsedSecondsSinceTrigger?: number;// elapsed seconds since breakout/down
  secondsSinceTrigger?: number;       // alias for elapsedSecondsSinceTrigger
  confirmationTimestamp?: number;     // timestamp when trigger was confirmed
  secondsSinceConfirmation?: number;  // seconds elapsed since confirmation
  timingScore: number;                // 0 - 100 (composite timing quality)
  signalCategory: SignalCategory;
  sweepType: LiquiditySweepType;
  triggerState?: TriggerState;
  discoveryLane?: DiscoveryLane;
  discoveryLabel?: DiscoveryLabel;
  entryPotential?: EntryPotential;
  mtfConfluence?: MTFConfluenceType;
  orderbookImbalanceRatio?: number;
  orderbookConfidenceModifier?: number;
  orderbookWarning?: string | null;
  vwapAnalysis?: VWAPAnalysis | null;
  absorption?: AbsorptionAnalysis | null;
  antiChaseReasons: string[];
  decision: string;
}

// ---- Scoring ----

export interface LongScoreBreakdown {
  trend: number;          // 0-20
  momentum: number;       // 0-15
  relativeStrength: number; // 0-15
  volumeExpansion: number;  // 0-15
  openInterest: number;   // 0-10
  funding: number;        // 0-10
  orderbook: number;      // 0-10
  liquidation: number;    // 0-5
  rawScore: number;       // 0-100
  availableWeight: number; // e.g. 85 / 100
  normalizedScore: number;
  dataCompleteness: number; // 0.0 to 1.0
  total: number;          // final weighted score
  isDecoupledAlpha?: boolean;
  modifiers: ScoreModifier[];
}

export interface ShortScoreBreakdown {
  trend: number;          // 0-20
  momentum: number;       // 0-15
  relativeWeakness: number; // 0-15
  volumeExpansion: number;  // 0-15
  openInterest: number;   // 0-10
  funding: number;        // 0-10
  orderbook: number;      // 0-10
  liquidation: number;    // 0-5
  rawScore: number;       // 0-100
  availableWeight: number; // e.g. 85 / 100
  normalizedScore: number;
  dataCompleteness: number; // 0.0 to 1.0
  total: number;          // final weighted score
  isDecoupledAlpha?: boolean;
  modifiers: ScoreModifier[];
}

export interface ScoreModifier {
  name: string;
  value: number;  // positive = bonus, negative = penalty
  reason: string;
}

export interface ExecutionQualityResult {
  direction: 'LONG' | 'SHORT';
  slippageBps: number | null;
  executableNotional: number;
  spreadBps: number;
  depthScore: number;       // 0-40 (direction-aware book depth)
  slippageScore: number;    // 0-25 (actual multi-level execution fill vs ref price)
  spreadScore: number;      // 0-20
  tradeFreqScore: number;   // 0-15
  totalScore: number;       // 0-100
  availableWeight: number;  // weight of observed execution fields
  dataCompleteness: number; // 0.0 to 1.0
  reasons: string[];
}

export interface ExecutionScore {
  spread: number;         // 0-20
  bidDepth: number;       // 0-20
  askDepth: number;       // 0-20
  slippage: number;       // 0-25
  tradeFrequency: number; // 0-15
  total: number;          // 0-100
  direction?: 'LONG' | 'SHORT';
  slippageBps?: number | null;
  dataCompleteness?: number;
  availableWeight?: number;
  passed?: boolean;       // explicit Stage 3 execution pass gate
  reason?: string;        // explanation for pass/rejection
}

export interface Stage3ExecutionResult extends ExecutionScore {
  passed: boolean;
  reason: string;
}

// ---- Direction / Rating ----

export type Direction = 'LONG' | 'SHORT' | 'CONFLICT' | 'WAIT' | 'REJECT';

export type Rating = 'A+' | 'A' | 'B+' | 'WATCH' | 'REJECT';

export type LiquidityTier = 'A' | 'B' | 'C' | 'D';

// ---- Timeframes ----

export type Timeframe = '5' | '15' | '60';

export const TIMEFRAMES: readonly Timeframe[] = ['5', '15', '60'] as const;

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '5': 5 * 60 * 1000,
  '15': 15 * 60 * 1000,
  '60': 60 * 60 * 1000,
};

// ---- Market Regime ----

export const enum MarketRegime {
  STRONG_BULL = 'STRONG_BULL',
  BULL = 'BULL',
  NEUTRAL = 'NEUTRAL',
  BEAR = 'BEAR',
  STRONG_BEAR = 'STRONG_BEAR',
}

export interface MarketRegimeState {
  regime: MarketRegime;
  btcTrend: TrendState;
  btcMomentum: number;   // -100 to 100
  btcVolatility: VolatilityRegime;
  btcRealizedVol: number;
  btcVwapPosition: number; // % above/below VWAP
  longModifier: number;   // multiplier (e.g. 1.10)
  shortModifier: number;  // multiplier (e.g. 0.90)
  timestamp: number;
}

// ---- OI + Funding ----

export interface FundingSettlement {
  timestamp: number; // settlement timestamp ms (from Bybit /funding/history)
  rate: number;
}

export interface CurrentFundingState {
  rate: number;
  timestamp: number;
  nextFundingTime: number;
  periodStart: number;
  fundingIntervalMinutes: number;
}

export interface FundingState {
  symbol: string;
  history: FundingSettlement[];
  current: CurrentFundingState | null;
}

export const enum OIPriceState {
  LONG_BUILD = 'LONG_BUILD',       // Price ↑ + OI ↑
  SHORT_COVERING = 'SHORT_COVERING', // Price ↑ + OI ↓
  SHORT_BUILD = 'SHORT_BUILD',     // Price ↓ + OI ↑
  LONG_LIQUIDATION = 'LONG_LIQUIDATION', // Price ↓ + OI ↓
  NEUTRAL = 'NEUTRAL',
}

export interface OIFundingAnalysis {
  oiPriceState: OIPriceState;
  oiChangePercent: number;
  fundingRate: number;
  fundingPercentile: number | null; // 0-100 strictly vs historical settlements, or null if < 3
  fundingReady: boolean;            // true if historical settlements >= 3
  fundingHistoryCount: number;      // number of historical settlements available
  longShortRatio: number | null;    // >1 = more longs, or null if unobserved
  longShortRatioTimestamp?: number;
  crowdingState: CrowdingState;
  eventTag?: 'SHORT_SQUEEZE_CANDIDATE' | 'LONG_FLUSH_RISK' | 'OI_SUPPORTED_MOMENTUM' | 'REVERSAL_WATCH' | null;
  capitalFlowLabel?: string;
  longScore: number;   // contribution to LONG score
  shortScore: number;  // contribution to SHORT score
  dataCompleteness: number; // 0.0 to 1.0
}

export const enum CrowdingState {
  EXTREME_LONG = 'EXTREME_LONG',
  MODERATE_LONG = 'MODERATE_LONG',
  BALANCED = 'BALANCED',
  MODERATE_SHORT = 'MODERATE_SHORT',
  EXTREME_SHORT = 'EXTREME_SHORT',
}

// ---- Exhaustion ----

export interface ExhaustionAnalysis {
  bullishExhaustion: number;  // 0-100
  bearishExhaustion: number;  // 0-100
  longPenalty: number;        // 0 to -25
  shortPenalty: number;       // 0 to -25
  longReversalBonus: number;  // 0 to +15
  shortReversalBonus: number; // 0 to +15
  reasons: string[];
}

// ---- Breakout ----

export interface BreakoutAnalysis {
  bullishBreakout: boolean;
  bearishBreakdown: boolean;
  failedBullishBreakout: boolean;
  failedBearishBreakdown: boolean;
  breakoutScore: number;      // -20 to +20
  level: number;              // price level
  volumeConfirmed: boolean;
  oiConfirmed: boolean;
  reasons: string[];
}

// ---- Squeeze ----

export interface SqueezeAnalysis {
  shortSqueeze: boolean;
  longSqueeze: boolean;
  squeezeIntensity: number;  // 0-100
  longBonus: number;         // 0 to +10
  shortBonus: number;        // 0 to +10
  reasons: string[];
}

// ---- Hot Queue ----

export type HotTrigger =
  | 'PRICE_SPIKE'
  | 'VOLUME_SPIKE'
  | 'OI_SPIKE'
  | 'LIQUIDATION_SPIKE'
  | 'BREAKOUT'
  | 'BREAKDOWN'
  | 'RS_SHIFT'
  | 'SPREAD_NORMALIZE';

export interface HotEvent {
  symbol: string;
  triggers: HotTrigger[];
  trigger?: HotTrigger;   // backwards compatibility alias for triggers[0]
  maxPriority: number;    // highest priority across observed triggers
  value: number;          // magnitude of latest trigger
  firstSeen: number;      // first trigger timestamp
  latestSeen: number;     // latest trigger timestamp
  ttl: number;            // expiry timestamp
}

// ---- Screener Output ----

export interface ScreenerCandidate {
  rank: number;
  symbol: string;
  side: Direction;
  finalScore: number;
  opportunityScore: number;
  executionScore: number;
  rating: Rating;
  longScore: number;
  shortScore: number;
  dataCompleteness: number; // 0.0 - 1.0
  reasons: string[];
  liquidityTier: LiquidityTier;
  volatilityRegime: VolatilityRegime;
  price: number;
  priceChange5m: number | null;
  priceChange1h: number | null;
  priceChange24h: number;
  volume24h: number;
  openInterestValue: number;
  fundingRate: number;
  fundingReady?: boolean;
  fundingHistoryCount?: number;
  timing?: TimingAnalysis;
  signalCategory?: SignalCategory;
  discoveryLabel?: DiscoveryLabel;
  moveMaturity?: MoveMaturity;
  entryPotential?: EntryPotential;
  mtfConfluence?: MTFConfluenceType;
  oiCapitalFlow?: string;
  vwapAnalysis?: VWAPAnalysis | null;
  absorption?: AbsorptionAnalysis | null;
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

export interface Stage1Diagnostics {
  totalScanned: number;
  rejectedInactive: number;
  rejectedWrongContract: number;
  rejectedLowLiquidity: number;
  rejectedLowOI: number;
  rejectedWideSpread: number;
  rejectedNoMovement: number;
  passed: number;
}

export interface PipelineDiagnostics {
  universeSize: number;
  eligibleSymbols: number;
  stage1Candidates: number;
  stage2Candidates: number;
  stage3Candidates: number;
  qualifiedCandidates: number;
  stage1?: Stage1Diagnostics;
  rejectionReasons: {
    stage1Inactive: number;
    stage1WrongContract: number;
    stage1LowLiquidity: number;
    stage1LowOI: number;
    stage1WideSpread: number;
    stage1NoMovement: number;
    stage2WeakTrend: number;
    stage2WeakMomentum: number;
    stage2Conflict: number;
    stage2LowCompleteness: number;
    stage2LateChase: number;
    stage2Distribution: number;
    stage3ExecutionRisk: number;
    stage3ScoreThreshold: number;
    // Backward compatibility aliases:
    rejectedLowLiquidity: number;
    rejectedWeakTrend: number;
    rejectedWeakMomentum: number;
    rejectedFundingConflict: number;
    rejectedLowCompleteness: number;
    rejectedExecutionRisk: number;
    rejectedScoreThreshold: number;
    rejectedLateChase: number;
    rejectedDistribution: number;
  };
}

export interface ScreenerOutput {
  timestamp: string;
  market: 'USDT_PERPETUAL';
  regime: MarketRegime;
  btcPrice: number;
  btcChange1h: number;
  universeSize: number;       // total instrument universe
  eligibleSymbols: number;    // valid USDT perpetual universe
  stage1Candidates: number;   // candidates passing Stage 1
  stage2Candidates: number;   // candidates scored in Stage 2
  stage3Candidates: number;   // candidates passing Stage 3 execution
  qualifiedCandidates: number;// final signals qualifying in FinalRanker
  totalSymbols: number;       // alias for universeSize
  candidateCount: number;     // alias for qualifiedCandidates
  hotQueueSize: number;
  scanLatencyMs: number;
  results: ScreenerCandidate[];
  actionableResults?: ScreenerCandidate[];
  watchlist?: ScreenerCandidate[];
  rejectedSignals?: ScreenerCandidate[];
  diagnostics?: PipelineDiagnostics;
}

// ---- Stage 1 Filter Result ----

export interface Stage1Result {
  symbol: string;
  liquidityTier: LiquidityTier;
  turnover24h: number;
  openInterestValue: number;
  spreadBps: number;
  priceWindow5m: PriceWindowMetric | null;
  priceWindow1h: PriceWindowMetric | null;
  priceChange5m: number | null;
  priceChange1h: number | null;
  volumeAcceleration: number | null;
  oiChangePercent: number | null;
  activityScore: number;  // composite score for ranking candidates
  discoveryLane?: DiscoveryLane;
  laneScore?: number;
}

// ---- Symbol State (full state per symbol) ----

export interface SymbolState {
  info: SymbolInfo;
  ticker: TickerData;
  prevTicker: TickerData | null;
  indicators: IndicatorState;
  volatility: VolatilityState;
  structure: Record<Timeframe, MarketStructure>;
  orderbook: OrderbookSnapshot | null;
  recentTrades: TradeData[];
  recentLiquidations: LiquidationData[];

  // Stage results
  stage1: Stage1Result | null;
  longScore: LongScoreBreakdown | null;
  shortScore: ShortScoreBreakdown | null;
  executionScore: ExecutionScore | null;
  oiFunding: OIFundingAnalysis | null;
  exhaustion: ExhaustionAnalysis | null;
  breakout: BreakoutAnalysis | null;
  squeeze: SqueezeAnalysis | null;

  // Metadata
  lastScoredAt: number;
  isCandidate: boolean;
  isHot: boolean;
  sectorGroup: string;
}

// ---- Relative Strength ----

export interface RelativeStrengthResult {
  vsBTC: number | null;       // -100 to +100 or null if unavailable
  vsETH: number | null;       // -100 to +100 or null if unavailable
  vsSector: number | null;    // -100 to +100 or null if unmapped/insufficient
  vsUniverse: number | null;  // -100 to +100 or null if insufficient
  longScore: number;          // 0-15
  shortScore: number;         // 0-15
  availableWeight: number;    // weight of available baseline comparisons (max 15)
  dataCompleteness: number;   // 0.0 to 1.0
}

// ---- Sector Groups ----

export const SECTOR_GROUPS: Record<string, string[]> = {
  'SOL_ECO': ['SOL', 'JUP', 'RAY', 'BONK', 'WIF', 'JTO', 'PYTH', 'TNSR', 'W', 'KMNO', 'DRIFT', 'POPCAT'],
  'ETH_L2': ['ARB', 'OP', 'STRK', 'MANTA', 'BLAST', 'ZK', 'SCROLL', 'METIS', 'MODE', 'LINEA'],
  'AI': ['FET', 'RENDER', 'TAO', 'NEAR', 'AKT', 'AR', 'ONDO', 'WLD', 'ARKM', 'IO', 'GRASS', 'ATH'],
  'MEME': ['DOGE', 'SHIB', 'PEPE', 'BONK', 'WIF', 'FLOKI', 'BRETT', 'NEIRO', 'TURBO', 'MEW', 'POPCAT', 'MOG', 'PNUT', 'GOAT'],
  'DEFI': ['UNI', 'AAVE', 'MKR', 'CRV', 'COMP', 'SUSHI', 'SNX', 'DYDX', 'GMX', 'PENDLE', 'ENA', 'JUP', 'EIGEN', 'COW'],
  'L1': ['BTC', 'ETH', 'SOL', 'AVAX', 'SUI', 'APT', 'SEI', 'INJ', 'TIA', 'NEAR', 'ADA', 'DOT', 'ATOM', 'TON', 'KAS', 'HBAR'],
  'GAMING': ['IMX', 'GALA', 'AXS', 'SAND', 'MANA', 'ILV', 'BEAM', 'PIXEL', 'PORTAL', 'RONIN', 'BIGTIME'],
  'INFRA': ['LINK', 'GRT', 'FIL', 'THETA', 'PYTH', 'API3', 'BAND', 'AR', 'STORJ'],
  'EXCHANGE': ['BNB', 'OKB', 'HT', 'BGB', 'MX', 'KCS', 'GT'],
  'RWA': ['ONDO', 'POLYX', 'OM', 'CFG', 'MPL', 'GFI', 'TRU'],
  'ORACLE': ['LINK', 'PYTH', 'BAND', 'API3', 'UMA', 'DIA'],
};

// Reverse mapping: baseCoin → sector
export function getSectorForCoin(baseCoin: string): string {
  const upper = baseCoin.toUpperCase();
  for (const [sector, coins] of Object.entries(SECTOR_GROUPS)) {
    if (coins.includes(upper)) return sector;
  }
  return 'OTHER';
}
