// ============================================================
// Market Data Hub — Central In-Memory State & Time-Series Store
// ============================================================

import { 
  SymbolInfo, TickerData, CandleData, OrderbookSnapshot, 
  TradeData, LiquidationData, Timeframe, CandleTimeframe, IndicatorState,
  getSectorForCoin, PriceWindowMetric,
  FundingSettlement, CurrentFundingState, FundingState,
  OIDeltaSnapshot, DataFreshness
} from './types.js';
import { computeFreshness } from '../utils/freshness.js';
import { 
  CircularBuffer, 
  NumericRingBuffer, 
  TimestampedPriceRingBuffer, 
  TimestampedNumericRingBuffer 
} from './circular-buffer.js';
import { CONFIG } from '../config.js';
import { BybitRest } from './bybit-rest.js';
import { logger } from '../utils/logger.js';
import { SymbolIndicators } from '../indicators/incremental.js';
import { HTFContextEngine } from '../engines/htf-context.js';

export class MarketDataHub {
  public instruments = new Map<string, SymbolInfo>();
  public tickers = new Map<string, TickerData>();
  public prevTickers = new Map<string, TickerData>();
  public historicalOIDeltas = new Map<string, OIDeltaSnapshot>();
  public candles = new Map<string, Map<CandleTimeframe, CircularBuffer<CandleData>>>();
  public indicators = new Map<string, IndicatorState>();
  public symbolIndicators = new Map<string, SymbolIndicators>();
  public volatilityHistory = new Map<string, NumericRingBuffer>();
  public orderbooks = new Map<string, OrderbookSnapshot>();
  public recentTrades = new Map<string, CircularBuffer<TradeData>>();
  public recentLiquidations = new Map<string, CircularBuffer<LiquidationData>>();
  
  // Real Timestamped series
  public priceHistories = new Map<string, TimestampedPriceRingBuffer>();
  public fundingHistories = new Map<string, TimestampedNumericRingBuffer>();
  public fundingStates = new Map<string, FundingState>();
  public lastFundingSettlementTime = new Map<string, number>();
  public longShortRatios = new Map<string, { buyRatio: number; sellRatio: number; timestamp: number } | null>();
  
  // P0 #1: Separate Forming/Unconfirmed vs Closed Candle state & idempotency tracker
  public currentCandles = new Map<string, CandleData>();
  public lastCommittedCandles = new Map<string, number>();

  // Backward compatibility
  public priceHistory5m = new Map<string, NumericRingBuffer>();
  
  private log = logger.child('MarketDataHub');
  private htfContextEngine = new HTFContextEngine();

  constructor(private rest: BybitRest) {}

  async initialize() {
    this.log.info('Initializing MarketDataHub...');
    const insts = await this.rest.getInstruments();
    for (const inst of insts) {
      this.instruments.set(inst.symbol, inst);
      
      const candleMap = new Map<CandleTimeframe, CircularBuffer<CandleData>>();
      for (const tf of CONFIG.TIMEFRAMES) {
        candleMap.set(tf, new CircularBuffer<CandleData>(CONFIG.KLINE_HISTORY_LIMIT));
      }
      for (const tf of CONFIG.HIGHER_TIMEFRAMES) {
        candleMap.set(tf, new CircularBuffer<CandleData>(CONFIG.KLINE_HISTORY_LIMIT));
      }
      this.candles.set(inst.symbol, candleMap);
      
      const symInd = new SymbolIndicators();
      this.symbolIndicators.set(inst.symbol, symInd);
      this.indicators.set(inst.symbol, symInd.getState());

      this.recentTrades.set(inst.symbol, new CircularBuffer<TradeData>(100));
      this.recentLiquidations.set(inst.symbol, new CircularBuffer<LiquidationData>(50));
      this.priceHistory5m.set(inst.symbol, new NumericRingBuffer(60));
      this.volatilityHistory.set(inst.symbol, new NumericRingBuffer(100));

      // 720 points = 1 hour of 5s updates or 12 hours of 1m updates
      this.priceHistories.set(inst.symbol, new TimestampedPriceRingBuffer(720));
      this.fundingHistories.set(inst.symbol, new TimestampedNumericRingBuffer(200));
    }
    this.log.info(`Loaded ${insts.length} USDT perpetual instruments`);

    const initialTickers = await this.rest.getTickers();
    const now = Date.now();
    for (const [symbol, ticker] of initialTickers.entries()) {
      if (this.instruments.has(symbol)) {
        ticker.receivedAt = now;
        this.tickers.set(symbol, ticker);
        const pBuf = this.priceHistories.get(symbol);
        if (pBuf && ticker.lastPrice > 0) {
          // Ascending chronological order: 24h ago -> 1h ago -> current event time
          if (ticker.prevPrice24h > 0) {
            pBuf.push(now - 86400_000, ticker.prevPrice24h);
          }
          if (ticker.prevPrice1h > 0) {
            pBuf.push(now - 3600_000, ticker.prevPrice1h);
          }
          pBuf.push(now, ticker.lastPrice);
        }

        const inst = this.instruments.get(symbol);
        const fundingIntervalMinutes = inst?.fundingInterval ?? 480;
        const periodStart = (ticker.nextFundingTime && ticker.nextFundingTime > 0)
          ? ticker.nextFundingTime - (fundingIntervalMinutes * 60_000)
          : now;

        const currentFunding: CurrentFundingState | null = Number.isFinite(ticker.fundingRate) ? {
          rate: ticker.fundingRate,
          timestamp: now,
          nextFundingTime: ticker.nextFundingTime,
          periodStart,
          fundingIntervalMinutes
        } : null;

        this.fundingStates.set(symbol, {
          symbol,
          history: [],
          current: currentFunding
        });

        const legacyBuf = this.priceHistory5m.get(symbol);
        if (legacyBuf && ticker.lastPrice > 0) {
          legacyBuf.push(ticker.lastPrice);
        }
      }
    }
    this.log.info(`Loaded ${this.tickers.size} initial tickers and seeded timestamped histories`);
  }

  updateTicker(data: Partial<TickerData> & { symbol: string }) {
    const symbol = data.symbol;
    if (!this.instruments.has(symbol)) return;

    const current = this.tickers.get(symbol);
    const now = data.timestamp && data.timestamp > 0 ? data.timestamp : Date.now();

    const updated: TickerData = current ? { ...current, ...data, timestamp: now } : {
      lastPrice: 0,
      markPrice: 0,
      indexPrice: 0,
      bid1Price: 0,
      bid1Size: 0,
      ask1Price: 0,
      ask1Size: 0,
      highPrice24h: 0,
      lowPrice24h: 0,
      prevPrice24h: 0,
      prevPrice1h: 0,
      price24hPcnt: 0,
      volume24h: 0,
      turnover24h: 0,
      openInterest: 0,
      openInterestValue: 0,
      fundingRate: 0,
      nextFundingTime: 0,
      ...data,
      symbol,
      timestamp: data.timestamp ?? now,
      receivedAt: now
    };

    if (current) {
      this.prevTickers.set(symbol, { ...current });
      for (const key in updated) {
        if ((updated as any)[key] === undefined) {
          (updated as any)[key] = (current as any)[key];
        }
      }
    }
    this.tickers.set(symbol, updated);

    if (updated.lastPrice > 0) {
      const pBuf = this.priceHistories.get(symbol);
      if (pBuf) {
        pBuf.push(now, updated.lastPrice);
      }
    }

    // Phase 2 #1: Separate Current/Active Funding State from Historical Settlements
    // Uses instrument-specific fundingInterval to accurately calculate active periodStart
    if (Number.isFinite(updated.fundingRate)) {
      const inst = this.instruments.get(symbol);
      const fundingIntervalMinutes = inst?.fundingInterval ?? 480;
      const periodStart = (updated.nextFundingTime && updated.nextFundingTime > 0)
        ? updated.nextFundingTime - (fundingIntervalMinutes * 60_000)
        : now;

      let fState = this.fundingStates.get(symbol);
      if (!fState) {
        fState = { symbol, history: [], current: null };
        this.fundingStates.set(symbol, fState);
      }

      fState.current = {
        rate: updated.fundingRate,
        timestamp: now,
        nextFundingTime: updated.nextFundingTime,
        periodStart,
        fundingIntervalMinutes
      };
    }
  }

  /**
   * Bootstrap genuine historical funding settlements from Bybit REST /v5/market/funding/history.
   * Cleanses, deduplicates, and populates historical settlements in ascending chronological order.
   * Does NOT contaminate historical settlements with live ticker rates.
   */
  async bootstrapFundingHistory(symbol: string) {
    try {
      const res = await this.rest.getFundingHistory(symbol, 30);
      const list = res?.list || [];
      if (list.length === 0) return;

      const settlements: FundingSettlement[] = [];
      const seenTimestamps = new Set<number>();

      for (const item of list) {
        const ts = parseInt(item.fundingRateTimestamp, 10);
        const rate = parseFloat(item.fundingRate);
        if (Number.isFinite(ts) && Number.isFinite(rate) && ts > 0 && !seenTimestamps.has(ts)) {
          seenTimestamps.add(ts);
          settlements.push({ timestamp: ts, rate });
        }
      }

      // Sort chronologically ascending (oldest first)
      settlements.sort((a, b) => a.timestamp - b.timestamp);

      let fState = this.fundingStates.get(symbol);
      if (!fState) {
        fState = { symbol, history: [], current: null };
        this.fundingStates.set(symbol, fState);
      }
      fState.history = settlements;

      // Mirror to fundingHistories circular buffer for backward compatibility
      const fBuf = this.fundingHistories.get(symbol);
      if (fBuf) {
        fBuf.clear();
        for (const s of settlements) {
          fBuf.push(s.timestamp, s.rate);
        }
      }

      if (settlements.length > 0) {
        this.lastFundingSettlementTime.set(symbol, settlements[settlements.length - 1].timestamp);
      }
    } catch (err) {
      this.log.error(`Failed to bootstrap funding history for ${symbol}`, { error: String(err) });
    }
  }

  getFundingState(symbol: string): FundingState | null {
    return this.fundingStates.get(symbol) ?? null;
  }

  /**
   * Calculates funding percentile strictly against historical settlement distribution.
   */
  getFundingPercentile(symbol: string): number | null {
    const state = this.fundingStates.get(symbol);
    if (!state || state.history.length < 3 || !state.current) return null;
    const rates = state.history.map(h => h.rate).sort((a, b) => a - b);
    const target = state.current.rate;
    let count = 0;
    for (const r of rates) {
      if (r <= target) count++;
      else break;
    }
    return (count / rates.length) * 100;
  }

  isFundingReady(symbol: string): boolean {
    return (this.fundingStates.get(symbol)?.history.length ?? 0) >= 3;
  }

  getFundingHistoryCount(symbol: string): number {
    return this.fundingStates.get(symbol)?.history.length ?? 0;
  }

  updateCandle(symbol: string, timeframe: CandleTimeframe, candle: CandleData) {
    const key = `${symbol}:${timeframe}`;

    // P0 #1: Separate unconfirmed / forming candle from closed candle history
    if (!candle.confirmed) {
      // Live forming candle: only update live candle state.
      // Do NOT push to closed candle history.
      // Do NOT update closed incremental indicators.
      this.currentCandles.set(key, candle);
      return;
    }

    // Confirmed candle commit:
    const lastCommitted = this.lastCommittedCandles.get(key) ?? -1;
    if (candle.timestamp <= lastCommitted) {
      // Already committed this candle start timestamp, idempotent ignore
      return;
    }

    const cMap = this.candles.get(symbol);
    if (!cMap) return;
    const buffer = cMap.get(timeframe);
    if (!buffer) return;

    // Commit exactly once to closed candle buffer
    buffer.push(candle);
    this.lastCommittedCandles.set(key, candle.timestamp);
    this.currentCandles.delete(key);

    // Update incremental indicators ONCE per confirmed candle
    let symInd = this.symbolIndicators.get(symbol);
    if (!symInd) {
      symInd = new SymbolIndicators();
      this.symbolIndicators.set(symbol, symInd);
    }
    if (CONFIG.TIMEFRAMES.includes(timeframe as Timeframe)) {
      const state = symInd.updateFromCandle(timeframe as Timeframe, candle);
      this.indicators.set(symbol, state);
    }

    // P0 #2: Never project future timestamp into priceHistories (candle.timestamp + tfMs removed).
    // Realtime price history is fed directly from actual event timestamps (trade/ticker).
  }

  updateOrderbook(snapshot: OrderbookSnapshot & { type?: string }) {
    snapshot.receivedAt = Date.now();
    this.orderbooks.set(snapshot.symbol, snapshot);
  }

  addTrade(trade: TradeData) {
    trade.receivedAt = Date.now();
    const buf = this.recentTrades.get(trade.symbol);
    if (buf) buf.push(trade);

    const pBuf = this.priceHistories.get(trade.symbol);
    if (pBuf && trade.price > 0) {
      pBuf.push(trade.timestamp, trade.price);
    }
  }

  addLiquidation(liq: LiquidationData) {
    const buf = this.recentLiquidations.get(liq.symbol);
    if (buf) buf.push(liq);
  }

  setLongShortRatio(symbol: string, buyRatio: number, sellRatio: number, timestamp: number = Date.now()) {
    this.longShortRatios.set(symbol, { buyRatio, sellRatio, timestamp });
  }

  getLongShortRatio(symbol: string): { buyRatio: number; sellRatio: number; timestamp: number } | null {
    return this.longShortRatios.get(symbol) || null;
  }

  /**
   * Get exact 5-minute price return with strict timestamp metadata.
   */
  get5mReturn(symbol: string, currentTs?: number): PriceWindowMetric {
    const pBuf = this.priceHistories.get(symbol);
    const now = currentTs ?? Date.now();
    if (pBuf) {
      const windowResult = pBuf.getReturnOverWindow(300_000, now);
      if (windowResult.value !== null) {
        return windowResult;
      }
    }

    // Fallback to verified 5m candle buffer if available
    const cMap = this.candles.get(symbol);
    const c5 = cMap?.get('5');
    if (c5 && c5.size >= 1) {
      const latest = c5.latest();
      const prev = c5.size >= 2 ? c5.at(c5.size - 2) : null;
      if (latest && prev && prev.close > 0) {
        return {
          value: (latest.close - prev.close) / prev.close,
          sourceTimestamp: now,
          referenceTimestamp: prev.timestamp,
          window: '5m',
          dataPointsAvailable: c5.size
        };
      } else if (latest && latest.open > 0) {
        return {
          value: (latest.close - latest.open) / latest.open,
          sourceTimestamp: now,
          referenceTimestamp: latest.timestamp,
          window: '5m',
          dataPointsAvailable: c5.size
        };
      }
    }

    return {
      value: null,
      sourceTimestamp: now,
      referenceTimestamp: 0,
      window: '5m',
      dataPointsAvailable: 0
    };
  }

  /**
   * Get exact 15-minute price return with strict timestamp metadata.
   */
  get15mReturn(symbol: string, currentTs?: number): PriceWindowMetric {
    const pBuf = this.priceHistories.get(symbol);
    const now = currentTs ?? Date.now();
    if (pBuf) {
      const windowResult = pBuf.getReturnOverWindow(900_000, now);
      if (windowResult.value !== null) {
        return windowResult;
      }
    }

    const cMap = this.candles.get(symbol);
    const c15 = cMap?.get('15');
    if (c15 && c15.size >= 1) {
      const latest = c15.latest();
      const prev = c15.size >= 2 ? c15.at(c15.size - 2) : null;
      if (latest && prev && prev.close > 0) {
        return {
          value: (latest.close - prev.close) / prev.close,
          sourceTimestamp: now,
          referenceTimestamp: prev.timestamp,
          window: '15m',
          dataPointsAvailable: c15.size
        };
      } else if (latest && latest.open > 0) {
        return {
          value: (latest.close - latest.open) / latest.open,
          sourceTimestamp: now,
          referenceTimestamp: latest.timestamp,
          window: '15m',
          dataPointsAvailable: c15.size
        };
      }
    }

    return {
      value: null,
      sourceTimestamp: now,
      referenceTimestamp: 0,
      window: '15m',
      dataPointsAvailable: 0
    };
  }

  /**
   * Get exact 1-hour price return with strict timestamp metadata.
   */
  get1hReturn(symbol: string, currentTs?: number): PriceWindowMetric {
    const pBuf = this.priceHistories.get(symbol);
    const now = currentTs ?? Date.now();
    
    if (pBuf) {
      const windowResult = pBuf.getReturnOverWindow(3600_000, now);
      if (windowResult.value !== null) {
        return windowResult;
      }
    }

    // Fallback to verified 1h candle or ticker prevPrice1h if within valid window
    const ticker = this.tickers.get(symbol);
    if (ticker && ticker.lastPrice > 0 && ticker.prevPrice1h > 0) {
      const pct = (ticker.lastPrice - ticker.prevPrice1h) / ticker.prevPrice1h;
      return {
        value: pct,
        sourceTimestamp: ticker.timestamp || now,
        referenceTimestamp: (ticker.timestamp || now) - 3600_000,
        window: '1h',
        dataPointsAvailable: pBuf?.size ?? 1
      };
    }

    return {
      value: null,
      sourceTimestamp: now,
      referenceTimestamp: 0,
      window: '1h',
      dataPointsAvailable: pBuf?.size ?? 0
    };
  }

  /**
   * Calculates real rolling volume acceleration (recent 5m volume vs baseline 20-period 5m SMA volume).
   * Returns null if insufficient historical volume observations exist.
   */
  getVolumeAcceleration(symbol: string): number | null {
    const ind = this.indicators.get(symbol);
    if (ind) {
      const ratio5m = ind.volumeRatio['5'];
      if (ratio5m !== null && Number.isFinite(ratio5m) && ratio5m > 0) {
        return ratio5m;
      }
      const ratio15m = ind.volumeRatio['15'];
      if (ratio15m !== null && Number.isFinite(ratio15m) && ratio15m > 0) {
        return ratio15m;
      }
    }

    // Secondary check: recent trade volume in last 5 min vs expected 5m rate from 24h turnover
    const ticker = this.tickers.get(symbol);
    const trades = this.recentTrades.get(symbol);
    if (ticker && ticker.turnover24h > 0 && trades && trades.size >= 5) {
      const now = Date.now();
      const fiveMinAgo = now - 300_000;
      let tradeVol5m = 0;
      trades.forEach((t) => {
        if (t.timestamp >= fiveMinAgo) {
          tradeVol5m += t.price * t.size;
        }
      });

      const expected5mTurnover = (ticker.turnover24h / (24 * 60)) * 5;
      if (expected5mTurnover > 0 && tradeVol5m > 0) {
        return tradeVol5m / expected5mTurnover;
      }
    }

    return null; // explicit null, no fake 1.0!
  }

  /**
   * Computes genuine universe market median return across eligible universe over windowMs.
   * Uses robust median to prevent single-coin alt pump/dump distortion.
   */
  getUniverseReturn(windowMs: number, currentTs?: number): number | null {
    const returns: number[] = [];

    // Collect returns from all symbols in priceHistories
    for (const [_, pBuf] of this.priceHistories.entries()) {
      if (pBuf && pBuf.size >= 2) {
        const ret = pBuf.getReturnOverWindow(windowMs, currentTs).value;
        if (ret !== null && Number.isFinite(ret)) {
          returns.push(ret);
        }
      }
    }

    if (returns.length >= 5) {
      returns.sort((a, b) => a - b);
      const mid = Math.floor(returns.length / 2);
      return returns.length % 2 !== 0 ? returns[mid] : (returns[mid - 1] + returns[mid]) / 2;
    }

    // Benchmark basket fallback when universe history is cold (< 5 symbols)
    const targetCoins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'SUIUSDT', 'NEARUSDT', 'LINKUSDT'];
    const basketReturns: number[] = [];
    for (const sym of targetCoins) {
      const pBuf = this.priceHistories.get(sym);
      if (pBuf) {
        const ret = pBuf.getReturnOverWindow(windowMs, currentTs).value;
        if (ret !== null && Number.isFinite(ret)) {
          basketReturns.push(ret);
        }
      }
    }

    if (basketReturns.length >= 3) {
      basketReturns.sort((a, b) => a - b);
      const mid = Math.floor(basketReturns.length / 2);
      return basketReturns.length % 2 !== 0 ? basketReturns[mid] : (basketReturns[mid - 1] + basketReturns[mid]) / 2;
    }

    const btc = this.priceHistories.get('BTCUSDT')?.getReturnOverWindow(windowMs, currentTs).value;
    const eth = this.priceHistories.get('ETHUSDT')?.getReturnOverWindow(windowMs, currentTs).value;
    if (typeof btc === 'number' && typeof eth === 'number') return (btc * 0.6 + eth * 0.4);
    if (typeof btc === 'number') return btc;
    return null;
  }

  /**
   * Computes genuine sector return for a given category over windowMs.
   */
  getSectorReturn(sector: string, windowMs: number, currentTs?: number): number | null {
    if (sector === 'OTHER') return null;

    const coinsInSector = CONFIG.TIMEFRAMES ? Array.from(this.instruments.values()).filter(i => getSectorForCoin(i.baseCoin) === sector).map(i => i.symbol) : [];
    if (coinsInSector.length === 0) return null;

    const returns: number[] = [];
    for (const sym of coinsInSector) {
      const pBuf = this.priceHistories.get(sym);
      if (pBuf) {
        const ret = pBuf.getReturnOverWindow(windowMs, currentTs).value;
        if (ret !== null && Number.isFinite(ret)) {
          returns.push(ret);
        }
      }
    }

    if (returns.length === 0) return null;
    const sum = returns.reduce((a, b) => a + b, 0);
    return sum / returns.length;
  }

  snapshotPrices() {
    const now = Date.now();
    for (const [symbol, ticker] of this.tickers.entries()) {
      if (ticker.lastPrice > 0) {
        const pBuf = this.priceHistories.get(symbol);
        if (pBuf) {
          pBuf.push(now, ticker.lastPrice);
        }
        const legacyBuf = this.priceHistory5m.get(symbol);
        if (legacyBuf) {
          legacyBuf.push(ticker.lastPrice);
        }
      }
    }
  }

  getActiveSymbols(): string[] {
    return Array.from(this.instruments.keys());
  }

  getTickerMap(): Map<string, TickerData> {
    return this.tickers;
  }

  getCandles(symbol: string, timeframe: CandleTimeframe): CircularBuffer<CandleData> | undefined {
    return this.candles.get(symbol)?.get(timeframe);
  }

  getHTFContext(symbol: string) {
    const candleMap = this.candles.get(symbol);
    return this.htfContextEngine.analyze(candleMap?.get('240'), candleMap?.get('D'));
  }

  getCurrentCandle(symbol: string, timeframe: Timeframe): CandleData | undefined {
    return this.currentCandles.get(`${symbol}:${timeframe}`);
  }

  getLatestCandle(symbol: string, timeframe: Timeframe): CandleData | undefined {
    return this.currentCandles.get(`${symbol}:${timeframe}`) || this.candles.get(symbol)?.get(timeframe)?.latest();
  }

  getSymbolSector(symbol: string): string {
    const inst = this.instruments.get(symbol);
    if (!inst) return 'OTHER';
    return getSectorForCoin(inst.baseCoin);
  }

  async seedColdStartOIDeltas(symbols: string[]): Promise<number> {
    const BATCH_SIZE = 5;
    let loaded = 0;
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (sym) => {
        try {
          const delta = await this.rest.getOIDelta(sym);
          if (delta) {
            this.historicalOIDeltas.set(sym, delta);
            loaded++;
            const currentTicker = this.tickers.get(sym);
            if (currentTicker && !this.prevTickers.has(sym)) {
              const p15 = this.get15mReturn(sym).value || 0;
              this.prevTickers.set(sym, {
                ...currentTicker,
                openInterest: delta.oi15mAgo,
                lastPrice: delta.oiChange15mPct !== 0 && p15 !== 0
                  ? currentTicker.lastPrice / (1 + p15) 
                  : currentTicker.lastPrice
              });
            }
          }
        } catch {
          // Soft fail
        }
      }));
    }
    return loaded;
  }

  getFreshness(symbol: string): {
    isStale: boolean;
    reason?: string;
    ticker: DataFreshness;
    orderbook?: DataFreshness;
    overall: DataFreshness;
  } {
    const ticker = this.tickers.get(symbol);
    const orderbook = this.orderbooks.get(symbol);
    const now = Date.now();

    const tFresh = computeFreshness(ticker?.timestamp, ticker?.receivedAt ?? now, 30_000);
    const obFresh = orderbook
      ? computeFreshness(orderbook.timestamp, orderbook.receivedAt ?? now, 15_000)
      : undefined;

    let isStale = false;
    let reason: string | undefined;

    if (tFresh.isStale) {
      isStale = true;
      reason = `Bybit Ticker Stale (Age: ${tFresh.ageMs}ms)`;
    } else if (obFresh && obFresh.isStale) {
      isStale = true;
      reason = `Bybit Orderbook Stale (Age: ${obFresh.ageMs}ms)`;
    }

    const overall: DataFreshness = {
      sourceTimestamp: ticker?.timestamp ?? null,
      receivedAt: now,
      ageMs: tFresh.ageMs,
      isStale,
      status: isStale ? 'STALE' : (tFresh.status === 'TIMESTAMP_UNAVAILABLE' ? 'TIMESTAMP_UNAVAILABLE' : 'FRESH')
    };

    return {
      isStale,
      reason,
      ticker: tFresh,
      orderbook: obFresh,
      overall
    };
  }
}
