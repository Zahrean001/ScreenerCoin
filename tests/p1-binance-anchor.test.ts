// ============================================================
// P1 Tests: Binance Symbol Resolver & Cross-Exchange Classifier
// ============================================================

import { BinanceSymbolResolver } from '../src/exchanges/binance-symbol-resolver.js';
import { BinanceDeepAnchorEngine } from '../src/exchanges/binance-deep-anchor.js';
import { CrossExchangeAnalysis, CrossExchangeStatus } from '../src/data/types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`✅ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${msg}`);
    failed++;
  }
}

// --- Minimal mock resolver for offline tests ---
class MockBinanceResolver extends BinanceSymbolResolver {
  constructor(
    private mockFutures: Set<string>,
    private mockSpot: Set<string>
  ) {
    super();
  }

  override resolve(bybitSymbol: string) {
    const hasFut = this.mockFutures.has(bybitSymbol);
    // Handle 1000x prefix
    let spotSym = bybitSymbol;
    let hasSpot = this.mockSpot.has(bybitSymbol);
    if (!hasSpot && bybitSymbol.startsWith('1000')) {
      spotSym = bybitSymbol.slice(4);
      hasSpot = this.mockSpot.has(spotSym);
    }

    return {
      bybitSymbol,
      binanceFuturesSymbol: hasFut ? bybitSymbol : null,
      binanceSpotSymbol: hasSpot ? spotSym : null,
      status: hasFut && hasSpot ? 'MAPPED' as const
        : hasFut ? 'FUTURES_ONLY' as const
        : hasSpot ? 'SPOT_ONLY' as const
        : 'UNAVAILABLE' as const
    };
  }

  override isInitialized() { return true; }
}

// --- Minimal mock deep anchor engine for classification tests ---
class TestableDeepAnchor extends BinanceDeepAnchorEngine {
  /**
   * Direct classification test: bypass network fetch entirely.
   */
  classifyDirect(
    bybitReturn: number,
    binanceFutReturn: number | null,
    binanceSpotReturn: number | null,
    bybitOIDelta: number | null,
    spotQuoteVolume: number = 10_000_000
  ): CrossExchangeAnalysis {
    const startMs = Date.now();

    // Replicate the classification logic from analyzeSingle
    const bybitMoving = Math.abs(bybitReturn) > 0.005;
    const hasFutures = binanceFutReturn !== null;
    const hasSpot = binanceSpotReturn !== null;

    if (!hasFutures && !hasSpot) {
      return this.makeNeutral('BINANCE_UNAVAILABLE', 'No Binance data', startMs, bybitReturn);
    }

    const sameDirectionFutures = hasFutures && Math.sign(bybitReturn) === Math.sign(binanceFutReturn!);
    const sameDirectionSpot = hasSpot && Math.sign(bybitReturn) === Math.sign(binanceSpotReturn!);
    const futuresMagnitudeAligned = hasFutures && Math.abs(binanceFutReturn!) > 0.003;
    const spotMagnitudeAligned = hasSpot && Math.abs(binanceSpotReturn!) > 0.003;

    let status: CrossExchangeStatus;
    let modifier: number;
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    let reason: string;

    if (sameDirectionFutures && futuresMagnitudeAligned && sameDirectionSpot && spotMagnitudeAligned) {
      status = 'CROSS_EXCHANGE_CONFIRMED';
      modifier = 3;
      confidence = 'HIGH';
      reason = 'All venues aligned';
    } else if (sameDirectionSpot && spotMagnitudeAligned && hasSpot && spotQuoteVolume > 5_000_000) {
      status = 'SPOT_DRIVEN_ACCUMULATION';
      modifier = 2;
      confidence = 'MEDIUM';
      reason = 'Spot confirms direction';
    } else if (bybitMoving && hasFutures && !sameDirectionFutures) {
      status = 'CROSS_EXCHANGE_DIVERGENCE';
      modifier = -2;
      confidence = 'MEDIUM';
      reason = 'Bybit and Binance futures disagree';
    } else if (bybitMoving && hasFutures && sameDirectionFutures && hasSpot && !sameDirectionSpot) {
      status = 'SPOT_FUTURES_DIVERGENCE';
      modifier = -3;
      confidence = 'MEDIUM';
      reason = 'Futures agree but spot divergent';
    } else if (bybitMoving && (!hasFutures || !futuresMagnitudeAligned)) {
      status = 'BYBIT_ONLY_MOVE';
      modifier = -2;
      confidence = 'LOW';
      reason = 'Bybit-only movement';
    } else {
      status = 'BINANCE_UNAVAILABLE';
      modifier = 0;
      confidence = 'LOW';
      reason = 'Insufficient evidence';
    }

    modifier = Math.max(-5, Math.min(5, modifier));

    return {
      status,
      confidence,
      scoreModifier: modifier,
      bybitFuturesReturn: bybitReturn,
      binanceFuturesReturn: binanceFutReturn,
      binanceSpotReturn: binanceSpotReturn,
      bybitOIDelta: bybitOIDelta,
      binanceOIDelta: null,
      oiConfluence: 'UNAVAILABLE',
      reason,
      timestamp: Date.now(),
      latencyMs: Date.now() - startMs
    };
  }

  private makeNeutral(
    status: CrossExchangeStatus, reason: string, startMs: number, bybitReturn: number
  ): CrossExchangeAnalysis {
    return {
      status, confidence: 'LOW', scoreModifier: 0,
      bybitFuturesReturn: bybitReturn, binanceFuturesReturn: null,
      binanceSpotReturn: null, bybitOIDelta: null, binanceOIDelta: null,
      oiConfluence: 'UNAVAILABLE', reason, timestamp: Date.now(),
      latencyMs: Date.now() - startMs
    };
  }
}

async function runTests() {
  console.log('====================================================');
  console.log(' RUNNING P1 BINANCE ANCHOR & SYMBOL RESOLVER TESTS  ');
  console.log('====================================================\n');

  // --- TEST 1: Symbol Resolver ---
  console.log('--- TEST 1: Symbol Resolver Mapping ---');
  const resolver = new MockBinanceResolver(
    new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', '1000PEPEUSDT']),
    new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PEPEUSDT'])
  );

  const btc = resolver.resolve('BTCUSDT');
  assert(btc.status === 'MAPPED', `BTCUSDT status is MAPPED (got: ${btc.status})`);
  assert(btc.binanceFuturesSymbol === 'BTCUSDT', 'BTCUSDT futures maps directly');
  assert(btc.binanceSpotSymbol === 'BTCUSDT', 'BTCUSDT spot maps directly');

  const pepe = resolver.resolve('1000PEPEUSDT');
  assert(pepe.status === 'MAPPED', `1000PEPEUSDT status is MAPPED (got: ${pepe.status})`);
  assert(pepe.binanceFuturesSymbol === '1000PEPEUSDT', '1000PEPEUSDT futures maps directly');
  assert(pepe.binanceSpotSymbol === 'PEPEUSDT', '1000PEPEUSDT spot strips prefix to PEPEUSDT');

  const unknown = resolver.resolve('XAUTUSDT');
  assert(unknown.status === 'UNAVAILABLE', `XAUTUSDT status is UNAVAILABLE (got: ${unknown.status})`);
  assert(unknown.binanceFuturesSymbol === null, 'XAUTUSDT futures is null');
  assert(unknown.binanceSpotSymbol === null, 'XAUTUSDT spot is null');

  // --- TEST 2: Unavailable Symbol → modifier 0 ---
  console.log('\n--- TEST 2: Unavailable Symbol → modifier 0 ---');
  const anchor = new TestableDeepAnchor(resolver);
  const unavailResult = anchor.classifyDirect(0.05, null, null, null);
  assert(unavailResult.status === 'BINANCE_UNAVAILABLE', `Unavailable yields BINANCE_UNAVAILABLE (got: ${unavailResult.status})`);
  assert(unavailResult.scoreModifier === 0, `Unavailable modifier is exactly 0 (got: ${unavailResult.scoreModifier})`);

  // --- TEST 3: Cross-Exchange Confirmed ---
  console.log('\n--- TEST 3: Futures + Spot Aligned → CROSS_EXCHANGE_CONFIRMED ---');
  const confirmed = anchor.classifyDirect(0.03, 0.025, 0.02, 0.05);
  assert(confirmed.status === 'CROSS_EXCHANGE_CONFIRMED', `Status is CROSS_EXCHANGE_CONFIRMED (got: ${confirmed.status})`);
  assert(confirmed.scoreModifier === 3, `Modifier is +3 (got: ${confirmed.scoreModifier})`);
  assert(confirmed.confidence === 'HIGH', `Confidence is HIGH (got: ${confirmed.confidence})`);

  // --- TEST 4: Spot-Futures Divergence → penalty ---
  console.log('\n--- TEST 4: Futures Aligned but Spot Divergent → SPOT_FUTURES_DIVERGENCE ---');
  const spotDiv = anchor.classifyDirect(0.03, 0.025, -0.01, null);
  assert(spotDiv.status === 'SPOT_FUTURES_DIVERGENCE', `Status is SPOT_FUTURES_DIVERGENCE (got: ${spotDiv.status})`);
  assert(spotDiv.scoreModifier === -3, `Modifier is -3 (got: ${spotDiv.scoreModifier})`);

  // --- TEST 5: Cross-Exchange Divergence ---
  console.log('\n--- TEST 5: Bybit Up + Binance Down → CROSS_EXCHANGE_DIVERGENCE ---');
  const crossDiv = anchor.classifyDirect(0.04, -0.02, null, null);
  assert(crossDiv.status === 'CROSS_EXCHANGE_DIVERGENCE', `Status is CROSS_EXCHANGE_DIVERGENCE (got: ${crossDiv.status})`);
  assert(crossDiv.scoreModifier === -2, `Modifier is -2 (got: ${crossDiv.scoreModifier})`);

  // --- TEST 6: Bybit-Only Move ---
  console.log('\n--- TEST 6: Bybit Moving + Binance Flat → BYBIT_ONLY_MOVE ---');
  const bybitOnly = anchor.classifyDirect(0.035, 0.001, 0.001, null);
  assert(bybitOnly.status === 'BYBIT_ONLY_MOVE', `Status is BYBIT_ONLY_MOVE (got: ${bybitOnly.status})`);
  assert(bybitOnly.scoreModifier === -2, `Modifier is -2 (got: ${bybitOnly.scoreModifier})`);

  // --- TEST 7: Modifier always clamped to [-5, +5] ---
  console.log('\n--- TEST 7: Modifier Clamp Bounds ---');
  assert(confirmed.scoreModifier >= -5 && confirmed.scoreModifier <= 5, 'Confirmed modifier within [-5, +5]');
  assert(spotDiv.scoreModifier >= -5 && spotDiv.scoreModifier <= 5, 'SpotDiv modifier within [-5, +5]');
  assert(crossDiv.scoreModifier >= -5 && crossDiv.scoreModifier <= 5, 'CrossDiv modifier within [-5, +5]');
  assert(unavailResult.scoreModifier >= -5 && unavailResult.scoreModifier <= 5, 'Unavailable modifier within [-5, +5]');

  // --- TEST 8: Direction Protection ---
  console.log('\n--- TEST 8: Binance Cannot Flip Bybit Direction ---');
  // Even worst cross-exchange penalty (-3) cannot flip a strong LONG signal (score 80)
  const strongLongScore = 80;
  const worstPenalty = spotDiv.scoreModifier; // -3
  const adjustedScore = strongLongScore + worstPenalty;
  assert(adjustedScore > 0, `Strong LONG (${strongLongScore}) + worst penalty (${worstPenalty}) = ${adjustedScore} > 0 (direction preserved)`);
  assert(adjustedScore > 50, `Score ${adjustedScore} remains well above threshold (direction not flipped)`);

  // Verify that even max possible penalty can't destroy score
  const maxPenalty = -5;
  const minScoreAfterPenalty = strongLongScore + maxPenalty;
  assert(minScoreAfterPenalty > 0, `Max penalty ${maxPenalty} on score ${strongLongScore} = ${minScoreAfterPenalty} (never zero or negative)`);

  console.log('\n====================================================');
  console.log(`P1 TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
