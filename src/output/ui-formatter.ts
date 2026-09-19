// ============================================================
// UI Formatter — Quantitative Terminal Presentation Layer
// ============================================================
//
// Formats quantitative momentum indicators, orderflow, and
// cross-exchange confluence into clean, dense, terminal-grade
// cards with explicit trade plans and risk metrics.
//
// ZERO AI-slop: No emojis, no conversational filler, no patronizing text.
// ============================================================

import chalk from 'chalk';
import { 
  ScreenerCandidate, 
  VWAPAnalysis, 
  CrossExchangeAnalysis, 
  AbsorptionAnalysis 
} from '../data/types.js';
import { CandidateScores } from '../ranking/final-ranker.js';

export function formatPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price) || price <= 0) return 'N/A';
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (price >= 1) {
    return `$${price.toFixed(2)}`;
  }
  if (price >= 0.01) {
    return `$${price.toFixed(4)}`;
  }
  if (price >= 0.0001) {
    return `$${price.toFixed(6)}`;
  }
  return `$${price.toFixed(8)}`;
}

export function formatPercent(val: number | null | undefined, colored = true): string {
  if (val == null || !Number.isFinite(val)) return '0.00%';
  const sign = val >= 0 ? '+' : '';
  const str = `${sign}${(val * 100).toFixed(2)}%`;
  if (!colored) return str;
  return val > 0 ? chalk.green(str) : val < 0 ? chalk.red(str) : chalk.gray(str);
}

export function formatUSD(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val) || val <= 0) return '$0';
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

export function renderGauge(
  value: number, 
  max: number = 100, 
  width: number = 10,
  fillChar: string = '█',
  emptyChar: string = '░'
): string {
  const clamped = Math.max(0, Math.min(max, value));
  const ratio = clamped / max;
  const filledCount = Math.round(width * ratio);
  const emptyCount = width - filledCount;

  return `[${fillChar.repeat(filledCount)}${emptyChar.repeat(emptyCount)}]`;
}

export interface ActionVerdict {
  code: string;
  badge: string;
  actionText: string;
  tag: 'ACTIONABLE' | 'WATCHLIST' | 'AVOID' | 'NEUTRAL';
}

export function getActionVerdict(c: ScreenerCandidate | CandidateScores): ActionVerdict {
  const status = c.entryStatus;
  const cat = c.signalCategory;
  const chaseScore = c.timing?.chaseRiskScore ?? 0;
  const isBlocked = (c as any).actionableBlocked || (c.freshness?.isStale === true);

  if (isBlocked) {
    return {
      code: 'STALE_DATA_LOCKED',
      badge: chalk.bgYellow.black.bold(' STALE DATA / LOCKED '),
      actionText: 'Data bursa tertunda (stale). Tunggu sinkronisasi snapshot berikutnya.',
      tag: 'NEUTRAL'
    };
  }

  if (chaseScore >= 55 || status === 'TOO_LATE' || cat === 'NO_LONG' || cat === 'NO_SHORT') {
    return {
      code: 'HIGH_CHASE_RISK',
      badge: chalk.bgRed.white.bold(' DO NOT CHASE / OVEREXTENDED '),
      actionText: 'Harga mendekati batas deviasi atas (ekstensi > 2.0σ). Risiko koreksi tajam.',
      tag: 'AVOID'
    };
  }

  if (status === 'ACTIONABLE_NOW' || status === 'CONFIRMED' || cat === 'EARLY_LONG' || cat === 'EARLY_SHORT' || cat === 'DECOUPLED_ALPHA') {
    return {
      code: 'ACTIONABLE_NOW',
      badge: chalk.bgGreen.black.bold(' ACTIONABLE ENTRY NOW '),
      actionText: 'Breakout terkonfirmasi valid. Timing segar, risiko chasing rendah.',
      tag: 'ACTIONABLE'
    };
  }

  if (status === 'WAIT_PULLBACK' || cat === 'LATE_LONG' || cat === 'LATE_SHORT') {
    return {
      code: 'WAIT_PULLBACK',
      badge: chalk.bgCyan.black.bold(' PULLBACK RETEST WATCH '),
      actionText: 'Tren utama valid. Tunggu koreksi sehat ke area support / VWAP sebelum entry.',
      tag: 'WATCHLIST'
    };
  }

  return {
    code: 'CONSOLIDATION_WAIT',
    badge: chalk.bgGray.white.bold(' MONITORING BASE '),
    actionText: 'Rentang konsolidasi. Menunggu konfirmasi breakout terarah.',
    tag: 'NEUTRAL'
  };
}

export function formatCapitalFlow(flow: string | undefined): string {
  if (!flow) return 'NETRAL (Tidak ada arus agresif)';
  if (flow.includes('LONG_BUILD')) return 'LONG_BUILD (Inflow posisi beli baru terakumulasi)';
  if (flow.includes('SHORT_SQUEEZE')) return 'SHORT_SQUEEZE (Penjual terlikuidasi, dorongan paksa ke atas)';
  if (flow.includes('LONG_LIQUIDATION')) return 'LONG_LIQUIDATION (Pembeli leverage terlikuidasi)';
  if (flow.includes('SHORT_BUILD')) return 'SHORT_BUILD (Posisi jual baru dominan)';
  if (flow.includes('PROFIT_TAKING') || flow.includes('UNWIND')) return 'PROFIT_TAKING (Ambil untung bertahap)';
  return flow;
}

export function formatVWAP(va: VWAPAnalysis | null | undefined): string {
  if (!va) return 'Neutral';
  const pos = va.bandPosition ? ` [${va.bandPosition}]` : '';
  if (va.alignment.includes('BULLISH')) {
    return `${va.alignment}${pos} — Harga di atas VWAP Sesi & Mingguan (Buyer In Control)`;
  }
  if (va.alignment.includes('BEARISH')) {
    return `${va.alignment}${pos} — Harga di bawah VWAP Sesi & Mingguan (Seller In Control)`;
  }
  return `${va.alignment}${pos}`;
}

export function formatCrossExchange(cx: CrossExchangeAnalysis | null | undefined): { text: string; color: (t: string) => string } {
  if (!cx || cx.status === 'BINANCE_UNAVAILABLE') {
    return { text: 'BINANCE_UNAVAILABLE (Bybit Standalone)', color: chalk.gray };
  }
  if (cx.status === 'CROSS_EXCHANGE_CONFIRMED') {
    return { text: `CROSS_CONFIRMED (Bybit & Binance Aligned | Mod: +${cx.scoreModifier})`, color: chalk.green };
  }
  if (cx.status === 'SPOT_DRIVEN_ACCUMULATION') {
    return { text: `SPOT_DRIVEN_ACCUMULATION (Spot Binance Mengonfirmasi | Mod: +${cx.scoreModifier})`, color: chalk.green };
  }
  if (cx.status === 'BYBIT_ONLY_MOVE') {
    return { text: `BYBIT_ONLY_MOVE (Hanya bergerak di Bybit | Mod: ${cx.scoreModifier})`, color: chalk.yellow };
  }
  if (cx.status === 'SPOT_FUTURES_DIVERGENCE') {
    return { text: `SPOT_FUTURES_DIVERGENCE (Futures naik, Spot pasif | Mod: ${cx.scoreModifier})`, color: chalk.red };
  }
  if (cx.status === 'CROSS_EXCHANGE_DIVERGENCE') {
    return { text: `CROSS_DIVERGENCE (Arah antar-bursa berlawanan | Mod: ${cx.scoreModifier})`, color: chalk.red };
  }
  return { text: `${cx.status} (Mod: ${cx.scoreModifier})`, color: chalk.cyan };
}

export interface TradePlan {
  entryZone: string;
  stopLoss: string;
  slPercent: string;
  takeProfit1: string;
  tpPercent: string;
  riskReward: string;
}

export function generateTradePlan(
  price: number,
  side: 'LONG' | 'SHORT',
  exec: any,
  va: VWAPAnalysis | null | undefined
): TradePlan {
  const currentPrice = price;

  let sl = exec?.suggestedStopLoss;
  let tp = exec?.suggestedTakeProfit1;

  if (!sl || sl <= 0) {
    sl = side === 'LONG' ? currentPrice * 0.975 : currentPrice * 1.025;
  }
  if (!tp || tp <= 0) {
    tp = side === 'LONG' ? currentPrice * 1.045 : currentPrice * 0.955;
  }

  const slDistPct = Math.abs((sl - currentPrice) / currentPrice) * 100;
  const tpDistPct = Math.abs((tp - currentPrice) / currentPrice) * 100;
  const rr = tpDistPct / (slDistPct || 1);

  let entryLow = currentPrice;
  let entryHigh = currentPrice;

  if (side === 'LONG') {
    const sessionVwap = va?.sessionVwap?.vwap;
    if (sessionVwap && sessionVwap < currentPrice && sessionVwap > currentPrice * 0.96) {
      entryLow = sessionVwap;
      entryHigh = currentPrice;
    } else {
      entryLow = currentPrice * 0.992;
      entryHigh = currentPrice * 1.002;
    }
  } else {
    entryLow = currentPrice * 0.998;
    entryHigh = currentPrice * 1.008;
  }

  return {
    entryZone: `${formatPrice(entryLow)} - ${formatPrice(entryHigh)}`,
    stopLoss: formatPrice(sl),
    slPercent: `-${slDistPct.toFixed(2)}%`,
    takeProfit1: formatPrice(tp),
    tpPercent: `+${tpDistPct.toFixed(2)}%`,
    riskReward: `1 : ${rr.toFixed(1)}`
  };
}

const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

export function pad(str: string, len: number): string {
  const visible = stripAnsi(str);
  const diff = len - visible.length;
  return diff > 0 ? str + ' '.repeat(diff) : str;
}

const wrap = (text: string, maxLen: number): string[] => {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const wVisLen = stripAnsi(w).length;
    if (wVisLen > maxLen) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      let rem = w;
      while (stripAnsi(rem).length > maxLen) {
        lines.push(rem.slice(0, maxLen));
        rem = rem.slice(maxLen);
      }
      cur = rem;
      continue;
    }
    const testLine = cur ? `${cur} ${w}` : w;
    if (stripAnsi(testLine).length <= maxLen) {
      cur = testLine;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
};

/**
 * Render institutional quantitative card without AI slop.
 */
export function renderDetailedCard(c: ScreenerCandidate | CandidateScores, rank?: number): string {
  const sym = c.symbol;
  const isCandidate = 'finalScore' in c;

  const price = isCandidate ? (c as ScreenerCandidate).price : (c as CandidateScores).ticker.lastPrice;
  const p24 = isCandidate ? (c as ScreenerCandidate).priceChange24h : (c as CandidateScores).ticker.price24hPcnt;
  const turnover = isCandidate ? (c as ScreenerCandidate).volume24h : (c as CandidateScores).ticker.turnover24h;
  const funding = isCandidate ? (c as ScreenerCandidate).fundingRate : (c as CandidateScores).ticker.fundingRate;

  let longScoreNum = 0;
  let shortScoreNum = 0;
  if (typeof c.longScore === 'number') {
    longScoreNum = c.longScore;
    shortScoreNum = typeof c.shortScore === 'number' ? c.shortScore : 0;
  } else {
    longScoreNum = (c.longScore as any)?.total ?? 0;
    shortScoreNum = (c.shortScore as any)?.total ?? 0;
  }

  const rawScore = isCandidate ? (c as ScreenerCandidate).finalScore : Math.max(longScoreNum, shortScoreNum);
  const rating = isCandidate ? (c as ScreenerCandidate).rating : (rawScore >= 80 ? 'A+' : rawScore >= 70 ? 'A' : rawScore >= 60 ? 'B+' : 'WATCH');
  
  const side: 'LONG' | 'SHORT' = ('side' in c && (c as ScreenerCandidate).side === 'SHORT') ? 'SHORT' : (longScoreNum >= shortScoreNum ? 'LONG' : 'SHORT');
  const sideTag = side === 'LONG' ? chalk.bgGreen.black.bold(' BUY / LONG ') : chalk.bgRed.white.bold(' SELL / SHORT ');

  const verdict = getActionVerdict(c);
  const plan = generateTradePlan(price, side, c.executionScore, c.vwapAnalysis ?? c.timing?.vwapAnalysis);
  const flowText = formatCapitalFlow(c.oiCapitalFlow);
  const vwapText = formatVWAP(c.vwapAnalysis ?? c.timing?.vwapAnalysis);
  const cx = formatCrossExchange(c.crossExchange ?? c.timing?.crossExchange);

  const chaseScore = c.timing?.chaseRiskScore ?? 0;
  const chaseGauge = renderGauge(chaseScore, 100, 8);
  const chaseColor = chaseScore >= 55 ? chalk.red : chaseScore >= 30 ? chalk.yellow : chalk.green;

  const scoreGauge = renderGauge(rawScore, 100, 8);
  const scoreColor = rawScore >= 75 ? chalk.green : rawScore >= 60 ? chalk.cyan : chalk.yellow;

  const p1h = c.priceChange1h !== undefined && c.priceChange1h !== null ? c.priceChange1h : 0;
  const p5m = (c as any).priceChange5m !== undefined && (c as any).priceChange5m !== null ? (c as any).priceChange5m : 0;

  const rankPrefix = rank ? `#${rank} ` : (isCandidate && (c as ScreenerCandidate).rank ? `#${(c as ScreenerCandidate).rank} ` : '');

  const W = 81;

  let out = '\n';
  out += chalk.gray('  ┌' + '─'.repeat(W) + '┐\n');
  
  // Header line with exact padding
  const headLeft = `  ${chalk.yellow.bold(rankPrefix + sym)}  ${sideTag}`;
  const headRight = `${verdict.badge}  `;
  const space = Math.max(1, W - stripAnsi(headLeft).length - stripAnsi(headRight).length);
  const headerContent = headLeft + ' '.repeat(space) + headRight;
  out += chalk.gray('  │') + pad(headerContent, W) + chalk.gray('│\n');
  out += chalk.gray('  ├' + '─'.repeat(W) + '┤\n');

  const printRow = (label: string, value: string, colorFn?: (s: string) => string): string => {
    const prefix = `  • ${label.padEnd(12)}: `;
    const maxValLen = W - prefix.length - 2;
    const lines = wrap(value, maxValLen);
    let rowOut = '';
    for (let i = 0; i < lines.length; i++) {
      const lineVal = colorFn ? colorFn(lines[i]) : lines[i];
      const text = i === 0 ? `${prefix}${lineVal}` : `    ${''.padEnd(12)}  ${lineVal}`;
      rowOut += chalk.gray('  │') + pad(text, W) + chalk.gray('│\n');
    }
    return rowOut;
  };

  // Section 1: Trade Setup & Plan
  out += chalk.gray('  │') + pad(chalk.cyan.bold('  [1] RENCANA TRADING (SETUP)'), W) + chalk.gray('│\n');
  out += printRow('Aksi', verdict.actionText);
  out += printRow('Area Entry', `${chalk.cyan.bold(plan.entryZone)} (Zona Support VWAP)`);
  out += printRow('Stop Loss', `${chalk.red.bold(plan.stopLoss)} (${plan.slPercent})`);
  out += printRow('Take Profit', `${chalk.green.bold(plan.takeProfit1)} (${plan.tpPercent}) [Target wajar 2x ATR]`);
  out += printRow('Risk/Reward', chalk.white.bold(plan.riskReward));

  out += chalk.gray('  ├' + '─'.repeat(W) + '┤\n');

  // Section 2: Quantitative Metrics & Risk
  out += chalk.gray('  │') + pad(chalk.cyan.bold('  [2] METRIK KUANTITATIF & RISIKO'), W) + chalk.gray('│\n');
  out += printRow('Skor Setup', `${scoreColor(scoreGauge)} ${rawScore.toFixed(1)}/100 (Grade: ${rating})`);
  out += printRow('Chase Risk', `${chaseColor(chaseGauge)} ${chaseScore}/100 [${chaseScore < 30 ? 'Aman' : chaseScore < 55 ? 'Sedang' : 'Tinggi'}]`);
  
  if (c.timing) {
    const t = c.timing;
    const trigSec = t.elapsedSecondsSinceTrigger ?? 0;
    const trigStr = trigSec < 60 ? `${trigSec}s ago` : `${Math.floor(trigSec / 60)}m ago`;
    out += printRow('Sinyal & ATR', `Jarak ${t.distanceFromTriggerPct}% (${t.distanceFromTriggerATR}x ATR) | Trigger: ${trigStr}`);
  }

  out += chalk.gray('  ├' + '─'.repeat(W) + '┤\n');

  // Section 3: Market & Liquidity Data
  out += chalk.gray('  │') + pad(chalk.cyan.bold('  [3] DATA PASAR & LIKUIDITAS'), W) + chalk.gray('│\n');
  out += printRow('Harga', `${chalk.white.bold(formatPrice(price))} | 24j: ${formatPercent(p24)} | 1j: ${formatPercent(p1h)} | 5m: ${formatPercent(p5m)}`);
  out += printRow('Turnover 24j', `${formatUSD(turnover)} (Tier ${c.liquidityTier}) | Funding: ${(funding * 100).toFixed(4)}%`);

  out += chalk.gray('  ├' + '─'.repeat(W) + '┤\n');

  // Section 4: Orderflow & Multi-Venue Verification
  out += chalk.gray('  │') + pad(chalk.cyan.bold('  [4] ARUS MODAL & KONFIRMASI LINTAS BURSA'), W) + chalk.gray('│\n');
  out += printRow('Arus Modal', flowText);
  out += printRow('Level VWAP', vwapText);
  out += printRow('Lintas Bursa', cx.text, cx.color);

  // Absorption
  const abs = c.absorption ?? c.timing?.absorption;
  if (abs && abs.event !== 'ABSORPTION_UNCONFIRMED') {
    const absColor = abs.event === 'BULLISH_ABSORPTION' ? chalk.green : chalk.red;
    out += printRow('Orderflow', `${abs.event} (${abs.location}) | Trapped: ${abs.trappedSide ?? 'N/A'}`, absColor);
  }

  // Supporting factors
  let reasons: string[] = [];
  if (isCandidate && (c as ScreenerCandidate).reasons) {
    reasons = (c as ScreenerCandidate).reasons;
  } else if (!isCandidate) {
    const breakdown = side === 'LONG' ? (c as CandidateScores).longScore : (c as CandidateScores).shortScore;
    if (breakdown && typeof breakdown === 'object' && 'modifiers' in breakdown) {
      reasons = (breakdown as any).modifiers?.map((m: any) => m.name || m.reason) || [];
    }
  }

  if (reasons.length > 0) {
    out += printRow('Faktor Kunci', reasons.slice(0, 3).join(' | '));
  }

  out += chalk.gray('  └' + '─'.repeat(W) + '┘');
  return out;
}
