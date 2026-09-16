# Trade Screener Coin

Read-only crypto market screener for **Bybit USDT perpetual contracts**.

Copyright (c) 2026 Zahrean001. All rights reserved.

This bot helps users discover coins that may deserve further review by
combining unusual activity, liquidity, momentum, market structure, capital
flow, relative strength, multi-timeframe context, VWAP levels, orderbook
imbalance, and absorption-style orderflow confirmation.

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

## Main features

- Bybit USDT perpetual market scanning
- Liquidity and spread filtering
- Multi-timeframe analysis using 5m, 15m, and 1h data
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
BYBIT_BASE_URL=https://api.bybit.com
BYBIT_WS_URL=wss://stream.bybit.com/v5/public/linear
LOG_LEVEL=info
SIGNAL_LOG_PATH=./validation/signal-log.jsonl
JSON_OUTPUT_PATH=./output/screener-results.json
```

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

## Safety and scope

- The bot is read-only and does not send trading orders.
- A high score is not a guarantee of future performance.
- `LATE_MOVER`, `EXHAUSTED`, and `WAIT_PULLBACK` results should not be chased.
- Check that timestamps and market data are current before acting on any result.
- Exchange availability, network errors, stale data, and rate limits can affect
  scan results.
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

Do not bypass TLS validation. Check the computer clock, Windows certificate
updates, proxy/antivirus HTTPS inspection, and whether Bybit is reachable from
the network.

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
- [Discovery upgrade walkthrough](walkthrough.md)
- [Environment example](.env.example)
