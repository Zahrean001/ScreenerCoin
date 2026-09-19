// ============================================================
// Configuration — All Tunable Parameters
// ============================================================

export const CONFIG = {
  // ---- Exchange ----
  BYBIT_REST_URL: process.env.BYBIT_BASE_URL || 'https://api.bybit.com',
  BYBIT_WS_URL: process.env.BYBIT_WS_URL || 'wss://stream.bybit.com/v5/public/linear',

  // ---- Stage 1: Liquidity Tiers (24h turnover in USDT) ----
  LIQUIDITY_TIERS: {
    A: 100_000_000,    // >= $100M
    B: 20_000_000,     // $20M–$100M
    C: 5_000_000,      // $5M–$20M
    D_REJECT: 5_000_000, // < $5M → reject
  },

  // ---- Stage 1: Minimum thresholds ----
  MIN_OI_USD: 1_000_000,          // $1M minimum OI
  MAX_SPREAD_BPS: 15,             // 0.15% max spread
  MIN_PRICE_CHANGE_5M: 0.003,     // 0.3% min 5m move
  MIN_PRICE_CHANGE_1H: 0.005,     // 0.5% min 1h move
  MIN_ACTIVITY_SCORE: 20,         // minimum composite activity

  // ---- Scan Intervals ----
  FAST_LOOP_MS: 1500,       // lightweight metrics for all symbols
  NORMAL_LOOP_MS: 5000,     // signal analysis for candidates
  DEEP_LOOP_MS: 30000,      // orderbook + execution for top candidates
  TICKER_POLL_MS: 1500,     // REST ticker poll fallback
  REGIME_UPDATE_MS: 10000,  // BTC regime update interval

  // ---- Scoring Weights ----
  OPPORTUNITY_WEIGHT: 0.75,
  EXECUTION_WEIGHT: 0.25,

  // ---- Rating Thresholds ----
  RATING_AP: 90,     // A+
  RATING_A: 82,      // A
  RATING_BP: 75,     // B+
  RATING_WATCH: 70,  // WATCH
  MIN_FINAL_SCORE: 70, // minimum to qualify for ranking (Grade A/B/Watchlist)
  MIN_DATA_COMPLETENESS: 0.60, // minimum data completeness (60%) to qualify

  // ---- Direction Conflict ----
  DIRECTION_MARGIN: 5, // min spread between LONG and SHORT to choose direction
  CONFLICT_THRESHOLD: 80, // both sides >= this = CONFLICT

  // ---- Correlation ----
  CORRELATION_PENALTY_THRESHOLD: 0.85,
  CORRELATION_PENALTY_FACTOR: 0.15,
  MAX_SAME_SECTOR_IN_TOP: 2,

  // ---- Volatility Percentiles ----
  VOLATILITY_LOW: 30,
  VOLATILITY_NORMAL: 50,
  VOLATILITY_ELEVATED: 70,
  VOLATILITY_HIGH: 90,
  VOLATILITY_EXTREME: 95,

  // ---- Hot Queue Triggers ----
  HOT_PRICE_CHANGE_THRESHOLD: 0.03,  // 3%
  HOT_VOLUME_RATIO_THRESHOLD: 3.0,   // 3x average
  HOT_OI_CHANGE_THRESHOLD: 0.10,     // 10%
  HOT_TTL_MS: 60_000,                // 60s decay
  HOT_MAX_SIZE: 15,                  // max hot queue symbols

  // ---- Market Regime Modifiers ----
  REGIME_MODIFIERS: {
    STRONG_BULL: { long: 1.15, short: 0.85 },
    BULL:        { long: 1.10, short: 0.90 },
    NEUTRAL:     { long: 1.00, short: 1.00 },
    BEAR:        { long: 0.90, short: 1.10 },
    STRONG_BEAR: { long: 0.85, short: 1.15 },
  },

  // ---- Indicator Periods ----
  EMA_FAST: 9,
  EMA_MID: 21,
  EMA_SLOW: 50,
  ATR_PERIOD: 14,
  RSI_PERIOD: 14,
  ROC_FAST: 5,
  ROC_SLOW: 14,
  VOLUME_SMA_PERIOD: 20,
  VWAP_RESET_PERIOD: 'session' as const,

  // ---- Kline History ----
  TIMEFRAMES: ['5', '15', '60'] as const,
  HIGHER_TIMEFRAMES: ['240', 'D'] as const,
  KLINE_HISTORY_LIMIT: 200,  // candles to load initially

  // ---- Execution Score Thresholds ----
  EXEC_SPREAD_GOOD: 3,        // bps
  EXEC_SPREAD_OK: 8,          // bps
  EXEC_SPREAD_BAD: 15,        // bps
  EXEC_DEPTH_MIN: 50_000,     // $50K minimum depth each side
  EXEC_DEPTH_GOOD: 200_000,   // $200K good depth
  EXEC_SLIPPAGE_GOOD: 5,      // bps
  EXEC_SLIPPAGE_OK: 15,       // bps
  EXEC_SLIPPAGE_BAD: 30,      // bps
  EXEC_MIN_TRADES_PER_MIN: 5, // minimum recent trades

  // ---- Exhaustion Thresholds ----
  EXHAUSTION_PRICE_THRESHOLD: 0.03,  // 3% 1H move
  EXHAUSTION_OI_THRESHOLD: 0.05,     // 5% OI change
  EXHAUSTION_FUNDING_EXTREME: 0.0005, // 0.05%
  EXHAUSTION_RSI_UPPER: 80,
  EXHAUSTION_RSI_LOWER: 20,
  EXHAUSTION_VOLUME_CLIMAX: 3.0,     // 3x volume

  // ---- Breakout ----
  BREAKOUT_LOOKBACK_CANDLES: 20, // swing detection lookback
  BREAKOUT_VOLUME_CONFIRM: 1.5,  // 1.5x volume for confirmation
  BREAKOUT_OI_CONFIRM: 0.02,    // 2% OI increase for confirmation

  // ---- Squeeze ----
  SQUEEZE_LIQUIDATION_THRESHOLD: 3, // 3+ liquidations in window
  SQUEEZE_PRICE_ACCELERATION: 0.02, // 2% rapid move

  // ---- Output ----
  MAX_RESULTS: 5,
  SIGNAL_LOG_PATH: process.env.SIGNAL_LOG_PATH || './validation/signal-log.jsonl',
  JSON_OUTPUT_PATH: process.env.JSON_OUTPUT_PATH || './output/screener-results.json',
  TERMINAL_REFRESH_MS: 1000,

  // ---- WebSocket ----
  WS_PING_INTERVAL_MS: 20_000,
  WS_RECONNECT_BASE_MS: 1000,
  WS_RECONNECT_MAX_MS: 30_000,
  WS_MAX_CONNECTIONS: 3,
  WS_MAX_TOPICS_PER_CONN: 450, // under 500 limit
  WS_SUBSCRIBE_BATCH_SIZE: 40,

  // ---- Rate Limiting ----
  REST_MAX_REQUESTS_PER_SECOND: 8, // under 10/s limit
  REST_BURST_SIZE: 3,

  // ---- Candidate Pool ----
  MAX_CANDIDATES: 80,          // max symbols to pass stage 1
  MAX_DEEP_CANDIDATES: 60,    // max for orderbook analysis (expanded for broad market coverage)
  SCORE_DEBOUNCE_MS: 500,     // don't re-score more than once per 500ms
} as const;

export type Config = typeof CONFIG;
