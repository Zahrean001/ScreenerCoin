// ============================================================
// Live Bybit Screener Test Runner & Detailed Diagnostic Output
// ============================================================

import { CONFIG } from '../src/config.js';
import { BybitRest } from '../src/data/bybit-rest.js';
import { BybitWebSocket } from '../src/data/bybit-ws.js';
import { MarketDataHub } from '../src/data/market-data-hub.js';
import { KlineLoader } from '../src/data/kline-loader.js';
import { Stage1Filter } from '../src/stages/stage1-filter.js';
import { VolatilityEngine } from '../src/indicators/volatility.js';
import { RelativeStrengthEngine } from '../src/indicators/relative-strength.js';
import { MarketRegimeEngine } from '../src/engines/market-regime.js';
import { OIFundingEngine } from '../src/engines/oi-funding.js';
import { LongEngine } from '../src/engines/long-engine.js';
import { ShortEngine } from '../src/engines/short-engine.js';
import { ExhaustionEngine } from '../src/engines/exhaustion.js';
import { BreakoutEngine } from '../src/engines/breakout.js';
import { SqueezeEngine } from '../src/engines/squeeze.js';
import { Stage3Execution } from '../src/stages/stage3-execution.js';
import { Stage2Signal } from '../src/stages/stage2-signal.js';
import { HotQueue, HotEventDetector } from '../src/ranking/hot-queue.js';
import { CorrelationFilter } from '../src/ranking/correlation.js';
import { FinalRanker, CandidateScores } from '../src/ranking/final-ranker.js';
import { JsonOutput } from '../src/output/json-output.js';
import { SignalLogger } from '../src/output/signal-logger.js';
import { MarketRegimeState, MarketRegime, TrendState, VolatilityRegime, ScreenerOutput } from '../src/data/types.js';
import Table from 'cli-table3';
import chalk from 'chalk';

async function runLiveScan() {
  const rest = new BybitRest();
  const ws = new BybitWebSocket();
  const hub = new MarketDataHub(rest);
  const klineLoader = new KlineLoader(rest, hub);

  const stage1 = new Stage1Filter(CONFIG);
  const volatilityEngine = new VolatilityEngine();
  const rsEngine = new RelativeStrengthEngine();
  const regimeEngine = new MarketRegimeEngine();
  const oiFundingEngine = new OIFundingEngine();
  const longEngine = new LongEngine();
  const shortEngine = new ShortEngine();
  const exhaustionEngine = new ExhaustionEngine();
  const breakoutEngine = new BreakoutEngine();
  const squeezeEngine = new SqueezeEngine();
  const stage3Execution = new Stage3Execution();

  const stage2 = new Stage2Signal(
    longEngine,
    shortEngine,
    exhaustionEngine,
    breakoutEngine,
    squeezeEngine,
    oiFundingEngine,
    rsEngine,
    volatilityEngine,
    stage3Execution
  );

  const hotQueue = new HotQueue();
  const hotDetector = new HotEventDetector(CONFIG);
  const correlationFilter = new CorrelationFilter();
  const finalRanker = new FinalRanker(correlationFilter);
  const jsonOutput = new JsonOutput(CONFIG.JSON_OUTPUT_PATH);
  const signalLogger = new SignalLogger(CONFIG.SIGNAL_LOG_PATH);

  // 1. Initialize Hub
  await hub.initialize();
  const allSymbols = hub.getActiveSymbols();

  // 2. Setup WebSocket
  ws.on('ticker', (data) => {
    if (!data.symbol) return;
    const prev = hub.tickers.get(data.symbol) || null;
    hub.updateTicker(data);

    const curr = hub.tickers.get(data.symbol);
    if (curr) {
      const hotEvent = hotDetector.detect(data.symbol, curr, prev);
      if (hotEvent) hotQueue.push(hotEvent);
    }
  });
  ws.on('kline', (symbol, timeframe, candle) => hub.updateCandle(symbol, timeframe, candle));
  ws.on('orderbook', (snapshot) => hub.updateOrderbook(snapshot));
  ws.on('trade', (trade) => hub.addTrade(trade));
  ws.on('liquidation', (liq) => hub.addLiquidation(liq));

  // 3. Connect & Subscribe
  ws.subscribe(allSymbols.map(s => `tickers.${s}`));

  // 4. Preload anchor klines
  await klineLoader.loadSymbolCandles('BTCUSDT');
  await klineLoader.loadSymbolCandles('ETHUSDT');

  // Wait 3.5s for live WebSocket stream ticks
  await new Promise(r => setTimeout(r, 3500));

  // 5. Stage 1 Filter
  const startS1 = Date.now();
  const candidates = stage1.filter(hub.tickers, hub.prevTickers, hub.instruments);
  const s1Time = Date.now() - startS1;

  // Preload klines for top 25 candidates
  const topCandidateSymbols = candidates.slice(0, 25).map(c => c.symbol);
  await Promise.all(topCandidateSymbols.map(s => klineLoader.loadSymbolCandles(s)));

  // 6. Stage 2 & 3 Scoring
  const startS2 = Date.now();
  let regime: MarketRegimeState = {
    regime: MarketRegime.NEUTRAL,
    btcTrend: TrendState.NEUTRAL,
    btcMomentum: 0,
    btcVolatility: VolatilityRegime.NORMAL,
    btcVwapPosition: 0,
    longModifier: 1.0,
    shortModifier: 1.0,
    timestamp: Date.now()
  };

  const btcTicker = hub.tickers.get('BTCUSDT')!;
  const btcInd = hub.indicators.get('BTCUSDT');
  const btc15m = hub.getCandles('BTCUSDT', '15');
  if (btcInd && btc15m) {
    regime = regimeEngine.analyze(btcInd, btcTicker, btc15m);
  }

  const candidateScores: CandidateScores[] = [];
  const sectorMap = new Map<string, string>();

  for (const cand of candidates.slice(0, 25)) {
    const score = stage2.analyzeCandidate(cand.symbol, hub, regime, cand.liquidityTier);
    if (score) {
      candidateScores.push(score);
      sectorMap.set(cand.symbol, hub.getSymbolSector(cand.symbol));
    }
  }

  const s2Time = Date.now() - startS2;

  const output: ScreenerOutput = finalRanker.rank(
    candidateScores,
    sectorMap,
    regime,
    btcTicker,
    hotQueue.size,
    s1Time + s2Time
  );

  // Print Output
  console.log('\n================================================================================================');
  console.log(`⚡ USDT PERPETUAL SCREENER — LIVE RESULT (${new Date().toLocaleTimeString()})`);
  console.log(`BTC: $${output.btcPrice.toFixed(2)} (${(output.btcChange1h * 100).toFixed(2)}% 1h) | Market Regime: ${output.regime} | Active Universe: ${hub.tickers.size} USDT Perps`);
  console.log(`Scan Latency: ${output.scanLatencyMs}ms | Stage 1 Passed: ${candidates.length} | Hot Queue: ${output.hotQueueSize} items`);
  console.log('================================================================================================\n');

  console.log('--- [1] OFFICIAL QUALIFIED TOP SETUPS (Threshold Score >= 80.0) ---');
  const officialTable = new Table({
    head: ['Rank', 'Symbol', 'Side', 'Final Score', 'Opp Score', 'Exec Score', 'Rating', '24h Vol', 'Primary Reasons'].map(h => chalk.cyan(h)),
  });

  if (output.results.length === 0) {
    officialTable.push([{ colSpan: 9, content: chalk.yellow('NO QUALIFIED SETUP (Saat ini tidak ada pair yang menembus skor kelayakan >= 80.0)') }]);
  } else {
    for (const res of output.results) {
      officialTable.push([
        res.rank,
        chalk.bold(res.symbol),
        res.side === 'LONG' ? chalk.green(res.side) : chalk.red(res.side),
        res.finalScore.toFixed(1),
        res.opportunityScore.toFixed(1),
        res.executionScore.toFixed(1),
        res.rating === 'A+' ? chalk.green.bold(res.rating) : chalk.green(res.rating),
        `$${(res.volume24h).toLocaleString()}`,
        res.reasons.join('; ')
      ]);
    }
  }
  console.log(officialTable.toString());

  console.log('\n--- [2] LIVE TOP CANDIDATES WATCHLIST (Scored Rankings & Raw Metrics) ---');
  const rawTable = new Table({
    head: ['#', 'Symbol', 'Price', '24h %', 'LONG Score', 'SHORT Score', 'Bias', 'Exec Score', '24h Turnover (USD)', 'Tier'].map(h => chalk.magenta(h)),
  });

  // Sort candidateScores by highest opportunity score
  const sorted = [...candidateScores].sort((a, b) => {
    const oppA = Math.max(a.longScore.total, a.shortScore.total);
    const oppB = Math.max(b.longScore.total, b.shortScore.total);
    return oppB - oppA;
  });

  for (let i = 0; i < Math.min(10, sorted.length); i++) {
    const cs = sorted[i];
    let bias = 'NEUTRAL';
    if (cs.longScore.total > cs.shortScore.total + 5) bias = chalk.green('BULLISH (LONG)');
    else if (cs.shortScore.total > cs.longScore.total + 5) bias = chalk.red('BEARISH (SHORT)');
    else bias = chalk.yellow('CONFLICT/CHOP');

    rawTable.push([
      i + 1,
      chalk.bold(cs.symbol),
      cs.ticker.lastPrice >= 1 ? cs.ticker.lastPrice.toFixed(4) : cs.ticker.lastPrice.toFixed(6),
      cs.ticker.price24hPcnt > 0 ? chalk.green(`+${(cs.ticker.price24hPcnt * 100).toFixed(2)}%`) : chalk.red(`${(cs.ticker.price24hPcnt * 100).toFixed(2)}%`),
      cs.longScore.total.toFixed(1),
      cs.shortScore.total.toFixed(1),
      bias,
      cs.executionScore.total.toFixed(1),
      `$${(cs.ticker.turnover24h / 1_000_000).toFixed(2)}M`,
      cs.liquidityTier
    ]);
  }
  console.log(rawTable.toString());

  jsonOutput.write(output);
  process.exit(0);
}

runLiveScan().catch(err => {
  console.error('Scan error:', err);
  process.exit(1);
});
