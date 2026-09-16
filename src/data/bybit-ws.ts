// ============================================================
// Bybit V5 Linear WebSocket Client with Connection Pool & Resilience
// ============================================================

import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';
import { TickerData, CandleData, OrderbookSnapshot, TradeData, LiquidationData } from './types.js';

interface WSConnection {
  ws: WebSocket;
  id: number;
  topics: Set<string>;
  connected: boolean;
  reconnecting: boolean;
  reconnectAttempts: number;
  pingInterval?: NodeJS.Timeout;
}

export class BybitWebSocket extends EventEmitter {
  private connections: WSConnection[] = [];
  private log = logger.child('BybitWS');
  private topicToConn = new Map<string, number>();

  constructor() {
    super();
  }

  private createConnection(id: number): WSConnection {
    const conn: WSConnection = {
      ws: new WebSocket(CONFIG.BYBIT_WS_URL, { perMessageDeflate: false }),
      id,
      topics: new Set(),
      connected: false,
      reconnecting: false,
      reconnectAttempts: 0
    };

    conn.ws.on('open', () => {
      this.log.info(`Connection ${id} opened.`);
      conn.connected = true;
      conn.reconnecting = false;
      conn.reconnectAttempts = 0;

      conn.pingInterval = setInterval(() => {
        if (conn.connected && conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(JSON.stringify({ op: 'ping' }));
        }
      }, CONFIG.WS_PING_INTERVAL_MS);

      if (conn.topics.size > 0) {
        this.sendSubscribeBatch(conn, Array.from(conn.topics));
      }
    });

    conn.ws.on('message', (data: Buffer) => {
      this.handleMessage(conn, data);
    });

    conn.ws.on('close', (code, reason) => {
      this.log.warn(`Connection ${id} closed. Code: ${code}`);
      conn.connected = false;
      if (conn.pingInterval) clearInterval(conn.pingInterval);
      this.reconnect(conn);
    });

    conn.ws.on('error', (err) => {
      this.log.error(`Connection ${id} error`, { error: String(err) });
    });

    return conn;
  }

  private reconnect(conn: WSConnection) {
    if (conn.reconnecting) return;
    conn.reconnecting = true;
    conn.reconnectAttempts++;
    
    // Exponential backoff with bounded jitter
    const backoff = Math.min(CONFIG.WS_RECONNECT_MAX_MS, CONFIG.WS_RECONNECT_BASE_MS * Math.pow(1.5, Math.min(6, conn.reconnectAttempts)));
    const jitter = Math.random() * 500;
    const delay = backoff + jitter;

    setTimeout(() => {
      this.log.info(`Reconnecting conn ${conn.id} (attempt ${conn.reconnectAttempts})...`);
      const newConn = this.createConnection(conn.id);
      newConn.topics = new Set(conn.topics);
      newConn.reconnectAttempts = conn.reconnectAttempts;
      this.connections[conn.id] = newConn;
    }, delay);
  }

  private sendSubscribeBatch(conn: WSConnection, topics: string[]) {
    for (let i = 0; i < topics.length; i += CONFIG.WS_SUBSCRIBE_BATCH_SIZE) {
      const batch = topics.slice(i, i + CONFIG.WS_SUBSCRIBE_BATCH_SIZE);
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify({ op: 'subscribe', args: batch }));
      }
    }
  }

  private sendUnsubscribeBatch(conn: WSConnection, topics: string[]) {
    for (let i = 0; i < topics.length; i += CONFIG.WS_SUBSCRIBE_BATCH_SIZE) {
      const batch = topics.slice(i, i + CONFIG.WS_SUBSCRIBE_BATCH_SIZE);
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify({ op: 'unsubscribe', args: batch }));
      }
    }
  }

  subscribe(topics: string[]) {
    for (const topic of topics) {
      if (this.topicToConn.has(topic)) continue;

      let targetConn = this.connections.find(c => c.topics.size < CONFIG.WS_MAX_TOPICS_PER_CONN);
      if (!targetConn) {
        if (this.connections.length >= CONFIG.WS_MAX_CONNECTIONS) {
          this.log.error('Max connections reached, cannot subscribe to more topics');
          continue;
        }
        targetConn = this.createConnection(this.connections.length);
        this.connections.push(targetConn);
      }

      targetConn.topics.add(topic);
      this.topicToConn.set(topic, targetConn.id);

      if (targetConn.connected && targetConn.ws.readyState === WebSocket.OPEN) {
        targetConn.ws.send(JSON.stringify({ op: 'subscribe', args: [topic] }));
      }
    }
  }

  unsubscribe(topics: string[]) {
    const byConn = new Map<number, string[]>();
    for (const topic of topics) {
      const connId = this.topicToConn.get(topic);
      if (connId !== undefined) {
        if (!byConn.has(connId)) byConn.set(connId, []);
        byConn.get(connId)!.push(topic);
        this.topicToConn.delete(topic);
      }
    }

    for (const [connId, t] of byConn.entries()) {
      const conn = this.connections[connId];
      if (conn) {
        for (const topic of t) conn.topics.delete(topic);
        if (conn.connected && conn.ws.readyState === WebSocket.OPEN) {
          this.sendUnsubscribeBatch(conn, t);
        }
      }
    }
  }
  
  subscribeCandidateStreams(symbols: string[]) {
    const topics: string[] = [];
    for (const s of symbols) {
      for (const tf of CONFIG.TIMEFRAMES) topics.push(`kline.${tf}.${s}`);
      topics.push(`orderbook.50.${s}`);
      topics.push(`publicTrade.${s}`);
      topics.push(`allLiquidation.${s}`);
    }
    this.subscribe(topics);
  }

  unsubscribeCandidateStreams(symbols: string[]) {
    const topics: string[] = [];
    for (const s of symbols) {
      for (const tf of CONFIG.TIMEFRAMES) topics.push(`kline.${tf}.${s}`);
      topics.push(`orderbook.50.${s}`);
      topics.push(`publicTrade.${s}`);
      topics.push(`allLiquidation.${s}`);
    }
    this.unsubscribe(topics);
  }

  private handleMessage(conn: WSConnection, data: Buffer) {
    try {
      const msg = JSON.parse(data.toString());
      if (!msg.topic) return;

      const { topic, type, data: msgData } = msg;

      if (topic.startsWith('tickers.')) {
        this.emit('ticker', this.parseTicker(msgData, type));
      } else if (topic.startsWith('kline.')) {
        const parts = topic.split('.');
        const timeframe = parts[1];
        const symbol = parts[2];
        for (const k of msgData) {
          this.emit('kline', symbol, timeframe, {
            timestamp: parseInt(k.start, 10),
            open: parseFloat(k.open),
            high: parseFloat(k.high),
            low: parseFloat(k.low),
            close: parseFloat(k.close),
            volume: parseFloat(k.volume),
            turnover: parseFloat(k.turnover),
            confirmed: k.confirm
          } as CandleData);
        }
      } else if (topic.startsWith('orderbook.')) {
        this.emit('orderbook', {
          symbol: msgData.s,
          bids: (msgData.b || []).map((b: string[]) => ({ price: parseFloat(b[0]), size: parseFloat(b[1]) })),
          asks: (msgData.a || []).map((a: string[]) => ({ price: parseFloat(a[0]), size: parseFloat(a[1]) })),
          timestamp: msg.ts,
          updateId: msgData.u,
          type
        } as OrderbookSnapshot & { type: string });
      } else if (topic.startsWith('publicTrade.')) {
        for (const t of msgData) {
          this.emit('trade', {
            timestamp: parseInt(t.T, 10),
            symbol: t.s,
            side: t.S,
            price: parseFloat(t.p),
            size: parseFloat(t.v)
          } as TradeData);
        }
      } else if (topic.startsWith('allLiquidation.')) {
        this.emit('liquidation', {
          timestamp: parseInt(msgData.T, 10),
          symbol: msgData.s,
          side: msgData.S,
          price: parseFloat(msgData.p),
          size: parseFloat(msgData.v)
        } as LiquidationData);
      }
    } catch (err) {
      this.log.error('WS parse error', { error: String(err) });
    }
  }

  private parseTicker(data: any, type: string): Partial<TickerData> & { symbol: string } {
    return {
      symbol: data.symbol,
      lastPrice: data.lastPrice ? parseFloat(data.lastPrice) : undefined,
      markPrice: data.markPrice ? parseFloat(data.markPrice) : undefined,
      indexPrice: data.indexPrice ? parseFloat(data.indexPrice) : undefined,
      bid1Price: data.bid1Price ? parseFloat(data.bid1Price) : undefined,
      bid1Size: data.bid1Size ? parseFloat(data.bid1Size) : undefined,
      ask1Price: data.ask1Price ? parseFloat(data.ask1Price) : undefined,
      ask1Size: data.ask1Size ? parseFloat(data.ask1Size) : undefined,
      highPrice24h: data.highPrice24h ? parseFloat(data.highPrice24h) : undefined,
      lowPrice24h: data.lowPrice24h ? parseFloat(data.lowPrice24h) : undefined,
      prevPrice24h: data.prevPrice24h ? parseFloat(data.prevPrice24h) : undefined,
      prevPrice1h: data.prevPrice1h ? parseFloat(data.prevPrice1h) : undefined,
      price24hPcnt: data.price24hPcnt ? parseFloat(data.price24hPcnt) : undefined,
      volume24h: data.volume24h ? parseFloat(data.volume24h) : undefined,
      turnover24h: data.turnover24h ? parseFloat(data.turnover24h) : undefined,
      openInterest: data.openInterest ? parseFloat(data.openInterest) : undefined,
      openInterestValue: data.openInterestValue ? parseFloat(data.openInterestValue) : undefined,
      fundingRate: data.fundingRate ? parseFloat(data.fundingRate) : undefined,
      nextFundingTime: data.nextFundingTime ? parseInt(data.nextFundingTime, 10) : undefined,
      timestamp: Date.now()
    };
  }

  public close() {
    for (const conn of this.connections) {
      if (conn.pingInterval) clearInterval(conn.pingInterval);
      conn.connected = false;
      try {
        conn.ws.removeAllListeners();
        conn.ws.terminate();
      } catch {}
    }
    this.connections = [];
    this.topicToConn.clear();
  }
}
