# Production Scoring Model & Completeness-Aware Normalization

## 1. Overview
The screener evaluates market candidates through asymmetric, independent LONG and SHORT scoring pipelines. Missing data points do not receive arbitrary placeholder scores; instead, the system tracks explicit `dataCompleteness` and normalizes raw scores against observed `availableWeight`.

---

## 2. Score Component Breakdown

| Component | Max Weight | Long Evaluation Criteria | Short Evaluation Criteria |
| :--- | :---: | :--- | :--- |
| **Trend & Structure** | 20 | EMA9 > EMA21 > EMA50 stack, multi-TF agreement (5m/15m/60m), confirmed HH+HL pivots | EMA9 < EMA21 < EMA50 stack, multi-TF agreement, confirmed LH+LL pivots |
| **Momentum** | 15 | RSI in 52–68 sweet-spot, positive accelerating ROC, Price > VWAP | RSI in 32–48 sweet-spot, negative accelerating ROC, Price < VWAP |
| **Relative Strength / Weakness** | 15 | Positive excess return vs BTC, ETH, Sector, and Universe | Negative excess return vs BTC, ETH, Sector, and Universe |
| **Volume Expansion** | 15 | Volume ratio > 1.5x–2.5x with buyer dominance (positive 24h delta) | Volume ratio > 1.5x–2.5x with seller dominance (negative 24h delta) |
| **Open Interest Dynamic** | 10 | Rising OI + Rising Price (`LONG_BUILD`) or Falling OI + Falling Price (`SHORT_COVERING`) | Rising OI + Falling Price (`SHORT_BUILD`) or Falling OI + Rising Price (`LONG_LIQUIDATION`) |
| **Funding Context** | 10 | Negative to neutral funding (room to run; shorts paying longs) | High positive funding (crowded longs; longs paying shorts) |
| **Orderbook Microstructure** | 10 | Bid depth dominance (Bid Depth > 1.5x Ask Depth) | Ask depth dominance (Ask Depth > 1.5x Bid Depth) |
| **Liquidation Pressure** | 5 | Short liquidations cascading | Long liquidations cascading |

---

## 3. Completeness-Aware Score Normalization

### 3.1 Mathematical Formula
$$\text{RawScore} = \sum_{k \in \mathcal{K}_{\text{observed}}} S_k$$
$$\text{AvailableWeight} = \sum_{k \in \mathcal{K}_{\text{observed}}} W_k$$
$$\text{DataCompleteness} = \frac{\text{AvailableWeight}}{\text{MaxPossibleWeight}} = \frac{\text{AvailableWeight}}{100}$$
$$\text{NormalizedScore} = \begin{cases} \min\left(100, \frac{\text{RawScore}}{\text{AvailableWeight}} \times 100\right), & \text{if } \text{AvailableWeight} > 0 \\ 0, & \text{if } \text{AvailableWeight} = 0 \end{cases}$$

### 3.2 Modifiers
$$\text{FinalScore} = \text{clamp}\Big(0, 100, \text{NormalizedScore} \times M_{\text{Regime}} + \Delta S_{\text{Breakout}} + \Delta S_{\text{Squeeze}} - \Delta S_{\text{Exhaustion}}\Big)$$

---

## 4. Direction-Aware Execution Quality (Stage 3)

| Metric | Range | Good | OK | Poor |
| :--- | :---: | :--- | :--- | :--- |
| **Spread** | 0–20 pts | $\le 3\,\text{bps}$ (20 pts) | $\le 8\,\text{bps}$ (14 pts) | $> 15\,\text{bps}$ (2 pts) |
| **Book Depth** | 0–40 pts | $\ge \$200\text{K}$ on executed side (40 pts) | $\ge \$50\text{K}$ (24 pts) | $<\$20\text{K}$ (8 pts) |
| **VWAP Slippage** | 0–25 pts | $\le 5\,\text{bps}$ for $\$10\text{K}$ order (25 pts) | $\le 12\,\text{bps}$ (16 pts) | $> 30\,\text{bps}$ (2 pts) |
| **Trade Frequency** | 0–15 pts | $\ge 60\,\text{trades/min}$ (15 pts) | $\ge 20\,\text{trades/min}$ (10 pts) | $< 5\,\text{trades/min}$ (2 pts) |

$$\text{CompositeScore} = 0.75 \times \text{OpportunityScore} + 0.25 \times \text{ExecutionScore}$$
