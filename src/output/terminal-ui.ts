// ============================================================
// Terminal UI — Quantitative Crypto Screener Dashboard
// ============================================================

import { ScreenerOutput } from '../data/types.js';
import {
  renderDetailedCard,
  formatPrice,
  formatPercent,
  renderGauge
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
    content += chalk.gray('  │') + chalk.white.bold('  TRADE SCREENER COIN v2.1.2 — QUANTITATIVE MOMENTUM RADAR                    ') + chalk.gray('│\n');
    content += chalk.gray('  ├' + '─'.repeat(W) + '┤\n');
    
    const btcStr = `  BTC Market: $${output.btcPrice.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} (${signedPercent(output.btcChange1h)} 1h) | Macro Regime: ${regimeColor(output.regime)}`;
    const pad1 = Math.max(0, W - 66 - output.regime.length);
    content += chalk.gray('  │') + btcStr + ' '.repeat(pad1) + chalk.gray('│\n');

    const scanStr = `  Universe  : ${output.totalSymbols} USDT Perps | Scan Time: ${(output.scanLatencyMs / 1000).toFixed(1)}s | Updated: ${output.timestamp}`;
    const pad2 = Math.max(0, W - 56 - output.timestamp.length);
    content += chalk.gray('  │') + scanStr + ' '.repeat(pad2) + chalk.gray('│\n');

    const discStr = `  Discovery : ${actionable.length} Actionable | ${watchlist.length} Watchlist | ${rejected.length} Avoid (High Risk)`;
    const pad3 = Math.max(0, W - 58);
    content += chalk.gray('  │') + discStr + ' '.repeat(pad3) + chalk.gray('│\n');

    if (output.diagnostics) {
      const d = output.diagnostics;
      const diagStr = `  Pipeline  : ${d.universeSize} universe -> ${d.stage1Candidates} passed S1 -> ${d.stage2Candidates} analyzed -> ${d.qualifiedCandidates} final`;
      content += chalk.gray('  │') + chalk.gray(diagStr) + ' '.repeat(Math.max(0, W - diagStr.length)) + chalk.gray('│\n');
    }
    content += chalk.gray('  └' + '─'.repeat(W) + '┘\n');

    // ────────────────────────────────────────────────────────────
    // 1. ACTIONABLE NOW
    // ────────────────────────────────────────────────────────────
    content += '\n' + chalk.green.bold('  [1] ACTIONABLE CANDIDATES') + chalk.gray(' — Confirmed setups within risk parameters') + '\n';
    content += chalk.gray('  ' + '─'.repeat(W) + '\n');

    if (actionable.length === 0) {
      content += chalk.gray('\n  No symbol passed all strict timing and risk gates in this snapshot.\n');
      content += chalk.gray('  Check Watchlist below or wait for a pullback into support.\n\n');
    } else {
      for (const res of actionable) {
        content += renderDetailedCard(res, res.rank) + '\n';
      }
    }

    // ────────────────────────────────────────────────────────────
    // 2. WATCHLIST (PULLBACK RETEST)
    // ────────────────────────────────────────────────────────────
    content += '\n' + chalk.cyan.bold('  [2] WATCHLIST') + chalk.gray(' — Trend intact, awaiting pullback / support retest') + '\n';
    content += chalk.gray('  ' + '─'.repeat(W) + '\n');

    if (watchlist.length === 0) {
      content += chalk.gray('  (No symbols in watchlist)\n');
    } else {
      for (const item of watchlist) {
        const sideColor = item.side === 'LONG' ? chalk.green : chalk.red;
        const scoreBar = renderGauge(item.finalScore, 100, 6);
        const p24 = formatPercent(item.priceChange24h);
        const priceStr = formatPrice(item.price);
        const note = item.timing?.decision || item.signalCategory || 'Waiting for support retest';

        content += `  • ${chalk.yellow.bold(item.symbol.padEnd(12))} [${sideColor(item.side)}] ${scoreBar} ${item.finalScore.toFixed(1)}/100 | ${priceStr} (${p24})\n`;
        content += chalk.gray(`    Plan: ${note}\n`);
      }
    }

    // ────────────────────────────────────────────────────────────
    // 3. AVOID / QUARANTINED
    // ────────────────────────────────────────────────────────────
    content += '\n' + chalk.red.bold('  [3] QUARANTINED / DO NOT CHASE') + chalk.gray(' — Overextended, late move, or stale data') + '\n';
    content += chalk.gray('  ' + '─'.repeat(W) + '\n');

    if (rejected.length === 0) {
      content += chalk.gray('  (No quarantined symbols)\n');
    } else {
      for (const item of rejected) {
        const sideColor = item.side === 'LONG' ? chalk.green : chalk.red;
        const priceStr = formatPrice(item.price);
        const p24 = formatPercent(item.priceChange24h);
        const reason = item.timing?.orderbookWarning || item.timing?.decision || 'Price extended near upper band, high mean-reversion risk';

        content += `  • ${chalk.white.bold(item.symbol.padEnd(12))} [${sideColor(item.side)}] ${priceStr} (${p24}) | ${chalk.red('AVOID')}\n`;
        content += chalk.gray(`    Reason: ${reason}\n`);
      }
    }

    // Execution Note
    content += '\n' + chalk.gray('  Execution Note: Quantitative discovery only. Verify live orderbook liquidity before order entry.\n');

    console.log(content);
  }
}
