// ============================================================
// USDT Perpetual Crypto Screener — Master Orchestrator
// ============================================================

import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { BybitRest } from './data/bybit-rest.js';
import { BybitWebSocket } from './data/bybit-ws.js';
import { MarketDataHub } from './data/market-data-hub.js';
import { KlineLoader } from './data/kline-loader.js';
import { Stage1Filter } from './stages/stage1-filter.js';
import { VolatilityEngine } from './indicators/volatility.js';
import { RelativeStrengthEngine } from './indicators/relative-strength.js';
import { MarketRegimeEngine } from './engines/market-regime.js';
import { OIFundingEngine } from './engines/oi-funding.js';
import { LongEngine } from './engines/long-engine.js';
import { ShortEngine } from './engines/short-engine.js';
import { ExhaustionEngine } from './engines/exhaustion.js';
import { BreakoutEngine } from './engines/breakout.js';
import { SqueezeEngine } from './engines/squeeze.js';
import { Stage3Execution } from './stages/stage3-execution.js';
import { Stage2Signal } from './stages/stage2-signal.js';
import { HotQueue, HotEventDetector } from './ranking/hot-queue.js';
import { CorrelationFilter } from './ranking/correlation.js';
import { FinalRanker, CandidateScores } from './ranking/final-ranker.js';
import { TerminalUI } from './output/terminal-ui.js';
import { JsonOutput } from './output/json-output.js';
import { SignalLogger } from './output/signal-logger.js';
import { MarketRegimeState, MarketRegime, TrendState, VolatilityRegime, Stage1Result, ScreenerOutput } from './data/types.js';

class ScreenerApp {
  private log = logger.child('App');

  // Data Layer
  private rest = new BybitRest();
  private ws = new BybitWebSocket();
  private hub = new MarketDataHub(this.rest);
  private klineLoader = new KlineLoader(this.rest, this.hub);

  // Filters & Engines
  private stage1 = new Stage1Filter(CONFIG);
  private volatilityEngine = new VolatilityEngine();
  private rsEngine = new RelativeStrengthEngine();
  private regimeEngine = new MarketRegimeEngine();
  private oiFundingEngine = new OIFundingEngine();
  private longEngine = new LongEngine();
  private shortEngine = new ShortEngine();
  private exhaustionEngine = new ExhaustionEngine();
  private breakoutEngine = new BreakoutEngine();
  private squeezeEngine = new SqueezeEngine();
  private stage3Execution = new Stage3Execution();

  private stage2 = new Stage2Signal(
    this.longEngine,
    this.shortEngine,
    this.exhaustionEngine,
    this.breakoutEngine,
    this.squeezeEngine,
    this.oiFundingEngine,
    this.rsEngine,
    this.volatilityEngine,
    this.stage3Execution
  );

  // Ranking & Output
  private hotQueue = new HotQueue();
  private hotDetector = new HotEventDetector(CONFIG);
  private correlationFilter = new CorrelationFilter();
  private finalRanker = new FinalRanker(this.correlationFilter);

  private terminalUI = new TerminalUI();
  private jsonOutput = new JsonOutput(CONFIG.JSON_OUTPUT_PATH);
  private signalLogger = new SignalLogger(CONFIG.SIGNAL_LOG_PATH);

  // State
  private currentCandidates: Stage1Result[] = [];
  private subscribedCandidateSymbols = new Set<string>();
  private currentRegime: MarketRegimeState = {
    regime: MarketRegime.NEUTRAL,
    btcTrend: TrendState.NEUTRAL,
    btcMomentum: 0,
    btcVolatility: VolatilityRegime.NORMAL,
    btcRealizedVol: 0,
    btcVwapPosition: 0,
    longModifier: 1.0,
    shortModifier: 1.0,
    timestamp: Date.now()
  };
  private isRunning = false;
  private fastLoopTimer?: NodeJS.Timeout;
  private normalLoopTimer?: NodeJS.Timeout;
  private deepLoopTimer?: NodeJS.Timeout;
  private hotLoopTimer?: NodeJS.Timeout;
  private loadingCandles = false;
  private fetchingLsRatios = false;
  private normalLoopRunning = false;

  async start() {
    this.log.info('Starting Fast USDT-Perpetual Crypto Screener (Production Logic Active)...');

    // 1. Initialize static metadata and initial tickers
    await this.hub.initialize();

    // 2. Set up WebSocket handlers
    this.setupWebSocket();

    // 3. Subscribe to all tickers initially
    const allSymbols = this.hub.getActiveSymbols();
    this.log.info(`Subscribing to tickers for ${allSymbols.length} active symbols...`);
    const tickerTopics = allSymbols.map(s => `tickers.${s}`);
    this.ws.subscribe(tickerTopics);

    // 4. Preload anchor candles (BTC & ETH)
    this.log.info('Preloading anchor candles (BTC & ETH)...');
    await this.klineLoader.loadSymbolCandles('BTCUSDT');
    await this.klineLoader.loadSymbolCandles('ETHUSDT');

    // 5. Initial Stage 1 run & preload candidates
    this.currentCandidates = this.stage1.filter(this.hub.tickers, this.hub.prevTickers, this.hub.instruments, this.hub);
    const initialCandidateSymbols = this.currentCandidates.slice(0, CONFIG.MAX_DEEP_CANDIDATES).map(c => c.symbol);
    this.updateCandidateSubscriptions(initialCandidateSymbols);

    // Load initial candidate candles asynchronously
    this.klineLoader.loadInitialCandles(initialCandidateSymbols).catch(err => {
      this.log.error('Initial candle preload error', { error: String(err) });
    });

    this.isRunning = true;

    // 6. Start scan loops
    this.startLoops();

    this.log.info('Screener operational! Starting scan loops.');
  }

  private setupWebSocket() {
    this.ws.on('ticker', (data) => {
      if (!data.symbol) return;
      const prev = this.hub.tickers.get(data.symbol) || null;
      this.hub.updateTicker(data);

      // Event-driven Hot Queue trigger detection
      const curr = this.hub.tickers.get(data.symbol);
      if (curr) {
        const hotEvent = this.hotDetector.detect(data.symbol, curr, prev);
        if (hotEvent) {
          this.hotQueue.push(hotEvent);
        }
      }
    });

    this.ws.on('kline', (symbol, timeframe, candle) => {
      this.hub.updateCandle(symbol, timeframe, candle);
    });

    this.ws.on('orderbook', (snapshot) => {
      this.hub.updateOrderbook(snapshot);
    });

    this.ws.on('trade', (trade) => {
      this.hub.addTrade(trade);
    });

    this.ws.on('liquidation', (liq) => {
      this.hub.addLiquidation(liq);
    });
  }

  private startLoops() {
    // FAST LOOP: Runs Stage 1 filter (~1.5s)
    this.fastLoopTimer = setInterval(() => this.runFastLoop(), CONFIG.FAST_LOOP_MS);

    // NORMAL LOOP: Runs full Stage 2 scoring & Final ranking (~5s)
    this.normalLoopTimer = setInterval(() => this.runNormalLoop(), CONFIG.NORMAL_LOOP_MS);

    // HOT LOOP: Event-driven scoring for priority queue items (~500ms check)
    this.hotLoopTimer = setInterval(() => this.runHotLoop(), 500);

    // DEEP LOOP: Price snapshot, cleanup, anchor updates (~30s)
    this.deepLoopTimer = setInterval(() => this.runDeepLoop(), CONFIG.DEEP_LOOP_MS);
  }

  private runFastLoop() {
    try {
      this.currentCandidates = this.stage1.filter(
        this.hub.tickers, 
        this.hub.prevTickers, 
        this.hub.instruments,
        this.hub
      );

      const topCandidateSymbols = this.currentCandidates.slice(0, CONFIG.MAX_DEEP_CANDIDATES).map(c => c.symbol);
      this.updateCandidateSubscriptions(topCandidateSymbols);

      // Lazy load candles for top candidates with missing data
      if (!this.loadingCandles) {
        const missingCandles = topCandidateSymbols.filter(s => {
          const c5 = this.hub.getCandles(s, '5');
          return !c5 || c5.size < 10;
        });

        if (missingCandles.length > 0) {
          this.loadingCandles = true;
          const batch = missingCandles.slice(0, 8);
          Promise.all(batch.map(s => this.klineLoader.loadSymbolCandles(s)))
            .finally(() => { this.loadingCandles = false; });
        }
      }
    } catch (err) {
      this.log.error('Fast loop error', { error: String(err) });
    }
  }

  private async runNormalLoop() {
    // Do not let a slow REST/funding bootstrap create overlapping scan cycles.
    if (this.normalLoopRunning) {
      this.log.warn('Skipping normal scan: previous cycle is still running');
      return;
    }

    this.normalLoopRunning = true;
    const startTime = Date.now();
    try {
      // 1. Update BTC regime
      this.updateRegime();

      // 2. Score candidates strictly bounded to MAX_DEEP_CANDIDATES
      const candidateScores: CandidateScores[] = [];
      const sectorMap = new Map<string, string>();
      const deepCandidates = this.currentCandidates.slice(0, CONFIG.MAX_DEEP_CANDIDATES);

      // Phase 2 #2: Await funding bootstrap for candidates before scoring (Option C)
      const needsFunding = deepCandidates.filter(c => !this.hub.isFundingReady(c.symbol));
      if (needsFunding.length > 0) {
        await Promise.allSettled(
          needsFunding.map(c => this.hub.bootstrapFundingHistory(c.symbol))
        );
      }

      for (const cand of deepCandidates) {
        const score = this.stage2.analyzeCandidate(
          cand.symbol, 
          this.hub, 
          this.currentRegime, 
          cand.liquidityTier,
          cand.priceChange5m,
          cand.priceChange1h,
          cand.discoveryLane
        );

        if (score) {
          candidateScores.push(score);
          sectorMap.set(cand.symbol, this.hub.getSymbolSector(cand.symbol));
        }
      }

      // 3. Final ranking & filtering
      const btcTicker = this.hub.tickers.get('BTCUSDT') || {
        symbol: 'BTCUSDT',
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
        timestamp: Date.now()
      };

      const latency = Date.now() - startTime;
      const totalSymbols = this.hub.instruments.size;
      const eligibleSymbols = Array.from(this.hub.instruments.values()).filter(i => 
        i.quoteCoin === 'USDT' && i.contractType === 'LinearPerpetual' && i.status === 'Trading'
      ).length;

      // Phase 2 #3: Use explicit Stage1Diagnostics instead of deriving by subtraction
      const stage1Diag = this.stage1.lastDiagnostics;

      const output: ScreenerOutput = this.finalRanker.rank(
        candidateScores,
        sectorMap,
        this.currentRegime,
        btcTicker,
        this.hotQueue.size,
        latency,
        {
          universeSize: totalSymbols,
          eligibleSymbols,
          stage1Candidates: this.currentCandidates.length,
          stage1Diagnostics: stage1Diag
        }
      );

      // 4. Output to terminal, JSON, and signal logs
      this.terminalUI.render(output);
      this.jsonOutput.write(output);

      for (const res of output.results) {
        this.signalLogger.logSignal(res, output.regime);
      }
    } catch (err) {
      this.log.error('Normal loop error', { error: String(err) });
    } finally {
      this.normalLoopRunning = false;
    }
  }

  private runHotLoop() {
    try {
      if (this.hotQueue.size === 0) return;

      const hotEvent = this.hotQueue.pop();
      if (!hotEvent) return;

      const cand = this.currentCandidates.find(c => c.symbol === hotEvent.symbol);
      const tier = cand ? cand.liquidityTier : 'B';

      const score = this.stage2.analyzeCandidate(
        hotEvent.symbol, 
        this.hub, 
        this.currentRegime, 
        tier
      );

      if (score && (score.longScore.total >= CONFIG.MIN_FINAL_SCORE || score.shortScore.total >= CONFIG.MIN_FINAL_SCORE)) {
        const triggers = hotEvent.triggers.join(', ');
        this.log.info(`HOT TRIGGER: ${hotEvent.symbol} triggered by [${triggers}] (Score: Long ${score.longScore.total.toFixed(1)} / Short ${score.shortScore.total.toFixed(1)})`);
      }
    } catch (err) {
      this.log.error('Hot loop error', { error: String(err) });
    }
  }

  private runDeepLoop() {
    try {
      this.hub.snapshotPrices();
      this.hotQueue.cleanup();

      // Background bounded fetch of Long/Short ratios for top deep candidates
      if (!this.fetchingLsRatios) {
        const topSymbols = this.currentCandidates.slice(0, 5).map(c => c.symbol);
        if (topSymbols.length > 0) {
          this.fetchingLsRatios = true;
          Promise.all(topSymbols.map(async (sym) => {
            try {
              const res = await this.rest.getLongShortRatio(sym, '1h', 2);
              if (res && res.length > 0) {
                const latest = res[0];
                this.hub.setLongShortRatio(sym, parseFloat(latest.buyRatio), parseFloat(latest.sellRatio), parseInt(latest.timestamp, 10));
              }
            } catch (err) {
              // Non-blocking
            }
          })).finally(() => { this.fetchingLsRatios = false; });
        }
      }
    } catch (err) {
      this.log.error('Deep loop error', { error: String(err) });
    }
  }

  private updateRegime() {
    const btcTicker = this.hub.tickers.get('BTCUSDT');
    const btcInd = this.hub.indicators.get('BTCUSDT');
    const btc15m = this.hub.getCandles('BTCUSDT', '15');

    if (btcTicker && btcInd && btc15m) {
      this.currentRegime = this.regimeEngine.analyze(btcInd, btcTicker, btc15m);
    }
  }

  private updateCandidateSubscriptions(candidateSymbols: string[]) {
    const targetSet = new Set(candidateSymbols);
    const toSubscribe: string[] = [];
    const toUnsubscribe: string[] = [];

    for (const sym of targetSet) {
      if (!this.subscribedCandidateSymbols.has(sym)) {
        toSubscribe.push(sym);
      }
    }

    for (const sym of this.subscribedCandidateSymbols) {
      if (!targetSet.has(sym)) {
        toUnsubscribe.push(sym);
      }
    }

    if (toSubscribe.length > 0) {
      this.ws.subscribeCandidateStreams(toSubscribe);
      for (const s of toSubscribe) this.subscribedCandidateSymbols.add(s);
    }

    if (toUnsubscribe.length > 0) {
      this.ws.unsubscribeCandidateStreams(toUnsubscribe);
      for (const s of toUnsubscribe) this.subscribedCandidateSymbols.delete(s);
    }
  }

  stop() {
    this.log.info('Stopping screener...');
    this.isRunning = false;
    if (this.fastLoopTimer) clearInterval(this.fastLoopTimer);
    if (this.normalLoopTimer) clearInterval(this.normalLoopTimer);
    if (this.hotLoopTimer) clearInterval(this.hotLoopTimer);
    if (this.deepLoopTimer) clearInterval(this.deepLoopTimer);
    this.ws.close();
  }
}

// Start Application
const app = new ScreenerApp();
app.start().catch(err => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  app.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  app.stop();
  process.exit(0);
});
