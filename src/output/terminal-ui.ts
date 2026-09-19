// ============================================================
// Real-time Terminal Dashboard & Actionable Trade Guide UI
// ============================================================

import { ScreenerOutput } from '../data/types.js';
import chalk from 'chalk';
import logUpdate from 'log-update';
import Table from 'cli-table3';

export class TerminalUI {
  constructor() {}

  render(output: ScreenerOutput): void {
    const table = new Table({
      head: ['Rank', 'Symbol', 'Side', 'Rating', 'Score', '24h Vol', 'Spread', 'Price', '24h %', 'Action / Status'].map(h => chalk.cyan.bold(h)),
      chars: { 'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': '' }
    });

    if (output.results.length === 0) {
      table.push([{ colSpan: 10, content: chalk.yellow('ℹ️  NO QUALIFIED SETUP AT THIS EXACT SECOND (Waiting for Grade A / A+ confirmation)') }]);
    } else {
      for (const res of output.results) {
        const sideColor = res.side === 'LONG' ? chalk.green.bold : res.side === 'SHORT' ? chalk.red.bold : chalk.white;
        
        let ratingStr: string = res.rating;
        if (res.rating === 'A+') ratingStr = chalk.bgGreen.black.bold(` ${res.rating} `);
        else if (res.rating === 'A') ratingStr = chalk.green.bold(res.rating);
        else if (res.rating === 'B+') ratingStr = chalk.yellow.bold(res.rating);
        else if (res.rating === 'WATCH') ratingStr = chalk.gray(res.rating);

        let actionTag = chalk.cyan('👀 MONITOR PULLBACK');
        if (res.discoveryLabel === 'DECOUPLED_ALPHA' || res.signalCategory === 'DECOUPLED_ALPHA') {
          actionTag = chalk.bgMagenta.white.bold(' 👑 DECOUPLED ALPHA ');
        } else if (res.discoveryLabel === 'SHORT_SQUEEZE_CANDIDATE' || res.signalCategory === 'SHORT_SQUEEZE_CANDIDATE') {
          actionTag = chalk.bgYellow.black.bold(' ⚡ SHORT SQUEEZE ');
        } else if (res.discoveryLabel === 'LONG_FLUSH_RISK' || res.signalCategory === 'LONG_FLUSH_RISK') {
          actionTag = chalk.bgRed.white.bold(' ⚠️ LONG FLUSH RISK ');
        } else if (res.discoveryLabel === 'OI_SUPPORTED_MOMENTUM') {
          actionTag = chalk.bgCyan.black.bold(' 🌊 OI ACCUMULATION ');
        } else if (res.discoveryLabel === 'FRESH_BREAKOUT' || res.signalCategory === 'EARLY_LONG') {
          actionTag = chalk.bgGreen.black.bold(' 🚀 FRESH BREAKOUT ');
        } else if (res.discoveryLabel === 'PRE_BREAKOUT_BASE' || res.signalCategory === 'BASE_LONG') {
          actionTag = chalk.bgCyan.black.bold(' 💎 BASE RADAR ');
        } else if (res.signalCategory === 'EARLY_SHORT') {
          actionTag = chalk.bgRed.white.bold(' ⚡ EARLY SHORT ');
        } else if (res.signalCategory === 'BASE_SHORT') {
          actionTag = chalk.bgMagenta.white.bold(' 📉 BASE SHORT ');
        } else if (res.discoveryLabel === 'EARLY_ROTATION' || res.signalCategory === 'PULLBACK_LONG') {
          actionTag = chalk.green.bold(' 🎯 EARLY ROTATION ');
        } else if (res.signalCategory === 'PULLBACK_SHORT') {
          actionTag = chalk.red.bold(' 🎯 PULLBACK SHORT ');
        } else if (res.signalCategory === 'LONG_CONTINUATION') {
          actionTag = chalk.green('🟢 BUY CONTINUATION');
        } else if (res.signalCategory === 'SHORT_CONTINUATION') {
          actionTag = chalk.red('🔴 SHORT CONTINUATION');
        } else if (res.discoveryLabel === 'LATE_MOVER' || res.signalCategory === 'LATE_LONG') {
          actionTag = chalk.yellow('⚠️ LATE (WAIT PULLBACK)');
        } else if (res.signalCategory === 'LATE_SHORT') {
          actionTag = chalk.yellow('⚠️ LATE (WAIT RETEST)');
        } else if (res.discoveryLabel === 'EXHAUSTED_MOVE') {
          actionTag = chalk.red.bold('❌ EXHAUSTED (AVOID FOMO)');
        } else if (res.rating === 'A+' || res.rating === 'A') {
          actionTag = res.side === 'LONG' ? chalk.green.bold('🚀 READY BUY') : chalk.red.bold('⚡ READY SHORT');
        } else if (res.reasons.some(r => r.toLowerCase().includes('exhaustion'))) {
          actionTag = chalk.yellow('⚠️ AVOID FOMO (OVEREXTENDED)');
        }

        const spreadBps = res.reasons.find(r => r.includes('spread')) || '<5 bps';

        table.push([
          res.rank,
          chalk.bold(res.symbol),
          sideColor(res.side),
          ratingStr,
          chalk.bold(res.finalScore.toFixed(1)),
          `$${(res.volume24h / 1e6).toFixed(1)}M`,
          typeof spreadBps === 'string' ? spreadBps : '<5 bps',
          `$${res.price}`,
          `${res.priceChange24h >= 0 ? '+' : ''}${(res.priceChange24h * 100).toFixed(2)}%`,
          actionTag
        ]);
      }
    }

    const regimeColor = output.regime.includes('BULL') ? chalk.green.bold : output.regime.includes('BEAR') ? chalk.red.bold : chalk.yellow.bold;
    
    let content = `\n========================================================================================\n`;
    content += `              💎 USDT PERPETUAL CRYPTO SCREENER — EARLY MOMENTUM RADAR                  \n`;
    content += `========================================================================================\n`;
    content += ` Macro Context : BTC $${output.btcPrice.toFixed(2)} (${output.btcChange1h >= 0 ? '+' : ''}${(output.btcChange1h * 100).toFixed(2)}% 1H) | Regime: ${regimeColor(output.regime)}\n`;
    content += ` Universe Stats: ${output.totalSymbols} symbols scanned | ${output.candidateCount} actionable signals | Latency: ${output.scanLatencyMs}ms\n`;
    if (output.diagnostics) {
      const d = output.diagnostics;
      content += ` Pipeline Funnel: Universe: ${d.universeSize} | Eligible: ${d.eligibleSymbols} | Stage 1: ${d.stage1Candidates} | Stage 2: ${d.stage2Candidates} | Stage 3: ${d.stage3Candidates} | Qualified: ${d.qualifiedCandidates}\n`;
      const r = d.rejectionReasons;
      content += ` Funnel Drops  : Low Liq: ${r.rejectedLowLiquidity} | Late Chase: ${r.rejectedLateChase ?? 0} | Dist/Cap: ${r.rejectedDistribution ?? 0} | Weak Trend: ${r.rejectedWeakTrend} | Low Score: ${r.rejectedScoreThreshold}\n`;
    }
    content += ` Last Updated  : ${output.timestamp}\n`;
    content += `----------------------------------------------------------------------------------------\n`;
    content += `🔥 SECTION 1: ACTIONABLE NOW (Fresh Breakouts & Validated Pullbacks Only)\n`;
    content += `----------------------------------------------------------------------------------------\n`;
    content += table.toString() + `\n`;

    const actionable = output.actionableResults ?? output.results;
    if (actionable.length > 0) {
      content += `\n📌 DETAIL SINYAL & PANDUAN EKSEKUSI (ACTIONABLE NOW):\n`;
      for (const res of actionable) {
        const sideIcon = res.side === 'LONG' ? '🟢 LONG (Beli)' : '🔴 SHORT (Jual)';
        const catTag = res.signalCategory ? `[${res.signalCategory}]` : '';
        const laneTag = res.discoveryLane ? `(${res.discoveryLane})` : '';
        const statusTag = res.entryStatus ? `[EntryStatus: ${res.entryStatus}]` : '';
        content += `\n[Rank #${res.rank}] ${chalk.bold(res.symbol)} — ${sideIcon} ${catTag} ${statusTag} ${laneTag} (Skor: ${res.finalScore.toFixed(1)} | Actionability: ${res.actionabilityScore ?? 'N/A'}/100)\n`;
        if (res.discoveryLabel) {
          const discColor = res.discoveryLabel === 'DECOUPLED_ALPHA' ? chalk.magenta.bold : res.discoveryLabel === 'SHORT_SQUEEZE_CANDIDATE' ? chalk.yellow.bold : chalk.cyan.bold;
          content += `  • Discovery Tag : ${discColor(res.discoveryLabel)} | Entry Potential: ${chalk.bold(res.entryPotential ?? 'MEDIUM')} | Move Maturity: ${res.moveMaturity ?? 'DEVELOPING'}\n`;
        }
        if (res.oiCapitalFlow) {
          content += `  • Capital Flow  : ${chalk.green(res.oiCapitalFlow)}\n`;
        }
        if (res.mtfConfluence) {
          content += `  • MTF Confluence: ${chalk.blue(res.mtfConfluence)}\n`;
        }
        if (res.htfContext) {
          const htf = res.htfContext;
          content += `  • HTF Context    : 1D ${htf.dailyTrend} | 4H ${htf.fourHourTrend} | ${htf.classification} (${htf.confidence}/100)\n`;
          if (htf.warnings.length > 0) content += `  • HTF Warning    : ${htf.warnings.join(', ')}\n`;
        }
        if (res.vwapAnalysis) {
          const va = res.vwapAnalysis;
          const sStr = va.sessionVwap?.vwap ? `$${va.sessionVwap.vwap}` : 'N/A';
          const wStr = va.weeklyVwap?.vwap ? `$${va.weeklyVwap.vwap}` : 'N/A';
          const mStr = va.monthlyVwap?.vwap ? `$${va.monthlyVwap.vwap}` : 'N/A';
          const b1Str = va.sessionVwap?.upperBand1 ? `B1: $${va.sessionVwap.upperBand1}/$${va.sessionVwap.lowerBand1}` : '';
          const b2Str = va.sessionVwap?.upperBand2 ? `B2: $${va.sessionVwap.upperBand2}/$${va.sessionVwap.lowerBand2}` : '';
          content += `  • VWAP Levels   : Session: ${sStr} | Weekly: ${wStr} | Monthly: ${mStr}\n`;
          content += `  • VWAP Bands    : ${b1Str} | ${b2Str} (${chalk.cyan(va.bandPosition)})\n`;
          content += `  • VWAP Confluence: ${chalk.bold(va.alignment)}\n`;
        }
        if (res.absorption && res.absorption.event !== 'ABSORPTION_UNCONFIRMED') {
          const absorption = res.absorption;
          const eventColor = absorption.event === 'BULLISH_ABSORPTION' ? chalk.green.bold : chalk.red.bold;
          content += `  • Orderflow Event: ${eventColor(absorption.event)} | Confidence: ${absorption.confidence}/100 | Location: ${absorption.location}\n`;
          content += `  • Absorption Data : ${absorption.evidence.join(' | ')} | Trapped: ${absorption.trappedSide ?? 'N/A'}\n`;
        }
        const cx = res.crossExchange ?? res.timing?.crossExchange;
        if (cx && cx.status !== 'BINANCE_UNAVAILABLE') {
          const cxColor = cx.scoreModifier > 0 ? chalk.green.bold : cx.scoreModifier < 0 ? chalk.red.bold : chalk.yellow;
          const modStr = cx.scoreModifier > 0 ? `+${cx.scoreModifier}` : `${cx.scoreModifier}`;
          content += `  • Cross-Exchange : ${cxColor(cx.status)} | Confidence: ${cx.confidence} | Mod: ${modStr}\n`;
          const bybitR = cx.bybitFuturesReturn != null ? `${(cx.bybitFuturesReturn * 100).toFixed(2)}%` : 'N/A';
          const binFR = cx.binanceFuturesReturn != null ? `${(cx.binanceFuturesReturn * 100).toFixed(2)}%` : 'N/A';
          const binSR = cx.binanceSpotReturn != null ? `${(cx.binanceSpotReturn * 100).toFixed(2)}%` : 'N/A';
          content += `  • Venue Delta    : Bybit Perps: ${bybitR} | Binance Perps: ${binFR} | Binance Spot: ${binSR}\n`;
          if (cx.oiConfluence !== 'UNAVAILABLE') {
            content += `  • OI Confluence  : ${cx.oiConfluence}\n`;
          }
        } else if (cx && cx.status === 'BINANCE_UNAVAILABLE') {
          content += `  • Cross-Exchange : ${chalk.gray('BINANCE_UNAVAILABLE')} (Bybit standalone)\n`;
        }
        if (res.timing) {
          const tSec = res.timing.elapsedSecondsSinceTrigger ?? 0;
          const triggerStr = tSec < 60 ? `${tSec}s ago` : `${Math.floor(tSec / 60)}m ${tSec % 60}s ago`;
          const cSec = res.timing.secondsSinceConfirmation;
          const confirmStr = cSec !== undefined ? (cSec < 60 ? `${cSec}s ago` : `${Math.floor(cSec / 60)}m ${cSec % 60}s ago`) : 'Confirmed on trigger bar';

          content += `  • Timestamps    : Trigger ${triggerStr} | Confirmation ${confirmStr}\n`;
          content += `  • State Machine : ${res.timing.setupState ?? 'N/A'} (Window: ${res.timing.timingWindow ?? 'N/A'})\n`;
          content += `  • Fase Pasar    : ${res.timing.phase.label} | Kematangan: ${res.timing.moveMaturity}\n`;
          content += `  • Skor Timing   : Timing ${res.timing.timingScore}/100 | Ignition ${res.timing.momentumIgnitionScore}/100 | Freshness ${res.timing.signalFreshness}/100\n`;
          content += `  • Risk & Reward : Extension ${res.timing.extensionScore ?? 0}/100 | Chase Risk ${res.timing.chaseRiskScore}/100 | Remaining Move ${res.timing.remainingMoveScore ?? 0}/100\n`;
          content += `  • Jarak Trigger : ${res.timing.distanceFromTriggerPct >= 0 ? '+' : ''}${res.timing.distanceFromTriggerPct}% (${res.timing.distanceFromTriggerATR}x ATR)\n`;
          if (res.timing.orderbookWarning) {
            content += `  • Orderbook Note: ${chalk.red.bold(res.timing.orderbookWarning)} (Imbalance: ${res.timing.orderbookImbalanceRatio ?? 1.0}x)\n`;
          }
          content += `  • Panduan Aksi  : ${chalk.cyan.bold(res.timing.decision)}\n`;
        }
        content += `  • Likuiditas    : Skor Eksekusi ${res.executionScore.toFixed(1)}/100 | Volume 24h: $${(res.volume24h / 1e6).toFixed(1)}M\n`;
      }
    }

    // Section 2: Watchlist
    if (output.watchlist && output.watchlist.length > 0) {
      content += `\n----------------------------------------------------------------------------------------\n`;
      content += `⏳ SECTION 2: WAIT / WATCHLIST (Pre-Breakout Consolidation & Late Moves Waiting For Pullback)\n`;
      content += `----------------------------------------------------------------------------------------\n`;
      for (const w of output.watchlist) {
        const cat = w.signalCategory ?? 'WATCH';
        const status = w.entryStatus ? `[${w.entryStatus}]` : '';
        const dist = w.timing ? `${w.timing.distanceFromTriggerATR}x ATR from base` : '';
        content += `  • ${chalk.bold(w.symbol)} [${w.side}] [${cat}] ${status}: Score ${w.finalScore.toFixed(1)} | ${dist} | ${w.timing?.decision ?? 'Awaiting trigger'}\n`;
      }
    }

    // Section 3: Rejected Signals
    if (output.rejectedSignals && output.rejectedSignals.length > 0) {
      content += `\n----------------------------------------------------------------------------------------\n`;
      content += `❌ SECTION 3: DO NOT CHASE / REJECTED (Quarantined: Distribution, Capitulation, or Too Late)\n`;
      content += `----------------------------------------------------------------------------------------\n`;
      for (const rej of output.rejectedSignals) {
        const status = rej.entryStatus ? `[${rej.entryStatus}]` : '[REJECTED]';
        const reason = rej.timing?.decision ?? 'Excessive chase or distribution risk';
        content += `  • ${chalk.yellow(rej.symbol)} [${rej.side}] ${status}: ${reason}\n`;
      }
    }

    content += `\n========================================================================================\n`;

    console.log(content);
  }
}
