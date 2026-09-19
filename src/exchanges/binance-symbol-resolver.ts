// ============================================================
// Binance Symbol Resolver — Exchange Metadata Based Mapping
// ============================================================
//
// Loads Binance exchangeInfo ONCE at boot, caches in memory,
// and resolves Bybit symbol → Binance Futures + Spot symbols.
// No API key required (public endpoints).
// ============================================================

import axios from 'axios';

export type SymbolMappingStatus =
  | 'MAPPED'          // Both futures and spot available
  | 'FUTURES_ONLY'    // Only Binance USDⓈ-M futures
  | 'SPOT_ONLY'       // Only Binance spot
  | 'UNAVAILABLE'     // Not listed on Binance
  | 'AMBIGUOUS';      // Mapping unclear, treat as neutral

export interface SymbolMapping {
  bybitSymbol: string;
  binanceFuturesSymbol: string | null;
  binanceSpotSymbol: string | null;
  status: SymbolMappingStatus;
}

interface BinanceSymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  contractType?: string;
}

// Known prefix multiplier tokens (Bybit uses 1000PEPE, Binance may differ)
const MULTIPLIER_PREFIXES = ['1000', '10000', '100000'];

const FUTURES_ENDPOINTS = [
  'https://fapi.binance.com',
  'https://fapi1.binance.com',
  'https://fapi2.binance.com'
];

const SPOT_ENDPOINTS = [
  'https://api.binance.com',
  'https://api3.binance.com',
  'https://api1.binance.com'
];

export class BinanceSymbolResolver {
  private futuresMap = new Map<string, BinanceSymbolInfo>();
  private spotMap = new Map<string, BinanceSymbolInfo>();
  private cache = new Map<string, SymbolMapping>();
  private initialized = false;
  private initError: string | null = null;

  // Manual override table for known exceptions
  private static OVERRIDES: Record<string, { futures?: string; spot?: string }> = {
    // Add known exceptions here as they are discovered
  };

  private async fetchFirstWorking(endpoints: string[], path: string, timeoutMs: number): Promise<any> {
    for (const base of endpoints) {
      try {
        const res = await axios.get(`${base}${path}`, {
          timeout: timeoutMs
        });
        if (res.data?.symbols) return res.data;
      } catch {
        // Try next mirror
      }
    }
    return null;
  }

  /**
   * Initialize by loading Binance exchangeInfo (futures + spot).
   * Called once at scanner boot. Failures are non-fatal (all symbols → UNAVAILABLE).
   */
  async initialize(timeoutMs: number = 4000): Promise<void> {
    try {
      const [futuresData, spotData] = await Promise.allSettled([
        this.fetchFirstWorking(FUTURES_ENDPOINTS, '/fapi/v1/exchangeInfo', timeoutMs),
        this.fetchFirstWorking(SPOT_ENDPOINTS, '/api/v3/exchangeInfo', timeoutMs)
      ]);

      if (futuresData.status === 'fulfilled' && futuresData.value?.symbols) {
        for (const sym of futuresData.value.symbols) {
          if (sym.contractType === 'PERPETUAL' && sym.quoteAsset === 'USDT' && sym.status === 'TRADING') {
            this.futuresMap.set(sym.symbol, sym);
          }
        }
      }

      if (spotData.status === 'fulfilled' && spotData.value?.symbols) {
        for (const sym of spotData.value.symbols) {
          if (sym.quoteAsset === 'USDT' && sym.status === 'TRADING') {
            this.spotMap.set(sym.symbol, sym);
          }
        }
      }

      this.initialized = true;
    } catch (err: any) {
      this.initError = err?.message || 'Unknown error loading Binance exchangeInfo';
      this.initialized = true; // Mark as initialized even on failure (all → UNAVAILABLE)
    }
  }

  /**
   * Resolve a Bybit USDT perpetual symbol to Binance futures + spot equivalents.
   */
  resolve(bybitSymbol: string): SymbolMapping {
    // Check cache first
    const cached = this.cache.get(bybitSymbol);
    if (cached) return cached;

    // Check manual overrides
    const override = BinanceSymbolResolver.OVERRIDES[bybitSymbol];
    if (override) {
      const result: SymbolMapping = {
        bybitSymbol,
        binanceFuturesSymbol: override.futures || null,
        binanceSpotSymbol: override.spot || null,
        status: override.futures && override.spot ? 'MAPPED'
          : override.futures ? 'FUTURES_ONLY'
          : override.spot ? 'SPOT_ONLY'
          : 'UNAVAILABLE'
      };
      this.cache.set(bybitSymbol, result);
      return result;
    }

    // If not initialized or maps empty, everything is UNAVAILABLE
    if (!this.initialized || (this.futuresMap.size === 0 && this.spotMap.size === 0)) {
      const unavailable: SymbolMapping = {
        bybitSymbol,
        binanceFuturesSymbol: null,
        binanceSpotSymbol: null,
        status: 'UNAVAILABLE'
      };
      this.cache.set(bybitSymbol, unavailable);
      return unavailable;
    }

    // Direct match attempt (most common case: BTCUSDT → BTCUSDT)
    let futuresSymbol: string | null = null;
    let spotSymbol: string | null = null;

    if (this.futuresMap.has(bybitSymbol)) {
      futuresSymbol = bybitSymbol;
    }
    if (this.spotMap.has(bybitSymbol)) {
      spotSymbol = bybitSymbol;
    }

    // Handle multiplier prefix tokens (1000PEPEUSDT → PEPEUSDT on spot)
    if (!spotSymbol) {
      for (const prefix of MULTIPLIER_PREFIXES) {
        if (bybitSymbol.startsWith(prefix)) {
          const stripped = bybitSymbol.slice(prefix.length);
          if (this.spotMap.has(stripped)) {
            spotSymbol = stripped;
            break;
          }
        }
      }
    }

    // Also check if futures uses multiplier prefix differently
    if (!futuresSymbol) {
      for (const prefix of MULTIPLIER_PREFIXES) {
        if (bybitSymbol.startsWith(prefix)) {
          // Binance might also use the same prefix
          if (this.futuresMap.has(bybitSymbol)) {
            futuresSymbol = bybitSymbol;
            break;
          }
        }
      }
    }

    let status: SymbolMappingStatus;
    if (futuresSymbol && spotSymbol) {
      status = 'MAPPED';
    } else if (futuresSymbol) {
      status = 'FUTURES_ONLY';
    } else if (spotSymbol) {
      status = 'SPOT_ONLY';
    } else {
      status = 'UNAVAILABLE';
    }

    const result: SymbolMapping = {
      bybitSymbol,
      binanceFuturesSymbol: futuresSymbol,
      binanceSpotSymbol: spotSymbol,
      status
    };

    this.cache.set(bybitSymbol, result);
    return result;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getInitError(): string | null {
    return this.initError;
  }

  getFuturesCount(): number {
    return this.futuresMap.size;
  }

  getSpotCount(): number {
    return this.spotMap.size;
  }

  getCacheSize(): number {
    return this.cache.size;
  }
}
