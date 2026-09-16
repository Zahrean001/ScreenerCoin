# Screener Operations

## Purpose

This application is a read-only real-time screener for Bybit USDT perpetual
contracts. It ranks LONG and SHORT setups; it does not place orders.

The source code is proprietary. Public visibility does not grant permission
to copy, modify, redistribute, re-host, or use the project commercially.
See the repository `LICENSE` file for the complete terms.

The pipeline combines liquidity, open interest, spread, rolling price movement,
market structure, momentum, funding, relative strength, volatility, orderbook
quality, and anti-chase rules. `actionableResults` are intended for immediate
review, while `watchlist` and rejected signals require further confirmation.

## Configuration

Copy `.env.example` to `.env` when custom endpoints or output paths are needed.
The default public endpoints use Bybit's production `.com` REST and WebSocket
hosts. Use the testnet endpoints for development.

No API key is required for the public market-data feeds currently used by the
screener.

## Windows quick start

The GitHub ZIP does not include `node_modules`. Install Node.js LTS first, then
double-click `scan.bat`. The launcher checks for dependencies and runs
`npm install` automatically on the first launch. It does not disable TLS
certificate validation.

## Runtime safety

- Confirm that REST and WebSocket timestamps are current before acting on a
  signal.
- Treat missing or incomplete data as unavailable, not as a directional signal.
- Review the signal category and entry status; late or rejected setups must not
  be chased.
- Stop the process with `SIGINT` or `SIGTERM` so timers and WebSocket
  connections are closed cleanly.
- This tool provides analysis only and does not guarantee execution quality,
  profitability, or availability of exchange data.

## Validation

Use the existing project commands:

```text
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
```
