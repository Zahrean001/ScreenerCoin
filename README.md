# Trade Screener Coin v2.1.2

Read-only multi-exchange crypto market screener with **Bybit USDT
perpetuals as the primary venue** and a limited **Binance confirmation layer**.

Copyright (c) 2026 Zahrean001. All rights reserved.

This bot helps users discover coins that may deserve further review by
combining unusual activity, liquidity, momentum, market structure, capital
flow, relative strength, multi-timeframe context, VWAP levels, orderbook
imbalance, absorption-style orderflow confirmation, and higher-timeframe
macro context. Bybit supplies the primary scan and directional bias. Binance
is queried only for a bounded set of top candidates to check whether the same
short-window move is also visible on Binance Futures and Binance Spot.

> **Important:** This is a discovery and ranking tool, not an auto-trading bot.
> It does not place orders, manage positions, or guarantee profits. Every
> signal must be independently reviewed before any trading decision.

## License and usage rights

This is a proprietary source-available project. The source is public for
inspection and personal, non-commercial evaluation only. Copying,
redistribution, modification, commercial use, re-hosting, or publishing
derived versions requires prior written permission from Zahrean001.

See [LICENSE](LICENSE) for the complete terms. The project is not released
under an open-source license.

## What the bot is for

The screener answers questions such as:

- Which coins are showing unusual activity?
- Is the move supported by open interest, funding, and capital flow?
- Is the coin outperforming or underperforming BTC and its sector?
- Is the move early, developing, mature, or already late?
- Is there evidence of support, resistance, a squeeze, or absorption?
- Which candidates deserve priority for further analysis?

The output is intended to produce a **shortlist of potential opportunities**.
It is not a complete entry plan and does not provide guaranteed entry, stop
loss, take profit, or leverage instructions.

## Exchange architecture

The scanner uses a deliberate two-layer design:

1. **Bybit primary scan:** scans the Bybit linear USDT perpetual universe,
   performs the full liquidity, structure, flow, HTF, timing, freshness, and
   ranking analysis, and remains the source of the primary LONG/SHORT bias.
2. **Binance deep confirmation:** checks only selected Stage 2 candidates.
   It compares matched 15m Binance Futures and Spot returns and recent 15m
   open-interest history when available. Binance can adjust ranking within a
   strict cap, but it can never reverse the Bybit bias.

Binance is not a replacement for Bybit, an execution venue, or proof of whale
activity. If Binance is unavailable, stale, unmapped, or times out, the
scanner continues with Bybit-only analysis and applies no external modifier.
No Binance API key is required because the confirmation layer uses public
market-data endpoints.

## Main features

- Bybit USDT perpetual market scanning
- Liquidity and spread filtering
- Multi-timeframe analysis using 5m, 15m, and 1h data
- Higher-timeframe context using 4h and 1d candles:
  - `MACRO_ALIGNED`
  - `EARLY_MACRO_ROTATION`
  - `COUNTER_TREND`
  - `HTF_NEUTRAL`
  - incomplete-history warnings
- Open interest and funding-flow classification:
  `LONG_BUILD`, `SHORT_BUILD`, `SHORT_COVERING`, and `LONG_LIQUIDATION`
- Decoupled alpha detection for strong coins that outperform BTC
- Squeeze and flush event classification
- Session, weekly, and monthly VWAP with deviation bands
- Orderbook bid/ask imbalance confirmation
- Absorption orderflow proxy:
  - `BULLISH_ABSORPTION`
  - `BEARISH_ABSORPTION`
  - `ABSORPTION_UNCONFIRMED`
- Early, base, pullback, continuation, and late-mover discovery labels
- Ranked results separated into actionable review and watchlist candidates
- Rate-limit retry with backoff for Bybit public REST requests
- End-to-end scan latency and signal freshness reporting
- Fail-safe freshness gates that block stale data from `ACTIONABLE_NOW`
- Binance deep confirmation for selected candidates using matched 15m futures
  and spot returns, recent 15m open-interest deltas, deterministic symbol
  mapping, capped modifiers, and fail-open timeout/error handling
- Simplified terminal dashboard with separate `ACTIONABLE NOW`, `WATCHLIST`,
  `AVOID / QUARANTINED`, and `DATA QUALITY` sections
- Human-readable candidate cards with setup gauges, timing guidance, VWAP and
  capital-flow explanations, formatted prices/volumes, and exchange status
- JSON and signal-log output paths configurable through `.env`

## Requirements

- Windows
- Node.js **LTS** (Node.js 20 or newer recommended)
- Internet connection
- No Bybit API key is required for the current public market-data endpoints

## Installation from GitHub ZIP

### 1. Download the project

On the GitHub repository page:

1. Click the green **Code** button.
2. Select **Download ZIP**.
3. Extract the ZIP to a normal folder, for example:

   ```text
   C:\Tools\ScreenerCoin
   ```

Avoid extracting it into a protected system folder if Windows permissions are
restricted.

### 2. Install Node.js LTS

Download and install Node.js LTS from:

<https://nodejs.org/>

After installation, restart File Explorer or open a new Command Prompt if
Windows does not immediately recognize the `node` command.

### 3. Start the scanner

Open the extracted project folder and double-click:

```text
scan.bat
```

On the first run, `scan.bat` automatically installs the project dependencies.
This can take a few minutes. Later runs reuse the installed dependencies.

The launcher will:

1. Check that Node.js is installed.
2. Install dependencies when `node_modules` is missing.
3. Load current public market data from Bybit.
4. Run the screener.
5. Display ranked candidates in the terminal window.

Run `scan.bat` again whenever a fresh scan is needed.

The scanner is read-only. It uses public Bybit market-data endpoints and does
not require API keys. The first market scan can take about 1 minute because it
loads 5m, 15m, 1h, 4h, and 1d candles for the most active candidates. The
terminal reports the actual end-to-end latency, data freshness, and any
incomplete data instead of silently treating missing data as a signal.

For selected Stage 2 candidates, the scanner also performs a bounded Binance
deep check. Bybit remains the primary venue and primary bias source; Binance is
confirmation only and can never reverse the Bybit direction. The check uses
matched 15m futures and spot returns plus recent 15m open-interest history when
available. Binance timeout, stale-data, or mapping failures are neutral and do
not block the main Bybit scan.

## Optional command-line usage

Open Command Prompt or PowerShell in the project folder:

```powershell
cd "C:\Tools\ScreenerCoin"
npm install
npm.cmd start
```

For a custom scan, pass symbols to `scan.bat`:

```powershell
scan.bat SOL DOGE
```

The symbol names are converted to the relevant USDT perpetual instruments by
the scanner.

## Optional configuration

The default public endpoints work without an API key. To customize settings:

1. Copy `.env.example` to `.env`.
2. Edit the values in `.env`.
3. Run `scan.bat` again.

Example:

```text
BYBIT_BASE_URL=https://api.bybit.id
BYBIT_WS_URL=wss://stream.bybit.id/v5/public/linear
LOG_LEVEL=info
SIGNAL_LOG_PATH=./validation/signal-log.jsonl
JSON_OUTPUT_PATH=./output/screener-results.json
```

Bybit documents regional endpoints. Set both variables to the endpoint for
your account region when needed. Never disable TLS certificate verification.
Never publish a real `.env` file or API credentials to GitHub. The repository
ignores `.env` files by default.

## Understanding the result

### Discovery labels

- `DECOUPLED_ALPHA`: strong independent relative strength while BTC is weak
- `SHORT_SQUEEZE_CANDIDATE`: crowded shorts with conditions for a possible squeeze
- `FRESH_BREAKOUT`: early directional expansion
- `PRE_BREAKOUT_BASE`: compressed structure before a possible expansion
- `EARLY_ROTATION`: developing rotation or pullback opportunity
- `LATE_MOVER`: the move may already be mature; avoid chasing

### Entry status

- `ACTIONABLE_NOW`: the candidate is worth reviewing immediately because the
  direction, trigger, data completeness, timing, and risk filters currently
  pass. This is not an automatic trade instruction and does not guarantee
  profit.
- `WATCHING` / `WAITING`: the setup is interesting but needs a trigger or
  confirmation.
- `WAIT_PULLBACK`: the direction may remain valid, but price has moved too far
  from the preferred area.
- `NO_LONG` / `NO_SHORT`: the relevant side does not have enough confirmation.
- `REJECTED` / `QUARANTINED`: risk, stale momentum, incomplete data, or other
  safety filters prevent the candidate from being treated as actionable.

### Higher-timeframe context

The screener uses the following hierarchy:

```text
1d = macro direction
4h = primary higher-timeframe trend
1h = setup context
15m = discovery structure
5m = timing and freshness
```

An `MACRO_ALIGNED` result means the 4h and 1d context support the candidate
direction. `COUNTER_TREND` means the lower-timeframe setup conflicts with the
macro context and is penalized or downgraded. If 4h or 1d history is
incomplete, the screener reports a warning and does not apply the full HTF
alignment modifier.

### Capital flow labels

- `LONG_BUILD`: price and open interest suggest new long positioning
- `SHORT_BUILD`: price and open interest suggest new short positioning
- `SHORT_COVERING`: price rises while short positions are reduced
- `LONG_LIQUIDATION`: price falls while long positions are reduced
- `NEUTRAL / UNCONFIRMED`: insufficient or conflicting confirmation

### Absorption events

Absorption is a mathematical orderflow proxy, not proof of an iceberg or whale
order:

- `BULLISH_ABSORPTION`: aggressive selling is being rejected near VWAP support
- `BEARISH_ABSORPTION`: aggressive buying is being rejected near VWAP resistance
- `ABSORPTION_UNCONFIRMED`: evidence is insufficient or conflicting

Always combine these labels with maturity, market regime, data completeness,
and the current price context.

### Cross-exchange confirmation

The terminal may show a cross-exchange status for selected candidates:

- `CROSS_EXCHANGE_CONFIRMED`: short-window direction is aligned across Bybit
  and Binance futures/spot data
- `SPOT_DRIVEN_ACCUMULATION`: Binance Spot direction and sufficient spot volume
  support the move
- `CROSS_EXCHANGE_DIVERGENCE`: Bybit and Binance Futures disagree
- `SPOT_FUTURES_DIVERGENCE`: futures move without matching spot confirmation
- `BYBIT_ONLY_MOVE`: the short-window move is not confirmed by Binance
- `BINANCE_UNAVAILABLE` / `STALE_EXTERNAL_DATA`: no external modifier is
  applied; Bybit analysis continues independently

These labels describe observed market-data alignment. They do not prove whale
activity, smart-money intent, accumulation, or distribution. The cross-exchange
modifier is capped to `[-5, +5]` and Binance can never reverse the Bybit bias.

### Reading the terminal output

The terminal intentionally uses four simple sections:

1. `ACTIONABLE NOW`: candidates that passed the current freshness, trigger,
   timing, structure, and risk gates and deserve immediate review.
2. `WATCHLIST`: interesting candidates that still need a trigger, confirmation,
   or pullback.
3. `AVOID / QUARANTINED`: candidates that are late, stale, risky, or otherwise
   blocked from immediate review.
4. `DATA QUALITY & HOW TO READ THIS`: explains the Bybit primary source and the
   Binance confirmation role.

The dashboard is a decision aid, not an order ticket. It intentionally avoids
printing every internal score and diagnostic in the main view so that the
important result is readable at a glance.

Candidate cards may also show an illustrative entry area, invalidation level,
target reference, and risk/reward estimate derived from the scanner's existing
market structure and ATR inputs. These are manual analysis references only;
the screener does not place orders, manage positions, or guarantee that any
level will be reached.

### Validation status for the current release

- 20 automated test suites passing with 0 failures
- TypeScript type-check and production build passing
- Live scan completed for 580 Bybit instruments
- 25 selected candidates checked by the Binance deep-confirmation layer
- No `SCAN ERROR` or Bybit rate-limit failure in the final live run

The validation snapshot produced 0 `ACTIONABLE_NOW`, 10 watchlist entries, and
10 quarantined entries in approximately 61.6 seconds. An empty actionable
section is an expected safe result when no candidate satisfies all freshness,
trigger, timing, structure, and risk gates at that exact market snapshot.

## Safety and scope

- The bot is read-only and does not send trading orders.
- A high score is not a guarantee of future performance.
- `LATE_MOVER`, `EXHAUSTED`, and `WAIT_PULLBACK` results should not be chased.
- Check that timestamps and market data are current before acting on any result.
- Exchange availability, network errors, stale data, and rate limits can affect
  scan results.
- A scan is a live snapshot, not a promise that the market will remain
  unchanged while the scan is running. Recheck the latest price, orderbook,
  and freshness fields before making any decision.
- Do not disable TLS certificate validation to bypass network errors.

## Troubleshooting

### `Node.js tidak ditemukan`

Install Node.js LTS, open a new terminal, and run `scan.bat` again.

### Dependency installation fails

Check the internet connection, then run:

```powershell
npm.cmd install
```

Run `scan.bat` again after installation completes.

### Bybit connection or certificate error

Do not bypass TLS validation. The default endpoint is the official regional
Indonesia host (`api.bybit.id`). Check the computer clock, Windows certificate
updates, proxy/antivirus HTTPS inspection, and whether that host is reachable.
For another supported Bybit region, set both `BYBIT_BASE_URL` and
`BYBIT_WS_URL` in `.env`.

### Rate-limit or incomplete candle warning

The scanner retries Bybit rate-limit responses with backoff. If a symbol still
cannot be loaded, it is not silently treated as bullish or bearish; review the
diagnostics and rerun the scan after a short delay. Avoid starting many scans
at the same time from one IP address.

### The result is empty

An empty actionable section can be valid. The screener intentionally avoids
forcing signals when market regime, data completeness, timing, or risk filters
do not support a candidate. Review the watchlist and diagnostics output.

## Developer validation

From the project folder:

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
```

The test runner covers the discovery, ranking, VWAP, OI/funding, timing,
orderbook, and absorption logic.

## Project documentation

- [Operations guide](docs/operations.md)
- [Environment example](.env.example)
