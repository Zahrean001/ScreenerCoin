// ============================================================
// Tests: Price Window Metrics & Volume Acceleration
// ============================================================

import { TimestampedPriceRingBuffer } from '../src/data/circular-buffer.js';
import { MarketDataHub } from '../src/data/market-data-hub.js';
import { BybitRest } from '../src/data/bybit-rest.js';

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

async function run() {
  console.log('=== Running Price Window & Volume Acceleration Tests ===\n');

  const now = 1_700_000_000_000; // Fixed epoch for determinism

  // 1. Exactly 5 minutes
  const buf = new TimestampedPriceRingBuffer(100);
  buf.push(now - 300_000, 100); // 5 min ago: $100
  buf.push(now, 105);           // Now: $105 (+5%)

  const ret5mExact = buf.getReturnOverWindow(300_000, now);
  assert(ret5mExact.value !== null && Math.abs(ret5mExact.value - 0.05) < 0.0001, '5m return exactly 5 min ago is +5.0%');
  assert(ret5mExact.window === '5m', 'window metadata is "5m"');
  assert(ret5mExact.referenceTimestamp === now - 300_000, 'referenceTimestamp is exact');

  // 2. Slightly older observation (within 35% tolerance: e.g. 5.5 minutes ago)
  const bufOlder = new TimestampedPriceRingBuffer(100);
  bufOlder.push(now - 330_000, 100); // 5.5 min ago
  bufOlder.push(now, 110);           // Now: $110 (+10%)
  const retOlder = bufOlder.getReturnOverWindow(300_000, now);
  assert(retOlder.value !== null && Math.abs(retOlder.value - 0.10) < 0.0001, '5m return handles slightly older observation (5.5 min)');

  // 3. Slightly newer observation (e.g. 4.5 minutes ago)
  const bufNewer = new TimestampedPriceRingBuffer(100);
  bufNewer.push(now - 270_000, 100); // 4.5 min ago
  bufNewer.push(now, 95);            // Now: $95 (-5%)
  const retNewer = bufNewer.getReturnOverWindow(300_000, now);
  assert(retNewer.value !== null && Math.abs(retNewer.value - (-0.05)) < 0.0001, '5m return handles slightly newer observation (4.5 min)');

  // 4. Missing history (only 30 seconds of history available)
  const bufShort = new TimestampedPriceRingBuffer(100);
  bufShort.push(now - 30_000, 100);
  bufShort.push(now, 101);
  const retShort = bufShort.getReturnOverWindow(300_000, now);
  assert(retShort.value === null, '5m return explicitly returns null when history < 3.25 min');

  // 5. Zero / invalid price rejected
  const bufInvalid = new TimestampedPriceRingBuffer(100);
  bufInvalid.push(now - 300_000, 0);       // invalid $0
  bufInvalid.push(now - 300_000, -10);     // invalid negative
  bufInvalid.push(now - 300_000, NaN);     // invalid NaN
  bufInvalid.push(now - 300_000, 100);     // valid $100
  bufInvalid.push(now, 102);               // valid $102
  assert(bufInvalid.size === 2, 'Invalid prices (0, negative, NaN) are safely rejected from buffer');
  const retValidOnly = bufInvalid.getReturnOverWindow(300_000, now);
  assert(retValidOnly.value !== null && Math.abs(retValidOnly.value - 0.02) < 0.0001, 'Calculated return only uses clean positive prices');

  // 6. Irregular WebSocket update intervals
  const bufIrregular = new TimestampedPriceRingBuffer(100);
  bufIrregular.push(now - 600_000, 90);
  bufIrregular.push(now - 450_000, 92);
  bufIrregular.push(now - 295_000, 100); // nearest past point to 300k
  bufIrregular.push(now - 120_000, 104);
  bufIrregular.push(now - 5_000, 108);
  bufIrregular.push(now, 110);
  const retIrregular = bufIrregular.getReturnOverWindow(300_000, now);
  assert(retIrregular.value !== null && Math.abs(retIrregular.value - 0.10) < 0.001, 'Nearest observation selected correctly during irregular WS intervals');

  // 7. 1-Hour Price Window Return
  const buf1h = new TimestampedPriceRingBuffer(200);
  buf1h.push(now - 3600_000, 50); // 1h ago: $50
  buf1h.push(now - 1800_000, 55);
  buf1h.push(now, 60);            // Now: $60 (+20%)
  const ret1h = buf1h.getReturnOverWindow(3600_000, now);
  assert(ret1h.value !== null && Math.abs(ret1h.value - 0.20) < 0.0001, '1h return calculates +20.0% return');
  assert(ret1h.window === '1h', '1h window metadata correctly tagged');

  // 8. Volume Acceleration (Real calculation vs null on missing)
  const rest = new BybitRest();
  const hub = new MarketDataHub(rest);
  
  // Before any data is loaded, volume acceleration is explicitly null (NOT 1.0!)
  const emptyVolAcc = hub.getVolumeAcceleration('BTCUSDT');
  assert(emptyVolAcc === null, 'getVolumeAcceleration returns explicit null when unobserved (no fake 1.0)');

  console.log(`\n=== Price Window Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
