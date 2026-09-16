import {
  AbsorptionAnalysis,
  CandleData,
  Direction,
  IndicatorState,
  OrderbookSnapshot,
  TradeData,
  VWAPAnalysis
} from '../data/types.js';
import { CircularBuffer } from '../data/circular-buffer.js';

/**
 * Detects effort-versus-result absorption proxies from recent trades and the
 * latest closed candle. This does not claim iceberg-order detection.
 */
export class AbsorptionEngine {
  analyze(
    direction: Direction,
    tickerPrice: number,
    indicators: IndicatorState,
    candles15m: CircularBuffer<CandleData> | undefined,
    trades: TradeData[],
    orderbook: OrderbookSnapshot | null,
    vwapAnalysis: VWAPAnalysis | null
  ): AbsorptionAnalysis {
    const noSignal = (evidence: string[] = []): AbsorptionAnalysis => ({
      event: 'ABSORPTION_UNCONFIRMED',
      confidence: 0,
      aggressiveSellRatio: 0,
      aggressiveBuyRatio: 0,
      volumeRatio: indicators.volumeRatio['15'] ?? null,
      rejectionWickPercent: null,
      location: 'UNCONFIRMED',
      evidence
    });

    if (!Number.isFinite(tickerPrice) || !candles15m || candles15m.size === 0 || trades.length < 5) {
      return noSignal(['Insufficient candle or trade-flow data']);
    }

    const candle = candles15m.latest();
    if (!candle || candle.high <= candle.low) {
      return noSignal(['Invalid latest candle range']);
    }

    const totalVolume = trades.reduce((sum, trade) => sum + Math.max(0, trade.price * trade.size), 0);
    if (totalVolume <= 0) return noSignal(['No measurable trade notional']);

    const sellNotional = trades
      .filter((trade) => trade.side === 'Sell')
      .reduce((sum, trade) => sum + Math.max(0, trade.price * trade.size), 0);
    const buyNotional = totalVolume - sellNotional;
    const sellRatio = sellNotional / totalVolume;
    const buyRatio = buyNotional / totalVolume;
    const volumeRatio = indicators.volumeRatio['15'];

    const range = candle.high - candle.low;
    const body = Math.abs(candle.close - candle.open);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const rejectionWickPercent = Math.max(lowerWick, upperWick) / range;
    const compactBody = body / range <= 0.55;
    const volumeConfirmed = volumeRatio !== null && volumeRatio >= 1.8;

    const sessionVwap = vwapAnalysis?.sessionVwap;
    const atr = indicators.atr14['15'] ?? tickerPrice * 0.015;
    const nearVwap = sessionVwap?.vwap !== null && sessionVwap?.vwap !== undefined &&
      Math.abs(tickerPrice - sessionVwap.vwap) <= Math.max(atr * 0.75, tickerPrice * 0.002);
    const nearLowerBand = sessionVwap?.lowerBand1 !== null && sessionVwap?.lowerBand1 !== undefined &&
      Math.abs(tickerPrice - sessionVwap.lowerBand1) <= Math.max(atr * 0.75, tickerPrice * 0.002);
    const nearUpperBand = sessionVwap?.upperBand1 !== null && sessionVwap?.upperBand1 !== undefined &&
      Math.abs(tickerPrice - sessionVwap.upperBand1) <= Math.max(atr * 0.75, tickerPrice * 0.002);

    const bidDepth = orderbook?.bids.slice(0, 15).reduce((sum, level) => sum + level.price * level.size, 0) ?? 0;
    const askDepth = orderbook?.asks.slice(0, 15).reduce((sum, level) => sum + level.price * level.size, 0) ?? 0;
    const imbalance = askDepth > 0 ? bidDepth / askDepth : null;

    const bullishLocation = (nearVwap || nearLowerBand) && tickerPrice <= (sessionVwap?.vwap ?? tickerPrice);
    const bearishLocation = (nearVwap || nearUpperBand) && tickerPrice >= (sessionVwap?.vwap ?? tickerPrice);
    const bullishBook = imbalance !== null && imbalance >= 1.5;
    const bearishBook = imbalance !== null && imbalance <= 0.67;
    const bullish = direction === 'LONG' && sellRatio >= 0.60 && lowerWick / range >= 0.35 &&
      compactBody && volumeConfirmed && bullishLocation && bullishBook;
    const bearish = direction === 'SHORT' && buyRatio >= 0.60 && upperWick / range >= 0.35 &&
      compactBody && volumeConfirmed && bearishLocation && bearishBook;

    const location = bullishLocation ? 'VWAP_SUPPORT' : bearishLocation ? 'VWAP_RESISTANCE' : 'UNCONFIRMED';
    const evidence = [
      `${(direction === 'LONG' ? sellRatio : buyRatio * 100).toFixed(0)}% aggressive ${direction === 'LONG' ? 'sell' : 'buy'} flow`,
      `rejection wick ${(rejectionWickPercent * 100).toFixed(0)}%`,
      `volume ${volumeRatio === null ? 'N/A' : `${volumeRatio.toFixed(1)}x SMA`}`,
      `VWAP location ${location}`
    ];

    if (!bullish && !bearish) {
      return {
        event: 'ABSORPTION_UNCONFIRMED',
        confidence: 0,
        aggressiveSellRatio: sellRatio,
        aggressiveBuyRatio: buyRatio,
        volumeRatio,
        rejectionWickPercent,
        location,
        evidence
      };
    }

    return {
      event: bullish ? 'BULLISH_ABSORPTION' : 'BEARISH_ABSORPTION',
      confidence: 80,
      aggressiveSellRatio: sellRatio,
      aggressiveBuyRatio: buyRatio,
      volumeRatio,
      rejectionWickPercent,
      location,
      trappedSide: bullish ? 'SHORT_SELLERS' : 'LONG_BUYERS',
      evidence
    };
  }
}
