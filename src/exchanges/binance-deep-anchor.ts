// ============================================================
// Binance Deep Anchor Engine — Cross-Exchange Confirmation Layer
// ============================================================
//
// Fetches Binance Futures OI, ticker, and Spot ticker for
// Stage 2 candidates (10–25 max). Classifies cross-exchange
// confluence. Modifier capped strictly to [-5, +5].
//
// Direction Protection: Binance data NEVER flips Bybit bias.
// Fail-Open: Timeout/error → modifier 0, status diagnostic.
// ============================================================

import { CrossExchangeAnalysis, CrossExchangeStatus } from '../data/types.js';
import { BinanceSymbolResolver, SymbolMapping } from './binance-symbol-resolver.js';
import { ConcurrencyLimiter, CircuitBreaker } from '../utils/concurrency-limiter.js';
import axios from 'axios';

const FUTURES_MIRRORS = [
  'https://fapi.binance.com',
  'https://fapi1.binance.com',
  'https://fapi2.binance.com'
];

const SPOT_MIRRORS = [
  'https://api.binance.com',
  'https://api3.binance.com',
  'https://api1.binance.com'
];

interface BinanceFuturesTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  volume: string;
  quoteVolume: string;
}

interface BinanceOI {
  symbol: string;
  openInterest: string;
}

interface BinanceSpotTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  volume: string;
  quoteVolume: string;
}

interface BybitCandidateSnapshot {
  symbol: string;
  lastPrice: number;
  priceChange24hPcnt: number;
  openInterestValue: number;
  prevOpenInterestValue?: number;
}

export class BinanceDeepAnchorEngine {
  private resolver: BinanceSymbolResolver;
  private limiter: ConcurrencyLimiter;
  private breaker: CircuitBreaker;
  private requestTimeoutMs: number;

  constructor(
    resolver: BinanceSymbolResolver,
    maxConcurrent: number = 5,
    requestTimeoutMs: number = 2000,
    circuitFailureThreshold: number = 5,
    circuitCooldownMs: number = 45_000
  ) {
    this.resolver = resolver;
    this.limiter = new ConcurrencyLimiter(maxConcurrent);
    this.breaker = new CircuitBreaker(circuitFailureThreshold, circuitCooldownMs);
    this.requestTimeoutMs = requestTimeoutMs;
  }

  /**
   * Analyze cross-exchange confluence for a batch of Bybit candidates.
   * Each candidate gets its own per-request timeout and circuit breaker check.
   */
  async analyzeAll(
    candidates: BybitCandidateSnapshot[]
  ): Promise<Map<string, CrossExchangeAnalysis>> {
    const results = new Map<string, CrossExchangeAnalysis>();

    await Promise.all(
      candidates.map(c =>
        this.limiter.run(() => this.analyzeSingle(c).then(r => results.set(c.symbol, r)))
      )
    );

    return results;
  }

  async analyzeSingle(bybit: BybitCandidateSnapshot): Promise<CrossExchangeAnalysis> {
    const startMs = Date.now();
    const mapping = this.resolver.resolve(bybit.symbol);

    if (mapping.status === 'UNAVAILABLE') {
      return this.makeResult('BINANCE_UNAVAILABLE', 0, 'LOW',
        `No Binance listing for ${bybit.symbol}`, startMs, 'UNAVAILABLE', bybit);
    }

    if (mapping.status === 'AMBIGUOUS') {
      return this.makeResult('BINANCE_UNAVAILABLE', 0, 'LOW',
        `Ambiguous symbol mapping for ${bybit.symbol}`, startMs, 'UNAVAILABLE', bybit);
    }

    // Circuit breaker check
    if (this.breaker.isOpen()) {
      return this.makeResult('REQUEST_ERROR', 0, 'LOW',
        'Circuit breaker active — skipping Binance request', startMs, 'UNAVAILABLE', bybit);
    }

    try {
      const [futData, spotData] = await Promise.allSettled([
        mapping.binanceFuturesSymbol ? this.fetchFuturesData(mapping.binanceFuturesSymbol) : Promise.resolve(null),
        mapping.binanceSpotSymbol ? this.fetchSpotData(mapping.binanceSpotSymbol) : Promise.resolve(null)
      ]);

      const futures = futData.status === 'fulfilled' ? futData.value : null;
      const spot = spotData.status === 'fulfilled' ? spotData.value : null;

      this.breaker.recordSuccess();
      return this.classify(bybit, mapping, futures, spot, startMs);
    } catch (err: any) {
      this.breaker.recordFailure();

      if (err?.name === 'AbortError' || err?.message?.includes('abort')) {
        return this.makeResult('REQUEST_TIMEOUT', 0, 'LOW',
          `Binance request timed out (${this.requestTimeoutMs}ms)`, startMs, 'UNAVAILABLE', bybit);
      }

      return this.makeResult('REQUEST_ERROR', 0, 'LOW',
        `Binance request error: ${err?.message || 'Unknown'}`, startMs, 'UNAVAILABLE', bybit);
    }
  }

  private classify(
    bybit: BybitCandidateSnapshot,
    mapping: SymbolMapping,
    futures: { ticker: BinanceFuturesTicker; oi: BinanceOI } | null,
    spot: BinanceSpotTicker | null,
    startMs: number
  ): CrossExchangeAnalysis {
    const bybitReturn = bybit.priceChange24hPcnt;
    const binanceFutReturn = futures?.ticker ? parseFloat(futures.ticker.priceChangePercent) / 100 : null;
    const binanceSpotReturn = spot ? parseFloat(spot.priceChangePercent) / 100 : null;

    // OI Delta estimation (we only have current OI from Binance, compare direction)
    const binanceOI = futures?.oi ? parseFloat(futures.oi.openInterest) : null;
    const bybitOIDelta = bybit.prevOpenInterestValue
      ? (bybit.openInterestValue - bybit.prevOpenInterestValue) / bybit.prevOpenInterestValue
      : null;

    // Determine OI Confluence
    let oiConfluence: CrossExchangeAnalysis['oiConfluence'] = 'UNAVAILABLE';
    if (bybitOIDelta !== null && binanceOI !== null) {
      // We can only check if both OI are present; Binance doesn't give us prev OI in a single call
      // So we classify based on available data quality
      oiConfluence = bybitOIDelta > 0.01 ? 'BOTH_EXPANDING' : bybitOIDelta < -0.01 ? 'BOTH_CONTRACTING' : 'UNAVAILABLE';
    }

    // Classification logic based on directional alignment
    let status: CrossExchangeStatus;
    let modifier: number;
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    let reason: string;

    const bybitMoving = Math.abs(bybitReturn) > 0.005; // > 0.5% 24h change
    const hasFutures = binanceFutReturn !== null;
    const hasSpot = binanceSpotReturn !== null;

    if (!hasFutures && !hasSpot) {
      return this.makeResult('BINANCE_UNAVAILABLE', 0, 'LOW',
        'No Binance data retrieved', startMs, 'UNAVAILABLE', bybit);
    }

    // Directional alignment check
    const sameDirectionFutures = hasFutures && Math.sign(bybitReturn) === Math.sign(binanceFutReturn!);
    const sameDirectionSpot = hasSpot && Math.sign(bybitReturn) === Math.sign(binanceSpotReturn!);
    const futuresMagnitudeAligned = hasFutures && Math.abs(binanceFutReturn!) > 0.003;
    const spotMagnitudeAligned = hasSpot && Math.abs(binanceSpotReturn!) > 0.003;

    if (sameDirectionFutures && futuresMagnitudeAligned && sameDirectionSpot && spotMagnitudeAligned) {
      // All three venues aligned with meaningful magnitude
      status = 'CROSS_EXCHANGE_CONFIRMED';
      modifier = 3;
      confidence = 'HIGH';
      reason = 'Bybit, Binance Futures, and Binance Spot all aligned';
      oiConfluence = bybitOIDelta !== null && bybitOIDelta > 0.005 ? 'BOTH_EXPANDING' : oiConfluence;
    } else if (sameDirectionSpot && spotMagnitudeAligned && hasSpot) {
      // Spot actively confirming the futures move
      const spotVol = spot ? parseFloat(spot.quoteVolume) : 0;
      if (spotVol > 5_000_000) { // $5M+ spot volume
        status = 'SPOT_DRIVEN_ACCUMULATION';
        modifier = 2;
        confidence = 'MEDIUM';
        reason = 'Binance Spot volume confirms futures direction';
      } else {
        status = 'CROSS_EXCHANGE_CONFIRMED';
        modifier = 2;
        confidence = 'MEDIUM';
        reason = 'Spot direction aligned but volume moderate';
      }
    } else if (bybitMoving && hasFutures && !sameDirectionFutures) {
      // Bybit and Binance futures moving in opposite directions
      status = 'CROSS_EXCHANGE_DIVERGENCE';
      modifier = -2;
      confidence = 'MEDIUM';
      reason = `Bybit ${bybitReturn > 0 ? '+' : ''}${(bybitReturn * 100).toFixed(2)}% vs Binance Futures ${binanceFutReturn! > 0 ? '+' : ''}${(binanceFutReturn! * 100).toFixed(2)}%`;
    } else if (bybitMoving && hasFutures && sameDirectionFutures && hasSpot && !sameDirectionSpot) {
      // Futures aligned but spot divergent (leverage-driven move)
      status = 'SPOT_FUTURES_DIVERGENCE';
      modifier = -3;
      confidence = 'MEDIUM';
      reason = 'Futures aligned but Spot not confirming — potential leverage-only pump';
    } else if (bybitMoving && (!hasFutures || !futuresMagnitudeAligned)) {
      // Bybit moving but Binance flat
      status = 'BYBIT_ONLY_MOVE';
      modifier = -2;
      confidence = 'LOW';
      reason = 'Movement isolated to Bybit, Binance participation minimal';
    } else {
      // Insufficient evidence for any classification
      status = 'BINANCE_UNAVAILABLE';
      modifier = 0;
      confidence = 'LOW';
      reason = 'Insufficient cross-exchange evidence';
    }

    // HARD CLAMP: [-5, +5]
    modifier = Math.max(-5, Math.min(5, modifier));

    return {
      status,
      confidence,
      scoreModifier: modifier,
      bybitFuturesReturn: bybitReturn,
      binanceFuturesReturn: binanceFutReturn,
      binanceSpotReturn: binanceSpotReturn,
      bybitOIDelta: bybitOIDelta,
      binanceOIDelta: null, // Single snapshot, no delta available
      oiConfluence,
      reason,
      timestamp: Date.now(),
      latencyMs: Date.now() - startMs
    };
  }

  private makeResult(
    status: CrossExchangeStatus,
    modifier: number,
    confidence: 'HIGH' | 'MEDIUM' | 'LOW',
    reason: string,
    startMs: number,
    oiConfluence: CrossExchangeAnalysis['oiConfluence'],
    bybit: BybitCandidateSnapshot
  ): CrossExchangeAnalysis {
    return {
      status,
      confidence,
      scoreModifier: Math.max(-5, Math.min(5, modifier)),
      bybitFuturesReturn: bybit.priceChange24hPcnt,
      binanceFuturesReturn: null,
      binanceSpotReturn: null,
      bybitOIDelta: null,
      binanceOIDelta: null,
      oiConfluence,
      reason,
      timestamp: Date.now(),
      latencyMs: Date.now() - startMs
    };
  }

  private async fetchFuturesData(
    symbol: string
  ): Promise<{ ticker: BinanceFuturesTicker; oi: BinanceOI }> {
    for (const base of FUTURES_MIRRORS) {
      try {
        const [tickerRes, oiRes] = await Promise.all([
          axios.get(`${base}/fapi/v1/ticker/24hr?symbol=${symbol}`, {
            timeout: this.requestTimeoutMs
          }).then(r => r.data),
          axios.get(`${base}/fapi/v1/openInterest?symbol=${symbol}`, {
            timeout: this.requestTimeoutMs
          }).then(r => r.data)
        ]);
        return { ticker: tickerRes, oi: oiRes };
      } catch {
        // try next mirror
      }
    }
    throw new Error('All Binance futures endpoints failed or timed out');
  }

  private async fetchSpotData(symbol: string): Promise<BinanceSpotTicker> {
    for (const base of SPOT_MIRRORS) {
      try {
        const res = await axios.get(`${base}/api/v3/ticker/24hr?symbol=${symbol}`, {
          timeout: this.requestTimeoutMs
        });
        return res.data;
      } catch {
        // try next mirror
      }
    }
    throw new Error('All Binance spot endpoints failed or timed out');
  }

  getCircuitState() {
    return this.breaker.getState();
  }

  getCircuitFailures() {
    return this.breaker.getConsecutiveFailures();
  }
}
