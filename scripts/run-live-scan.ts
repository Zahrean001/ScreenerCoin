// ============================================================
// Live Market Scan Runner & Detailed Opportunity Inspector
// ============================================================

import { CONFIG } from '../src/config.js';
import { logger } from '../src/utils/logger.js';
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
import { CorrelationFilter } from '../src/ranking/correlation.js';
import { FinalRanker, CandidateScores } from '../src/ranking/final-ranker.js';
import { TerminalUI } from '../src/output/terminal-ui.js';
import { MarketRegimeState, MarketRegime, TrendState, VolatilityRegime, ScreenerOutput } from '../src/data/types.js';

async function main() {
  console.log('====================================================');
  console.log('  STARTING LIVE USDT-PERPETUAL CRYPTO MARKET SCAN   ');
  console.log('====================================================\n');

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
    longEngine, shortEngine, exhaustionEngine, breakoutEngine,
    squeezeEngine, oiFundingEngine, rsEngine, volatilityEngine, stage3Execution
  );

  const correlationFilter = new CorrelationFilter();
  const finalRanker = new FinalRanker(correlationFilter);
  const terminalUI = new TerminalUI();

  // 1. Initialize Hub with all instruments and latest tickers
  console.log('[1/5] Fetching live linear perpetual instruments and ticker snapshot from Bybit V5...');
  await hub.initialize();
  const activeSymbols = hub.getActiveSymbols();
  console.log(`       Loaded ${activeSymbols.length} active USDT perpetual contracts.`);

  // 2. Setup WebSocket
  console.log('[2/5] Connecting WebSocket pool and subscribing to live ticker streams...');
  ws.on('ticker', (t) => hub.updateTicker(t));
  ws.on('kline', (sym, tf, c) => hub.updateCandle(sym, tf, c));
  ws.on('orderbook', (ob) => hub.updateOrderbook(ob));
  ws.on('trade', (tr) => hub.addTrade(tr));
  ws.on('liquidation', (liq) => hub.addLiquidation(liq));

  const tickerTopics = activeSymbols.map(s => `tickers.${s}`);
  ws.subscribe(tickerTopics);

  // 3. Preload Anchor Candles (BTC & ETH)
  console.log('[3/5] Preloading anchor candles (BTCUSDT & ETHUSDT)...');
  await klineLoader.loadSymbolCandles('BTCUSDT');
  await klineLoader.loadSymbolCandles('ETHUSDT');

  // 4. Initial Stage 1 Filter
  console.log('[4/5] Running Stage 1 fast filter across all instruments...');
  const stage1Candidates = stage1.filter(hub.tickers, hub.prevTickers, hub.instruments, hub);
  console.log(`       Stage 1 Filter: ${activeSymbols.length} total -> ${stage1Candidates.length} qualified candidates.`);

  const topCandidates = stage1Candidates.slice(0, Math.min(20, CONFIG.MAX_DEEP_CANDIDATES));
  const topSymbols = topCandidates.map(c => c.symbol);

  // Subscribe candidate specific streams (orderbook, trades, klines)
  ws.subscribeCandidateStreams(topSymbols);

  console.log(`       Preloading candles and subscribing to orderbooks/trades for top ${topSymbols.length} candidates:`);
  console.log(`       ${topSymbols.join(', ')}`);

  // Load candles for candidate symbols
  for (const sym of topSymbols) {
    await klineLoader.loadSymbolCandles(sym);
  }

  // 5. Accumulate live ticks and orderbooks
  console.log('\n[5/5] Streaming live orderbook deltas & trade flow (waiting 10s for real-time depth)...');
  await new Promise(resolve => setTimeout(resolve, 10_000));

  // Snapshot prices for rolling calculations
  hub.snapshotPrices();

  // Evaluate Market Regime
  const btcIndicators = hub.indicators.get('BTCUSDT');
  const btcTicker = hub.tickers.get('BTCUSDT')!;
  const btcCandles15m = hub.getCandles('BTCUSDT', '15')!;

  let currentRegime: MarketRegimeState = {
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

  if (btcIndicators && btcCandles15m) {
    currentRegime = regimeEngine.analyze(btcIndicators, btcTicker, btcCandles15m);
  }

  // Bootstrap historical funding settlements for candidates before scoring (Option C)
  console.log('       Bootstrapping genuine historical funding settlements for candidates...');
  const needsFunding = topCandidates.filter(c => !hub.isFundingReady(c.symbol));
  if (needsFunding.length > 0) {
    await Promise.allSettled(
      needsFunding.map(c => hub.bootstrapFundingHistory(c.symbol))
    );
  }

  // Execute Stage 2 & 3 scoring for candidates
  const candidateScores: CandidateScores[] = [];
  const sectorMap = new Map<string, string>();

  for (const cand of topCandidates) {
    const score = stage2.analyzeCandidate(
      cand.symbol, 
      hub, 
      currentRegime, 
      cand.liquidityTier,
      cand.priceChange5m,
      cand.priceChange1h,
      cand.discoveryLane
    );
    if (score) {
      candidateScores.push(score);
      sectorMap.set(cand.symbol, hub.getSymbolSector(cand.symbol));
    }
  }

  // Final Ranking
  const scanStartTime = Date.now();
  const output: ScreenerOutput = finalRanker.rank(
    candidateScores,
    sectorMap,
    currentRegime,
    btcTicker,
    0,
    Date.now() - scanStartTime,
    {
      universeSize: hub.instruments.size,
      eligibleSymbols: activeSymbols.length,
      stage1Candidates: stage1Candidates.length,
      stage1Diagnostics: stage1.lastDiagnostics
    }
  );

  console.log('\n========================================================================================');
  console.log('                            HASIL SCREENER PASAR LIVE (BYBIT)                           ');
  console.log('========================================================================================\n');

  // Render Table
  terminalUI.render(output);

  // Detailed Candidate Breakdown
  console.log('\n========================================================================================');
  console.log('                   PANDUAN EKSEKUSI & ACTION PLAN TOP 5 KOIN TERATAS                    ');
  console.log('========================================================================================\n');

  if (output.results.length === 0) {
    console.log('ℹ️  TIDAK ADA KOIN YANG LOLOS FILTER KUALITAS & ANTI-CHASE PADA DETIK INI.');
    console.log('   Alasan Penolakan Pipeline:');
    const r = output.diagnostics.rejectionReasons;
    console.log(`   • Ditolak karena Telat / Overextended (Late Chase): ${r.rejectedLateChase}`);
    console.log(`   • Ditolak karena Risiko Distribusi / Top Wick: ${r.rejectedDistribution}`);
    console.log(`   • Ditolak karena Tren Lemah: ${r.rejectedWeakTrend}`);
    console.log(`   • Ditolak karena Skor di Bawah Ambang: ${r.rejectedScoreThreshold}\n`);

    // Tampilkan 3 koin yang paling mendekati tapi terkena Anti-Chase sebagai edukasi
    const blockedByChase = candidateScores
      .filter(c => c.timing && (c.timing.signalCategory === 'NO_LONG' || c.timing.signalCategory === 'LATE_LONG'))
      .slice(0, 3);

    if (blockedByChase.length > 0) {
      console.log('📋 CONTOH KOIN YANG SUDAH TERBANG & DIBLOKIR OLEH ANTI-CHASE (JANGAN FOMO):');
      for (const c of blockedByChase) {
        console.log(`   • ${c.symbol}: Direction=${c.longScore.total >= c.shortScore.total ? 'BULLISH' : 'BEARISH'} (Score: ${Math.max(c.longScore.total, c.shortScore.total).toFixed(1)})`);
        console.log(`     Fase: ${c.timing?.phase.label} | Kematangan: ${c.timing?.moveMaturity} | Chase Risk: ${c.timing?.chaseRiskScore}/100 | Jarak: +${c.timing?.distanceFromTriggerPct}% (${c.timing?.distanceFromTriggerATR}x ATR)`);
        console.log(`     Alasan Blokir: ${c.timing?.decision}\n`);
      }
    }
  } else {
    output.results.forEach((item, idx) => {
      const price = item.price;
      const ind = hub.indicators.get(item.symbol);
      const ema9_15 = ind?.ema9['15'] ?? price * 0.985;
      const ema21_15 = ind?.ema21['15'] ?? price * 0.975;
      
      let entryPlan = '';
      let slPlan = '';
      let tpPlan = '';

      if (item.signalCategory === 'EARLY_LONG') {
        entryPlan = `Market/Limit Order di Area Breakout: $${price.toFixed(6)}`;
        slPlan = `$${(ema21_15 * 0.98).toFixed(6)} (-2.0% di bawah basis breakout)`;
        tpPlan = `TP1: $${(price * 1.04).toFixed(6)} (+4%) | TP2: $${(price * 1.08).toFixed(6)} (+8%)`;
      } else if (item.signalCategory === 'EARLY_SHORT') {
        entryPlan = `Market/Limit Short di Area Breakdown: $${price.toFixed(6)}`;
        slPlan = `$${(ema21_15 * 1.02).toFixed(6)} (+2.0% di atas breakdown base)`;
        tpPlan = `TP1: $${(price * 0.96).toFixed(6)} (-4%) | TP2: $${(price * 0.92).toFixed(6)} (-8%)`;
      } else {
        entryPlan = item.side === 'LONG'
          ? `TUNGGU PULLBACK ke Support/EMA 15m: $${ema21_15.toFixed(6)} - $${ema9_15.toFixed(6)}`
          : `TUNGGU RETEST ke Resistance: $${ema9_15.toFixed(6)} - $${ema21_15.toFixed(6)}`;
        slPlan = item.side === 'LONG' ? `$${(ema21_15 * 0.975).toFixed(6)}` : `$${(ema21_15 * 1.025).toFixed(6)}`;
        tpPlan = item.side === 'LONG' ? `TP: $${(price * 1.05).toFixed(6)}` : `TP: $${(price * 0.95).toFixed(6)}`;
      }

      console.log(`----------------------------------------------------------------------------------------`);
      console.log(`[#${idx + 1}] KOIN: ${item.symbol} | SINYAL: [${item.signalCategory}] ${item.side === 'LONG' ? '🟢 LONG' : '🔴 SHORT'} | SKOR: ${item.finalScore.toFixed(1)}/100`);
      console.log(`     Harga Saat Ini   : $${item.price} (24h: ${(item.priceChange24h * 100).toFixed(2)}%) | Volume: $${(item.volume24h / 1e6).toFixed(1)}M`);
      if (item.timing) {
        console.log(`     Fase Pasar       : ${item.timing.phase.label} (Conf: ${(item.timing.phase.confidence * 100).toFixed(0)}%) | Kematangan: ${item.timing.moveMaturity}`);
        console.log(`     Skor Timing      : ${item.timing.timingScore}/100 | Ignition: ${item.timing.momentumIgnitionScore}/100 | Chase Risk: ${item.timing.chaseRiskScore}/100`);
        console.log(`     Jarak Trigger    : ${item.timing.distanceFromTriggerPct >= 0 ? '+' : ''}${item.timing.distanceFromTriggerPct}% (${item.timing.distanceFromTriggerATR}x ATR)`);
        console.log(`     Panduan Tindakan : ${item.timing.decision}`);
      }
      console.log(`     👉 Rencana Entry : ${entryPlan}`);
      console.log(`     🛑 Stop Loss (SL): ${slPlan}`);
      console.log(`     🎯 Take Profit   : ${tpPlan}`);
      console.log(`     💡 Sinyal        : ${item.reasons.join(', ')}`);
    });
    console.log(`----------------------------------------------------------------------------------------\n`);
  }

  console.log(`Scan selesai pada ${new Date().toISOString()}`);
  ws.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Scan error:', err);
  process.exit(1);
});
