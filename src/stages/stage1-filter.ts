// ============================================================
// Stage 1 Filter — Ultra-Fast Liquid & Active Candidate Filter
// ============================================================

import { TickerData, SymbolInfo, Stage1Result, LiquidityTier, PriceWindowMetric, Stage1Diagnostics, DiscoveryLane } from '../data/types.js';
import { CONFIG } from '../config.js';
import { spreadBps, pctChange } from '../utils/math.js';
import { MarketDataHub } from '../data/market-data-hub.js';

export class Stage1Filter {
  private config: typeof CONFIG;
  public lastDiagnostics: Stage1Diagnostics = {
    totalScanned: 0,
    rejectedInactive: 0,
    rejectedWrongContract: 0,
    rejectedLowLiquidity: 0,
    rejectedLowOI: 0,
    rejectedWideSpread: 0,
    rejectedNoMovement: 0,
    passed: 0
  };
  
  constructor(config: typeof CONFIG = CONFIG) {
    this.config = config;
  }
  
  filter(
    tickers: Map<string, TickerData>,
    prevTickers: Map<string, TickerData>,
    instruments: Map<string, SymbolInfo>,
    hub?: MarketDataHub
  ): Stage1Result[] {
    const startTime = Date.now();
    const results: Stage1Result[] = [];
    
    const diag: Stage1Diagnostics = {
      totalScanned: tickers.size,
      rejectedInactive: 0,
      rejectedWrongContract: 0,
      rejectedLowLiquidity: 0,
      rejectedLowOI: 0,
      rejectedWideSpread: 0,
      rejectedNoMovement: 0,
      passed: 0
    };

    for (const [symbol, ticker] of tickers.entries()) {
      const info = instruments.get(symbol);
      if (!info) continue;
      
      // 1. Hard Scope: Active status check
      if (info.status !== 'Trading') {
        diag.rejectedInactive++;
        continue;
      }

      // Contract Type: USDT linear perpetual only
      if (info.quoteCoin !== 'USDT' || info.contractType !== 'LinearPerpetual') {
        diag.rejectedWrongContract++;
        continue;
      }
      
      // 2. Dynamic Liquidity check: Must meet minimal tradable threshold (Tier D Reject: < $5M)
      if (ticker.turnover24h < this.config.LIQUIDITY_TIERS.D_REJECT) {
        diag.rejectedLowLiquidity++;
        continue;
      }
      
      // 3. Open Interest check: Must meet minimum active capital ($1M)
      if (ticker.openInterestValue < this.config.MIN_OI_USD) {
        diag.rejectedLowOI++;
        continue;
      }
      
      // 4. Spread check: Reject unacceptably wide books (> 15 bps)
      const currentSpreadBps = spreadBps(ticker.bid1Price, ticker.ask1Price);
      if (!Number.isFinite(currentSpreadBps) || currentSpreadBps > this.config.MAX_SPREAD_BPS) {
        diag.rejectedWideSpread++;
        continue;
      }
      
      // 5. Real Windowed Price Changes
      let priceWindow5m: PriceWindowMetric | null = null;
      let priceWindow1h: PriceWindowMetric | null = null;
      let priceChange5m: number | null = null;
      let priceChange1h: number | null = null;
      let volumeAcceleration: number | null = null;

      if (hub) {
        priceWindow5m = hub.get5mReturn(symbol, ticker.timestamp);
        priceWindow1h = hub.get1hReturn(symbol, ticker.timestamp);
        priceChange5m = priceWindow5m.value;
        priceChange1h = priceWindow1h.value;
        volumeAcceleration = hub.getVolumeAcceleration(symbol);
      } else {
        // Fallback when hub instance is not directly passed
        if (ticker.lastPrice > 0 && ticker.prevPrice1h > 0) {
          priceChange1h = pctChange(ticker.lastPrice, ticker.prevPrice1h);
          priceWindow1h = {
            value: priceChange1h,
            sourceTimestamp: ticker.timestamp,
            referenceTimestamp: ticker.timestamp - 3600_000,
            window: '1h',
            dataPointsAvailable: 1
          };
        }
      }

      // 6. OI Change calculation
      const prevTicker = prevTickers.get(symbol);
      const oiChangePercent = (prevTicker && prevTicker.openInterest > 0)
        ? pctChange(ticker.openInterest, prevTicker.openInterest)
        : null;

      // 7. Activity Gate check: Ensure market has meaningful movement or activity
      const absP24h = Math.abs(ticker.price24hPcnt);
      const absP1h = priceChange1h !== null ? Math.abs(priceChange1h) : absP24h;
      const absP5m = priceChange5m !== null ? Math.abs(priceChange5m) : 0;
      const hasTickMove = prevTicker ? ticker.lastPrice !== prevTicker.lastPrice : true;

      // Passing condition: Has 5m move OR 1h move OR 24h move >= threshold OR is high-liquidity active coin
      const hasMovement = (absP5m >= this.config.MIN_PRICE_CHANGE_5M) ||
                          (absP1h >= this.config.MIN_PRICE_CHANGE_1H) ||
                          (absP24h >= 0.005 && hasTickMove) ||
                          (ticker.turnover24h >= 15_000_000 && hasTickMove);

      if (!hasMovement) {
        diag.rejectedNoMovement++;
        continue;
      }

      diag.passed++;
      
      // Calculate dynamic liquidity tier (A >= $100M, B >= $20M, C >= $5M)
      let liquidityTier: LiquidityTier = 'C';
      if (ticker.turnover24h >= this.config.LIQUIDITY_TIERS.A) liquidityTier = 'A';
      else if (ticker.turnover24h >= this.config.LIQUIDITY_TIERS.B) liquidityTier = 'B';
      
      // 8. Phase 4 Multi-Lane Discovery Classification
      const p5m = priceChange5m ?? 0;
      const p1h = priceChange1h ?? 0;
      const volAcc = volumeAcceleration ?? 1.0;
      const oiChg = oiChangePercent ?? 0;

      let discoveryLane: DiscoveryLane = 'LANE_D_HOT_MOVER';
      let laneScore = 0;

      // Check Lane B: Bullish Ignition (Fresh breakout acceleration)
      if (p5m >= 0.003 && p5m <= 0.025 && (volAcc >= 1.1 || oiChg > 0.005)) {
        discoveryLane = 'LANE_B_BULLISH_IGNITION';
        laneScore = 60 + (p5m * 1200) + (Math.min(2.5, volAcc) * 10) + (Math.min(0.05, oiChg) * 100);
      }
      // Check Lane C: Bearish Breakdown Ignition (Fresh breakdown acceleration)
      else if (p5m <= -0.003 && p5m >= -0.025 && (volAcc >= 1.1 || oiChg > 0.005)) {
        discoveryLane = 'LANE_C_BEARISH_IGNITION';
        laneScore = 60 + (Math.abs(p5m) * 1200) + (Math.min(2.5, volAcc) * 10);
      }
      // Check Lane A: Pre-Breakout / Volatility Compression (Base building, low extension)
      else if (Math.abs(p1h) <= 0.025 && Math.abs(p5m) <= 0.008) {
        discoveryLane = 'LANE_A_PRE_BREAKOUT';
        laneScore = 55 + (Math.min(2.0, volAcc) * 10) + (Math.abs(oiChg) * 100) - (Math.abs(p1h) * 400);
      }
      // Otherwise: Lane D: Hot Mover (High momentum, already extended)
      else {
        discoveryLane = 'LANE_D_HOT_MOVER';
        laneScore = 40 + Math.min(30, Math.abs(p1h) * 300) + Math.min(20, Math.abs(p5m) * 500);
      }

      // Legacy activityScore for backwards compatibility
      let rawScore = 0;
      let weight = 0;
      if (priceChange1h !== null) {
        rawScore += Math.min(35, Math.abs(priceChange1h) * 1000);
        weight += 35;
      } else {
        rawScore += Math.min(35, absP24h * 350);
        weight += 35;
      }
      if (priceChange5m !== null) {
        rawScore += Math.min(25, Math.abs(priceChange5m) * 1500);
        weight += 25;
      }
      if (volumeAcceleration !== null && volumeAcceleration > 0) {
        rawScore += Math.min(20, Math.max(0, (volumeAcceleration - 0.8) * 10));
        weight += 20;
      }
      if (oiChangePercent !== null && Number.isFinite(oiChangePercent)) {
        rawScore += Math.min(10, Math.abs(oiChangePercent) * 200);
        weight += 10;
      }
      if (currentSpreadBps > 0 && currentSpreadBps <= this.config.MAX_SPREAD_BPS) {
        rawScore += Math.max(0, 10 - (currentSpreadBps / this.config.MAX_SPREAD_BPS) * 10);
        weight += 10;
      }
      const activityScore = weight > 0 ? (rawScore / weight) * 100 : 0;
      
      results.push({
        symbol,
        liquidityTier,
        turnover24h: ticker.turnover24h,
        openInterestValue: ticker.openInterestValue,
        spreadBps: currentSpreadBps,
        priceWindow5m,
        priceWindow1h,
        priceChange5m,
        priceChange1h,
        volumeAcceleration,
        oiChangePercent,
        activityScore,
        discoveryLane,
        laneScore
      });
    }
    
    // Multi-Lane Quota Allocation:
    // Split candidates into 4 distinct lanes
    const laneB = results.filter(r => r.discoveryLane === 'LANE_B_BULLISH_IGNITION').sort((a, b) => (b.laneScore ?? 0) - (a.laneScore ?? 0));
    const laneA = results.filter(r => r.discoveryLane === 'LANE_A_PRE_BREAKOUT').sort((a, b) => (b.laneScore ?? 0) - (a.laneScore ?? 0));
    const laneC = results.filter(r => r.discoveryLane === 'LANE_C_BEARISH_IGNITION').sort((a, b) => (b.laneScore ?? 0) - (a.laneScore ?? 0));
    const laneD = results.filter(r => r.discoveryLane === 'LANE_D_HOT_MOVER').sort((a, b) => (b.laneScore ?? 0) - (a.laneScore ?? 0));

    const finalCandidatesMap = new Map<string, Stage1Result>();

    // 1. Quota Lane B (Bullish Ignition): up to 25
    laneB.slice(0, 25).forEach(c => finalCandidatesMap.set(c.symbol, c));

    // 2. Quota Lane A (Pre-Breakout Compression): up to 25
    laneA.slice(0, 25).forEach(c => finalCandidatesMap.set(c.symbol, c));

    // 3. Quota Lane C (Bearish Breakdown Ignition): up to 15
    laneC.slice(0, 15).forEach(c => finalCandidatesMap.set(c.symbol, c));

    // 4. Quota Lane D (Hot Movers for watchlist only): up to 15
    laneD.slice(0, 15).forEach(c => finalCandidatesMap.set(c.symbol, c));

    // Fill remaining capacity up to MAX_CANDIDATES from remaining Lane B -> Lane A -> Lane C -> Lane D
    const remainingPool = [...laneB.slice(25), ...laneA.slice(25), ...laneC.slice(15), ...laneD.slice(15)];
    for (const c of remainingPool) {
      if (finalCandidatesMap.size >= this.config.MAX_CANDIDATES) break;
      if (!finalCandidatesMap.has(c.symbol)) {
        finalCandidatesMap.set(c.symbol, c);
      }
    }

    const finalResults = Array.from(finalCandidatesMap.values());
    
    this.lastDiagnostics = diag;
    const elapsed = Date.now() - startTime;
    return finalResults;
  }
}
