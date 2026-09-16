import { IndicatorState, Timeframe, CandleData, TIMEFRAMES } from '../data/types.js';
import { CircularBuffer, NumericRingBuffer } from '../data/circular-buffer.js';
import { trueRange } from '../utils/math.js';
import { CONFIG } from '../config.js';
import { AnchoredVWAPEngine } from './anchored-vwap.js';

export class IncrementalEMA {
  private alpha: number;
  private value: number | null = null;
  private count: number = 0;
  private sum: number = 0;

  constructor(public readonly period: number) {
    this.alpha = 2 / (period + 1);
  }

  update(price: number): number | null {
    this.count++;
    if (this.value === null) {
      this.sum += price;
      if (this.count === this.period) {
        this.value = this.sum / this.period;
      }
      return this.value;
    }
    this.value = (price - this.value) * this.alpha + this.value;
    return this.value;
  }

  getObservationCount(): number {
    return this.count;
  }

  getValue(): number | null {
    return this.value;
  }

  reset(): void {
    this.value = null;
    this.count = 0;
    this.sum = 0;
  }
}

export class IncrementalATR {
  private value: number | null = null;
  private count: number = 0;
  private sum: number = 0;
  private prevClose: number | null = null;

  constructor(public readonly period: number = 14) {}

  update(high: number, low: number, close: number): number | null {
    if (this.prevClose === null) {
      this.prevClose = close;
      return null;
    }
    
    this.count++;
    const tr = trueRange(high, low, this.prevClose);
    this.prevClose = close;

    if (this.value === null) {
      this.sum += tr;
      if (this.count === this.period) {
        this.value = this.sum / this.period;
      }
      return this.value;
    }

    this.value = (this.value * (this.period - 1) + tr) / this.period;
    return this.value;
  }

  getObservationCount(): number {
    return this.count;
  }

  getValue(): number | null {
    return this.value;
  }
}

export class IncrementalRSI {
  private avgGain: number = 0;
  private avgLoss: number = 0;
  private prevPrice: number | null = null;
  private count: number = 0;
  private value: number | null = null;
  private sumGain: number = 0;
  private sumLoss: number = 0;

  constructor(public readonly period: number = 14) {}

  update(price: number): number | null {
    if (this.prevPrice === null) {
      this.prevPrice = price;
      return null;
    }

    this.count++;
    const change = price - this.prevPrice;
    this.prevPrice = price;

    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (this.count <= this.period) {
      this.sumGain += gain;
      this.sumLoss += loss;
      if (this.count === this.period) {
        this.avgGain = this.sumGain / this.period;
        this.avgLoss = this.sumLoss / this.period;
        this.value = this.avgLoss === 0 ? 100 : 100 - (100 / (1 + this.avgGain / this.avgLoss));
      }
      return this.value;
    }

    this.avgGain = (this.avgGain * (this.period - 1) + gain) / this.period;
    this.avgLoss = (this.avgLoss * (this.period - 1) + loss) / this.period;

    if (this.avgLoss === 0) {
      this.value = 100;
    } else {
      const rs = this.avgGain / this.avgLoss;
      this.value = 100 - (100 / (1 + rs));
    }
    return this.value;
  }

  getObservationCount(): number {
    return this.count;
  }

  getValue(): number | null {
    return this.value;
  }
}

export class IncrementalVWAP {
  private sumPriceVolume: number = 0;
  private sumVolume: number = 0;

  constructor() {}

  update(price: number, volume: number): number | null {
    if (volume === 0) return this.getValue();
    this.sumPriceVolume += price * volume;
    this.sumVolume += volume;
    return this.sumPriceVolume / this.sumVolume;
  }

  getValue(): number | null {
    if (this.sumVolume === 0) return null;
    return this.sumPriceVolume / this.sumVolume;
  }

  reset(): void {
    this.sumPriceVolume = 0;
    this.sumVolume = 0;
  }
}

export class ROCCalculator {
  private buffer: CircularBuffer<number>;
  private value: number | null = null;

  constructor(public readonly period: number) {
    this.buffer = new CircularBuffer(period + 1);
  }

  update(price: number): number | null {
    this.buffer.push(price);
    if (this.buffer.size <= this.period) return null;
    
    const pastPrice = this.buffer.oldest()!;
    if (pastPrice === 0) return null;
    
    this.value = ((price - pastPrice) / pastPrice) * 100;
    return this.value;
  }

  getValue(): number | null {
    return this.value;
  }
}

export class IncrementalSMA {
  private buffer: NumericRingBuffer;

  constructor(public readonly period: number) {
    this.buffer = new NumericRingBuffer(period);
  }

  update(value: number): number | null {
    this.buffer.push(value);
    if (this.buffer.size < this.period) return null;
    return this.buffer.mean();
  }

  getValue(): number | null {
    if (this.buffer.size < this.period) return null;
    return this.buffer.mean();
  }
}

export class SymbolIndicators {
  public readonly ema9: Map<Timeframe, IncrementalEMA> = new Map();
  public readonly ema21: Map<Timeframe, IncrementalEMA> = new Map();
  public readonly ema50: Map<Timeframe, IncrementalEMA> = new Map();
  public readonly atr14: Map<Timeframe, IncrementalATR> = new Map();
  public readonly rsi14: Map<Timeframe, IncrementalRSI> = new Map();
  public readonly roc5: Map<Timeframe, ROCCalculator> = new Map();
  public readonly roc14: Map<Timeframe, ROCCalculator> = new Map();
  public readonly vwap: Map<Timeframe, IncrementalVWAP> = new Map();
  public readonly volumeSma20: Map<Timeframe, IncrementalSMA> = new Map();
  public readonly candleBuffers: Map<Timeframe, CircularBuffer<CandleData>> = new Map();
  private anchoredVwapEngine = new AnchoredVWAPEngine();

  private lastUpdate: number = 0;
  private currentVolume: Map<Timeframe, number> = new Map();
  private lastClose: Map<Timeframe, number> = new Map();

  constructor() {
    for (const tf of TIMEFRAMES) {
      this.ema9.set(tf, new IncrementalEMA(CONFIG.EMA_FAST));
      this.ema21.set(tf, new IncrementalEMA(CONFIG.EMA_MID));
      this.ema50.set(tf, new IncrementalEMA(CONFIG.EMA_SLOW));
      this.atr14.set(tf, new IncrementalATR(CONFIG.ATR_PERIOD));
      this.rsi14.set(tf, new IncrementalRSI(CONFIG.RSI_PERIOD));
      this.roc5.set(tf, new ROCCalculator(CONFIG.ROC_FAST));
      this.roc14.set(tf, new ROCCalculator(CONFIG.ROC_SLOW));
      this.vwap.set(tf, new IncrementalVWAP());
      this.volumeSma20.set(tf, new IncrementalSMA(CONFIG.VOLUME_SMA_PERIOD));
      this.candleBuffers.set(tf, new CircularBuffer<CandleData>(CONFIG.KLINE_HISTORY_LIMIT));
      this.currentVolume.set(tf, 0);
      this.lastClose.set(tf, 0);
    }
  }

  updateFromCandle(timeframe: Timeframe, candle: CandleData): IndicatorState {
    const { close, high, low, volume, timestamp } = candle;
    
    this.candleBuffers.get(timeframe)?.push(candle);
    this.ema9.get(timeframe)!.update(close);
    this.ema21.get(timeframe)!.update(close);
    this.ema50.get(timeframe)!.update(close);
    this.atr14.get(timeframe)!.update(high, low, close);
    this.rsi14.get(timeframe)!.update(close);
    this.roc5.get(timeframe)!.update(close);
    this.roc14.get(timeframe)!.update(close);
    
    const typicalPrice = (high + low + close) / 3;
    this.vwap.get(timeframe)!.update(typicalPrice, volume);
    this.volumeSma20.get(timeframe)!.update(volume);

    this.currentVolume.set(timeframe, volume);
    this.lastClose.set(timeframe, close);

    if (timestamp > this.lastUpdate) {
      this.lastUpdate = timestamp;
    }
    return this.getState();
  }

  getState(): IndicatorState {
    const state: IndicatorState = {
      ema9: { '5': null, '15': null, '60': null },
      ema21: { '5': null, '15': null, '60': null },
      ema50: { '5': null, '15': null, '60': null },
      atr14: { '5': null, '15': null, '60': null },
      atrPercent: { '5': null, '15': null, '60': null },
      rsi14: { '5': null, '15': null, '60': null },
      roc5: { '5': null, '15': null, '60': null },
      roc14: { '5': null, '15': null, '60': null },
      vwap: { '5': null, '15': null, '60': null },
      volumeSma20: { '5': null, '15': null, '60': null },
      volumeRatio: { '5': null, '15': null, '60': null },
      lastUpdate: this.lastUpdate
    };

    for (const tf of TIMEFRAMES) {
      state.ema9[tf] = this.ema9.get(tf)!.getValue();
      state.ema21[tf] = this.ema21.get(tf)!.getValue();
      state.ema50[tf] = this.ema50.get(tf)!.getValue();
      const atr = this.atr14.get(tf)!.getValue();
      state.atr14[tf] = atr;
      state.rsi14[tf] = this.rsi14.get(tf)!.getValue();
      state.roc5[tf] = this.roc5.get(tf)!.getValue();
      state.roc14[tf] = this.roc14.get(tf)!.getValue();
      state.vwap[tf] = this.vwap.get(tf)!.getValue();
      const volSma = this.volumeSma20.get(tf)!.getValue();
      state.volumeSma20[tf] = volSma;
      
      const close = this.lastClose.get(tf) || 0;
      if (atr !== null && close > 0) {
        state.atrPercent[tf] = (atr / close) * 100;
      }
      
      const vol = this.currentVolume.get(tf) || 0;
      if (volSma !== null && volSma > 0) {
        state.volumeRatio[tf] = vol / volSma;
      }
    }

    // Compute Multi-Anchor Institutional VWAP (Session, Weekly, Monthly)
    const c15 = this.candleBuffers.get('15')?.toArray() || [];
    const c5 = this.candleBuffers.get('5')?.toArray() || [];
    const c60 = this.candleBuffers.get('60')?.toArray() || [];

    const sessionCandles = c15.length > 0 ? c15 : c5;
    state.sessionVwap = this.anchoredVwapEngine.computeSessionVWAP(sessionCandles);
    state.weeklyVwap = this.anchoredVwapEngine.computeWeeklyVWAP(c60);
    state.monthlyVwap = this.anchoredVwapEngine.computeMonthlyVWAP(c60);

    // Synchronize state.vwap for backwards compatibility
    if (state.sessionVwap?.vwap !== null && state.sessionVwap?.vwap !== undefined) {
      state.vwap['5'] = state.sessionVwap.vwap;
      state.vwap['15'] = state.sessionVwap.vwap;
    }
    if (state.weeklyVwap?.vwap !== null && state.weeklyVwap?.vwap !== undefined) {
      state.vwap['60'] = state.weeklyVwap.vwap;
    }

    return state;
  }

  getObservationCount(timeframe: Timeframe): number {
    return this.ema9.get(timeframe)?.getObservationCount() ?? 0;
  }
}
