import { BybitRest } from './bybit-rest.js';
import { MarketDataHub } from './market-data-hub.js';
import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';
import { CandleTimeframe } from './types.js';

export class KlineLoader {
  private log = logger.child('KlineLoader');

  constructor(private rest: BybitRest, private hub: MarketDataHub) {}

  async loadInitialCandles(symbols: string[]) {
    this.log.info(`Loading historical klines for ${symbols.length} symbols...`);
    const allTimeframes = [...CONFIG.TIMEFRAMES, ...CONFIG.HIGHER_TIMEFRAMES];
    const totalCalls = symbols.length * allTimeframes.length;
    const estTimeSec = Math.ceil(totalCalls / CONFIG.REST_MAX_REQUESTS_PER_SECOND);
    this.log.info(`Estimated time to load: ${estTimeSec} seconds`);

    let completed = 0;
    
    const BATCH_SIZE = 5;
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(symbol => this.loadSymbolCandles(symbol)));
      
      completed += batch.length;
      if (completed % 20 === 0 || completed >= symbols.length) {
        this.log.info(`Loading candles: ${completed}/${symbols.length} symbols...`);
      }
    }
    
    this.log.info('Finished loading initial klines.');
  }

  async loadSymbolCandles(symbol: string) {
    try {
      const allTimeframes = [...CONFIG.TIMEFRAMES, ...CONFIG.HIGHER_TIMEFRAMES];
      await Promise.all(allTimeframes.map(async (tf: string) => {
        const timeframe = tf as CandleTimeframe;
        const candles = await this.rest.getKlines(symbol, timeframe, CONFIG.KLINE_HISTORY_LIMIT);
        for (const c of candles) {
          this.hub.updateCandle(symbol, timeframe, c);
        }
      }));
    } catch (err) {
      this.log.error(`Failed to load candles for ${symbol}`, { error: String(err) });
    }
  }
}
