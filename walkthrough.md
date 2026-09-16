# Walkthrough: Discovery & Capital Flow Engine Upgrade

Upgrade engine screener berfokus murni pada **Discovery Accuracy** & **Ranking Prioritas** sesuai arahan: menyaring dan meranking koin yang memiliki aktivitas tidak biasa, didukung capital flow, decouple dari pergerakan market, serta mengukur kematangan pergerakan (apakah awal atau sudah terlambat).

---

## 1. Perubahan Arsitektur & Fitur Baru

### A. Cold-Start Historical Open Interest Seeding (P0)
- **Implementasi:** 
  - [`BybitRest.getOIDelta`](file:///g:/Trade%20Screener%20Coin/src/data/bybit-rest.ts) mengambil riwayat 5 interval 15m dari `/v5/market/open-interest`.
  - [`MarketDataHub.get15mReturn`](file:///g:/Trade%20Screener%20Coin/src/data/market-data-hub.ts) mengukur return harga 15 menit sebenarnya (dari ring buffer timestamped 900s atau candle 15m).
  - [`MarketDataHub.seedColdStartOIDeltas`](file:///g:/Trade%20Screener%20Coin/src/data/market-data-hub.ts) memadukan OI delta 15m dengan return harga 15m untuk mensintesis `prevTickers` secara akurat pada saat pertama kali bot dinyalakan.
  - [`Stage2Signal`](file:///g:/Trade%20Screener%20Coin/src/stages/stage2-signal.ts) mengirimkan nilai `priceChange15m` aktual ke `OIFundingEngine`.

### B. Decoupled Alpha Detection & Regime Exception (P0)
- **Implementasi di [`LongEngine`](file:///g:/Trade%20Screener%20Coin/src/engines/long-engine.ts):**
  - Outperform BTC konsisten: `vsBTC >= 0.02` (+2% outperformance) atau skor relative strength $\ge 11/15$.
  - Likuiditas institusional: Turnover 24h $\ge \$20\text{M}$.
  - Tren teknikal sehat: Skor tren $\ge 8/20$ dan raw score $\ge 50$.
  - Funding normal & organik: Funding rate berada di rentang sehat `[-0.0002, +0.0004]` (mengecualikan short crowding ekstrem dan overbought).
  - **Veto Exception:** Dilindungi dari diskon rezim `STRONG_BEAR` (diberikan multiplier proteksi `max(0.88, regime * 1.55)`).

### C. Squeeze & Flush Event Classification (P0)
- Pada [`OIFundingEngine`](file:///g:/Trade%20Screener%20Coin/src/engines/oi-funding.ts):
  - `SHORT_SQUEEZE_CANDIDATE`: Funding rate negatif ekstrem ($\le -0.015\%$) atau crowding short ekstrem di mana harga tertahan/memantul di support.
  - `LONG_FLUSH_RISK`: Long crowded di resisten gagal breakout dengan funding tinggi ($\ge +0.03\%$).
  - `OI_SUPPORTED_MOMENTUM`: Delta OI $> +1.5\%$ seiring kenaikan harga.
  - `REVERSAL_WATCH`: Volume spike dengan penurunan OI drastis.
  - Label transparan modal: `LONG_BUILD (New Money Accumulation)`, `SHORT_BUILD (Aggressive Short Positioning)`, `SHORT_COVERING`, `LONG_LIQUIDATION`.

### D. Multi-Timeframe Confluence Engine (P1)
- Engine baru [`MTFConfluenceEngine`](file:///g:/Trade%20Screener%20Coin/src/engines/mtf-confluence.ts) mengukur keselarasan 5m, 15m, dan 1h.
- Terhubung langsung dengan jarak trigger ATR aktual di [`TimingEngine`](file:///g:/Trade%20Screener%20Coin/src/engines/timing-engine.ts): jika jarak $>2.2\times$ ATR dari base trigger, status confluence otomatis diklasifikasikan sebagai `LATE_EXPANSION`.

### E. Orderbook Imbalance sebagai Confidence Modifier (P1)
- Di [`TimingEngine`](file:///g:/Trade%20Screener%20Coin/src/engines/timing-engine.ts), rasio kedalaman 15 level bid vs ask dihitung:
  - Support bantalan tebal ($\ge 1.8\times$): Bonus confidence $+5$ poin.
  - Tembok resisten ask tebal ($\le 0.55\times$ untuk Long): Penalti $-8$ poin dan warning `HEAVY_ASK_RESISTANCE_WALL (Fakeout risk)`.
  - **Penerapan Nyata ke Skor:** Nilai modifier diaplikasikan langsung ke `actionabilityScore`, yang menyumbang 35% bobot pada composite score perankingan di `FinalRanker`.

### F. Multi-Tier Prioritization & Output UI (P2)
- Pada [`FinalRanker`](file:///g:/Trade%20Screener%20Coin/src/ranking/final-ranker.ts):
  - **Tier 0:** `DECOUPLED_ALPHA` (Prioritas teratas discovery)
  - **Tier 1:** `SHORT_SQUEEZE_CANDIDATE`
  - **Tier 2:** `EARLY_LONG` / `EARLY_SHORT` (Fresh Ignition)
  - **Tier 3:** `BASE_LONG` / `BASE_SHORT` (Pre-Breakout Base)
  - **Tier 4:** `PULLBACK_LONG` / `PULLBACK_SHORT` (Orderly Pullback)
- Tampilan detail di [`TerminalUI`](file:///g:/Trade%20Screener%20Coin/src/output/terminal-ui.ts) dan [`scan.ts`](file:///g:/Trade%20Screener%20Coin/scan.ts) kini menjawab 5 pertanyaan inti:
  1. *Aktivitas tidak biasa:* Terdeteksi via Ignition & Volume Expansion.
  2. *Dukungan capital flow:* Tertera di baris `Capital Flow`.
  3. *Outperform market:* Tertera di skor Relative Strength vs BTC & Sector.
  4. *Awal atau terlambat:* Tertera di `Maturity` (`EARLY` vs `LATE_MOVER` / `Trigger stale > 45m`).
  5. *Prioritas entry:* Tertera di `Potential` (`HIGH`, `MEDIUM`, `LOW`).

---

## 2. Pengujian & Verifikasi

### A. Type-Check
```powershell
node node_modules/typescript/bin/tsc --noEmit
# Result: 0 errors (PASS)
```

### B. Automated Regression & Unit Test Suites
```powershell
npm.cmd test
# Result: TOTAL SUITES: 15 | PASSED: 15 | FAILED: 0 (100% PASS)
# Suite baru: tests/discovery-engine-upgrade.test.ts (19/19 passed)
```

Targeted test suite `tests/discovery-engine-upgrade.test.ts` memverifikasi secara deterministik:
1. `MarketDataHub.get15mReturn()` membaca return 15m aktual dari timestamped ring buffer (PASS).
2. `MarketDataHub.seedColdStartOIDeltas()` mensintesis `prevTickers` dan `historicalOIDeltas` dengan return 15m (PASS).
3. `LongEngine` Decoupled Alpha mengaktifkan `isDecoupledAlpha` saat $vsBTC \ge +2\%$ dengan funding sehat $[-0.02\%, +0.04\%]$ dan memproteksi skor dari bear veto BTC (PASS).
4. `TimingEngine` mengoreksi MTF confluence menjadi `LATE_EXPANSION` saat jarak trigger ATR $>2.2\times$ (PASS).
5. `TimingEngine` mengaplikasikan `orderbookConfidenceModifier` (+5 / -8) ke `actionabilityScore`, dan `FinalRanker` menaikkan peringkat kandidat dengan dukungan bid tebal dibanding resisten ask (PASS).

### C. Fresh Live Scan Verifikasi (16 Sep 2026, 06.07.20 WIB)
Perintah: `node node_modules/tsx/dist/cli.mjs scan.ts ETHFI SOL DOGE`
- **Waktu Eksekusi:** 4.7 detik (terekam langsung di `scan.log`).
- **Makro Rezim:** `🔴 STRONG_BEAR (BTC: $75,755.8)`.
- **Hasil Aktual Multi-Anchor VWAP Bybit Live:**
  - **ETHFIUSDT ($0.5957 | 24h: -5.74% | 5m: +0.39%):**
    - VWAP Confluence: `TRIPLE_BEARISH_STACK` (Price < Session < Weekly < Monthly)
    - Level VWAP: Session $0.606673 | Weekly $0.630571 | Monthly $0.664539
    - VWAP Bands: B1 ($0.6207 / $0.5925) | B2 ($0.6348 / $0.5784)
    - Status Posisi: `RETEST_BAND_1` (Harga $0.5957 sedang menguji Lower Band 1)
  - **SOLUSDT ($97.23 | 24h: -5.23% | 5m: +0.08%):**
    - VWAP Confluence: `TRIPLE_BEARISH_STACK`
    - Level VWAP: Session $99.3656 | Weekly $100.5994 | Monthly $101.5460
    - VWAP Bands: B1 ($100.95 / $97.77) | B2 ($102.54 / $96.18)
    - Status Posisi: `INSIDE_VALUE_AREA`
  - **DOGEUSDT ($0.08031 | 24h: -4.26% | 5m: +0.19%):**
    - VWAP Confluence: `TRIPLE_BEARISH_STACK`
    - Level VWAP: Session $0.081584 | Weekly $0.082688 | Monthly $0.085958
    - VWAP Bands: B1 ($0.082776 / $0.080392) | B2 ($0.083968 / $0.079201)
    - Status Posisi: `RETEST_BAND_1` (Harga $0.08031 persis menyentuh Lower Band 1 $0.080392)

---

## 3. Fitur Baru: Institutional Multi-Anchor VWAP Engine (AA VWAP Pro Native)

Telah diimplementasikan engine VWAP institusional multi-anchor yang selaras penuh dengan Pine Script `AA VWAP Pro v12`:
1. **Session VWAP (Daily Anchor 00:00:00 UTC):** Dihitung dari candle 15m/5m untuk menentukan bias intraday hari ini.
2. **Weekly VWAP (Weekly Anchor Senin 00:00:00 UTC):** Dihitung dari candle 1h untuk menentukan arah tren mingguan.
3. **Monthly VWAP (Monthly Anchor Tanggal 1 00:00:00 UTC):** Dihitung dari candle 1h/Daily untuk menentukan level magnetik makro bulanan.
4. **Volume-Weighted Standard Deviation Bands:**
   - **Band 1.0σ (Value Area / Retest Zone):** Digunakan untuk konfirmasi pantulan retest yang sehat (`ACTIONABLE NOW`).
   - **Band 2.0σ (Exhaustion / Anti-Chasing Zone):** Jika harga menembus di atas $+2.0\sigma$ untuk Long atau di bawah $-2.0\sigma$ untuk Short, bot memicu peringatan `VWAP_EXHAUSTED` dan mengunci status ke `WAIT_PULLBACK` (dilarang chasing).
5. **Triple VWAP Confluence Matrix:**
   - `TRIPLE_BULLISH_STACK`: $Price > Session > Weekly > Monthly$ (bonus skor Long).
   - `TRIPLE_BEARISH_STACK`: $Price < Session < Weekly < Monthly$ (bonus skor Short).
6. **Validasi Test Suite:**
   - Suite baru: [`tests/anchored-vwap.test.ts`](file:///g:/Trade%20Screener%20Coin/tests/anchored-vwap.test.ts) (21/21 assertions PASS).
   - Master Runner (`npm.cmd test`): **16/16 suites PASS (100%)**.
