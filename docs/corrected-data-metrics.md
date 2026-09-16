# Corrected Data Metrics & Ingestion Semantics

## 1. Executive Summary
This document defines the mathematical models, sampling windows, buffer architectures, and normalization methods implemented across the USDT Perpetual Screener codebase. All placeholder metrics and synthetic fallbacks have been completely eliminated in favor of real, timestamp-audited market data streams.

---

## 2. Metric Specifications & Calculation Formulas

### 2.1 5-Minute and 1-Hour Rolling Price Returns
* **Storage Buffer:** `TimestampedPriceRingBuffer` (Zero-GC, flat typed arrays `Float64Array` for timestamps and prices).
* **Sampling Principle:** For a target window $W$ (where $W_{5\text{m}} = 300,000\,\text{ms}$, $W_{1\text{h}} = 3,600,000\,\text{ms}$) at query time $T_{\text{now}}$, the engine queries the observation nearest to $T_{\text{target}} = T_{\text{now}} - W$ within an allowable tolerance $\delta = 0.35 \times W$.
* **Formula:**
  $$\text{Return}_W = \frac{P(T_{\text{now}}) - P(T_{\text{ref}})}{P(T_{\text{ref}})}$$
  Where $T_{\text{ref}} = \arg\min_t |t - T_{\text{target}}|$, subject to $|T_{\text{ref}} - T_{\text{target}}| \le \delta$.
* **Missing Data Policy:** Returns `null` if buffer contains zero entries within the tolerance window or history span is insufficient.

### 2.2 Volume Acceleration
* **Formula:**
  $$\text{VolAcceleration} = \frac{\text{Observed Hourly Rate}}{\text{24h Hourly Baseline}} = \frac{V_{\text{last\_hour}}}{V_{\text{24h}} / 24}$$
* **Missing Data Policy:** If 1h volume is not observed, returns `null` (strictly never returns fake `1.0`).

### 2.3 Universe and Sector Relative Strength
* **Universe Baseline Return:**
  $$R_{\text{universe}}(W) = \frac{1}{N} \sum_{i=1}^N R_i(W)$$
  Calculated across all actively trading USDT perpetual contracts with valid $W$-window histories.
* **Sector Baseline Return:**
  $$R_{\text{sector}}(W) = \frac{1}{|S|} \sum_{s \in S} R_s(W)$$
  Calculated across constituent tokens in categorized groups (`L1`, `L2`, `DEFI`, `AI`, `MEME`, `GAMING`, `INFRA`, `EXCHANGE`, `RWA`, `ORACLE`).
* **Excess Return (Relative Strength):**
  $$\text{RS}_{\text{benchmark}} = R_{\text{symbol}}(W) - R_{\text{benchmark}}(W)$$
* **Missing Sector Policy:** If a token belongs to `OTHER` or has fewer than 2 active sector peers, $\text{RS}_{\text{sector}}$ is assigned `null`, and scoring available weight is dynamically scaled without punishing the candidate.

### 2.4 Funding Rate History & Percentile
* **Storage Buffer:** `TimestampedNumericRingBuffer` storing historical 8-hour funding settlements.
* **Percentile Rank Formula:**
  $$\text{Percentile}(F_{\text{current}}) = \frac{\sum_{i=1}^M \mathbf{1}_{\{F_i \le F_{\text{current}}\}}}{M} \times 100$$
* **Policy:** Only computed if historical settlements $M \ge 3$; otherwise returns `null`.

### 2.5 Long/Short Account Ratio
* **Source:** Real periodic Bybit Linear API snapshots (`/v5/market/account-ratio`).
* **Policy:** Cached with timestamp; if unobserved, returns `null` (no default `1.0`).

### 2.6 Direction-Aware VWAP Slippage
* **Book Traversal:**
  * **LONG Orders:** Traverses `orderbook.asks` from Best Ask upwards until cumulative notional $\sum P_i Q_i \ge \text{TargetNotional}$ ($10,000 USD).
  * **SHORT Orders:** Traverses `orderbook.bids` from Best Bid downwards until cumulative notional fills.
* **Effective Fill Price:**
  $$P_{\text{VWAP}} = \frac{\sum_{k=1}^m P_k \cdot \Delta q_k}{\sum_{k=1}^m \Delta q_k}$$
* **Slippage Formula (bps):**
  $$\text{Slippage}_{\text{bps}} = \frac{|P_{\text{VWAP}} - P_{\text{mid}}|}{P_{\text{mid}}} \times 10,000$$

### 2.7 Confirmed Swing Pivot Points (Market Structure)
* **Pivot High:** Bar $i$ where $H_i > \max(H_{i-k}, \dots, H_{i-1})$ and $H_i \ge \max(H_{i+1}, \dots, H_{i+k})$.
* **Pivot Low:** Bar $i$ where $L_i < \min(L_{i-k}, \dots, L_{i-1})$ and $L_i \le \min(L_{i+1}, \dots, L_{i+k})$.
* **Lookahead Bias Prevention:** Only closed bars with full $k$-right confirmation are evaluated as structural pivots.

### 2.8 Realized Volatility
* **Formula:**
  $$\sigma_{\text{realized}} = \sqrt{\frac{1}{K-1} \sum_{t=1}^K (r_t - \bar{r})^2}, \quad r_t = \ln(P_t / P_{t-1})$$
  Computed over 15m closed BTC candle returns.
