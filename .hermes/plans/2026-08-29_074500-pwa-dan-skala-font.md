# Rencana: Screener jadi PWA + font yang bisa diperbesar/diperkecil

> **Untuk Hermes:** kerjakan satu Tahap per giliran, sesuai kebiasaan Alung. TDD di
> modul murni; UI diverifikasi lewat build + bukti bundle produksi.

**Goal:** Screener bisa di-install ke home screen HP sebagai PWA, ukuran hurufnya
sepenuhnya diatur pengguna (bukan hanya oleh developer), dan tata letaknya benar-benar
enak dipakai di layar HP — tanpa mengorbankan versi desktop.

**Arsitektur singkat:** tetap Next.js 14 App Router, zero-dependency baru. PWA lewat
`app/manifest.ts` + service worker statis di `public/`. Skala font lewat konversi
`px → rem` di CSS ditambah pengali `--ui-scale` yang dikontrol pengguna dan disimpan di
`localStorage`. Tata letak HP diperbaiki dengan pola "satu kolom + navigasi seksi",
bukan menumpuk semua panel secara vertikal seperti sekarang.

**Tech stack:** Next.js 14.2.35, React 18.3.1, CSS murni (`app/globals.css`),
`node:test` untuk test, Docker + nginx untuk deploy.

---

## Konteks nyata hari ini (sudah diverifikasi, bukan asumsi)

| Fakta | Nilai | Kenapa penting |
|---|---|---|
| Deklarasi font `px` di `globals.css` | **102** (`font:Npx` 80× + `font-size:Npx` 22×) | Ini akar masalahnya: `px` **mengabaikan** setelan ukuran font browser/OS. Selama masih `px`, pengaturan font di HP Alung tidak akan berpengaruh sama sekali. |
| Ukuran font berbeda yang dipakai | 7, 8, 9, 10, 11, 12, 13, 15, 18, 20, 23, 30, 35, 42, 52 px | Banyak yang **di bawah 12px** (17× ukuran 8px, 31× ukuran 9px) — terlalu kecil untuk HP dan tidak bisa dinaikkan pengguna. |
| `app/layout.tsx` | tidak ada `viewport`, `themeColor`, `manifest` | Tanpa `viewport`, HP me-render halaman selebar ±980px lalu mengecilkannya → semua huruf jadi mikro. |
| Direktori `public/` | **belum ada** | Perlu dibuat untuk ikon + service worker. `Dockerfile` memakai `COPY . .` sehingga `public/` otomatis ikut terbawa — tidak perlu ubah Dockerfile. |
| Media query yang ada | `max-width:600px`, `700px`, `900px` | Titik putus sudah ada tapi hanya mengecilkan grid; tata letak seksi tidak diubah. |
| Font eksternal | `@import` Google Fonts di baris 1 `globals.css` | `@import` memblokir render dan **gagal saat offline**. Untuk PWA ini harus ditangani. |
| SVG chart | `app/components/Chart.tsx`, teks pakai class CSS (`.axis`, `.panelTag`, `.lvlText` = 8px) | Teks chart juga harus ikut skala, tapi **hati-hati**: chart pakai `viewBox`, jadi perlu perlakuan berbeda dari teks biasa. |
| Komponen terdampak | `Dashboard`, `History`, `RiskCalculator`, `DecisionJournal`, `DataHealth`, `SignalAlerts`, `Chart`, `auth/*` | Cakupan perubahan tata letak. |

**Asumsi yang gue pegang:** HP target Redmi Note 8 / ArrowOS (Android), browser Chrome.
Android tidak membatasi PWA seperti iOS, jadi install + Web Push memungkinkan.

---

## Keputusan desain dan alasannya

**1. `rem`, bukan `em`, dengan pengali terpisah.**
`em` menumpuk (anak mewarisi lalu mengalikan lagi) sehingga ukuran jadi tidak
terprediksi di komponen bersarang. `rem` selalu relatif ke akar. Rumusnya:

```
html { font-size: calc(16px * var(--ui-scale)); }   /* dasar */
.foo { font: 0.5625rem 'DM Mono'; }                  /* dulu 9px */
```

Dengan `16px` sebagai basis, konversinya `px / 16`. Tapi **basis tidak dipaku 16px** —
lihat poin 2.

**2. Setelan font OS harus tetap dihormati.**
Kalau `html { font-size: 16px }` ditulis absolut, setelan "ukuran font" di HP Alung
tetap diabaikan — masalahnya cuma berpindah tempat. Yang benar:

```
html { font-size: calc(100% * var(--ui-scale)); }
```

`100%` = ukuran default browser **yang sudah mengikuti setelan OS/browser pengguna**.
`--ui-scale` adalah kontrol tambahan di dalam aplikasi. Jadi ada dua lapis kendali:
setelan HP (global) dan slider di Screener (khusus aplikasi ini).

**3. `user-scalable` TIDAK boleh dimatikan.**
Banyak PWA menulis `maximum-scale=1, user-scalable=no` supaya "terasa seperti app".
Itu mematikan pinch-zoom dan melanggar aksesibilitas. Alung minta pengguna bisa
memperbesar/memperkecil — jadi pinch-zoom dibiarkan hidup **dan** ada slider skala.
Keduanya, bukan salah satu.

**4. Ukuran font minimum dinaikkan di HP.**
Font 7–9px di layar HP praktis tidak terbaca. Di bawah 700px lebar, tangga ukuran
dinaikkan lewat penimpaan token (lihat Tahap 2), bukan dengan mengubah 102 nilai lagi.

**5. Tata letak HP: navigasi seksi, bukan tumpukan panjang.**
Sekarang di HP semua seksi (kartu sinyal → chart → kalkulator → history → jurnal →
health) menumpuk jadi satu halaman yang sangat panjang. Untuk alat keputusan cepat itu
buruk: informasi terpenting (kartu sinyal + status entry) tenggelam. Solusinya bar
navigasi bawah (`SINYAL · HISTORY · JURNAL · HEALTH`) yang menyembunyikan seksi lain.
Di desktop (≥900px) semuanya tetap tampil seperti sekarang.

**6. Service worker sengaja dibuat "bodoh".**
Screener adalah alat keputusan berbasis data harga. Menyajikan data harga dari cache
adalah **bahaya nyata** — Alung bisa melihat harga lima menit lalu dan menganggapnya
sekarang. Aturannya keras: **cache aset statis saja, JANGAN pernah cache respons
`/api/*`.** Offline berarti kerangka aplikasi muncul dengan pesan tegas "TIDAK ADA DATA
— OFFLINE", bukan angka basi.

---

## Tahap 1 — Fondasi PWA (kecil, aman, tidak mengubah tampilan)

**Tujuan:** aplikasi bisa di-install ke home screen dan me-render dengan lebar yang benar di HP.

**File:**
- Ubah: `app/layout.tsx`
- Buat: `app/manifest.ts`
- Buat: `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/maskable-512.png`
- Buat: `app/lib/pwa.test.ts` (validasi bentuk manifest)

**Langkah 1.1 — Tambah viewport + themeColor di `app/layout.tsx`.**

```tsx
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // maximumScale & userScalable SENGAJA tidak diset:
  // mematikan pinch-zoom melanggar permintaan "bisa diperkecil/diperbesar".
  themeColor: "#080a0e",
};
```

**Langkah 1.2 — Buat `app/manifest.ts`** (route manifest bawaan Next, bukan file JSON statis
supaya ikut type-checking):

```ts
import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Screener — Futures Intelligence",
    short_name: "Screener",
    description: "Alat bantu keputusan manual berbasis data Binance Futures",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#080a0e",
    theme_color: "#080a0e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

**Langkah 1.3 — Buat ikon.** Bikin dengan Python/Pillow atau `rsvg-convert` dari SVG
sederhana: latar `#080a0e`, glyph `◈` warna `--green #55d69a`. Ikon `maskable` butuh
padding aman ~10% di tiap sisi supaya tidak terpotong saat Android memberi bentuk bulat.

**Langkah 1.4 — Verifikasi.**
```bash
npm run build 2>&1 | grep -E 'Compiled|Error'
npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)'
```
Lalu setelah deploy, dari luar: `curl -s https://scansignal.my.id/manifest.webmanifest`
harus mengembalikan JSON di atas. **Catatan:** `/manifest.webmanifest` harus bisa diakses
**tanpa login**, kalau tidak Chrome tidak akan menawarkan install. Perlu cek
`middleware.ts` / `guard()` tidak memblokirnya.

**Langkah 1.5 — Commit:** `Add installable PWA manifest, icons, and mobile viewport`

---

## Tahap 2 — Skala font yang dikontrol pengguna (inti permintaan Alung)

**Tujuan:** semua huruf ikut setelan OS **dan** bisa diperbesar/diperkecil dari dalam
aplikasi, tersimpan antar sesi.

**File:**
- Buat: `app/lib/ui-scale.ts` + `app/lib/ui-scale.test.ts` (modul murni)
- Buat: `app/components/ScaleControl.tsx`
- Ubah: `app/globals.css` (konversi 102 deklarasi + token)
- Ubah: `app/layout.tsx` (skrip anti-flash)
- Ubah: `app/components/Dashboard.tsx` (pasang kontrol)

**Langkah 2.1 — Modul murni `app/lib/ui-scale.ts` (TDD, tulis test dulu).**

```ts
export const SCALE_STEPS = [0.85, 0.925, 1, 1.1, 1.25, 1.4, 1.6] as const;
export const DEFAULT_SCALE = 1;
export const SCALE_KEY = "screener_ui_scale_v1";

export function clampScale(value: unknown): number   // nilai asing/NaN → DEFAULT_SCALE
export function nextScale(current: number, direction: 1 | -1): number  // berhenti di ujung
export function scaleLabel(value: number): string    // "100%", "125%"
```

Test yang wajib ada (RED dulu):
- nilai di luar daftar dibulatkan ke langkah terdekat yang sah
- `"abis"`, `null`, `NaN`, `Infinity`, `-2` → `DEFAULT_SCALE`
- `nextScale` di langkah terkecil dengan arah `-1` tetap di langkah terkecil (tidak melewati batas)
- `scaleLabel(0.925)` → `"93%"` (pembulatan, bukan `92.5%`)

**Langkah 2.2 — Tangga token di `globals.css`.** Tambah di `:root`, JANGAN ubah 102 nilai
satu-satu secara acak — pakai token supaya bisa ditimpa di HP:

```css
:root{
  --ui-scale:1;
  --fs-3xs:0.4375rem; /* 7px  */
  --fs-2xs:0.5rem;    /* 8px  */
  --fs-xs:0.5625rem;  /* 9px  */
  --fs-sm:0.625rem;   /* 10px */
  --fs-md:0.6875rem;  /* 11px */
  --fs-lg:0.75rem;    /* 12px */
  --fs-xl:0.8125rem;  /* 13px */
  --fs-2xl:0.9375rem; /* 15px */
  /* judul besar tetap clamp() supaya tidak meledak di layar kecil */
}
html{font-size:calc(100% * var(--ui-scale));}
```

**Langkah 2.3 — Konversi 102 deklarasi.** Lakukan dengan skrip Python (`re.sub`) yang
memetakan tiap `font:Npx` / `font-size:Npx` ke token yang sesuai, lalu **periksa
diff-nya manual**. Jangan percaya hasil skrip tanpa dibaca.

⚠️ **Jebakan yang harus dihindari:** properti singkat `font:` **wajib** menyertakan
`font-family`. `font:var(--fs-xs)` saja adalah CSS tidak sah dan akan menghapus seluruh
deklarasi. Harus `font:var(--fs-xs) 'DM Mono'`. Sesudah konversi, hitung ulang:
`grep -c "font:var(--fs" app/globals.css` harus cocok dengan jumlah semula.

**Langkah 2.4 — Naikkan tangga di HP.** Satu blok, bukan puluhan penimpaan:

```css
@media(max-width:700px){
  :root{
    --fs-3xs:0.5625rem; /* 7→9   */
    --fs-2xs:0.625rem;  /* 8→10  */
    --fs-xs:0.6875rem;  /* 9→11  */
    --fs-sm:0.75rem;    /* 10→12 */
    --fs-md:0.8125rem;  /* 11→13 */
  }
}
```

**Langkah 2.5 — `ScaleControl.tsx`.** Tombol `A−` / `A+` + label persen + tombol `RESET`.
Menulis `--ui-scale` ke `document.documentElement.style` dan menyimpan ke `localStorage`.
Letakkan di topbar (desktop) dan di panel setelan (HP).

**Langkah 2.6 — Cegah kedip.** Skala dibaca dari `localStorage` yang tidak tersedia saat
render server, jadi halaman akan sempat tampil di skala 100% lalu melompat. Pasang skrip
kecil `beforeInteractive` di `<head>` yang menerapkan `--ui-scale` sebelum paint pertama.

**Langkah 2.7 — Teks di dalam SVG chart.** `Chart.tsx` memakai `viewBox`, jadi teksnya
ikut diskalakan oleh lebar SVG, **bukan** oleh `rem`. Menerapkan `rem` di sini akan
membuat teks berubah dua kali. Perlakuan: biarkan teks chart dalam satuan `viewBox`, tapi
naikkan ukurannya di HP dan **verifikasi visual** bahwa label sumbu tidak tumpang tindih.
Ini satu-satunya bagian yang tidak ikut slider — harus dicatat jujur di `PANDUAN.md`.

**Langkah 2.8 — Verifikasi:** `npm test`, `tsc`, `npm run build`, lalu cek jumlah token
dan pastikan tidak ada `font:` yang kehilangan `font-family`.

**Langkah 2.9 — Commit:** `Let the reader control text size instead of hardcoding pixels`

---

## Tahap 3 — Tata letak yang layak dipakai di HP

**Tujuan:** informasi terpenting terlihat lebih dulu; halaman tidak lagi jadi tumpukan sepanjang layar.

**File:** `app/components/Dashboard.tsx`, `app/globals.css`, komponen seksi terkait.

**Langkah 3.1 — Navigasi seksi di bawah (hanya <900px).** Bar tetap di bawah (aman dari
jempol) dengan empat tab: `SINYAL`, `HISTORY`, `JURNAL`, `HEALTH`. State tab disimpan
sehingga tidak reset saat data 30 detik masuk. Di ≥900px bar disembunyikan dan semua
seksi tampil seperti sekarang — versi desktop tidak dirugikan.

**Langkah 3.2 — Ringkas hero di HP.** `.hero h1` sekarang `52px` di HP dan memakan hampir
seluruh layar pertama tanpa memberi informasi. Di HP: kecilkan, dan angkat ringkasan
yang berguna (jumlah sinyal, status data, waktu update) ke atas.

**Langkah 3.3 — Kartu sinyal: yang penting di atas.** Urutan baru di HP:
coin + arah + skor → **STATUS ENTRY realtime** → level rencana → indikator → alasan.
Blok indikator dan alasan dijadikan bisa dilipat (`<details>`) supaya kartu tidak panjang.

**Langkah 3.4 — Tabel yang tidak bisa dibaca di HP.** `.statTable` dengan
`white-space:nowrap` memaksa geser horizontal. Di <700px ubah jadi kartu bertumpuk
(label di atas nilai) — khususnya tabel jurnal dan history.

**Langkah 3.5 — Target sentuh.** Banyak tombol sekarang `padding:6px` dengan font 7px.
Di HP minimum tinggi sentuh **44px**. Berlaku untuk `.cardDecisionBtns`, `.rangeBtns`,
`.filters button`.

**Langkah 3.6 — Area aman.** Di mode `standalone`, bar bawah bisa tertutup gesture bar
Android. Pakai `padding-bottom:env(safe-area-inset-bottom)`.

**Langkah 3.7 — Verifikasi.** `npm test`, `tsc`, `build`. Untuk bukti visual: render di
beberapa lebar (360, 412, 768, 1440) dan periksa tidak ada scroll horizontal serta tidak
ada teks terpotong. **Batas jujur:** `computer_use` di lingkungan ini gagal
(`browser_pid_required`), jadi verifikasi visual otomatis tidak tersedia — keputusan
akhir "enak dipakai" harus dari mata Alung di HP-nya sendiri.

**Langkah 3.8 — Commit:** `Rebuild the mobile layout around the decision, not the page order`

---

## Tahap 4 — Service worker + perilaku offline yang jujur

**Tujuan:** aplikasi bisa dibuka dari home screen walau jaringan buruk, **tanpa** pernah
menampilkan harga basi sebagai harga sekarang.

**File:** `public/sw.js`, `app/components/ServiceWorker.tsx`, `app/lib/offline.ts` + test.

**Langkah 4.1 — `public/sw.js` dengan aturan keras:**
- `install`: pre-cache kerangka statis saja (`/`, ikon, CSS/JS build).
- `fetch`: kalau URL mengandung `/api/`, **selalu** langsung ke jaringan; kalau gagal,
  kembalikan error — **jangan** pakai cache. Aset statis: cache-first.
- `activate`: hapus cache versi lama.

**Langkah 4.2 — Penanda offline di UI.** Modul murni `offline.ts` memutuskan kapan status
"OFFLINE / DATA TIDAK DAPAT DIPERCAYA" ditampilkan. Panel `DataHealth` yang sudah ada
sekarang tinggal menampilkannya — dan karena Tahap sebelumnya sudah menambahkan deteksi
`STALE`, payload basi otomatis ketahuan.

**Langkah 4.3 — Font offline.** `@import` Google Fonts di baris 1 `globals.css` gagal saat
offline sehingga huruf jatuh ke fallback dan tata letak bergeser. Dua pilihan, minta
keputusan Alung: (a) host file font sendiri di `public/fonts/` — offline rapi, repo lebih
berat; (b) biarkan, terima pergeseran huruf saat offline. Rekomendasi gue: **(a)**,
sekalian menghapus ketergantungan ke Google.

**Langkah 4.4 — Jebakan update.** Service worker yang salah bisa "mengunci" pengguna di
versi lama setelah deploy — gejalanya: Alung sudah gue deploy tapi layarnya tidak berubah.
Wajib: `skipWaiting()` + `clients.claim()`, nama cache dibubuhi versi build, dan
verifikasi setelah deploy bahwa aset baru benar-benar terambil.

**Langkah 4.5 — Commit:** `Cache the shell offline without ever serving stale market data`

---

## File yang kemungkinan berubah

| File | Tahap |
|---|---|
| `app/layout.tsx` | 1, 2 |
| `app/manifest.ts` (baru) | 1 |
| `public/icons/*` (baru) | 1 |
| `app/lib/ui-scale.ts` + `.test.ts` (baru) | 2 |
| `app/components/ScaleControl.tsx` (baru) | 2 |
| `app/globals.css` | 2, 3 |
| `app/components/Dashboard.tsx` | 2, 3 |
| `app/components/{History,DecisionJournal,RiskCalculator,DataHealth,Chart}.tsx` | 3 |
| `public/sw.js`, `app/components/ServiceWorker.tsx` (baru) | 4 |
| `app/lib/offline.ts` + `.test.ts` (baru) | 4 |
| `PANDUAN.md` | tiap Tahap |

`Dockerfile` **tidak** perlu diubah (`COPY . .` sudah mencakup `public/`).

---

## Test & verifikasi

Per Tahap, wajib lulus semuanya:
```bash
npx tsc -p tsconfig.json --noEmit
npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)'    # sekarang 102 pass, harus naik
npm run build 2>&1 | grep -E 'Compiled|Error'
```
Setelah deploy: HTTP 200 di `/login` dan `/`, `401` untuk `/api/*` anonim, `manifest.webmanifest`
200 tanpa login, dan string fitur benar-benar ada di bundle produksi (bukan cuma di kode lokal).

Test baru yang berbobot (bukan test kosmetik):
- `clampScale` menolak nilai `localStorage` yang rusak/asing
- `nextScale` tidak bisa melewati batas atas/bawah
- keputusan penanda offline: online→OK, offline→tidak boleh menampilkan angka sebagai terkini
- aturan service worker: URL `/api/` tidak boleh pernah dijawab dari cache

---

## Risiko & konsekuensi jujur

1. **Konversi 102 deklarasi font berisiko merusak tampilan diam-diam.** Kesalahan
   `font:` tanpa `font-family` membuat aturan dibuang tanpa error. Mitigasi: skrip +
   baca diff + hitung ulang jumlah token.
2. **Perubahan tata letak menyentuh hampir semua komponen.** Kalau ada satu Tahap yang
   gagal, jangan didorong ke produksi bersamaan — Tahap 3 layak dipecah lagi kalau
   diff-nya terlalu besar.
3. **Service worker adalah bagian paling berbahaya di rencana ini.** Kesalahan di sini
   bisa menyajikan aplikasi versi lama secara permanen. Ini sebabnya ia ditaruh
   **paling akhir**, setelah tiga Tahap yang tidak berisiko.
4. **PWA ≠ notifikasi 24/7.** Tahap 1–4 membuat aplikasi bisa di-install dan nyaman,
   tapi notifikasi saat tab tertutup **tetap butuh Web Push (poin 6)** yang belum
   dikerjakan. Jangan sampai Alung mengira install PWA otomatis memberi notifikasi latar.
5. **Suara alert tidak ikut ke notifikasi sistem.** Nada WebAudio tiga nada hanya
   berbunyi saat halaman hidup. Notifikasi push memakai suara channel Android.
6. **Manajemen baterai ArrowOS/MIUI** bisa membunuh service worker sehingga notifikasi
   telat. Ini di luar kendali kode; perlu pengecualian optimasi baterai untuk Chrome.
7. **Verifikasi visual otomatis tidak tersedia** (`computer_use` gagal dengan
   `browser_pid_required`). Penilaian akhir UX harus dari Alung.

---

## Pertanyaan terbuka (butuh keputusan Alung)

1. **Font offline:** host sendiri di `public/fonts/` (rapi, repo berat) atau biarkan
   memakai Google Fonts (huruf bergeser saat offline)? Rekomendasi: host sendiri.
2. **Navigasi tab di HP:** setuju kartu sinyal jadi tab default dan seksi lain
   disembunyikan? Alternatifnya tetap satu halaman panjang tapi dengan seksi terlipat.
3. **Urutan kerja:** Tahap 1+2 dulu (install + skala font — langsung terasa), lalu
   evaluasi di HP sebelum lanjut ke Tahap 3? Rekomendasi: ya, karena Tahap 3 paling
   subjektif dan lebih baik dinilai setelah lo pegang sendiri.
4. **Nasib poin 6 (Web Push):** dikerjakan setelah Tahap 4, atau disela lebih awal?
   Ingat RAM VM tersisa ~1,7 GB dan Web Push butuh proses server yang hidup terus.
