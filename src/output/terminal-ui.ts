// ============================================================
// Terminal UI — Quantitative Crypto Screener Dashboard
// ============================================================

import { ScreenerOutput } from '../data/types.js';
import {
  renderDetailedCard,
  formatPrice,
  formatPercent,
  renderGauge,
  pad,
  stripAnsi,
  wrap
} from './ui-formatter.js';
import chalk from 'chalk';

function signedPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

export class TerminalUI {
  render(output: ScreenerOutput): void {
    const actionable = output.actionableResults ?? output.results;
    const watchlist = output.watchlist ?? [];
    const rejected = output.rejectedSignals ?? [];
    const regimeColor = output.regime.includes('BULL')
      ? chalk.green
      : output.regime.includes('BEAR')
        ? chalk.red
        : chalk.yellow;

    const W = 81;

    let content = '\n';
    content += chalk.gray('  ┌' + '─'.repeat(W) + '┐\n');
    content += chalk.gray('  │') + pad(chalk.white.bold('  TRADE SCREENER COIN v2.1.2 — QUANTITATIVE MOMENTUM RADAR'), W) + chalk.gray('│\n');
    content += chalk.gray('  ├' + '─'.repeat(W) + '┤\n');
    
    const btcStr = `  BTC Market: $${output.btcPrice.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} (${signedPercent(output.btcChange1h)} 1h) | Macro Regime: ${regimeColor(output.regime)}`;
    content += chalk.gray('  │') + pad(btcStr, W) + chalk.gray('│\n');

    const scanStr = `  Universe  : ${output.totalSymbols} USDT Perps | Scan Time: ${(output.scanLatencyMs / 1000).toFixed(1)}s | Updated: ${output.timestamp}`;
    content += chalk.gray('  │') + pad(scanStr, W) + chalk.gray('│\n');

    const discStr = `  Discovery : ${actionable.length} Actionable | ${watchlist.length} Watchlist | ${rejected.length} Avoid (High Risk)`;
    content += chalk.gray('  │') + pad(discStr, W) + chalk.gray('│\n');

    if (output.diagnostics) {
      const d = output.diagnostics;
      const diagStr = `  Pipeline  : ${d.universeSize} universe -> ${d.stage1Candidates} passed S1 -> ${d.stage2Candidates} analyzed -> ${d.qualifiedCandidates} final`;
      content += chalk.gray('  │') + pad(chalk.gray(diagStr), W) + chalk.gray('│\n');
    }
    content += chalk.gray('  └' + '─'.repeat(W) + '┘\n');

    // ────────────────────────────────────────────────────────────
    // 1. ACTIONABLE NOW
    // ────────────────────────────────────────────────────────────
    content += '\n' + chalk.green.bold('  [1] SINYAL VALID & SIAP ENTRY (ACTIONABLE)') + chalk.gray(' — Setup terkonfirmasi dengan risiko terkontrol') + '\n';
    content += chalk.gray('  ' + '─'.repeat(W) + '\n');

    if (actionable.length === 0) {
      content += '\n';
      content += chalk.gray('  ┌' + '─'.repeat(W) + '┐\n');
      content += chalk.gray('  │') + pad(chalk.yellow('  Tidak ada setup yang lolos seluruh gerbang risiko pada snapshot ini.'), W) + chalk.gray('│\n');
      content += chalk.gray('  │') + pad(chalk.gray('  Pasar overextended / choppy. Pantau DAFTAR PANTAU (Watchlist) di bawah.'), W) + chalk.gray('│\n');
      content += chalk.gray('  └' + '─'.repeat(W) + '┘\n');
    } else {
      for (const res of actionable) {
        content += renderDetailedCard(res, res.rank) + '\n';
      }
    }

    // ────────────────────────────────────────────────────────────
    // 2. WATCHLIST (PULLBACK RETEST)
    // ────────────────────────────────────────────────────────────
    content += '\n';
    content += chalk.gray('  ┌' + '─'.repeat(W) + '┐\n');
    content += chalk.gray('  │') + pad(chalk.cyan.bold('  [2] DAFTAR PANTAU (WATCHLIST) — Tren Valid, Tunggu Koreksi / Retest'), W) + chalk.gray('│\n');
    content += chalk.gray('  ├' + '─'.repeat(W) + '┤\n');

    if (watchlist.length === 0) {
      content += chalk.gray('  │') + pad(chalk.gray('  (Tidak ada koin watchlist pada snapshot saat ini)'), W) + chalk.gray('│\n');
    } else {
      for (let i = 0; i < watchlist.length; i++) {
        const item = watchlist[i];
        const sideTag = item.side === 'LONG' ? chalk.green.bold('BUY / LONG') : chalk.red.bold('SELL / SHORT');
        const scoreBar = renderGauge(item.finalScore, 100, 6);
        const p24 = formatPercent(item.priceChange24h);
        const priceStr = formatPrice(item.price);
        const note = item.timing?.decision || item.signalCategory || 'Tren valid, menunggu pullback ke area support / VWAP';

        const line1Left = `  • ${chalk.yellow.bold(item.symbol.padEnd(11))} [${sideTag}] ${scoreBar} ${item.finalScore.toFixed(1)}/100`;
        const line1Right = `${priceStr} (${p24})  `;
        const sp1 = Math.max(1, W - stripAnsi(line1Left).length - stripAnsi(line1Right).length);
        const line1 = line1Left + ' '.repeat(sp1) + line1Right;
        content += chalk.gray('  │') + pad(line1, W) + chalk.gray('│\n');

        const maxPlanLen = W - 14;
        const planLines = wrap(note, maxPlanLen);
        for (let j = 0; j < planLines.length; j++) {
          const planText = j === 0 ? `    Plan  : ${planLines[j]}` : `            ${planLines[j]}`;
          content += chalk.gray('  │') + pad(chalk.gray(planText), W) + chalk.gray('│\n');
        }

        if (i < watchlist.length - 1) {
          content += chalk.gray('  │' + ' '.repeat(W) + '│\n');
        }
      }
    }
    content += chalk.gray('  └' + '─'.repeat(W) + '┘\n');

    // ────────────────────────────────────────────────────────────
    // 3. AVOID / QUARANTINED
    // ────────────────────────────────────────────────────────────
    content += '\n';
    content += chalk.gray('  ┌' + '─'.repeat(W) + '┐\n');
    content += chalk.gray('  │') + pad(chalk.red.bold('  [3] AREA DIHINDARI (QUARANTINED) — Overextended / Fakeout / High Risk'), W) + chalk.gray('│\n');
    content += chalk.gray('  ├' + '─'.repeat(W) + '┤\n');

    if (rejected.length === 0) {
      content += chalk.gray('  │') + pad(chalk.gray('  (Tidak ada koin yang di-quarantine pada snapshot saat ini)'), W) + chalk.gray('│\n');
    } else {
      for (let i = 0; i < rejected.length; i++) {
        const item = rejected[i];
        const sideTag = item.side === 'LONG' ? chalk.green.bold('BUY / LONG') : chalk.red.bold('SELL / SHORT');
        const priceStr = formatPrice(item.price);
        const p24 = formatPercent(item.priceChange24h);
        const reason = item.timing?.orderbookWarning || item.timing?.decision || 'Harga overextended dekat batas deviasi atas (Mean reversion risk)';

        const line1Left = `  • ${chalk.white.bold(item.symbol.padEnd(11))} [${sideTag}] ${priceStr} (${p24})`;
        const line1Right = `${chalk.red.bold('JANGAN KEJAR / AVOID')}  `;
        const sp = Math.max(1, W - stripAnsi(line1Left).length - stripAnsi(line1Right).length);
        const line1 = line1Left + ' '.repeat(sp) + line1Right;
        content += chalk.gray('  │') + pad(line1, W) + chalk.gray('│\n');

        const maxReasonLen = W - 14;
        const reasonLines = wrap(reason, maxReasonLen);
        for (let j = 0; j < reasonLines.length; j++) {
          const reasonText = j === 0 ? `    Alasan: ${reasonLines[j]}` : `            ${reasonLines[j]}`;
          content += chalk.gray('  │') + pad(chalk.gray(reasonText), W) + chalk.gray('│\n');
        }

        if (i < rejected.length - 1) {
          content += chalk.gray('  │' + ' '.repeat(W) + '│\n');
        }
      }
    }
    content += chalk.gray('  └' + '─'.repeat(W) + '┘\n');

    // Execution Note
    content += '\n' + chalk.gray('  Catatan Eksekusi: Data kuantitatif radar awal. Selalu periksa kedalaman orderbook sebelum entry.\n');

    console.log(content);
  }
}
