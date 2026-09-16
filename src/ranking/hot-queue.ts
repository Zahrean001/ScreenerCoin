// ============================================================
// Hot Queue — Event-Driven Priority Queue with Multi-Trigger Accumulation
// ============================================================

import { HotEvent, HotTrigger, TickerData } from '../data/types.js';
import { CONFIG } from '../config.js';
import { pctChange } from '../utils/math.js';

export class HotQueue {
  private queue: HotEvent[] = [];

  push(event: HotEvent): void {
    const existingIndex = this.queue.findIndex((e) => e.symbol === event.symbol);

    if (existingIndex !== -1) {
      const existing = this.queue[existingIndex];
      // Accumulate new triggers without duplicates
      for (const t of event.triggers) {
        if (!existing.triggers.includes(t)) {
          existing.triggers.push(t);
        }
      }
      existing.maxPriority = Math.max(existing.maxPriority, event.maxPriority);
      existing.value = event.value;
      existing.latestSeen = event.latestSeen;
      existing.ttl = Math.max(existing.ttl, event.ttl);
    } else {
      this.queue.push({
        symbol: event.symbol,
        triggers: [...event.triggers],
        maxPriority: event.maxPriority,
        value: event.value,
        firstSeen: event.firstSeen,
        latestSeen: event.latestSeen,
        ttl: event.ttl
      });
    }
    
    // Sort descending by highest priority
    this.queue.sort((a, b) => b.maxPriority - a.maxPriority);

    // Evict lowest priority if full
    if (this.queue.length > CONFIG.HOT_MAX_SIZE) {
      this.queue.pop();
    }
  }

  pop(): HotEvent | undefined {
    return this.queue.shift();
  }

  peek(): HotEvent | undefined {
    return this.queue[0];
  }

  getSymbols(): string[] {
    return this.queue.map(e => e.symbol);
  }

  has(symbol: string): boolean {
    return this.queue.some(e => e.symbol === symbol);
  }

  cleanup(): void {
    const now = Date.now();
    this.queue = this.queue.filter(e => e.ttl > now);
  }

  get size(): number {
    return this.queue.length;
  }

  getAll(): HotEvent[] {
    return [...this.queue];
  }
}

export class HotEventDetector {
  private config: typeof CONFIG;

  constructor(config: typeof CONFIG = CONFIG) {
    this.config = config;
  }

  detect(symbol: string, ticker: TickerData, prevTicker: TickerData | null): HotEvent | null {
    if (!prevTicker) return null;

    const triggers: HotTrigger[] = [];
    let maxPriority = 0;
    let mainValue = 0;

    // 1. Price spike check
    const priceChange = Math.abs(pctChange(ticker.lastPrice, prevTicker.lastPrice));
    if (priceChange >= this.config.HOT_PRICE_CHANGE_THRESHOLD) {
      triggers.push('PRICE_SPIKE');
      const priority = priceChange * 100;
      if (priority > maxPriority) {
        maxPriority = priority;
        mainValue = priceChange;
      }
    }

    // 2. Volume spike check (turnover rate estimation)
    const timeDiffSec = (ticker.timestamp - prevTicker.timestamp) / 1000;
    if (timeDiffSec > 0 && prevTicker.turnover24h > 0) {
      const turnoverDiff = ticker.turnover24h - prevTicker.turnover24h;
      const expectedTurnover = (prevTicker.turnover24h / 86400) * timeDiffSec;
      const volumeRatio = expectedTurnover > 0 ? turnoverDiff / expectedTurnover : 0;
      
      if (volumeRatio >= this.config.HOT_VOLUME_RATIO_THRESHOLD) {
        triggers.push('VOLUME_SPIKE');
        const priority = volumeRatio * 10;
        if (priority > maxPriority) {
          maxPriority = priority;
          mainValue = volumeRatio;
        }
      }
    }
    
    // 3. OI spike check
    const oiChange = prevTicker.openInterest > 0 
      ? Math.abs(pctChange(ticker.openInterest, prevTicker.openInterest)) 
      : 0;

    if (oiChange >= this.config.HOT_OI_CHANGE_THRESHOLD) {
      triggers.push('OI_SPIKE');
      const priority = oiChange * 50;
      if (priority > maxPriority) {
        maxPriority = priority;
        mainValue = oiChange;
      }
    }

    if (triggers.length === 0) return null;

    const now = Date.now();
    return {
      symbol,
      triggers,
      trigger: triggers[0],
      maxPriority,
      value: mainValue,
      firstSeen: now,
      latestSeen: now,
      ttl: now + this.config.HOT_TTL_MS
    };
  }
}
