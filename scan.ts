// ============================================================
// MANUAL SCAN — Jalankan via: scan.bat (double-click)
// Trade Screener Coin v2.0 — Auto Radar & Custom Coin Request
// ============================================================

import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { CONFIG } from './src/config.js';
import { BybitRest } from './src/data/bybit-rest.js';
import { MarketDataHub } from './src/data/market-data-hub.js';
import { KlineLoader } from './src/data/kline-loader.js';
import { Stage1Filter } from './src/stages/stage1-filter.js';
import { VolatilityEngine } from './src/indicators/volatility.js';
import { RelativeStrengthEngine } from './src/indicators/relative-strength.js';
import { MarketRegimeEngine } from './src/engines/market-regime.js';
import { OIFundingEngine } from './src/engines/oi-funding.js';
import { LongEngine } from './src/engines/long-engine.js';
import { ShortEngine } from './src/engines/short-engine.js';
import { ExhaustionEngine } from './src/engines/exhaustion.js';
import { BreakoutEngine } from './src/engines/breakout.js';
import { SqueezeEngine } from './src/engines/squeeze.js';
import { Stage3Execution } from './src/stages/stage3-execution.js';
import { Stage2Signal } from './src/stages/stage2-signal.js';
import { CorrelationFilter } from './src/ranking/correlation.js';
import { FinalRanker, CandidateScores } from './src/ranking/final-ranker.js';
import { TerminalUI } from './src/output/terminal-ui.js';
import { BinanceSymbolResolver } from './src/exchanges/binance-symbol-resolver.js';
import { BinanceDeepAnchorEngine } from './src/exchanges/binance-deep-anchor.js';
import chalk from 'chalk';

// ─── Helper: progress bar ───
function progressBar(current: number, total: number, width = 30): string {
  const pct = Math.min(current / total, 1);
  const filled = Math.round(width * pct);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `  [${bar}] ${Math.round(pct * 100)}%`;
}

// ─── Helper: elapsed timer ───
function elapsed(start: number): string {
  return ((Date.now() - start) / 1000).toFixed(1) + 's';
}

// ─── Helper: spinner frames ───
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinIdx = 0;
function spin(): string {
  return SPINNER[spinIdx++ % SPINNER.length];
}

async function runScan() {
  const startTime = Date.now();
  const scanTime = new Date().toLocaleString('id-ID', { 
    timeZone: 'Asia/Jakarta',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  // ═══ BOOT HEADER — FIGlet Random Number Art ═══
  const THICK_DIGITS = '23456789';
  const rd = () => THICK_DIGITS[Math.floor(Math.random() * THICK_DIGITS.length)];

  function randomizeLine(tpl: string): string {
    let out = '';
    for (const ch of tpl) {
      out += ch === '8' ? rd() : ch;
    }
    return out;
  }

  const W = 69;
  const TRADE_TPL = [
    '  88888888  8888888    888    8888888   88888888',
    '     88     88    88  88 88   88   88   88      ',
    '     88     8888888  88   88  88   88   888888  ',
    '     88     88  88   8888888  88   88   88      ',
    '     88     88   88  88   88  8888888   88888888',
  ];

  const SCREENER_TPL = [
    '  888888  888888  8888888  88888888 88888888 88  88 88888888 8888888 ',
    '  88      88      88   88  88       88       888 88 88       88   88',
    '   8888   88      888888   88888    88888    88 888 88888    888888  ',
    '      88  88      88  88   88       88       88  88 88       88  88 ',
    '  888888  888888  88   88  88888888 88888888 88  88 88888888 88   88',
  ];

  const COIN_TPL = [
    '            888888   888888   88888888  88    88',
    '           88       88    88     88     888   88',
    '           88       88    88     88     88 8  88',
    '           88       88    88     88     88  8 88',
    '            888888   888888   88888888  88   888',
  ];

  const BOX_W = W + 14; // 83

  console.log('');
  console.log(chalk.cyan('  ╔' + '═'.repeat(BOX_W) + '╗'));
  console.log(chalk.cyan('  ║' + ' '.repeat(BOX_W) + '║'));

  // TRADE
  for (const tpl of TRADE_TPL) {
    const line = randomizeLine(tpl);
    console.log(chalk.cyan('  ║') + chalk.white.bold('  ' + line) + ' '.repeat(Math.max(0, BOX_W - line.length - 2)) + chalk.cyan('║'));
  }
  console.log(chalk.cyan('  ║' + ' '.repeat(BOX_W) + '║'));

  // SCREENER
  for (const tpl of SCREENER_TPL) {
    const line = randomizeLine(tpl);
    console.log(chalk.cyan('  ║') + chalk.gray('  ' + line) + ' '.repeat(Math.max(0, BOX_W - line.length - 2)) + chalk.cyan('║'));
  }
  console.log(chalk.cyan('  ║' + ' '.repeat(BOX_W) + '║'));

  // COIN
  for (const tpl of COIN_TPL) {
    const line = randomizeLine(tpl);
    console.log(chalk.cyan('  ║') + chalk.white.bold('  ' + line) + ' '.repeat(Math.max(0, BOX_W - line.length - 2)) + chalk.cyan('║'));
  }

  console.log(chalk.cyan('  ║' + ' '.repeat(BOX_W) + '║'));
  const tagText = 'USDT Perpetual Crypto Screener — Early Momentum Radar v2.0';
  const timeText = `Scan Time: ${scanTime} WIB`;
  const padTag = Math.max(0, BOX_W - tagText.length - 2);
  const padTime = Math.max(0, BOX_W - timeText.length - 2);
  console.log(chalk.cyan('  ║') + '  ' + chalk.yellow(tagText) + ' '.repeat(padTag) + chalk.cyan('║'));
  console.log(chalk.cyan('  ║') + '  ' + chalk.gray(timeText) + ' '.repeat(padTime) + chalk.cyan('║'));
  console.log(chalk.cyan('  ║' + ' '.repeat(BOX_W) + '║'));
  console.log(chalk.cyan('  ╚' + '═'.repeat(BOX_W) + '╝'));
  console.log('');

  // ═══ MODE SELECTION (Interactive / CLI Args) ═══
  let requestedCoins: string[] = [];
  const cliArgs = process.argv.slice(2).filter(a => !a.startsWith('-'));

  if (cliArgs.length > 0) {
    requestedCoins = cliArgs.join(' ').split(/[\s,]+/).filter(Boolean);
    console.log(chalk.cyan(`  [*] Mode CLI Target: `) + chalk.yellow.bold(requestedCoins.join(', ')) + '\n');
  } else {
    console.log(chalk.cyan.bold('  ┌─────────────────────────────────────────────────────────────────────────────┐'));
    console.log(chalk.cyan.bold('  │') + chalk.white.bold('  🎯  PILIH MODE SCAN                                                       ') + chalk.cyan.bold('│'));
    console.log(chalk.cyan.bold('  ├─────────────────────────────────────────────────────────────────────────────┤'));
    console.log(chalk.cyan.bold('  │') + chalk.white('  [1] ') + chalk.green.bold('Auto Market Radar') + chalk.gray('   (Scan 570+ koin USDT Perp secara otomatis)     ') + chalk.cyan.bold('│'));
    console.log(chalk.cyan.bold('  │') + chalk.white('  [2] ') + chalk.yellow.bold('Custom Coin Scan') + chalk.gray('    (Scan & analisa mendalam koin yang Anda minta) ') + chalk.cyan.bold('│'));
    console.log(chalk.cyan.bold('  └─────────────────────────────────────────────────────────────────────────────┘'));
    console.log('');

    const rl = readline.createInterface({ input, output });
    try {
      const choice = (await rl.question(chalk.cyan('  Ketik [1] atau [2] ') + chalk.gray('(Tekan Enter langsung untuk Mode 1): '))).trim();
      if (choice === '2') {
        const coinInput = await rl.question(chalk.yellow('  Masukkan koin yang ingin di-scan (contoh: SOL, DOGE, FARTCOIN): '));
        requestedCoins = coinInput.split(/[\s,]+/).filter(Boolean);
      } else if (choice !== '1' && choice !== '') {
        // User langsung ketik nama koin (misal: "SOL" atau "PEPE, ETH")
        requestedCoins = choice.split(/[\s,]+/).filter(Boolean);
      }
    } finally {
      rl.close();
    }
    console.log('');
  }

  // ═══ STEP 1: Connect to Exchange ═══
  console.log(chalk.cyan(`  ${spin()} `) + chalk.white('[1/6] Connecting to Bybit & fetching market data...'));
  const rest = new BybitRest();
  const hub = new MarketDataHub(rest);
  const klineLoader = new KlineLoader(rest, hub);
  await hub.initialize();
  console.log(chalk.green(`  ✓ `) + chalk.white(`${hub.instruments.size} instruments`) + chalk.gray(` | `) + chalk.white(`${hub.tickers.size} tickers`) + chalk.gray(` loaded`) + chalk.gray(` (${elapsed(startTime)})`));

  // Initialize Engines
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
    longEngine, shortEngine, exhaustionEngine,
    breakoutEngine, squeezeEngine, oiFundingEngine,
    rsEngine, volatilityEngine, stage3Execution
  );

  const correlationFilter = new CorrelationFilter();
  const finalRanker = new FinalRanker(correlationFilter);
  const terminalUI = new TerminalUI();

  const binanceResolver = new BinanceSymbolResolver();
  const binanceInitPromise = binanceResolver.initialize(4000).catch(() => {});
  const binanceAnchor = new BinanceDeepAnchorEngine(binanceResolver, 5, 2000, 5, 45_000);

  // ══════════════════════════════════════════════════════════════════
  // BRANCH A: CUSTOM COIN REQUEST SCAN
  // ══════════════════════════════════════════════════════════════════
  if (requestedCoins.length > 0) {
    const normalizedSymbols: string[] = [];
    const notFoundSymbols: string[] = [];

    for (const raw of requestedCoins) {
      let sym = raw.toUpperCase().trim();
      if (!sym.endsWith('USDT') && !sym.endsWith('PERP')) {
        sym = sym + 'USDT';
      }
      if (hub.instruments.has(sym)) {
        normalizedSymbols.push(sym);
      } else {
        notFoundSymbols.push(raw.toUpperCase());
      }
    }

    if (notFoundSymbols.length > 0) {
      console.log(chalk.yellow(`  ⚠️ Koin tidak ditemukan di Bybit USDT Perpetual: ${notFoundSymbols.join(', ')}`));
    }

    if (normalizedSymbols.length === 0) {
      console.log(chalk.red.bold('\n  ❌ Tidak ada koin valid untuk di-scan. Pastikan simbol koin benar (contoh: SOL, DOGE, BTC).\n'));
      process.exit(1);
    }

    console.log(chalk.cyan(`  ${spin()} `) + chalk.white(`Target Koin: `) + chalk.yellow.bold(normalizedSymbols.join(', ')));

    const symbolsToLoad = Array.from(new Set([...normalizedSymbols, 'BTCUSDT']));
    console.log(chalk.cyan(`  ${spin()} `) + chalk.white(`[2/4] Loading candles & OI untuk ${symbolsToLoad.length} symbols...`));
    await klineLoader.loadInitialCandles(symbolsToLoad);
    await hub.seedColdStartOIDeltas(normalizedSymbols);
    console.log(chalk.green(`  ✓ `) + chalk.white(`Data candle & OI dimuat`) + chalk.gray(` (${elapsed(startTime)})`));

    // Analyze BTC Market Regime
    const btcTicker = hub.tickers.get('BTCUSDT')!;
    const btcInd = hub.indicators.get('BTCUSDT')!;
    const btcCandles15 = hub.getCandles('BTCUSDT', '15');
    if (!btcCandles15) {
      throw new Error('BTC 15m candles were not loaded; cannot analyze market regime.');
    }
    const currentRegime = regimeEngine.analyze(btcInd, btcTicker, btcCandles15);

    const regimeIcon = currentRegime.regime.includes('BULL') ? '🟢' : currentRegime.regime.includes('BEAR') ? '🔴' : '🟡';
    const regimeColor = currentRegime.regime.includes('BULL') ? chalk.green : currentRegime.regime.includes('BEAR') ? chalk.red : chalk.yellow;
    console.log(chalk.cyan(`  ${spin()} `) + chalk.white(`[3/4] Market Regime: `) + regimeColor.bold(`${regimeIcon} ${currentRegime.regime}`) + chalk.gray(` (BTC: $${Number(btcTicker.lastPrice).toLocaleString()})`));

    console.log(chalk.cyan(`  ${spin()} `) + chalk.white(`[4/4] Menjalankan Multi-Timeframe Scoring Engine...`));

    const customScores: CandidateScores[] = [];
    const sectorMap = new Map<string, string>();

    for (const sym of normalizedSymbols) {
      const ticker = hub.tickers.get(sym);
      if (!ticker) continue;

      const p5m = hub.get5mReturn(sym).value;
      const p1h = hub.get1hReturn(sym).value;
      const tier = ticker.turnover24h >= 100_000_000 ? 'A' : (ticker.turnover24h >= 20_000_000 ? 'B' : 'C');

      const score = stage2.analyzeCandidate(sym, hub, currentRegime, tier, p5m, p1h);
      if (score) {
        customScores.push(score);
        sectorMap.set(sym, hub.getSymbolSector(sym));
      }
    }

    await binanceInitPromise;
    const cxMap = await binanceAnchor.analyzeAll(
      customScores.map(s => ({
        symbol: s.symbol,
        lastPrice: s.ticker.lastPrice,
        priceChange24hPcnt: s.ticker.price24hPcnt,
        priceChange15mPcnt: hub.get15mReturn(s.symbol).value,
        openInterestValue: s.ticker.openInterestValue
      }))
    );
    for (const s of customScores) {
      const cx = cxMap.get(s.symbol);
      if (cx) {
        s.crossExchange = cx;
        if (s.timing) s.timing.crossExchange = cx;
      }
    }

    const rankerOutput = finalRanker.rank(
      customScores, sectorMap, currentRegime, btcTicker,
      100, Date.now() - startTime,
      {
        universeSize: hub.instruments.size,
        eligibleSymbols: normalizedSymbols.length,
        stage1Candidates: normalizedSymbols.length,
        stage1Diagnostics: stage1.lastDiagnostics
      }
    );

    const totalElapsed = elapsed(startTime);

    // ═══ RENDER CUSTOM REPORT CARDS ═══
    console.log('');
    console.log(chalk.cyan('  ╔═══════════════════════════════════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan('  ║') + chalk.white.bold('  📋  HASIL ANALISA MENDALAM KOIN PERMINTAAN ANDA                                ') + chalk.cyan('║'));
    console.log(chalk.cyan('  ╚═══════════════════════════════════════════════════════════════════════════════════╝'));

    for (const score of customScores) {
      const sym = score.symbol;
      const ticker = score.ticker;
      const longTotal = score.longScore.total;
      const shortTotal = score.shortScore.total;
      const bias = longTotal >= shortTotal ? 'LONG' : 'SHORT';
      const sideColor = bias === 'LONG' ? chalk.green.bold : chalk.red.bold;
      const sideTag = bias === 'LONG' ? chalk.bgGreen.black.bold(' BUY / LONG ') : chalk.bgRed.white.bold(' SELL / SHORT ');

      // Find if it was ranked in results, watchlist, or quarantined
      const rankedResult = rankerOutput.results.find(r => r.symbol === sym);
      const rankedWatch = rankerOutput.watchlist?.find(w => w.symbol === sym);
      const rankedRej = rankerOutput.rejectedSignals?.find(x => x.symbol === sym);

      let statusBadge = chalk.yellow('⏳ WAIT / MONITOR');
      if (rankedResult) {
        statusBadge = chalk.bgGreen.black.bold(' 🚀 ACTIONABLE ENTRY NOW ');
      } else if (rankedRej) {
        statusBadge = chalk.bgRed.white.bold(' ⚠️ DO NOT CHASE (HIGH RISK) ');
      } else if (rankedWatch) {
        statusBadge = chalk.bgCyan.black.bold(' ⏳ WATCHLIST (BASE / PULLBACK) ');
      }

      const p24 = (ticker.price24hPcnt * 100).toFixed(2);
      const p24Color = ticker.price24hPcnt >= 0 ? chalk.green : chalk.red;
      const p1hStr = score.priceChange1h !== null && score.priceChange1h !== undefined ? `${(score.priceChange1h * 100).toFixed(2)}%` : '0.00%';
      const p5mStr = score.priceChange5m !== null && score.priceChange5m !== undefined ? `${(score.priceChange5m * 100).toFixed(2)}%` : '0.00%';

      console.log('');
      console.log(chalk.white('  ┌── [KOIN] ') + chalk.yellow.bold(sym) + `  ${sideTag}  ${statusBadge}`);
      console.log(chalk.gray(`  │  Harga Saat Ini : `) + chalk.white.bold(`$${ticker.lastPrice}`) + chalk.gray(` | 24h: `) + p24Color(`${p24}%`) + chalk.gray(` | 1h: `) + chalk.white(p1hStr) + chalk.gray(` | 5m: `) + chalk.white(p5mStr));
      console.log(chalk.gray(`  │  Skor Bot Total : `) + chalk.white.bold(`${Math.max(longTotal, shortTotal).toFixed(1)}/100`) + chalk.gray(` (Long: ${longTotal.toFixed(1)} vs Short: ${shortTotal.toFixed(1)})`));
      
      const discColor = score.discoveryLabel === 'DECOUPLED_ALPHA' ? chalk.magenta.bold : score.discoveryLabel === 'SHORT_SQUEEZE_CANDIDATE' ? chalk.yellow.bold : chalk.cyan.bold;
      console.log(chalk.gray(`  │  Discovery Tag  : `) + discColor(score.discoveryLabel ?? 'STANDARD_MOMENTUM') + chalk.gray(` | Potential: `) + chalk.bold(score.entryPotential ?? 'MEDIUM') + chalk.gray(` | Maturity: `) + chalk.white(score.moveMaturity ?? 'DEVELOPING'));
      if (score.oiCapitalFlow) {
        console.log(chalk.gray(`  │  Capital Flow   : `) + chalk.green(score.oiCapitalFlow));
      }
      if (score.mtfConfluence) {
        console.log(chalk.gray(`  │  MTF Confluence : `) + chalk.blue(score.mtfConfluence));
      }

      const va = score.vwapAnalysis ?? score.timing?.vwapAnalysis;
      if (va) {
        const sStr = va.sessionVwap?.vwap ? `$${va.sessionVwap.vwap}` : 'N/A';
        const wStr = va.weeklyVwap?.vwap ? `$${va.weeklyVwap.vwap}` : 'N/A';
        const mStr = va.monthlyVwap?.vwap ? `$${va.monthlyVwap.vwap}` : 'N/A';
        const b1Str = va.sessionVwap?.upperBand1 ? `B1 (1.0σ): $${va.sessionVwap.upperBand1} / $${va.sessionVwap.lowerBand1}` : '';
        const b2Str = va.sessionVwap?.upperBand2 ? `B2 (2.0σ): $${va.sessionVwap.upperBand2} / $${va.sessionVwap.lowerBand2}` : '';
        
        const stackColor = va.alignment.includes('BULLISH') ? chalk.green.bold : va.alignment.includes('BEARISH') ? chalk.red.bold : chalk.yellow;
        console.log(chalk.gray(`  │  VWAP Confluence: `) + stackColor(va.alignment) + chalk.gray(` | Posisi: `) + chalk.cyan(va.bandPosition));
        console.log(chalk.gray(`  │  Level VWAP     : `) + chalk.white(`Session: ${sStr} | Weekly: ${wStr} | Monthly: ${mStr}`));
        if (b1Str) {
          console.log(chalk.gray(`  │  VWAP Bands (SD): `) + chalk.gray(`${b1Str} | ${b2Str}`));
        }
      }

      const abs = score.absorption ?? score.timing?.absorption;
      if (abs && abs.event !== 'ABSORPTION_UNCONFIRMED') {
        const absColor = abs.event === 'BULLISH_ABSORPTION' ? chalk.green.bold : chalk.red.bold;
        console.log(chalk.gray(`  │  Orderflow Event: `) + absColor(abs.event) + chalk.gray(` | Confidence: `) + chalk.white(`${abs.confidence}/100`) + chalk.gray(` | Lokasi: `) + chalk.cyan(abs.location));
        console.log(chalk.gray(`  │  Data Absorpsi  : `) + chalk.white(abs.evidence.join(' | ')) + chalk.gray(` | Trapped: `) + chalk.yellow(abs.trappedSide ?? 'N/A'));
      }

      const cx = score.crossExchange ?? score.timing?.crossExchange;
      if (cx && cx.status !== 'BINANCE_UNAVAILABLE') {
        const cxColor = cx.scoreModifier > 0 ? chalk.green.bold : cx.scoreModifier < 0 ? chalk.red.bold : chalk.yellow;
        const modStr = cx.scoreModifier > 0 ? `+${cx.scoreModifier}` : `${cx.scoreModifier}`;
        console.log(chalk.gray(`  │  Cross-Exchange : `) + cxColor(cx.status) + chalk.gray(` | Confidence: `) + chalk.white(cx.confidence) + chalk.gray(` | Mod: `) + chalk.cyan(modStr));
        const bybitR = cx.bybitFuturesReturn != null ? `${(cx.bybitFuturesReturn * 100).toFixed(2)}%` : 'N/A';
        const binFR = cx.binanceFuturesReturn != null ? `${(cx.binanceFuturesReturn * 100).toFixed(2)}%` : 'N/A';
        const binSR = cx.binanceSpotReturn != null ? `${(cx.binanceSpotReturn * 100).toFixed(2)}%` : 'N/A';
        console.log(chalk.gray(`  │  Venue Delta    : `) + chalk.white(`Bybit: ${bybitR} | Binance Futures: ${binFR} | Binance Spot: ${binSR}`));
        if (cx.oiConfluence !== 'UNAVAILABLE') {
          console.log(chalk.gray(`  │  OI Confluence  : `) + chalk.white(cx.oiConfluence));
        }
      } else if (cx && cx.status === 'BINANCE_UNAVAILABLE') {
        console.log(chalk.gray(`  │  Cross-Exchange : `) + chalk.gray('BINANCE_UNAVAILABLE (Bybit standalone)'));
      }

      console.log(chalk.gray(`  │  Kategori Sinyal: `) + chalk.cyan.bold(score.signalCategory || 'MONITORING') + chalk.gray(` | Entry Status: `) + chalk.white(score.entryStatus || 'EVALUATING'));
      
      if (score.timing) {
        const t = score.timing;
        const chaseColor = t.chaseRiskScore >= 55 ? chalk.red.bold : t.chaseRiskScore >= 30 ? chalk.yellow : chalk.green;
        console.log(chalk.gray(`  │  Timing & Jarak : `) + chalk.white(`${t.distanceFromTriggerPct >= 0 ? '+' : ''}${t.distanceFromTriggerPct}%`) + chalk.gray(` (${t.distanceFromTriggerATR}x ATR dari base) | Freshness: ${t.signalFreshness}/100`));
        console.log(chalk.gray(`  │  Resiko Chasing : `) + chaseColor(`${t.chaseRiskScore}/100`) + chalk.gray(` | Ignition: ${t.momentumIgnitionScore}/100 | Fase: ${t.phase.label}`));
        if (t.orderbookWarning) {
          console.log(chalk.gray(`  │  Orderbook Note : `) + chalk.red.bold(t.orderbookWarning) + chalk.gray(` (Imbalance: ${t.orderbookImbalanceRatio ?? 1.0}x)`));
        }
        console.log(chalk.gray(`  │  Instruksi Aksi : `) + chalk.cyan.bold(t.decision));
      }

      const exec = score.executionScore;
      if (exec) {
        const slippage = exec.slippageBps !== null && exec.slippageBps !== undefined
          ? `${exec.slippageBps.toFixed(2)} bps`
          : 'N/A';
        console.log(chalk.gray(`  │  Execution      : `) + chalk.green.bold(`${exec.total.toFixed(1)}/100`) + chalk.gray(` | Slippage: ${slippage} | ${exec.passed ? 'PASS' : 'REVIEW'}`));
      }

      console.log(chalk.gray(`  │  Likuiditas     : `) + chalk.white(`$${(ticker.turnover24h / 1e6).toFixed(1)}M`) + chalk.gray(` (Tier ${score.liquidityTier}) | Funding: `) + chalk.white(`${(ticker.fundingRate * 100).toFixed(4)}%`));

      const reasons = (bias === 'LONG' ? score.longScore : score.shortScore).modifiers.map(modifier => modifier.reason);
      if (reasons && reasons.length > 0) {
        console.log(chalk.gray(`  │  Faktor Kunci   : `) + chalk.white(reasons.slice(0, 4).join(' | ')));
      }
      console.log(chalk.white('  └─────────────────────────────────────────────────────────────────────────────'));
    }

    console.log('');
    console.log(chalk.cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.gray(`  Custom Scan selesai dalam ${totalElapsed} | ${scanTime} WIB`));
    console.log(chalk.gray(`  Untuk analisa koin lain, jalankan kembali scan.bat`));
    console.log(chalk.cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log('');

    process.exit(0);
  }

  // ══════════════════════════════════════════════════════════════════
  // BRANCH B: AUTO MARKET RADAR SCAN (570+ COINS)
  // ══════════════════════════════════════════════════════════════════
  console.log(chalk.cyan(`  ${spin()} `) + chalk.white('[2/6] Stage 1 — Filtering liquidity & activity...'));
  const stage1Candidates = stage1.filter(hub.tickers, hub.prevTickers, hub.instruments, hub);
  const passRate1 = ((stage1Candidates.length / hub.instruments.size) * 100).toFixed(1);
  console.log(chalk.green(`  ✓ `) + chalk.white.bold(`${stage1Candidates.length}`) + chalk.gray(` candidates passed (${passRate1}% of universe)`) + chalk.gray(` (${elapsed(startTime)})`));

  const symbolsToScan = Array.from(new Set([
    ...stage1Candidates.slice(0, CONFIG.MAX_DEEP_CANDIDATES).map(c => c.symbol),
    'BTCUSDT'
  ]));
  const allTickers = Array.from(hub.tickers.values());
  const liquidLeaders = allTickers
    .filter(t => t.turnover24h >= 20_000_000 && t.lastPrice > 0)
    .sort((a, b) => b.turnover24h - a.turnover24h)
    .slice(0, 20)
    .map(t => t.symbol);
  const fullSymbols = Array.from(new Set([...symbolsToScan, ...liquidLeaders]));

  console.log(chalk.cyan(`  ${spin()} `) + chalk.white(`[3/6] Loading candles for ${fullSymbols.length} symbols...`));
  await klineLoader.loadInitialCandles(fullSymbols);
  console.log(chalk.green(`  ✓ `) + chalk.white(`${fullSymbols.length} symbol candles loaded`) + chalk.gray(` (${elapsed(startTime)})`));

  console.log(chalk.cyan(`  ${spin()} `) + chalk.white(`  ⚡ Seeding historical Open Interest deltas...`));
  const seededCount = await hub.seedColdStartOIDeltas(fullSymbols);
  console.log(chalk.green(`  ✓ `) + chalk.white(`Historical OI deltas seeded (${seededCount} symbols)`) + chalk.gray(` (${elapsed(startTime)})`));
  console.log(progressBar(3, 6));

  console.log(chalk.cyan(`  ${spin()} `) + chalk.white('[4/6] Analyzing BTC market regime...'));
  const btcTicker = hub.tickers.get('BTCUSDT')!;
  const btcInd = hub.indicators.get('BTCUSDT')!;
  const btcCandles15 = hub.getCandles('BTCUSDT', '15');
  if (!btcCandles15) {
    throw new Error('BTC 15m candles were not loaded; cannot analyze market regime.');
  }
  const currentRegime = regimeEngine.analyze(btcInd, btcTicker, btcCandles15);

  const regimeIcon = currentRegime.regime.includes('BULL') ? '🟢' : currentRegime.regime.includes('BEAR') ? '🔴' : '🟡';
  const regimeColor = currentRegime.regime.includes('BULL') ? chalk.green : currentRegime.regime.includes('BEAR') ? chalk.red : chalk.yellow;
  console.log(chalk.green(`  ✓ `) + chalk.white(`BTC `) + chalk.white.bold(`$${Number(btcTicker.lastPrice).toLocaleString()}`) + chalk.gray(` | Regime: `) + regimeColor.bold(`${regimeIcon} ${currentRegime.regime}`) + chalk.gray(` (${elapsed(startTime)})`));

  console.log(chalk.cyan(`  ${spin()} `) + chalk.white('[5/6] Stage 2 — Deep signal analysis...'));
  const candidateScores: CandidateScores[] = [];
  const sectorMap = new Map<string, string>();
  let analyzed = 0;

  for (const sym of fullSymbols) {
    if (sym === 'BTCUSDT') continue;
    const ticker = hub.tickers.get(sym);
    if (!ticker) continue;

    const p5m = hub.get5mReturn(sym).value;
    const p1h = hub.get1hReturn(sym).value;
    const tier = ticker.turnover24h >= 100_000_000 ? 'A'
               : ticker.turnover24h >= 20_000_000 ? 'B' : 'C';

    const score = stage2.analyzeCandidate(sym, hub, currentRegime, tier, p5m, p1h);
    if (score) {
      candidateScores.push(score);
      sectorMap.set(sym, hub.getSymbolSector(sym));
    }
    analyzed++;
  }
  console.log(chalk.green(`  ✓ `) + chalk.white.bold(`${candidateScores.length}`) + chalk.gray(` signals detected from ${analyzed} analyzed`) + chalk.gray(` (${elapsed(startTime)})`));
  console.log(progressBar(5, 6));

  console.log(chalk.cyan(`  ${spin()} `) + chalk.white('  ⚡ Checking Binance cross-exchange deep anchor (top candidates)...'));
  await binanceInitPromise;
  const topCandidatesForCX = [...candidateScores]
    .sort((a, b) => Math.max(b.longScore.total, b.shortScore.total) - Math.max(a.longScore.total, a.shortScore.total))
    .slice(0, 25);

  const cxMap = await binanceAnchor.analyzeAll(
    topCandidatesForCX.map(s => ({
      symbol: s.symbol,
      lastPrice: s.ticker.lastPrice,
      priceChange24hPcnt: s.ticker.price24hPcnt,
      priceChange15mPcnt: hub.get15mReturn(s.symbol).value,
      openInterestValue: s.ticker.openInterestValue
    }))
  );

  for (const s of candidateScores) {
    const cx = cxMap.get(s.symbol);
    if (cx) {
      s.crossExchange = cx;
      if (s.timing) s.timing.crossExchange = cx;
    }
  }
  console.log(chalk.green(`  ✓ `) + chalk.white(`Cross-exchange confluence analyzed (${topCandidatesForCX.length} candidates)`) + chalk.gray(` (${elapsed(startTime)})`));

  console.log(chalk.cyan(`  ${spin()} `) + chalk.white('[6/6] Final ranking & generating output...'));
  const totalSymbols = hub.instruments.size;
  const eligibleSymbols = Array.from(hub.instruments.values()).filter(i =>
    i.quoteCoin === 'USDT' && i.contractType === 'LinearPerpetual' && i.status === 'Trading'
  ).length;

  const rankerOutput = finalRanker.rank(
    candidateScores, sectorMap, currentRegime, btcTicker,
    100, Date.now() - startTime,
    {
      universeSize: totalSymbols,
      eligibleSymbols,
      stage1Candidates: stage1Candidates.length,
      stage1Diagnostics: stage1.lastDiagnostics
    }
  );

  const totalElapsed = elapsed(startTime);
  console.log(chalk.green(`  ✓ `) + chalk.white(`Ranking complete`) + chalk.gray(` (${totalElapsed})`));
  console.log(progressBar(6, 6));

  // Render the single readable result dashboard.
  terminalUI.render(rankerOutput);

  // Footer
  console.log('');
  console.log(chalk.cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.gray(`  Trade Screener Coin v2.1.1 | Scan completed in ${totalElapsed}`));
  console.log(chalk.gray(`  ${scanTime} WIB | Refresh: jalankan scan.bat lagi`));
  console.log(chalk.cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log('');

  process.exit(0);
}

runScan().catch(e => {
  console.error('');
  console.error(chalk.red.bold('  ┌─────────────────────────────────────────────────────────────────────────────┐'));
  console.error(chalk.red.bold('  │  ❌  SCAN ERROR                                                            │'));
  console.error(chalk.red.bold('  └─────────────────────────────────────────────────────────────────────────────┘'));
  console.error(chalk.red(`  ${e.message || e}`));
  console.error('');
  process.exit(1);
});
