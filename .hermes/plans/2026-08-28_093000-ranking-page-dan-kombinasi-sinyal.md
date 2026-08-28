> **SUPERSEDED — JANGAN DIIMPLEMENTASIKAN.** Audit metodologi membatalkan beberapa klaim dan desain di dokumen ini. Gunakan `2026-08-28_121500-forward-ranking-experiment.md`.

# Rencana Implementasi — Halaman Ranking + Kombinasi Sinyal

> **Untuk Hermes:** implementasikan task-by-task, commit tiap task selesai.

**Goal:** Tambah halaman `/ranking` (panel breadth + ranking XSMOM + rebalance history)
tanpa menghapus halaman sinyal, dan tambahkan konteks ranking/breadth ke card sinyal
yang sudah ada — sebagai **informasi**, bukan sebagai penguat klaim edge.

**Arsitektur:** Next.js App Router, dua halaman terpisah berbagi endpoint baru
`/api/ranking`. Zero-dependency (RAM 1,7 GB), SVG manual, JSONL store seperti pola
`app/lib/store.ts` yang sudah ada.

**Tech Stack:** Next.js 14.2.35, React, TypeScript, Binance Futures public REST.

---

## Konteks & temuan yang mendasari rencana ini

Semua angka dari `/opt/data/research/screener-edge/` (data 16 coin × 4h × 1.500 hari).

| Temuan | Angka | Implikasi desain |
|---|---|---|
| Breadth gate | tercile atas net **+1,38%** t=+2,44 vs rendah −0,19% | gate utama halaman ranking |
| Leg SHORT | **−0,74%** t=−1,50 bahkan saat breadth tinggi | **jangan tampilkan badge SHORT** |
| Leg LONG saat breadth tinggi | **+3,49%** t=+3,49 PF=2,03 | LONG-only top-4 |
| Persistensi rank | top4 bertahan **52%** vs acak 25% | kolom "berapa minggu di zona" |
| Dispersi | t=+0,83, pola bolak-balik | tampilkan info saja, **bukan gate** |
| Konsentrasi | 3 coin teratas = **94%** total | tampilkan peringatan kerapuhan |
| Ranking + gate (chart sintetis) | t=+3,43 vs acak, tangkap **32%** potensi | ranking = sumber informasi utama |
| Confluence (chart sintetis) | t=+0,25 vs acak, tangkap **3%** potensi | bukan sumber keputusan |
| **XSMOM LONG-only + gate breadth** | **+2,9093%** t=+3,07 PF=1,81 (n=300) | baseline yang benar |
| Timing "tunggu RSI < 45" | **−0,0594%** t=−2,39 vs baseline | **peringatkan: jangan tunggu pullback** |
| 6 bentuk kombinasi lain | t antara −0,64 dan +0,36 | tidak menyumbang, tidak merusak |

**Keputusan kunci:** sinyal confluence dan ranking **tidak digabung jadi satu angka**.
Card sinyal diberi **label konteks** dari ranking/breadth; skor confluence
diturunkan statusnya jadi "info teknikal", bukan rekomendasi.

### Koreksi metodologi (penting, jangan diulang)

Uji kombinasi pertama (`combo_test.py`) **cacat**: XSMOM dipaksa masuk harness
confluence (stop 3×ATR + trailing + tangga ROI), padahal mekanismenya hold 7 hari
fixed tanpa stop. Efeknya menghancurkan baseline:

```text
XSMOM harness sendiri (hold 7d fixed)  : +0,6179%  t=+2,51
XSMOM harness confluence (stop 3×ATR)  : −0,0016R  t=−0,07
```

Kesimpulan lama "kombinasi memperburuk" adalah artefak harness rusak, bukan temuan.
Uji ulang dengan harness benar ada di `combo_proper.py`.

**Aturan implementasi yang lahir dari kesalahan ini:** harness XSMOM di kode dan
dokumentasi WAJIB hold 7 hari fixed, exit di jadwal rebalance, **tanpa stop ATR
dan tanpa trailing**. Menambahkan stop 3×ATR ke posisi XSMOM menghancurkan
mekanismenya.

**Batas uji yang harus disebut jujur:** n=300 leg (gate breadth memotong banyak
periode), jauh di bawah 1.696 leg di uji XSMOM penuh. Efek kecil tidak akan
terdeteksi di sampel ini. Klaim yang sah: "tidak terdeteksi di 300 leg", bukan
"pasti tidak ada manfaat".

---

## Task 1: Endpoint `/api/ranking`

**Objective:** Satu endpoint yang mengembalikan breadth, ranking 16 coin, dispersi,
dan persistensi — dari 1 batch request klines.

**Files:**
- Create: `app/api/ranking/route.ts`
- Modify: `app/lib/indicators.ts` (tambah `RANKING_COINS`, `pctChange`)

**Step 1: Tambah konstanta universe di `app/lib/indicators.ts`**

```typescript
export const RANKING_COINS = (process.env.SCREENER_RANKING_COINS ??
  "BTC,ETH,SOL,XRP,BNB,DOGE,ADA,AVAX,LINK,DOT,LTC,TRX,ATOM,NEAR,FIL,ETC"
).split(",").map((s) => s.trim()).filter(Boolean);

export const RANK_LOOKBACK_BARS = 84;   // 14 hari di 4h
export const RANK_BREADTH_MIN = 0.56;   // ambang dari riset (tercile atas)
```

**Step 2: Buat `app/api/ranking/route.ts`**

Ambil klines 4h limit 300 per coin (butuh 200 untuk EMA200 + 84 lookback).
**Buang bar terakhir** (masih terbentuk) — ini sumber look-ahead paling umum.

```typescript
import { NextResponse } from "next/server";
import { BINANCE, candles, ema, RANKING_COINS, RANK_LOOKBACK_BARS,
         RANK_BREADTH_MIN } from "@/app/lib/indicators";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = {
  symbol: string; rank: number; ret14: number; price: number;
  aboveEma200: boolean; zone: "LONG" | "NEUTRAL";
};

export async function GET() {
  const rows: Omit<Row, "rank" | "zone">[] = [];
  for (const sym of RANKING_COINS) {
    try {
      const k = await candles(sym, "4h", 300);
      const c = k.slice(0, -1);                    // buang bar berjalan
      if (c.length < RANK_LOOKBACK_BARS + 200) continue;
      const closes = c.map((x) => x.close);
      const e200 = ema(closes, 200);
      const now = closes[closes.length - 1];
      const past = closes[closes.length - 1 - RANK_LOOKBACK_BARS];
      rows.push({
        symbol: sym,
        ret14: (now / past - 1) * 100,
        price: now,
        aboveEma200: now > e200[e200.length - 1],
      });
    } catch { /* skip coin yang gagal, jangan gagalkan seluruh response */ }
  }
  rows.sort((a, b) => b.ret14 - a.ret14);
  const ranked: Row[] = rows.map((r, i) => ({
    ...r, rank: i + 1,
    zone: i < 4 ? "LONG" : "NEUTRAL",
  }));
  const breadth = rows.length
    ? rows.filter((r) => r.aboveEma200).length / rows.length : 0;
  const top4 = ranked.slice(0, 4);
  const bot4 = ranked.slice(-4);
  const dispersion = top4.length && bot4.length
    ? top4.reduce((s, r) => s + r.ret14, 0) / top4.length -
      bot4.reduce((s, r) => s + r.ret14, 0) / bot4.length
    : 0;
  return NextResponse.json({
    source: "binance-futures",
    ts: Date.now(),
    breadth,
    breadthMin: RANK_BREADTH_MIN,
    active: breadth >= RANK_BREADTH_MIN,
    dispersion,
    rows: ranked,
    coinsOk: rows.length,
    coinsTotal: RANKING_COINS.length,
  });
}
```

**Step 3: Verifikasi**

```bash
npm run build                     # harap exit 0
PORT=3106 npm start &
curl -s localhost:3106/api/ranking | head -c 400
```

Harap: `"source":"binance-futures"`, `rows` berisi 16 entri berurutan `ret14`
menurun, `breadth` antara 0–1, `active` boolean.

**Step 4: Commit**

```bash
git add app/api/ranking/route.ts app/lib/indicators.ts
git commit -m "Add ranking endpoint with breadth and dispersion"
```

---

## Task 2: Store rebalance mingguan

**Objective:** Catat snapshot ranking tiap rebalance supaya bisa dievaluasi 3–6 bulan
ke depan. Ini inti nilai jangka panjangnya.

**Files:**
- Create: `app/lib/rankStore.ts`
- Create: `app/api/ranking/snapshot/route.ts`

**Step 1: `app/lib/rankStore.ts`** — ikuti pola `app/lib/store.ts` (JSONL append + dedup)

```typescript
import fs from "fs";
import path from "path";

export type RankSnapshot = {
  id: string;              // "2026-W35" — satu per minggu ISO
  ts: number;
  breadth: number;
  active: boolean;
  dispersion: number;
  picks: { symbol: string; rank: number; ret14: number; entry: number }[];
  resolved?: { symbol: string; exit: number; retPct: number }[];
};

const DIR = process.env.SCREENER_DATA_DIR ?? ".data";
const FILE = path.join(DIR, "rankings.jsonl");
const MAX_RECORDS = 500;

export function isoWeek(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

export function readSnapshots(): RankSnapshot[] { /* baca JSONL, parse per baris */ }
export function appendSnapshot(s: RankSnapshot): { logged: boolean } {
  // dedup by id — satu snapshot per minggu, panggil ulang tidak menambah
}
```

**Step 2: Endpoint POST untuk menyimpan snapshot**

Alasan POST manual, bukan cron: preferensi on-demand. Lo tekan tombol
"CATAT REBALANCE" sekali seminggu.

**Step 3: Verifikasi** — POST dua kali, pastikan yang kedua `logged: false`.

**Step 4: Commit**

---

## Task 3: Halaman `/ranking`

**Objective:** Tiga blok: status pasar, tabel ranking, rebalance history.

**Files:**
- Create: `app/ranking/page.tsx`
- Create: `app/components/BreadthPanel.tsx`
- Create: `app/components/RankTable.tsx`
- Modify: `app/globals.css`

**Layout:**

```text
┌─ STATUS PASAR ──────────────────────────────┐
│ BREADTH   81%  (13/16 di atas EMA200)       │
│ STATUS    AKTIF        ← gate utama          │
│ dispersi  33.9%        (informasi saja)      │
└─────────────────────────────────────────────┘

┌─ RANKING 14 HARI ───────────────────────────┐
│  #  coin   ret14d    harga     zona   streak │
│  1  XRP    +41.40%   1.4198    LONG    3 mgg │
│  2  SOL    +40.71%   106.31    LONG    2 mgg │
│  3  LINK   +33.40%   11.694    LONG    1 mgg │
│  4  ETH    +33.27%   2495.34   LONG    4 mgg │
│  5  BTC    +26.65%   79645.6     -           │
│ ...                                          │
│ 16  ATOM    -3.42%   1.4970      -           │
└─────────────────────────────────────────────┘

┌─ REBALANCE HISTORY ─────────────────────────┐
│ 2026-W34  breadth 78%  hasil +1.2%          │
│ 2026-W33  breadth 62%  hasil -0.4%          │
│ ...                     kumulatif: +4.1%     │
└─────────────────────────────────────────────┘
```

**Aturan tampilan yang WAJIB dipatuhi:**

1. **Tidak ada badge SHORT.** Data menunjukkan leg short merugi (−0,74%).
   Peringkat 13–16 ditampilkan sebagai "lemah", bukan sebagai peluang short.
2. Saat `breadth < 56%`, seluruh zona LONG **diredupkan** + banner:
   `BREADTH RENDAH — riset menunjukkan periode ini tidak menguntungkan`.
3. Dispersi ditampilkan **tanpa** interpretasi on/off (t=+0,83, tidak terbukti).
4. Footer wajib: `Status: paper trading. DSR 0,76 (<0,95). Holdout t=+0,49 —
   belum terbukti cukup untuk uang nyata.`

**Verifikasi:** `curl localhost:3106/ranking | grep -c 'SHORT'` harus **0**.

---

## Task 4: Kombinasi di halaman sinyal — label konteks

**Objective:** Card sinyal tetap ada, ditambah konteks ranking/breadth. **Bukan**
digabung jadi satu skor.

**Files:**
- Modify: `app/api/market/route.ts` (tambah field `rank`, `breadth`, `context`)
- Modify: `app/page.tsx` (render label + banner)

**Kenapa label, bukan skor gabungan** — hasil uji dengan harness BENAR
(`combo_proper.py`: pool ranking, hold 7d fixed, LONG-only, gate breadth).
7 bentuk kombinasi diuji, bukan cuma satu:

```text
K0 baseline (XSMOM murni)           n=300  net=+2.9093%  t=+3.07  PF=1.81
K1 tunggu RSI < 45                  n=127  net=-0.0594%  t=-0.07  PF=0.98
K2 tunggu bullish pattern           n=287  net=+2.8183%  t=+2.98  PF=1.81
K3 tunggu close > EMA50             n=287  net=+3.0251%  t=+3.08  PF=1.83
K4 skip coin SHORT-kuat             n=289  net=+3.3968%  t=+3.51  PF=2.01
K5 sizing by skor confluence        n=300  net=+2.1746%  t=+3.41  PF=2.06
K6 exit awal saat bear pattern      n=300  net=+2.6367%  t=+3.00  PF=1.99
CTRL masuk di bar ACAK              n=300  net=+2.4435%  t=+2.83  PF=1.74

vs baseline K0:
  K1 t=-2.39  -> MEMBURUK signifikan
  K2..K6 t antara -0.64 dan +0.36  -> tidak beda

uji kritis vs masuk ACAK:
  K2 vs CTRL t=+0.29  -> TIDAK beda dari acak
  K3 vs CTRL t=+0.44  -> TIDAK beda dari acak
  K1 vs CTRL t=-2.12  -> lebih buruk dari acak
```

Tiga kesimpulan yang menentukan desain:

1. **K1 (tunggu pullback) merugikan signifikan.** Menunggu RSI turun di coin yang
   sedang momentum kuat membuang justru pergerakan yang mau dipanen, dan memotong
   sampel jadi 127 dari 300. Ini satu-satunya bentuk kombinasi yang aktif merusak.
2. **K2/K3 setara baseline, TAPI masuk di hari acak juga setara.** Jadi yang
   bekerja bukan confluence-nya — mereka cuma tidak merusak.
3. **K4 mean tertinggi (+3,40%) tapi t=+0,36** — tidak bisa dibedakan dari
   kebetulan. Menyorotnya sebagai "terbaik" karena mean tertinggi dari 7 varian
   adalah persis cara overfitting terjadi. JANGAN implementasikan sebagai default.

Karena tidak ada bentuk kombinasi yang terbukti lebih baik dari XSMOM murni,
confluence tetap disajikan **berdampingan** sebagai label, tidak dilebur.

**Label yang ditampilkan di card:**

```typescript
type SignalContext =
  | "SEARAH_RANKING"      // rank <= 4 dan sinyal LONG
  | "BERLAWANAN_RANKING"  // rank > 12 dan sinyal LONG
  | "NETRAL"
  | "BREADTH_RENDAH";     // breadth < 56% — override semua
```

Contoh render:

```text
┌─ AVAX  LONG  skor 4/6 ──────────────────────┐
│ ⚠ skor teknikal — riset: setara entry acak   │
│ RANKING  #10 dari 16   NETRAL                │
│ BREADTH  81%  AKTIF                          │
│ entry 7.4252-7.4410  inval 7.3524            │
└─────────────────────────────────────────────┘
```

**Perubahan teks yang wajib:**
- Badge `LONG`/`SHORT` → tambah subteks `skor teknikal, bukan rekomendasi`
- Banner permanen di atas daftar sinyal:
  `Skor confluence terukur setara entry acak (5.434 trade, t=-11,95). Panel ini
  informasi teknikal; untuk keputusan pakai halaman Ranking.`
- **Peringatan anti-pullback** — muncul kalau coin ada di top-4 ranking DAN
  skor confluence LONG-nya rendah (RSI masih tinggi):
  `Jangan tunggu harga turun untuk masuk coin top-4. Uji: menunggu RSI<45
  menurunkan hasil dari +2,91% ke -0,06% (t=-2,39).`

---

## Task 5: Navigasi + dokumentasi

**Files:**
- Modify: `app/page.tsx`, `app/ranking/page.tsx` (nav antar halaman)
- Modify: `PANDUAN.md` (bagian baru: halaman ranking, cara baca breadth)
- Modify: `README.md`
- Create: `SPEC-XSMOM.md` — spek beku yang di-commit hari ini

**`SPEC-XSMOM.md` isinya:**

```text
lookback   : 14 hari (84 bar 4h, close-to-close)
hold       : 7 hari FIXED — exit di jadwal rebalance
stop       : TIDAK ADA. Jangan tambah stop ATR, jangan tambah trailing.
             Bukti: memasang stop 3xATR menjatuhkan hasil dari +0,62% (t=+2,51)
             ke -0,0016R (t=-0,07). Stop menghancurkan mekanisme ini.
universe   : 16 coin (daftar eksplisit)
posisi     : LONG top-4 saja, bobot sama, TANPA short
gate       : breadth >= 56% (coin di atas EMA200)
rebalance  : mingguan, hari & jam tetap
biaya      : fee 0,065% + funding 0,015%/hari
timing     : masuk di bar rebalance. JANGAN tunggu pullback.
             Bukti: menunggu RSI<45 -> -0,06% (t=-2,39 vs baseline).

DIBEKUKAN 2026-08-28. Jangan diubah selama periode evaluasi.
Ambang keputusan: 12 rebalance = lihat serius, 24 rebalance = boleh bicara uang.
Kalau kumulatif negatif di 24 rebalance -> kandidat gugur.
```

Ini yang membuat evaluasi 6 bulan ke depan punya nilai statistik: spek lebih tua
dari datanya.

---

## Files yang akan berubah

```text
Create:
  app/api/ranking/route.ts
  app/api/ranking/snapshot/route.ts
  app/lib/rankStore.ts
  app/ranking/page.tsx
  app/components/BreadthPanel.tsx
  app/components/RankTable.tsx
  SPEC-XSMOM.md

Modify:
  app/lib/indicators.ts     (RANKING_COINS, konstanta)
  app/api/market/route.ts   (field rank/breadth/context)
  app/page.tsx              (label konteks + banner + nav)
  app/globals.css           (style panel & tabel)
  PANDUAN.md                (bagian halaman ranking)
  README.md
```

## Validasi

```bash
npm run build                                   # exit 0
curl -s localhost:3106/api/ranking | head -c 400
curl -s localhost:3106/ranking | grep -c SHORT  # harus 0
curl -s localhost:3106/api/market | head -c 300 # rows tetap 10, ada field rank
# POST snapshot 2x -> yang kedua logged:false
```

## Risiko & tradeoff

- **Rate limit**: 16 coin × klines 300 = 16 request per load `/api/ranking`.
  Mitigasi: cache 60 detik in-memory (ranking cuma berubah mingguan).
- **RAM**: `next build` berisiko OOM di 1,7 GB. Build satu-satu, jangan paralel.
- **Look-ahead**: bar 4h terakhir WAJIB dibuang. Ini kesalahan paling mudah
  terjadi dan paling merusak.
- **Dua halaman membingungkan**: mitigasi lewat banner eksplisit di halaman sinyal
  yang mengarahkan ke halaman ranking untuk keputusan.
- **Konsentrasi 94% di 3 coin** — tampilkan sebagai catatan kerapuhan di footer
  halaman ranking, jangan disembunyikan.
- **Harness salah = kesimpulan salah.** Kesalahan yang sudah terjadi sekali:
  memaksa XSMOM masuk harness confluence (stop 3×ATR) menghasilkan kesimpulan
  palsu "kombinasi memperburuk". Tiap mekanisme harus diuji di harness-nya
  sendiri; kalau membandingkan dua mekanisme, harness-nya harus dibuat setara
  secara eksplisit, bukan diasumsikan.
- **n=300 leg pada uji kombinasi** — gate breadth memotong banyak periode.
  Efek kecil tidak terdeteksi di sampel ini. Jangan tulis "tidak ada manfaat"
  di UI; tulis "tidak terdeteksi".

## Open questions

1. Universe 16 coin atau diperluas ke 30–40? Memperluas = sampel berbeda (tidak
   menggerus DSR seperti tuning parameter) dan menguji generalisasi. Bonus:
   menaikkan n pada uji kombinasi supaya efek kecil bisa terdeteksi.
2. Snapshot manual (tombol) atau cron mingguan? Rencana ini pakai manual sesuai
   preferensi on-demand.
3. Halaman sinyal dipertahankan permanen atau sampai evaluasi 24 rebalance selesai?
4. K4 (skip coin dengan confluence SHORT ≥ 4) mean-nya tertinggi tapi t=+0,36.
   Dicatat sebagai kandidat untuk dievaluasi ulang setelah 24 rebalance data live,
   **tidak** diimplementasikan sekarang. Kalau diimplementasikan sebagai default
   hari ini, itu overfitting ke 7 varian yang kebetulan diuji.
