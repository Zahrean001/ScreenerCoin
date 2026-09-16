import { BybitRest } from '../src/data/bybit-rest.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function run() {
  const rest = new BybitRest();
  const instruments = await rest.getInstruments();
  const tickers = await rest.getTickers();
  const liquid = instruments.filter(i => 
    i.quoteCoin === 'USDT' && 
    i.status === 'Trading' && 
    (tickers.get(i.symbol)?.turnover24h || 0) >= 1_500_000
  );
  
  console.log(`Scanning 4H Market Structure across ${liquid.length} liquid USDT perpetual symbols...`);
  
  const deepMatches: any[] = [];
  const retestMatches: any[] = [];

  for (let i = 0; i < liquid.length; i += 12) {
    const batch = liquid.slice(i, i + 12);
    await Promise.all(batch.map(async (inst) => {
      try {
        const k = await rest.getKlines(inst.symbol, '240', 60);
        if (k.length < 25) return;
        const ticker = tickers.get(inst.symbol)!;
        const last = ticker.lastPrice;
        
        let ll = Infinity, hh = -Infinity, llIdx = -1, hhIdx = -1;
        for (let j = 0; j < k.length - 1; j++) {
          if (k[j].low < ll) { ll = k[j].low; llIdx = j; }
          if (k[j].high > hh) { hh = k[j].high; hhIdx = j; }
        }
        if (hh <= ll || hhIdx <= llIdx) return;
        
        const range = hh - ll;
        const pullFromHH = (hh - last) / range;
        const fromLL = (last - ll) / range;
        
        // Deep Discount Retracement (price pulled back 74% - 78% or 93% from the top HH towards LL)
        const deepDiff748 = Math.abs(pullFromHH - 0.748);
        const deepDiff764 = Math.abs(pullFromHH - 0.764);
        const deepDiff780 = Math.abs(pullFromHH - 0.780);
        const deepDiff933 = Math.abs(pullFromHH - 0.933);
        const minDeepDiff = Math.min(deepDiff748, deepDiff764, deepDiff780, deepDiff933);

        if (minDeepDiff < 0.025) {
          let matchedLevel = '0.748';
          if (minDeepDiff === deepDiff764) matchedLevel = '0.764';
          if (minDeepDiff === deepDiff780) matchedLevel = '0.780';
          if (minDeepDiff === deepDiff933) matchedLevel = '0.933';
          
          deepMatches.push({
            symbol: inst.symbol,
            lastPrice: last,
            ll4H: ll,
            hh4H: hh,
            matchedLevel: `Deep OTE ${matchedLevel}`,
            pullbackPercent: (pullFromHH * 100).toFixed(1) + '%',
            vol24h: `$${(ticker.turnover24h / 1e6).toFixed(1)}M`,
            change24h: (ticker.price24hPcnt * 100).toFixed(2) + '%'
          });
        }

        // Support Retest (price at 0.748 - 0.780 or 0.933 measured from LL)
        const retestDiff748 = Math.abs(fromLL - 0.748);
        const retestDiff764 = Math.abs(fromLL - 0.764);
        const retestDiff780 = Math.abs(fromLL - 0.780);
        const retestDiff933 = Math.abs(fromLL - 0.933);
        const minRetestDiff = Math.min(retestDiff748, retestDiff764, retestDiff780, retestDiff933);

        if (minRetestDiff < 0.015) {
          let matchedLevel = '0.748';
          if (minRetestDiff === retestDiff764) matchedLevel = '0.764';
          if (minRetestDiff === retestDiff780) matchedLevel = '0.780';
          if (minRetestDiff === retestDiff933) matchedLevel = '0.933';
          
          retestMatches.push({
            symbol: inst.symbol,
            lastPrice: last,
            ll4H: ll,
            hh4H: hh,
            matchedLevel: `Retest Fibo ${matchedLevel}`,
            positionFromLL: (fromLL * 100).toFixed(1) + '%',
            vol24h: `$${(ticker.turnover24h / 1e6).toFixed(1)}M`,
            change24h: (ticker.price24hPcnt * 100).toFixed(2) + '%'
          });
        }
      } catch (e) {}
    }));
  }

  console.log('\n========================================================================================');
  console.log('📌 KATEGORI 1: DEEP DISCOUNT OTE (PULLBACK 74.8% - 78.0% ATAU 93.3% DARI 4H HH KE LL)');
  console.log('========================================================================================');
  console.table(deepMatches);

  console.log('\n========================================================================================');
  console.log('📌 KATEGORI 2: SUPPORT RETEST (POSISI HARGA DI 74.8% - 78.0% ATAU 93.3% DARI LL)');
  console.log('========================================================================================');
  console.table(retestMatches);
}

run();
