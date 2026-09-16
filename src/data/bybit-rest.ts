import axios from 'axios';
import { CONFIG } from '../config.js';
import { RateLimiter, RateLimitedQueue } from '../utils/rate-limiter.js';
import { SymbolInfo, TickerData, CandleData, OrderbookSnapshot, OIDeltaSnapshot } from './types.js';
import { logger } from '../utils/logger.js';

export class BybitRest {
  private queue: RateLimitedQueue;
  private log = logger.child('BybitRest');

  constructor() {
    const limiter = new RateLimiter(CONFIG.REST_BURST_SIZE, CONFIG.REST_MAX_REQUESTS_PER_SECOND);
    this.queue = new RateLimitedQueue(limiter);
  }

  private async request<T>(endpoint: string, params: Record<string, any> = {}): Promise<T> {
    return this.queue.enqueue(async () => {
      try {
        const url = `${CONFIG.BYBIT_REST_URL}${endpoint}`;
        const response = await axios.get(url, { params, timeout: 15000 });
        if (response.data.retCode !== 0) {
          throw new Error(`Bybit API Error: ${response.data.retMsg} (Code: ${response.data.retCode})`);
        }
        return response.data.result;
      } catch (err) {
        this.log.error(`REST request failed for ${endpoint}`, { error: String(err) });
        throw err;
      }
    });
  }

  async getInstruments(): Promise<SymbolInfo[]> {
    const instruments: SymbolInfo[] = [];
    let cursor = '';
    
    do {
      const params: Record<string, any> = { category: 'linear', status: 'Trading' };
      if (cursor) params.cursor = cursor;
      
      const result = await this.request<any>('/v5/market/instruments-info', params);
      const list = result.list || [];
      
      for (const item of list) {
        // Strictly exclude stocks/equities (symbolType: "stock") and pre-listings
        if (
          item.quoteCoin === 'USDT' && 
          item.contractType === 'LinearPerpetual' &&
          item.symbolType !== 'stock' &&
          !item.isPreListing
        ) {
          instruments.push({
            symbol: item.symbol,
            baseCoin: item.baseCoin,
            quoteCoin: item.quoteCoin,
            settleCoin: item.settleCoin,
            status: item.status,
            contractType: item.contractType,
            tickSize: parseFloat(item.priceFilter.tickSize),
            qtyStep: parseFloat(item.lotSizeFilter.qtyStep),
            minOrderQty: parseFloat(item.lotSizeFilter.minOrderQty),
            maxLeverage: parseFloat(item.leverageFilter.maxLeverage),
            fundingInterval: parseInt(item.fundingInterval || '480', 10),
            launchTime: parseInt(item.launchTime || '0', 10),
          });
        }
      }
      cursor = result.nextPageCursor || '';
    } while (cursor);

    return instruments;
  }

  async getTickers(): Promise<Map<string, TickerData>> {
    const result = await this.request<any>('/v5/market/tickers', { category: 'linear' });
    const tickers = new Map<string, TickerData>();
    const now = Date.now();

    for (const item of result.list || []) {
      tickers.set(item.symbol, {
        symbol: item.symbol,
        lastPrice: parseFloat(item.lastPrice || '0'),
        markPrice: parseFloat(item.markPrice || '0'),
        indexPrice: parseFloat(item.indexPrice || '0'),
        bid1Price: parseFloat(item.bid1Price || '0'),
        bid1Size: parseFloat(item.bid1Size || '0'),
        ask1Price: parseFloat(item.ask1Price || '0'),
        ask1Size: parseFloat(item.ask1Size || '0'),
        highPrice24h: parseFloat(item.highPrice24h || '0'),
        lowPrice24h: parseFloat(item.lowPrice24h || '0'),
        prevPrice24h: parseFloat(item.prevPrice24h || '0'),
        prevPrice1h: parseFloat(item.prevPrice1h || '0'),
        price24hPcnt: parseFloat(item.price24hPcnt || '0'),
        volume24h: parseFloat(item.volume24h || '0'),
        turnover24h: parseFloat(item.turnover24h || '0'),
        openInterest: parseFloat(item.openInterest || '0'),
        openInterestValue: parseFloat(item.openInterestValue || '0'),
        fundingRate: parseFloat(item.fundingRate || '0'),
        nextFundingTime: parseInt(item.nextFundingTime || '0', 10),
        timestamp: now,
      });
    }

    return tickers;
  }

  async getKlines(symbol: string, interval: string, limit: number = 200): Promise<CandleData[]> {
    const result = await this.request<any>('/v5/market/kline', { category: 'linear', symbol, interval, limit });
    const list = result.list || [];
    const candles: CandleData[] = [];

    // result comes newest first, reverse to oldest first
    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];
      candles.push({
        timestamp: parseInt(item[0], 10),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5]),
        turnover: parseFloat(item[6]),
        confirmed: i > 0, // newest is unconfirmed
      });
    }

    return candles;
  }

  async getOrderbook(symbol: string, limit: number = 50): Promise<OrderbookSnapshot> {
    const result = await this.request<any>('/v5/market/orderbook', { category: 'linear', symbol, limit });
    return {
      symbol: result.s,
      bids: (result.b || []).map((level: string[]) => ({ price: parseFloat(level[0]), size: parseFloat(level[1]) })),
      asks: (result.a || []).map((level: string[]) => ({ price: parseFloat(level[0]), size: parseFloat(level[1]) })),
      timestamp: result.ts,
      updateId: result.u,
    };
  }

  async getOpenInterestHistory(symbol: string, intervalTime: string = '15min', limit: number = 50): Promise<any> {
    return this.request<any>('/v5/market/open-interest', { category: 'linear', symbol, intervalTime, limit });
  }

  async getFundingHistory(symbol: string, limit: number = 50): Promise<any> {
    return this.request<any>('/v5/market/funding/history', { category: 'linear', symbol, limit });
  }

  async getLongShortRatio(symbol: string, period: string = '1h', limit: number = 10): Promise<any> {
    return this.request<any>('/v5/market/account-ratio', { category: 'linear', symbol, period, limit });
  }

  async getOIDelta(symbol: string): Promise<OIDeltaSnapshot | null> {
    try {
      const res = await this.getOpenInterestHistory(symbol, '15min', 5);
      const list = res?.list || res?.result?.list || [];
      if (list.length >= 2) {
        const currentOI = parseFloat(list[0].openInterest || '0');
        const oi15mAgo = parseFloat(list[1].openInterest || '0');
        const oi1hAgo = list.length >= 5 ? parseFloat(list[4].openInterest || '0') : oi15mAgo;

        const oiChange15mPct = oi15mAgo > 0 ? (currentOI - oi15mAgo) / oi15mAgo : 0;
        const oiChange1hPct = oi1hAgo > 0 ? (currentOI - oi1hAgo) / oi1hAgo : 0;

        return {
          symbol,
          currentOI,
          oi15mAgo,
          oi1hAgo,
          oiChange15mPct,
          oiChange1hPct,
          timestamp: Date.now()
        };
      }
    } catch (err) {
      // Fail soft
    }
    return null;
  }
}
