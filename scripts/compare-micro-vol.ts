import { BybitRest } from '../src/data/bybit-rest.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function compareMicroVolatility() {
  const rest = new BybitRest();
  const symbols = ['UAIUSDT', 'HEMIUSDT', 'AKEUSDT', 'EGLDUSDT', 'ARBUSDT'];

  console.log('--- PERBANDINGAN VOLATILITAS DETIK/MENIT (LTF 1M & 5M) ---');

  for (const sym of symbols) {
    try {
      const [c1m, c5m] = await Promise.all([
        rest.getKlines(sym, '1', 30),
        rest.getKlines(sym, '5', 30)
      ]);

      // Calculate avg candle range % = (High - Low) / Low * 100
      const ranges1m = c1m.map(c => ((c.high - c.low) / c.low) * 100);
      const avgRange1m = ranges1m.reduce((a, b) => a + b, 0) / ranges1m.length;
      const maxRange1m = Math.max(...ranges1m);

      const ranges5m = c5m.map(c => ((c.high - c.low) / c.low) * 100);
      const avgRange5m = ranges5m.reduce((a, b) => a + b, 0) / ranges5m.length;
      const maxRange5m = Math.max(...ranges5m);

      const lastCandle1m = c1m[c1m.length - 1];
      const lastPrice = lastCandle1m.close;

      console.log(`\n🔹 ${sym} (Harga: $${lastPrice}):`);
      console.log(`   • Rata-rata Ayunan per 1 Menit: ${avgRange1m.toFixed(2)}% (Maksimal: ${maxRange1m.toFixed(2)}%)`);
      console.log(`   • Rata-rata Ayunan per 5 Menit: ${avgRange5m.toFixed(2)}% (Maksimal: ${maxRange5m.toFixed(2)}%)`);
    } catch (e) {
      console.log(`Error on ${sym}`);
    }
  }
}

compareMicroVolatility().catch(console.error);
