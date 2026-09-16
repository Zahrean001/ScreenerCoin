# Baseline Performance Metrics (Pre-Correction)

## 1. System Measurement Snapshot

Date: August 31, 2026
Target Environment: Node.js / TypeScript ES2022 (Windows, Bybit V5 Linear USDT-Perpetuals)

| Metric | Baseline Value | Method / Source |
| :--- | :--- | :--- |
| **Universe Symbols Scanned** | 739 symbols | `GET /v5/market/instruments-info?category=linear` |
| **Stage 1 Scan Latency** | 1 ms | `Stage1Filter.filter()` over 739 tickers in-memory |
| **Stage 2 Scoring Latency** | 5 ms (15 candidates) | `Stage2Signal.analyzeCandidate()` |
| **Stage 3 Execution Latency** | < 1 ms (embedded in Stage 2) | `Stage3Execution.analyze()` |
| **Total Pipeline Latency** | 6 - 12 ms | Full scan cycle from Stage 1 to Final Ranking |
| **Stage 1 Candidates Generated** | 60 candidates (capped) | `CONFIG.MAX_CANDIDATES` |
| **Deep Candidates Processed** | 15 candidates | `CONFIG.MAX_DEEP_CANDIDATES` |
| **Active WebSocket Connections** | 2 sharded sockets | `BybitWebSocket` (450 topics/connection) |
| **Active WebSocket Topics** | 739 ticker streams | `tickers.{symbol}` for all linear symbols |
| **REST Calls Per Live Scan** | 0 calls during fast loop | Ingested via WebSocket cache; candles preloaded |
| **Orderbook Calls Per Scan** | 0 REST (WS cached L2 orderbook) | Streamed via `orderbook.50.{symbol}` for candidates |

---

## 2. Identified Semantic & Pipeline Issues (To Be Corrected)

1. **`priceChange5m`**: Was using `pctChange(ticker.lastPrice, prevTicker.lastPrice)` where `prevTicker` is merely the previous WebSocket tick (~100ms), NOT 5 minutes.
2. **`priceChange1h`**: Relied on `ticker.prevPrice1h` without explicit timestamp verification metadata (`sourceTimestamp`, `referenceTimestamp`).
3. **`volumeAcceleration`**: Contained `const volumeAcceleration = 1.0;` placeholder in `stage1-filter.ts`.
4. **Relative Strength (RS / RW)**: Passed empty arrays `[]` for `sectorPriceHistories` and `universePriceHistories` in `stage2-signal.ts`, causing `vsSector` and `vsUniverse` to degrade to raw symbol return.
5. **Funding Rate History**: Used single-element array `[ticker.fundingRate]` instead of true rolling funding rate history.
6. **Long/Short Ratio**: Returned placeholder `1.0` instead of real cached exchange ratio or explicit `null`.
7. **Slippage Score**: Contained `slippageScore = 15; // Placeholder` in `stage3-execution.ts`.
8. **Direction-Aware Execution**: Treated bid and ask depth symmetrically rather than evaluating asks for LONG and bids for SHORT with VWAP multi-level fill simulation.
9. **Market Regime Volatility**: Hardcoded `btcVolatility: VolatilityRegime.NORMAL` placeholder in `market-regime.ts`.
10. **Market Structure**: Returned `structures: []` in `estimateStructure()`, leaving downstream swing logic unconfirmed.
11. **Missing Data Handling**: Lacked explicit `dataCompleteness` and `availableWeight` tracking.
12. **Hot Queue Deduplication**: Replaced events on symbol collision instead of aggregating trigger history (`triggers: []`, `firstSeen`, `latestSeen`, `maxPriority`).
13. **WebSocket Reconnect State**: Shared global boolean `reconnecting` across all sharded connections instead of per-connection tracking.
