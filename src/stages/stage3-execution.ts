// ============================================================
// Stage 3 Execution Engine — Direction-Aware Orderbook Quality & Slippage
// ============================================================

import { 
  ExecutionScore, 
  ExecutionQualityResult, 
  Stage3ExecutionResult,
  OrderbookSnapshot, 
  TickerData, 
  TradeData, 
  Direction 
} from '../data/types.js';
import { CONFIG } from '../config.js';
import { spreadBps } from '../utils/math.js';

export class Stage3Execution {
  /**
   * Calculates genuine direction-aware execution quality by walking the orderbook
   * (consuming asks for LONG, consuming bids for SHORT).
   */
  evaluateExecution(
    symbol: string,
    direction: 'LONG' | 'SHORT',
    orderbook: OrderbookSnapshot | null,
    ticker: TickerData,
    recentTrades: TradeData[],
    targetNotionalUsd: number = 10_000
  ): ExecutionQualityResult {
    const reasons: string[] = [];

    // 1. Spread Score (0 - 20)
    let spreadScore = 5;
    let actualSpreadBps = 0;

    if (ticker.bid1Price > 0 && ticker.ask1Price > 0) {
      actualSpreadBps = spreadBps(ticker.bid1Price, ticker.ask1Price);
      if (actualSpreadBps <= CONFIG.EXEC_SPREAD_GOOD) {
        spreadScore = 20;
      } else if (actualSpreadBps <= CONFIG.EXEC_SPREAD_OK) {
        spreadScore = 14;
      } else if (actualSpreadBps <= CONFIG.EXEC_SPREAD_BAD) {
        spreadScore = 8;
      } else {
        spreadScore = 2;
        reasons.push(`Wide spread (${actualSpreadBps.toFixed(1)} bps)`);
      }
    }

    // 2. Direction-Aware Depth & Multi-Level Slippage Simulation
    let depthScore = 10;
    let slippageScore = 10;
    let slippageBps: number | null = null;
    let executableNotional = 0;
    let dataCompleteness = 0.5; // Base completeness with ticker + trades

    if (orderbook && orderbook.bids.length > 0 && orderbook.asks.length > 0) {
      dataCompleteness = 1.0;

      const levels = direction === 'LONG' ? orderbook.asks : orderbook.bids;
      const refPrice = direction === 'LONG' 
        ? orderbook.asks[0].price 
        : orderbook.bids[0].price;

      const midPrice = (orderbook.bids[0].price + orderbook.asks[0].price) / 2;

      // Calculate total side depth in USD (up to top 20 levels)
      let sideDepthUsd = 0;
      for (let i = 0; i < Math.min(20, levels.length); i++) {
        sideDepthUsd += levels[i].price * levels[i].size;
      }

      // Depth Score (0 - 40)
      if (sideDepthUsd >= CONFIG.EXEC_DEPTH_GOOD * 2) {
        depthScore = 40;
      } else if (sideDepthUsd >= CONFIG.EXEC_DEPTH_GOOD) {
        depthScore = 32;
      } else if (sideDepthUsd >= CONFIG.EXEC_DEPTH_MIN) {
        depthScore = 20;
      } else if (sideDepthUsd > 0) {
        depthScore = 8;
        reasons.push(`Shallow ${direction === 'LONG' ? 'ask' : 'bid'} depth ($${(sideDepthUsd / 1000).toFixed(1)}K)`);
      } else {
        depthScore = 0;
        reasons.push(`Zero ${direction === 'LONG' ? 'ask' : 'bid'} depth`);
      }

      // Walk the orderbook for multi-level VWAP slippage
      let remainingNotional = targetNotionalUsd;
      let totalCost = 0;
      let totalQty = 0;

      for (const level of levels) {
        if (remainingNotional <= 0) break;
        const levelNotional = level.price * level.size;
        const fillNotional = Math.min(remainingNotional, levelNotional);
        const fillQty = fillNotional / level.price;

        totalCost += fillQty * level.price;
        totalQty += fillQty;
        remainingNotional -= fillNotional;
      }

      executableNotional = targetNotionalUsd - remainingNotional;

      if (totalQty > 0 && midPrice > 0) {
        const vwapFillPrice = totalCost / totalQty;
        // Slippage in BPS from mid price
        slippageBps = (Math.abs(vwapFillPrice - midPrice) / midPrice) * 10_000;

        // Slippage Score (0 - 25)
        if (slippageBps <= CONFIG.EXEC_SLIPPAGE_GOOD) {
          slippageScore = 25;
        } else if (slippageBps <= CONFIG.EXEC_SLIPPAGE_OK) {
          slippageScore = 18;
        } else if (slippageBps <= CONFIG.EXEC_SLIPPAGE_BAD) {
          slippageScore = 10;
        } else {
          slippageScore = 3;
          reasons.push(`High slippage (${slippageBps.toFixed(1)} bps for $${(targetNotionalUsd / 1000).toFixed(0)}K fill)`);
        }

        // Insufficient book penalty
        if (executableNotional < targetNotionalUsd) {
          slippageScore = Math.max(0, slippageScore - 10);
          reasons.push(`Partial fill only ($${(executableNotional / 1000).toFixed(1)}K of $${(targetNotionalUsd / 1000).toFixed(0)}K)`);
        }
      }
    } else {
      // Fallback: estimate from ticker L1 size
      const l1SizeUsd = direction === 'LONG' 
        ? ticker.ask1Price * ticker.ask1Size 
        : ticker.bid1Price * ticker.bid1Size;

      if (l1SizeUsd >= CONFIG.EXEC_DEPTH_MIN) {
        depthScore = 20;
        slippageScore = 12;
      } else {
        depthScore = 10;
        slippageScore = 8;
      }
    }

    // 3. Trade Frequency Score (0 - 15)
    const now = Date.now();
    const tradesInMin = recentTrades.filter(t => (now - t.timestamp) <= 60_000).length;
    let tradeFreqScore = 3;

    if (tradesInMin >= CONFIG.EXEC_MIN_TRADES_PER_MIN * 4) {
      tradeFreqScore = 15;
    } else if (tradesInMin >= CONFIG.EXEC_MIN_TRADES_PER_MIN * 2) {
      tradeFreqScore = 12;
    } else if (tradesInMin >= CONFIG.EXEC_MIN_TRADES_PER_MIN) {
      tradeFreqScore = 8;
    } else {
      tradeFreqScore = 3;
      if (recentTrades.length > 0) reasons.push('Low trade frequency');
    }

    const totalScore = Math.min(100, Math.max(0, spreadScore + depthScore + slippageScore + tradeFreqScore));

    return {
      direction,
      slippageBps,
      executableNotional,
      spreadBps: actualSpreadBps,
      depthScore,
      slippageScore,
      spreadScore,
      tradeFreqScore,
      totalScore,
      availableWeight: 100 * dataCompleteness,
      dataCompleteness,
      reasons
    };
  }

  /**
   * Compatibility wrapper for general candidate scoring
   */
  analyze(
    symbol: string, 
    orderbook: OrderbookSnapshot | null, 
    ticker: TickerData, 
    recentTrades: TradeData[],
    direction: 'LONG' | 'SHORT' = 'LONG'
  ): Stage3ExecutionResult {
    const res = this.evaluateExecution(symbol, direction, orderbook, ticker, recentTrades);

    let bidDepth = 0;
    let askDepth = 0;
    if (orderbook) {
      for (const b of orderbook.bids.slice(0, 10)) bidDepth += b.price * b.size;
      for (const a of orderbook.asks.slice(0, 10)) askDepth += a.price * a.size;
    }

    const isPass = res.totalScore >= 40 && res.spreadBps <= CONFIG.MAX_SPREAD_BPS && res.depthScore > 0;
    const passReason = isPass 
      ? 'Execution quality passes threshold' 
      : (res.reasons.length > 0 ? res.reasons.join('; ') : 'Execution score below threshold');

    return {
      spread: res.spreadScore,
      bidDepth: Math.min(20, (bidDepth / CONFIG.EXEC_DEPTH_GOOD) * 20),
      askDepth: Math.min(20, (askDepth / CONFIG.EXEC_DEPTH_GOOD) * 20),
      slippage: res.slippageScore,
      tradeFrequency: res.tradeFreqScore,
      total: res.totalScore,
      direction,
      slippageBps: res.slippageBps,
      dataCompleteness: res.dataCompleteness,
      availableWeight: res.availableWeight,
      passed: isPass,
      reason: passReason
    };
  }
}
