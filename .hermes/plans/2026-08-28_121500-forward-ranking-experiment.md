# Forward Ranking Experiment — Implementation Plan v2

> **For Hermes:** implement task-by-task with strict TDD. This plan supersedes `2026-08-28_093000-ranking-page-dan-kombinasi-sinyal.md`; do not execute the old plan.

**Goal:** Tambah halaman `/ranking` terpisah untuk eksperimen forward relative-strength 16 coin, dengan ranking mingguan immutable, paper portfolio, benchmark equal-weight 16, breadth context, data-quality gates, dan statistik forward yang jujur—tanpa mengubah halaman sinyal menjadi bagian dari strategi XSMOM.

**Architecture:** Logic murni dan accounting ditempatkan di `app/lib/ranking.ts` serta `app/lib/portfolio.ts`, dipakai endpoint preview, snapshot, dan resolution agar tidak drift. Snapshot JSONL append-only menyimpan input dan hash spesifikasi. Halaman `/ranking` membedakan jelas `PREVIEW LIVE` dari `SNAPSHOT AKTIF`; halaman sinyal tetap permanen dan independen.

**Tech Stack:** Next.js 14 App Router, TypeScript, React 18, Node fs/promises, Binance USD-M REST, zero new runtime dependency.

---

## Keputusan yang sudah dibekukan

- Universe: BTC, ETH, SOL, XRP, BNB, DOGE, ADA, AVAX, LINK, DOT, LTC, TRX, ATOM, NEAR, FIL, ETC.
- Lookback: 14 hari = 84 candle 4h tertutup.
- Selection: top-4 LONG, equal-weight.
- Rebalance: mingguan pada jadwal tetap; jam/hari disimpan sebagai config dan harus dipilih satu kali sebelum snapshot pertama.
- Signal formation: setelah candle 4h tertutup.
- Paper entry: open candle 4h berikutnya.
- Paper exit/rebalance: open candle jadwal minggu berikutnya.
- Gross exposure paper: 100%, 25% tiap coin, 1×, tanpa leverage.
- Baseline: tanpa price stop; hanya kill switch operasional/data. Ini paper research, bukan izin uang nyata.
- Breadth: nilai `% coin di atas EMA200`; konteks saja, bukan gate.
- Benchmark: equal-weight 16 coin pada timestamp/aturan eksekusi sama.
- Primary metric: weekly excess return top-4 minus benchmark.
- Confluence 30m+1h: halaman/card independen; tidak memfilter, menunda, memberi bobot, atau menutup XSMOM.
- Snapshot tidak boleh retroaktif. Minggu lewat = `MISSED`.
- Status produk: `EKSPERIMEN FORWARD — BELUM CUKUP DATA` sampai kriteria masa depan dipenuhi.

## Temuan audit yang mengikat desain

- Whole-strategy historical permutation: percentile 99,75; p=0,0026 untuk informasi relatif.
- Return absolut full history HAC t=1,18; belum signifikan.
- Late 63 weeks top-4 compounded -33,9%, maxDD 61,6%.
- Breadth cutoff hanya 17 minggu pada late sample; jangan jadikan switch.
- Stop 10/15/20% tidak memperbaiki drawdown dalam uji terisolasi.
- Production-parity confluence tidak menambah timing yang terbukti.
- Semua statistik keputusan memakai satu portfolio return per minggu, bukan empat legs.

---

### Task 0: Tandai plan lama superseded dan freeze specification

**Objective:** Mencegah implementasi aturan lama yang sudah dibatalkan.

**Files:**
- Modify: `.hermes/plans/2026-08-28_093000-ranking-page-dan-kombinasi-sinyal.md`
- Create: `SPEC-XSMOM-FORWARD.md`

**Steps:**
1. Tambahkan banner paling atas plan lama: `SUPERSEDED — DO NOT IMPLEMENT`, link ke plan ini.
2. Tulis semua keputusan beku di atas ke `SPEC-XSMOM-FORWARD.md`.
3. Tambahkan hash SHA-256 dari isi canonical spec di footer.
4. Catat checkpoint 12/26/52/104 minggu dan larangan tuning.
5. Commit: `docs: freeze forward ranking experiment spec`.

**Verification:** hash yang dihitung ulang sama dengan footer; tidak ada threshold breadth 56% atau 68,75% sebagai gate.

---

### Task 1: Ranking domain logic dengan TDD

**Objective:** Menghitung ranking dan breadth secara deterministic tanpa kesalahan candle/warm-up.

**Files:**
- Create: `app/lib/ranking.ts`
- Create: `app/lib/ranking.test.ts`
- Modify: `package.json` (tambahkan test runner hanya jika Node built-in tidak cukup)

**RED tests:**
- return 14 hari memakai candle close index `i` dan `i-84`;
- current/in-progress candle tidak masuk input;
- top-4 stabil untuk fixture terurut;
- tie dipecahkan deterministik menggunakan simbol alfabetis;
- breadth = count(close > EMA200)/16;
- input bukan 16/16 menghasilkan `INCOMPLETE`, bukan ranking parsial;
- EMA menerima warm-up minimal 1.000 bar;
- timestamp antar-coin tidak identik menghasilkan `INCOMPLETE`.

**GREEN:** implement `rankUniverse(markets, effectiveCloseAt)` pure function.

**Verification:** `npm test`; `npm run build`.

**Commit:** `feat: add deterministic ranking domain logic`.

---

### Task 2: Portfolio accounting dengan TDD

**Objective:** Menghasilkan return paper-account yang benar dan parity dengan engine audit Python.

**Files:**
- Create: `app/lib/portfolio.ts`
- Create: `app/lib/portfolio.test.ts`
- Create: `test/fixtures/portfolio-parity.json`

**RED tests:**
- +10% lalu -10% menghasilkan equity 99, bukan 100;
- equal-weight empat leg dihitung satu weekly return;
- unchanged membership tidak membayar sell+buy fee;
- one replacement membayar satu sell + satu buy;
- positive funding rate mengurangi LONG equity;
- negative rate menambah LONG equity;
- funding memakai mark notional settlement relatif ke entry notional;
- drawdown peak-to-trough benar;
- output fixture identik dengan `portfolio_engine.py` dalam toleransi 1e-9.

**GREEN:** implement compounding, turnover, funding, benchmark, excess, drawdown.

**Verification:** Node tests + Python fixture generator + build.

**Commit:** `feat: add verified paper portfolio accounting`.

---

### Task 3: Binance market-data adapter dan completeness gate

**Objective:** Mengambil data cukup tanpa membuang candle tertutup dua kali atau mengubah universe diam-diam.

**Files:**
- Create: `app/lib/ranking-data.ts`
- Modify: `app/lib/indicators.ts` untuk helper kline raw/page bila diperlukan
- Create: `app/lib/ranking-data.test.ts`

**RED tests:**
- helper existing sudah menghapus in-progress candle; tidak ada second `slice(0,-1)`;
- 1.000 candle 4h tersedia untuk setiap 16 coin;
- 15/16 success => `INCOMPLETE` dan snapshot dilarang;
- timestamps stale/misaligned => `INCOMPLETE`;
- retry bounded, failure tidak disembunyikan;
- response menyertakan `dataAsOf`, `effectiveRebalanceAt`, `nextRebalanceAt`, dan per-coin errors.

**GREEN:** fetch `/fapi/v1/klines` secara bounded dengan concurrency kecil dan warm-up parity.

**Verification:** fixture mocked deterministic; satu integration smoke read-only terhadap Binance; build.

**Commit:** `feat: add complete-universe ranking data adapter`.

---

### Task 4: Immutable snapshot store

**Objective:** Menyimpan preregistered weekly observations tanpa cherry-pick atau backfill.

**Files:**
- Create: `app/lib/ranking-store.ts`
- Create: `app/lib/ranking-store.test.ts`
- Data: `${SCREENER_DATA_DIR}/ranking-snapshots.jsonl`

**Snapshot schema:**
```ts
{
  schemaVersion: 1,
  key: string,                 // ISO week + spec hash
  specHash: string,
  status: "OPEN" | "RESOLVED" | "MISSED" | "INVALID",
  scheduledAt: number,
  formedAt: number,
  dataAsOf: number,
  entryAt: number,
  exitAt: number,
  universe: string[],
  lookbackReturns: Record<string, number>,
  ranking: string[],
  top4: string[],
  breadth: number,
  ema200: Record<string, number>,
  signalPrices: Record<string, number>,
  entryPrices?: Record<string, number>,
  exitPrices?: Record<string, number>,
  funding?: Record<string, number>,
  turnover?: number,
  strategyReturnPct?: number,
  benchmarkReturnPct?: number,
  excessReturnPct?: number,
  dataQuality: { complete: boolean; errors: string[] }
}
```

**RED tests:** dedup ISO week; append-only; immutable formed fields; no retroactive OPEN; missed schedule becomes `MISSED`; invalid 15/16 cannot become OPEN; corrupt trailing JSONL handled explicitly.

**Commit:** `feat: add immutable weekly ranking snapshots`.

---

### Task 5: Snapshot lifecycle API

**Objective:** Memisahkan preview, formation, resolution, dan history.

**Files:**
- Create: `app/api/ranking/preview/route.ts`
- Create: `app/api/ranking/snapshot/route.ts`
- Create: `app/api/ranking/history/route.ts`
- Create tests untuk handler/domain.

**Behavior:**
- `GET /preview`: live ranking, tidak menjadi bukti.
- `POST /snapshot`: hanya dalam bounded formation window dan hanya 16/16 complete; idempotent.
- `POST /snapshot` bukan keputusan trading/payment dan tidak retroaktif.
- Resolver berjalan saat request pertama setelah exit; jika data tersedia, mengisi entry/exit/funding dan hasil secara immutable.
- Jika minggu tidak dibuka saat formation window, history menunjukkan `MISSED`.

**Security:** mutating snapshot endpoint tetap internal/same-origin; jangan ekspos website publik tanpa auth/TLS.

**Commit:** `feat: add forward ranking snapshot lifecycle`.

---

### Task 6: Forward statistics service

**Objective:** Menampilkan statistik yang tidak mengulang pseudo-replication.

**Files:**
- Create: `app/lib/forward-stats.ts`
- Create: `app/lib/forward-stats.test.ts`

**Metrics:**
- resolved weeks count;
- compounded paper equity;
- benchmark equity;
- cumulative excess;
- weekly mean excess;
- max drawdown strategy dan benchmark;
- data-quality counts: OPEN/RESOLVED/MISSED/INVALID;
- per-breadth bucket descriptive results only;
- no per-leg t-stat, no DSR sementara, no profit promise.

**Checkpoint labels:**
- `<12`: `PENGUMPULAN DATA`;
- `12–25`: `AUDIT OPERASIONAL`;
- `26–51`: `BUKTI BELUM CUKUP`;
- `52–103`: `EVALUASI AWAL`;
- `>=104`: `EVALUASI LANJUT — TETAP BUKAN JAMINAN`.

**Commit:** `feat: add honest forward experiment metrics`.

---

### Task 7: Halaman `/ranking`

**Objective:** Membuat halaman berbeda dengan hierarki informasi yang jujur.

**Files:**
- Create: `app/ranking/page.tsx`
- Create components: `MarketBreadth.tsx`, `RankingTable.tsx`, `ActiveSnapshot.tsx`, `ForwardEvidence.tsx`, `DataQuality.tsx`
- Modify CSS sesuai design system sekarang, tetap ringan.

**UI blocks:**
1. Banner merah/amber: `EKSPERIMEN FORWARD — BUKAN SINYAL BELI`.
2. Status data 16/16, timestamp, stale state.
3. `SNAPSHOT AKTIF` immutable, dibedakan dari `PREVIEW LIVE`.
4. Ranking lengkap 1–16; top-4 diberi label `PAPER SELECTION`, bukan LONG recommendation.
5. Breadth meter kontinu; tanpa badge `TRADE ON/OFF`.
6. Paper portfolio vs equal-weight benchmark.
7. Timeline snapshot, termasuk `MISSED` dan `INVALID`.
8. Methodology drawer berisi aturan dan spec hash.

**Responsive acceptance:** 360px, 768px, desktop; tabel bisa scroll horizontal tanpa memotong nilai.

**Commit:** `feat: add forward ranking experiment page`.

---

### Task 8: Pertahankan halaman sinyal, tapi pisahkan klaim

**Objective:** Card sinyal tetap permanen sesuai keputusan Lung tanpa memberi kesan telah memperbaiki XSMOM.

**Files:**
- Modify: `app/page.tsx`
- Modify komponen card terkait
- Add navigation link ke `/ranking`.

**Changes:**
- Header: `Sinyal Teknikal 30m — Informasi, bukan edge tervalidasi`.
- Jangan menambahkan blended score, rank filter, breadth gate, atau timing XSMOM.
- Boleh tampilkan link non-actionable: `Lihat eksperimen ranking terpisah`.
- Entry/stop/target existing boleh tetap terlihat sebagai trade-plan calculator, tetapi disclaimer harus dekat card, bukan footer tersembunyi.

**Commit:** `fix: separate technical cards from ranking experiment`.

---

### Task 9: Operasional, persistence, dan dokumentasi pemula

**Objective:** Sistem bertahan restart dan bisa dioperasikan Lung tanpa pengetahuan teknis.

**Files:**
- Modify: `PANDUAN.md`
- Modify: `README.md`
- Modify deployment Compose setelah lokasi host diverifikasi.

**Document:**
- preview vs snapshot;
- kenapa minggu terlewat tidak boleh diisi mundur;
- cara membaca top-4 vs benchmark;
- breadth bukan gate;
- arti checkpoint;
- backup/restore JSONL;
- data failure 15/16;
- larangan uang nyata dan leverage.

**Persistence:** mount `${SCREENER_DATA_DIR}` ke `/data`; verifikasi write/read setelah recreate.

**Commit:** `docs: add beginner guide for forward ranking experiment`.

---

### Task 10: Quality gates dan deploy

**Objective:** Membuktikan artifact berjalan sebelum menyatakan selesai.

**Commands:**
```bash
npm test
npm run build
# start local test server, verify:
curl -f http://127.0.0.1:<port>/api/ranking/preview
curl -f http://127.0.0.1:<port>/ranking
```

**Required checks:**
- preview 16/16;
- no in-progress candle;
- first snapshot idempotent;
- second POST tidak menduplikasi;
- forced incomplete fixture menolak snapshot;
- JSONL survive restart/recreate;
- current `/api/market`, `/api/price`, `/api/history` tetap HTTP 200;
- production build clean;
- Docker Compose volume `/data` verified;
- port 8642 untouched; dashboard remains mapped to 8643:3000;
- website tidak diekspos publik tanpa auth/TLS.

**Commit:** `chore: verify and deploy ranking experiment`.

---

## Risiko yang wajib tampil di produk

- survivorship bias dari fixed current universe;
- seluruh historical period sudah pernah dilihat;
- late 63 weeks rugi absolut;
- historical maxDD sekitar 70%;
- breadth gate belum tervalidasi;
- forward sample tumbuh hanya satu observasi per minggu;
- paper fills bukan real fills;
- past performance tidak menjamin hasil berikutnya.

## Definition of Done

- Semua domain test RED→GREEN dan lulus.
- Preview dan snapshot berbeda secara visual dan data.
- Ranking tidak terbentuk jika data bukan 16/16.
- Snapshot immutable, dedup, no backfill.
- Portfolio accounting parity dengan Python fixture.
- Statistik hanya per minggu.
- Halaman sinyal tidak memengaruhi eksperimen ranking.
- PANDUAN.md menjelaskan semuanya secara pemula.
- Build, API smoke, persistence, dan Compose diverifikasi dengan output nyata.
- Tidak ada klaim strategi final atau ajakan uang nyata.

## Urutan implementasi yang direkomendasikan

P0: Task 0–4 (spec, math, data, store)
P1: Task 5–7 (API, stats, UI ranking)
P2: Task 8–9 (signal framing, docs, persistence)
P3: Task 10 (verification + deploy)

Setelah setiap prioritas, stop dan laporkan hasil terverifikasi ke Lung sebelum lanjut ke prioritas berikutnya.
