// ============================================================
// Readable terminal dashboard for discovery and ranking results
// ============================================================

import { ScreenerOutput } from '../data/types.js';
import chalk from 'chalk';

function signedPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

function ageText(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return 'n/a';
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function plainStatus(status: string | undefined): string {
  if (!status) return 'WAITING';
  return status.replaceAll('_', ' ');
}

export class TerminalUI {
  render(output: ScreenerOutput): void {
    const actionable = output.actionableResults ?? output.results;
    const watchlist = output.watchlist ?? [];
    const rejected = output.rejectedSignals ?? [];
    const regimeColor = output.regime.includes('BULL')
      ? chalk.green.bold
      : output.regime.includes('BEAR')
        ? chalk.red.bold
        : chalk.yellow.bold;

    let content = '\n';
    content += chalk.cyan.bold('============================================================\n');
    content += chalk.cyan.bold('        TRADE SCREENER COIN v2.1.1 - MARKET RADAR\n');
    content += chalk.cyan.bold('============================================================\n');
    content += `Market : BTC $${output.btcPrice.toFixed(2)} (${signedPercent(output.btcChange1h)} 1H) | Regime: ${regimeColor(output.regime)}\n`;
    content += `Scan   : ${output.totalSymbols} symbols | Finished in ${(output.scanLatencyMs / 1000).toFixed(1)}s | Updated: ${output.timestamp}\n`;
    content += `Result : ${chalk.green.bold(`${actionable.length} actionable`)} | ${chalk.yellow(`${watchlist.length} watchlist`)} | ${chalk.red(`${rejected.length} avoid`)}\n`;

    if (output.diagnostics) {
      const d = output.diagnostics;
      content += `Filter : ${d.universeSize} scanned -> ${d.stage1Candidates} active -> ${d.stage2Candidates} analyzed -> ${d.qualifiedCandidates} qualified\n`;
    }

    content += '\n' + chalk.green.bold('1. ACTIONABLE NOW') + chalk.gray(' - review immediately, not an automatic trade') + '\n';
    content += chalk.gray('------------------------------------------------------------\n');
    if (actionable.length === 0) {
      content += chalk.yellow('No setup passed all freshness, trigger, timing, and risk filters.\n');
      content += chalk.gray('This is a valid safe result; wait for a better-confirmed setup.\n');
    } else {
      for (const res of actionable) {
        const side = res.side === 'LONG' ? chalk.green('LONG') : chalk.red('SHORT');
        const decision = plainStatus(res.entryStatus ?? res.timing?.decision);
        content += `\n${chalk.bold(`#${res.rank} ${res.symbol}`)} | ${side} | Score ${res.finalScore.toFixed(1)} | ${res.rating}\n`;
        content += `  Status : ${chalk.bold(decision)} | Price $${res.price} | 24H ${signedPercent(res.priceChange24h)}\n`;
        content += `  Setup  : ${res.discoveryLabel ?? res.signalCategory ?? 'CONFIRMED SETUP'} | Flow: ${res.oiCapitalFlow ?? 'N/A'}\n`;
        if (res.htfContext) {
          content += `  Trend  : 1D ${res.htfContext.dailyTrend} | 4H ${res.htfContext.fourHourTrend} | ${res.htfContext.classification}\n`;
        }
        if (res.timing) {
          content += `  Timing : ${res.timing.decision} | Freshness ${res.timing.signalFreshness}/100 | Trigger ${ageText(res.timing.elapsedSecondsSinceTrigger)} ago\n`;
        }
        const cx = res.crossExchange ?? res.timing?.crossExchange;
        if (cx) {
          const modifier = cx.scoreModifier > 0 ? `+${cx.scoreModifier}` : `${cx.scoreModifier}`;
          content += `  Check  : Bybit + Binance ${plainStatus(cx.status)} | Modifier ${modifier}\n`;
        }
        content += `  Note   : ${res.timing?.decision ?? 'Review the full market context before acting.'}\n`;
      }
    }

    content += '\n' + chalk.yellow.bold('2. WATCHLIST') + chalk.gray(' - interesting, but wait for confirmation or pullback') + '\n';
    content += chalk.gray('------------------------------------------------------------\n');
    if (watchlist.length === 0) {
      content += chalk.gray('No watchlist candidates.\n');
    } else {
      for (const item of watchlist) {
        content += `  ${chalk.bold(item.symbol)} | ${item.side} | Score ${item.finalScore.toFixed(1)} | ${plainStatus(item.entryStatus)}\n`;
        content += `    ${item.timing?.decision ?? item.signalCategory ?? 'Waiting for trigger'}\n`;
      }
    }

    content += '\n' + chalk.red.bold('3. AVOID / QUARANTINED') + chalk.gray(' - do not chase this snapshot') + '\n';
    content += chalk.gray('------------------------------------------------------------\n');
    if (rejected.length === 0) {
      content += chalk.gray('No quarantined candidates.\n');
    } else {
      for (const item of rejected) {
        content += `  ${chalk.bold(item.symbol)} | ${item.side} | ${plainStatus(item.entryStatus ?? 'REJECTED')}\n`;
        content += `    ${item.timing?.decision ?? 'Risk, stale data, or late movement detected'}\n`;
      }
    }

    content += '\n' + chalk.cyan.bold('DATA QUALITY & HOW TO READ THIS') + '\n';
    content += chalk.gray('------------------------------------------------------------\n');
    content += '  Bybit = primary scan and directional bias. Binance = confirmation only.\n';
    content += '  Binance errors/timeouts do not stop the scan and apply no external modifier.\n';
    content += '  ACTIONABLE NOW means worth reviewing now, not guaranteed profit or an order.\n';
    content += '  Always recheck the live price, orderbook, and freshness before deciding.\n';
    content += chalk.cyan.bold('============================================================\n');

    console.log(content);
  }
}
