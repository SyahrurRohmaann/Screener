# Kitab Pedoman Screener

Panduan lengkap dashboard Screener — dari nol sampai paham tiap angka di layar.
Ditulis untuk pemula. Kalau ada istilah yang belum jelas, cek **Kamus Istilah** di bagian akhir.

---

## Daftar Isi

0. [Eksperimen forward ranking](#0-eksperimen-forward-ranking)
0b. [Login, sesi, dan ganti password](#0b-login-sesi-dan-ganti-password)
0c. [Keamanan: yang wajib lo lakukan](#0c-keamanan-yang-wajib-lo-lakukan)
0d. [Journal keputusan manual](#0d-journal-keputusan-manual)
1. [Screener ini apa, dan bukan apa](#1-screener-ini-apa-dan-bukan-apa)
2. [Cara buka dan jalanin](#2-cara-buka-dan-jalanin)
3. [Tur layar: apa saja yang kelihatan](#3-tur-layar-apa-saja-yang-kelihatan)
4. [Mesin sinyal: dari candle jadi LONG/SHORT](#4-mesin-sinyal-dari-candle-jadi-longshort)
5. [Membaca kartu sinyal baris per baris](#5-membaca-kartu-sinyal-baris-per-baris)
6. [Rencana trade: entry, stop, TP](#6-rencana-trade-entry-stop-tp)
7. [Status sinyal dan umurnya](#7-status-sinyal-dan-umurnya)
8. [Panel konteks: funding, OI, ratio](#8-panel-konteks-funding-oi-ratio)
9. [Chart 30m](#9-chart-30m)
10. [Filter](#10-filter)
11. [Risk Calculator](#11-risk-calculator)
12. [Signal History & Evaluasi](#12-signal-history--evaluasi)
13. [Semua parameter environment](#13-semua-parameter-environment)
14. [API: buat dipakai sendiri](#14-api-buat-dipakai-sendiri)
15. [Alur kerja harian](#15-alur-kerja-harian)
16. [Contoh kasus lengkap](#16-contoh-kasus-lengkap)
17. [Batasan yang harus lo tahu](#17-batasan-yang-harus-lo-tahu)
18. [Troubleshooting](#18-troubleshooting)
19. [Kamus istilah](#19-kamus-istilah)

---

## 0. Eksperimen forward ranking

Buka `/ranking` untuk eksperimen yang **terpisah** dari kartu sinyal. `PREVIEW
LIVE` hanya urutan kalau dihitung sekarang; preview bukan bukti. `SNAPSHOT AKTIF`
adalah catatan immutable yang hanya dapat dibuat Senin 08:00–08:30 UTC setelah
semua 16 coin lengkap dan timestamp-nya sama.

Aturan beku ada di `SPEC-XSMOM-FORWARD.md`: return 14 hari dari 84 candle 4h
tertutup, top-4 paper equal-weight, entry di open berikutnya, dan benchmark
equal-weight 16. Top-4 berarti **PAPER SELECTION**, bukan rekomendasi LONG.
Breadth `% di atas EMA200` hanya konteks, bukan trade gate. Sinyal 30m/1h tidak
memfilter, menunda, membobot, atau menutup portfolio ranking.

Satu minggu adalah satu observasi portfolio. Checkpoint 12 minggu hanya audit
operasional; 26 belum cukup bukti; 52 evaluasi awal; 104 evaluasi lanjut dan
tetap bukan jaminan. Formation terlewat menjadi `MISSED`, bukan diisi mundur.
Data 15/16 adalah `INCOMPLETE` dan tidak boleh menjadi snapshot.

Data ada di `${SCREENER_DATA_DIR}/ranking-snapshots.jsonl` (biasanya `/data`).
Untuk backup/restore: hentikan app, salin/pulihkan file utuh, lalu start lagi;
jangan merge atau edit baris. Volume `screener_data:/data` harus tetap terpasang
saat recreate. POST snapshot wajib sudah login, same-origin, **dan** membawa
Bearer `RANKING_SNAPSHOT_TOKEN` — tanpa token terkonfigurasi endpoint itu mati
total (fail closed). Situsnya kini sudah di balik login dan HTTPS.

Ini paper research, melarang uang nyata dan leverage. Fixed universe punya
survivorship bias; late sample historis rugi 33,9%; drawdown historis sekitar
70%; paper fill bukan real fill; past performance bukan jaminan.

---

## 0b. Login, sesi, dan ganti password

Website ini sekarang **tertutup**. Buka alamatnya, yang muncul pertama adalah
halaman login. Semua halaman dan semua endpoint API ikut terkunci — tanpa login,
`/` dan `/ranking` dialihkan ke `/login`, dan setiap `/api/...` menjawab `401`.
Jadi orang lain tidak bisa menarik data lewat API walau dia tahu URL-nya.

### Password awal

Password awal adalah **`098123plm`**. Saat aplikasi jalan pertama kali, password
itu langsung diubah menjadi hash `scrypt` dengan salt acak 32 byte dan disimpan
di `${SCREENER_DATA_DIR}/auth.json` dengan izin file `600`. Password aslinya
tidak pernah ditulis ke disk maupun ke repo.

Contoh isi `auth.json` (nilai dipotong):

```json
{"salt":"9f3c…","hash":"2b81…","passwordVersion":1,"sessions":[],"failures":[]}
```

Kalau lo lupa password: hentikan app, hapus `auth.json`, start lagi. Password
kembali ke `098123plm` dan semua sesi hilang. Snapshot ranking tidak terpengaruh
karena file-nya berbeda.

### Sesi mati setelah 2 jam idle

Setelah login, browser dapat cookie `screener_session` berisi id acak 32 byte.
Cookie-nya `HttpOnly` (JavaScript halaman tidak bisa membacanya) dan
`SameSite=Lax` (situs lain tidak bisa memakainya diam-diam).

Timeout-nya **idle 2 jam**, dan hitungannya digeser tiap ada aktivitas:

- buka jam 09:00, klik-klik sampai 11:30, lalu diam → sesi mati sekitar 13:30;
- buka jam 09:00, langsung tinggal → sesi mati jam 11:00;
- tab dibiarkan terbuka tanpa aktivitas tetap dihitung idle.

Kalau sudah kedaluwarsa, halaman balik ke login dan API menjawab `401`. Tinggal
login ulang.

Salah password 10 kali dalam 15 menit membuat login **terkunci** sampai jendela
15 menit itu lewat, walau setelahnya lo masukkan password yang benar.

### Ganti password dari dalam web

Di kanan atas halaman utama dan `/ranking` ada tombol `AKUN` dan `KELUAR`.
Klik `AKUN`, lalu isi tiga kolom: password sekarang, password baru (minimal 8
karakter), dan ulangi password baru. Tekan `GANTI PASSWORD`.

Yang terjadi setelah berhasil:

- salt baru dibuat dan hash dihitung ulang, `passwordVersion` naik;
- **semua perangkat lain otomatis keluar**, browser yang lo pakai tetap masuk;
- password lama langsung ditolak.

Kalau password sekarang salah, jawabannya `Password sekarang salah.` dan tidak
ada yang berubah. Kalau password baru di bawah 8 karakter, juga ditolak.

### TLS: sudah terpasang

Password dikirim dari browser ke server saat login, jadi tanpa HTTPS kiriman itu
polos di jaringan. Di VPS, TLS **sudah aktif**: nginx memegang 443, port 80
dialihkan otomatis ke HTTPS, dan `SCREENER_COOKIE_SECURE=1` sudah menyala
sehingga cookie sesi ditandai `Secure`. Detail pemasangan ada di bagian 2.

Sertifikatnya asli dari Let's Encrypt untuk `scansignal.my.id`, jadi tidak ada
peringatan browser dan perpanjangannya otomatis tiap 90 hari.

Kalau lo memasang ini di tempat lain, urutannya penting: **HTTPS dulu, flag
kemudian**. Flag itu sengaja tidak diikat ke `NODE_ENV` — kalau cookie ditandai
`Secure` padahal situsnya masih HTTP biasa, browser tidak akan pernah mengirim
cookie balik dan login akan muter terus tanpa pesan error yang jelas.

---

## 0c. Keamanan: yang wajib lo lakukan

Dua hal ini belum beres dan hanya lo yang bisa menyelesaikannya.

### 1. Ganti password web

Password `098123plm` tertulis di file ini, ada di riwayat chat, dan kebetulan
sama dengan passphrase kunci SSH. Kalau salah satu bocor, dua-duanya ikut jebol.
Login, klik `AKUN`, ganti ke password yang **berbeda** dari passphrase SSH.

### 2. Rotasi kunci SSH VPS

Kunci privat VPS pernah dikirim lewat chat, jadi anggap sudah tidak rahasia.
Bikin kunci baru lalu buang yang lama:

```bash
# di VPS
ssh-keygen -t ed25519 -C "laptop-alung" -f ~/.ssh/id_ed25519_new
cat ~/.ssh/id_ed25519_new.pub >> ~/.ssh/authorized_keys

# tes dari mesin lo, JANGAN tutup sesi lama dulu
ssh -i ~/.ssh/id_ed25519_new ubuntu@IP-VPS 'echo OK'

# kalau berhasil, hapus baris kunci lama
nano ~/.ssh/authorized_keys
```

Jangan hapus kunci lama sebelum kunci baru terbukti bisa login — kalau keliru
urutannya, lo terkunci di luar VPS sendiri.

### Yang sudah dikerjakan (tidak perlu lo urus)

- Semua halaman dan API tertutup di balik login; tanpa sesi, API menjawab `401`.
- Password disimpan sebagai hash `scrypt` + salt acak, file mode `600`.
- Sesi mati setelah 2 jam idle; 10 kali salah password mengunci login 15 menit.
- Port `8643` ditutup dari internet, hanya nginx yang boleh menjangkaunya.
- HTTPS aktif di 443, HTTP 80 dialihkan otomatis.
- Header `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, `same-origin` aktif.
- Token snapshot acak disimpan mode `600`, tidak pernah masuk repo.

### Yang masih jadi batasan

- Satu password untuk satu operator; belum ada multi-user atau 2FA.
- Rate limit login disimpan di file, cukup untuk satu instance saja.

---

## 0d. Journal keputusan manual

Setiap kartu sinyal aktif sekarang punya tiga keputusan operator:

- **AMBIL PAPER** — catat actual entry paper dan actual risk dalam persen. Nilai awal
  diisi dari rencana sinyal tetapi harus lo cek dan boleh lo ubah sebelum simpan.
- **PANTAU** — catat bahwa sinyal sengaja dipantau tanpa mengarang fill atau outcome.
- **LEWATI** — pilih alasan (`risk terlalu besar`, `sudah terlambat`, `struktur tidak
  jelas`, `event risk`, atau `lainnya`) dan tambahkan catatan bebas bila perlu.

Satu identitas sinyal (`coin + waktu candle tutup`) hanya boleh punya satu keputusan
awal. Saat disimpan, server membekukan timestamp keputusan dan inti sinyal yang terlihat
saat itu: side, score/mode, harga, seluruh level rencana, indikator, dan alasan konfluensi.
Journal di bawah kartu bisa difilter menurut aksi dan coin. Karena datanya server-side,
catatan yang sama terlihat dari perangkat lain setelah login.

Data append-only ada di `${SCREENER_DATA_DIR}/signal-decisions.jsonl`, jadi volume
`SCREENER_DATA_DIR` wajib tetap terpasang saat recreate/deploy dan file ini harus ikut
backup. `POST /api/decisions` hanya menerima sesi login aktif dan request same-origin;
request lintas situs ditolak. `GET /api/decisions` juga tetap di balik login.

Journal ini adalah **bukti keputusan manual**, bukan koneksi exchange. Menekan tombol
apa pun tidak membuat order, tidak memakai uang nyata, dan tidak menciptakan hasil trade
palsu. Kalau kelak perlu mencatat perkembangan, tambahkan event status append-only yang
benar-benar diamati; jangan menulis outcome yang tidak terjadi.

---

## 1. Screener ini apa, dan bukan apa

**Screener = penyaring perhatian.** Dia mantau 10 coin sekaligus, dan bilang
"eh, di AVAX ada beberapa kondisi teknikal yang kebetulan barengan, coba lihat".
Itu saja. Selebihnya keputusan lo.

### Yang dia lakukan

- Ambil data candle dari Binance Futures tiap 30 detik
- Hitung indikator (EMA, RSI, volume) di candle 30 menit yang **sudah tutup**
- Kasih skor konfluensi 0–6
- Kalau skor cukup, hitung ancar-ancar entry, stop, dan target
- Catat semua sinyal, lalu evaluasi hasilnya belakangan

### Yang dia TIDAK lakukan

- ❌ Tidak eksekusi order. Tidak terhubung ke akun lo. Tidak butuh API key.
- ❌ Tidak jamin profit. Skor 6/6 tetap bisa rugi.
- ❌ Tidak menggantikan analisa chart lo sendiri.
- ❌ Tidak kasih rekomendasi leverage.

### Kenapa penting lo baca ini

Riset di strategi sebelumnya menemukan edge per sinyal cuma sekitar
**0.05%–0.14%**, sementara fee taker Binance sekitar **0.15% bolak-balik**.
Artinya: sinyal mentah dari sistem ini, kalau ditradingkan buta-butaan,
kemungkinan besar **rugi karena fee**.

Jadi fungsi sebenarnya alat ini: **mengecilkan 10 coin jadi 1–2 coin yang layak
lo buka chartnya.** Kalau lo pakai sebagai tombol "entry otomatis", lo bakar duit.

---

## 2. Cara buka dan jalanin

### Buka di browser

```text
https://scansignal.my.id
```

`www.scansignal.my.id` juga jalan. Perhatikan **`https`**, bukan `http`, dan
**tanpa** `:8643`. Port 8643 cuma bisa diakses dari dalam VPS; dari internet yang
terbuka hanya 80 (dialihkan otomatis ke HTTPS) dan 443.

Sertifikatnya asli dari Let's Encrypt, jadi **tidak ada peringatan browser** —
ikon kunci langsung hijau. Kalau lo masih lihat peringatan, berarti lo membuka
lewat alamat IP, bukan lewat domain; sertifikat hanya sah untuk nama domain.

Yang muncul pertama adalah **halaman login**, bukan dashboard. Password awal
`098123plm`; baca bagian 0b untuk sesi 2 jam dan cara menggantinya.

Kalau lo pakai `http://scansignal.my.id:8643` seperti dulu, hasilnya timeout. Itu
disengaja: kalau port itu terbuka, orang bisa melewati nginx dan HTTPS-nya, lalu
menarik data lewat HTTP polos.

### Jalanin di server (Docker Compose)

Di `~/ai-stack/docker-compose.yaml`:

```yaml
  screener-dashboard:
    build:
      context: /home/ubuntu/Screener
      dockerfile: Dockerfile
    container_name: screener_dashboard
    restart: unless-stopped
    ports:
      - "127.0.0.1:8643:3000"
    volumes:
      - screener_data:/data
    environment:
      NODE_ENV: production
      SCREENER_DATA_DIR: /data
      SCREENER_COINS: BTC,ETH,SOL,XRP,BNB,DOGE,ADA,AVAX,LINK,DOT
      SCREENER_MIN_SCORE: "4"
      SCREENER_FEE_PCT: "0.1"
      SCREENER_COOKIE_SECURE: "1"
      RANKING_SNAPSHOT_TOKEN: "<token acak, lihat ~/Screener/.snapshot-token>"
    networks:
      - ai-network

volumes:
  screener_data:
```

Deploy / update:

Dua baris yang gampang salah:

- `127.0.0.1:8643:3000` — tanpa `127.0.0.1:` di depan, port 8643 terbuka ke
  seluruh internet dan siapa pun bisa melewati nginx beserta HTTPS-nya. Angka
  `3000` di kanan adalah port Next.js di dalam container, jangan diubah.
- `SCREENER_COOKIE_SECURE: "1"` — aman dinyalakan **karena** HTTPS sudah jalan.
  Jangan nyalakan di lingkungan yang masih HTTP biasa.

Token snapshot dibuat sekali, disimpan mode 600. Kalau hilang, bikin baru lalu
samakan nilainya di compose:

```bash
head -c 32 /dev/urandom | base64 | tr -d '\n=/+' > ~/Screener/.snapshot-token
chmod 600 ~/Screener/.snapshot-token
```

Deploy / update (jalankan sebagai user `ubuntu` di VPS):

```bash
cd ~/Screener && git pull origin main
cd ~/ai-stack
docker compose build screener-dashboard
docker compose up -d --force-recreate screener-dashboard
docker compose ps
```

Yang benar keluar:

```text
screener_dashboard   Up   127.0.0.1:8643->3000/tcp
```

Kalau yang muncul `0.0.0.0:8643->3000/tcp`, prefix `127.0.0.1:` hilang dan app lo
terekspos langsung ke internet — perbaiki compose lalu recreate.

> **Penting:** port 8642 milik Hermes Gateway — jangan disentuh, jangan di-proxy.

Cek cepat setelah deploy, dari dalam VPS:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8643/login      # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8643/api/market # 401
```

`401` pada `/api/market` justru tanda benar: tanpa login, API tidak memberi data.

### TLS di depan container

Next.js tidak memegang sertifikat sendiri; nginx yang menerima HTTPS lalu
meneruskan ke app:

```text
browser --HTTPS 443--> nginx --HTTP 127.0.0.1:8643--> container Next.js
```

Hop kedua memang HTTP biasa, tapi aman karena tidak pernah keluar dari mesin:
container hanya listen di loopback.

**Kondisi terpasang saat ini:**

| Bagian | Nilai |
|---|---|
| Domain | `scansignal.my.id` + `www.scansignal.my.id` |
| nginx | 1.28.3, port 80 (redirect 301) dan 443 |
| Sertifikat | **Let's Encrypt asli** (issuer `YE1`), SAN dua domain, berlaku 90 hari |
| Auto-renew | `certbot.timer` enabled + active, `renew --dry-run` sukses |
| Config aktif | `/etc/nginx/sites-enabled/screener` (dari `deploy/nginx/screener.conf`) |
| Container | `127.0.0.1:8643` — tertutup dari internet |
| Cookie | `SCREENER_COOKIE_SECURE=1` → `Secure` + HSTS aktif |
| Port 8642 | tidak disentuh, tidak di-proxy |

`sites-enabled/default` bawaan nginx sudah dinonaktifkan supaya tidak menyerobot
`default_server` di port 80.

Sertifikat lama yang self-signed masih ada di `/etc/nginx/ssl/` dan confignya di
`deploy/nginx/screener-selfsigned.conf` — dipakai hanya kalau lo perlu jalan tanpa
domain. Selama domain aktif, yang berlaku adalah `screener.conf`.

Verifikasi dari luar VPS — tidak perlu `-k` lagi karena sertifikatnya dipercaya:

```bash
DOM=scansignal.my.id
curl -sI  http://$DOM/               # 301 ke https
curl -sI  https://$DOM/login         # HTTP/2 200
curl -s -o /dev/null -w '%{http_code}\n' https://$DOM/api/market   # 401
curl -s -o /dev/null -w '%{http_code}\n' http://$DOM:8643/login    # harus gagal
```

Baris terakhir **harus gagal** (kode `000` = tidak tersambung). Kalau justru
`200`, port 8643 masih terbuka ke internet dan HTTPS lo bisa dilewati.

Kalau `curl` tanpa `-k` sukses, artinya rantai sertifikatnya sah — itu bukti yang
lebih kuat daripada melihat ikon kunci di browser.

### Cara sertifikat Let's Encrypt dipasang (sudah dilakukan)

Ada skrip yang mengerjakan seluruh urutan ini dan **menolak jalan** kalau
prasyaratnya belum benar, supaya tidak gagal separuh jalan:

```bash
cd ~/Screener && git pull origin main
bash deploy/enable-letsencrypt.sh scansignal.my.id www.scansignal.my.id
```

Enam langkahnya: cek A record → uji ACME path lewat HTTP → pasang certbot →
terbitkan sertifikat → pasang vhost domain → verifikasi + `renew --dry-run`.

**Dua prasyarat yang paling sering bikin gagal.**

Pertama, A record domain harus sudah menunjuk IP VPS. Let's Encrypt memvalidasi
dengan mengambil `http://<domain>/.well-known/acme-challenge/…`, jadi kalau
domainnya masih nunjuk hosting lain, permintaan itu mendarat di server yang salah
dan validasinya pasti gagal. Cek dulu:

```bash
getent hosts scansignal.my.id      # harus keluar IP VPS lo
curl -s ifconfig.me                # IP VPS, jalankan di VPS
```

Kedua, path ACME **tidak boleh** ikut di-redirect ke HTTPS. Ini jebakan yang
kejadian waktu pemasangan: config port 80 mengalihkan *semua* request ke HTTPS,
termasuk `/.well-known/acme-challenge/`, sehingga certbot ketemu sertifikat
self-signed yang tidak dipercaya dan gagal. Perbaikannya satu baris sebelum
`return 301`:

```nginx
location /.well-known/acme-challenge/ { root /var/www/html; }
location / { return 301 https://$host$request_uri; }
```

Setiap kegagalan validasi dihitung ke rate limit Let's Encrypt, jadi uji dulu
manual sebelum memanggil certbot:

```bash
echo tes | sudo tee /var/www/html/.well-known/acme-challenge/tes
curl -s http://scansignal.my.id/.well-known/acme-challenge/tes   # harus balas "tes"
sudo rm /var/www/html/.well-known/acme-challenge/tes
```

Perpanjangan otomatis sudah aktif (`certbot.timer`). Cek kapan saja:

```bash
systemctl list-timers | grep certbot
sudo certbot certificates
sudo certbot renew --dry-run
```

**Di mana flag `SCREENER_COOKIE_SECURE` ditulis?** Di blok `environment:` service
`screener-dashboard` pada `~/ai-stack/docker-compose.yml` — **bukan** di `.env`.
Container tidak membaca `.env` milik repo, dan `.env` juga masuk `.gitignore`
sehingga tidak ikut ke image. Cek nilainya benar-benar masuk:

```bash
docker compose exec screener-dashboard env | grep SCREENER_COOKIE_SECURE
```

Kalau lo jalanin `npm run start` langsung di host tanpa Docker, alternatifnya
bikin `.env.local` di folder repo berisi satu baris `SCREENER_COOKIE_SECURE=1`
(Next.js membacanya otomatis saat start), atau export di shell sebelum start.

Verifikasi setelah domain aktif:

```bash
DOM=scansignal.my.id
curl -sI https://$DOM/login | grep -i strict-transport
curl -si https://$DOM/api/auth/login -X POST \
  -H "Origin: https://$DOM" -H 'Content-Type: application/json' \
  -d '{"password":"PASSWORD-LO"}' | grep -i set-cookie
```

Yang benar: header `Strict-Transport-Security` muncul, dan cookie mengandung
`Secure; HttpOnly; SameSite=Lax`.

### Jalanin lokal buat ngoprek

```bash
cd ~/Screener
npm install
npm run dev     # http://localhost:3000, auto-reload
```

Di mode `npm run dev` tanpa TLS, jangan set `SCREENER_COOKIE_SECURE` — kalau
diset, cookie tidak akan pernah terkirim dan lo tidak bisa login sama sekali.

---

## 3. Tur layar: apa saja yang kelihatan

Dari atas ke bawah:

```text
┌──────────────────────────────────────────────────┐
│ ◎ SCREENER            ● LIVE  [↻ REFRESH]        │  ← header
├──────────────────────────────────────────────────┤
│ Read the market.              02  ACTIVE SETUPS  │  ← hero + ringkasan
│ Trade with context.           10  MARKETS        │
├──────────────────────────────────────────────────┤
│ MARKET SCAN  [ALL][LONG][SHORT] │ [ANY MODE]…    │  ← baris filter
├──────────────────────────────────────────────────┤
│ ┌─ kartu ─┐ ┌─ kartu ─┐ ┌─ kartu ─┐              │  ← grid 10 coin
│ │  AVAX   │ │  LINK   │ │  BTC    │              │
│ └─────────┘ └─────────┘ └─────────┘              │
├──────────────────────────────────────────────────┤
│ RISK CALCULATOR                                  │  ← hitung ukuran posisi
├──────────────────────────────────────────────────┤
│ SIGNAL HISTORY & EVALUASI          [▼ BUKA]      │  ← rapor performa
└──────────────────────────────────────────────────┘
```

**ACTIVE SETUPS** = jumlah coin yang saat ini punya sinyal.
Angka `00` itu normal dan sehat — artinya nggak ada setup yang lolos filter.
Kalau tiap saat ada 8–9 setup, berarti threshold-nya kelonggaran.

**Tombol ↻ REFRESH** memaksa hitung ulang sekarang tanpa nunggu 30 detik.

---

### Tiga kecepatan update (ini sering bikin bingung)

Nggak semua angka di layar update bareng. Ada tiga lapis, sengaja dibedain:

| Yang update | Seberapa cepat | Kenapa segitu |
|---|---|---|
| **Harga (mark price)** | ±1 detik (WebSocket) atau 3 detik (polling) | WebSocket dipakai kalau tersambung; kalau nggak, otomatis fallback ke polling `/api/price`. |
| **Funding, OI, ratio** | tiap 30 detik | Data ini sendiri cuma berubah tiap 5–15 menit di Binance. Lebih cepat = boros request, nggak ada gunanya. |
| **Sinyal & skor** | tiap 30 detik | Indikator dihitung dari candle 30m yang **sudah tutup**. Sebelum candle tutup, angkanya nggak berubah — jadi 30 detik hanya memperpendek jeda *penemuan*, bukan mempercepat lahirnya sinyal. |

**Kenapa 30 detik tidak membuat sinyal datang lebih awal.** Sinyal lahir dari candle
30m yang sudah tutup, jadi kelahirannya terjadi tepat di menit :00 dan :30 — di luar
kendali refresh. Yang dipersingkat cuma jeda antara candle tutup dan lo melihatnya:
dulu paling lama 60 detik, sekarang paling lama 30 detik. Rata-ratanya 15 detik.
Menurunkan lagi ke 10 detik tidak menambah kecepatan yang berarti tapi melipatgandakan
request ke Binance (~60 panggilan tiap kali refresh) dan berisiko kena rate limit.

### Inbox dan notifikasi sinyal baru

Bar `NOTIF` di atas dashboard punya dua fungsi yang berbeda:

- `🔔 NOTIF AKTIF` mengirim notifikasi browser untuk sinyal yang lahir setelah
  halaman dibuka. Browser meminta izin sekali; fitur ini perlu HTTPS.
- `☰ INBOX` menyimpan maksimal 100 sinyal terbaru **di browser/perangkat itu**.
  Badge merah adalah jumlah yang belum dibaca. Klik item untuk menandainya dibaca
  sekaligus membuka chart coin terkait; tombol `TANDAI SEMUA DIBACA` mereset badge.

Load pertama dijadikan baseline: sinyal yang sudah ada masuk inbox sebagai sudah
dibaca dan tidak memunculkan ledakan notifikasi lama. Identitasnya
`<coin>-<waktu candle tutup>`, sehingga refresh 30 detik dan reload halaman tidak
mengumumkan sinyal yang sama berulang kali. Inbox memakai `localStorage`, bukan
server: ia bertahan setelah reload, tetapi **tidak sinkron antar-browser/perangkat**.

Ini belum Web Push 24/7. Kalau tab mati total, browser tidak menjalankan polling
30 detik dan tidak ada proses yang bisa mendeteksi sinyal baru. Untuk kebutuhan
itu nanti perlu scheduler server + service worker/VAPID, bukan sekadar izin
notifikasi browser.

Tombol `⚙ ALERT STATUS` mengatur event lanjutan per sinyal: masuk zona entry,
invalid/stop, TP1, TP2, dan timeout 24 jam. Empat event pertama aktif secara
default; timeout default mati agar tidak berisik. State terakhir disimpan lokal,
jadi event yang sama tidak diulang setelah refresh atau saat opsi baru diaktifkan.
Alert ini mengikuti mark price realtime selama halaman aktif; ia informasi status,
bukan bukti fill atau eksekusi order.

### Indikator sumber harga

Di header dan di bawah tiap harga ada label sumber feed:

```text
LIVE · WEBSOCKET   →  frame WebSocket masuk, update ±1 detik
LIVE · POLLING 3S  →  WebSocket diam/diblokir, harga dari REST tiap 3 detik
MENGHUBUNGKAN…     →  belum ada harga masuk sama sekali
```

Kenapa ada fallback: di sebagian jaringan dan browser, koneksi ke
`wss://fstream.binance.com` **berhasil terbuka tapi tidak pernah mengirim data**.
Ini sudah diuji langsung dan terbukti terjadi. Kalau cuma bergantung pada
WebSocket, harga akan diam total tanpa pesan error apa pun.

Jadi sekarang polling jalan lebih dulu, dan berhenti sendiri begitu ada frame
WebSocket nyata masuk. Kalau WebSocket diam lagi lebih dari 5 detik, polling
otomatis lanjut. Harga tidak akan pernah beku tanpa penjelasan.

Jadi kalau lo lihat harga bergerak terus tapi skor diam di `4/6` — itu **bukan bug**.
Skor cuma bisa berubah saat candle 30 menit berikutnya tutup.

Kenapa harus candle tutup? Karena candle yang masih jalan itu bohong. Pola
"bullish engulfing" di menit ke-3 bisa berubah jadi "bearish" di menit ke-29.
Kalau kita hitung candle berjalan, sinyal bakal muncul-hilang-muncul terus.

**Satu pengecualian:** status `INVALIDATED` dihitung dari harga realtime.
Kalau harga nembus stop di detik ini, kartunya langsung ganti status tanpa
nunggu refresh 30 detik. Ini disengaja — informasi "rencana sudah batal"
terlalu penting untuk ditunda.

---

## 4. Mesin sinyal: dari candle jadi LONG/SHORT

### Bahan mentah

Tiap 30 detik, per coin, sistem ambil:

- **200 candle 30 menit** → buat hitung sinyal
- **100 candle 1 jam** → buat lihat tren besar
- Candle yang masih berjalan **dibuang**

### Empat indikator

**1. EMA50 (Exponential Moving Average 50 periode)**

Rata-rata harga 50 candle terakhir, tapi candle baru dikasih bobot lebih besar.
Gunanya: garis pemisah. Harga di atas EMA50 = kecenderungan naik.

Dipakai di dua timeframe:
- EMA50 di 30m → posisi harga sekarang
- EMA50 di 1h → arah tren besar (`BULL` kalau harga 1h di atas EMA50-nya)

**2. RSI14 (Relative Strength Index)**

Angka 0–100 yang mengukur seberapa "capek" pergerakan harga.

```text
RSI < 30  → oversold, turunnya udah kejauhan
RSI > 70  → overbought, naiknya udah kejauhan
RSI ~50   → netral
```

Yang dicari sistem **bukan** angkanya, tapi **momen menembusnya**:

```text
Candle sebelumnya RSI = 28  (di bawah 30)
Candle sekarang   RSI = 33  (naik lewat 30)
                            → "RSI tembus↑30"  ✓
```

Kalau RSI sudah 45 dari kemarin, itu nggak dihitung. Yang bernilai adalah
**transisinya**, bukan posisinya.

**3. MAVOL5 vs MAVOL14 (Moving Average Volume)**

Ini rata-rata **volume**, bukan rata-rata harga. Sering ketuker.

```text
MAVOL5  = rata-rata volume 5 candle terakhir  (jangka pendek)
MAVOL14 = rata-rata volume 14 candle terakhir (jangka lebih panjang)

MAVOL5 > MAVOL14  → volume belakangan lebih ramai dari biasanya
```

Gunanya: pergerakan harga yang disertai volume naik lebih meyakinkan
daripada yang sepi.

**4. Pola candlestick**

Sistem mengenali 7 pola dari candle 30m terakhir:

| Pola | Bentuk kasarnya | Arti |
|---|---|---|
| Bullish/bearish engulfing | Candle besar "menelan" candle sebelumnya | Pembalikan kuat |
| Hammer | Badan kecil, sumbu panjang ke bawah | Harga ditolak turun |
| Inverted hammer | Badan kecil, sumbu panjang ke atas | Harga ditolak naik |
| Morning star | Turun → ragu → naik | Pembalikan naik |
| Evening star | Naik → ragu → turun | Pembalikan turun |
| Piercing | Candle naik menembus separuh candle turun sebelumnya | Pembalikan naik |
| Dark cloud cover | Candle turun menembus separuh candle naik sebelumnya | Pembalikan turun |

> Catatan implementasi: `hammer` dan `inverted hammer` dihitung sebagai
> sumbu panjang yang menandakan penolakan, dan saat ini dipakai untuk
> **kedua arah** (bullish maupun bearish). Pola sisanya spesifik arah.

---

### Cara skor dihitung

Tiap komponen punya bobot. Total maksimal **6**.

| Komponen | Poin | Kenapa segitu |
|---|---|---|
| Pola candle | **2** | Sinyal paling spesifik, kejadiannya jarang |
| RSI tembus 30 / 70 | **2** | Momen transisi, juga jarang |
| MAVOL5 > MAVOL14 | **1** | Konfirmasi pendukung, sering terjadi |
| Harga vs EMA50 | **1** | Konteks arah, hampir selalu bernilai |

Skor LONG dan SHORT dihitung terpisah:

```text
skor LONG  = (candle bullish ? 2 : 0)
           + (RSI tembus ↑30 ? 2 : 0)
           + (MAVOL5 > MAVOL14 ? 1 : 0)
           + (harga > EMA50 ? 1 : 0)

skor SHORT = (candle bearish ? 2 : 0)
           + (RSI tembus ↓70 ? 2 : 0)
           + (MAVOL5 > MAVOL14 ? 1 : 0)
           + (harga < EMA50 ? 1 : 0)
```

### Syarat sinyal muncul

Skor saja tidak cukup. Ada **dua gerbang**:

```text
LONG muncul kalau:
    skor LONG ≥ SCREENER_MIN_SCORE
    DAN (tren 1h = BULL  ATAU  RSI baru tembus ↑30)

SHORT muncul kalau:
    skor SHORT ≥ SCREENER_MIN_SCORE
    DAN (tren 1h = BEAR  ATAU  RSI baru tembus ↓70)
```

Gerbang kedua mencegah dua hal bodoh:
- LONG saat tren besar jelas turun (kecuali ada pantulan oversold yang sah)
- SHORT saat tren besar jelas naik (kecuali ada penolakan overbought yang sah)

Kalau LONG dan SHORT dua-duanya lolos, **LONG diprioritaskan** (dievaluasi dulu).

### Kenapa MIN_SCORE = 4

Ini pernah diuji langsung. Threshold `2` (nilai dari kandidat backtest lama) menghasilkan:

```text
min_score = 2  →  9 dari 10 coin nyala LONG bersamaan
```

Sembilan sinyal serentak itu bukan sembilan peluang. Itu tanda sistemnya
cuma mendeteksi "market sedang naik" — informasi yang bisa lo dapat gratis
dengan melihat chart BTC 5 detik. Nilai penyaringnya hilang total.

Dengan threshold `4`:

```text
min_score = 4  →  2 dari 10 coin nyala, keduanya skor 4 dengan
                  konfluensi nyata (candle + volume + EMA)
```

Pilihan nilai:

| Nilai | Efeknya | Cocok untuk |
|---|---|---|
| `2` | Sangat longgar, sinyal membanjir | Riset, jangan buat trading |
| `3` | Longgar | Market sepi, mau lihat lebih banyak kandidat |
| **`4`** | **Seimbang — default** | **Pemakaian normal** |
| `5` | Ketat, butuh pola candle + RSI tembus | Mau sangat selektif |
| `6` | Sangat ketat, mungkin nol sinyal berhari-hari | Nyari setup sempurna |

Ubah lewat env `SCREENER_MIN_SCORE`, restart container. Nggak perlu rebuild image.

---

## 5. Membaca kartu sinyal baris per baris

Contoh kartu nyata:

```text
┌──────────────────────────────────────────┐
│ AVAX/USDT                        [LONG]  │  ①
│ PERPETUAL · 30M                          │
│                                          │
│ $7.4410                                  │  ②
│ REALTIME MARK PRICE                      │
│                                          │
│ [NEW] [SEARAH TREN] [12m lalu]           │  ③
│                                          │
│ CONFLUENCE SCORE · 30M            4/6    │  ④
│ ████████░░░░                             │
│                                          │
│ ENTRY ZONE        $7.4252 — $7.4410      │  ⑤
│ INVALIDATION      $7.3524 (1.19%)        │
│ TP1 · 1R          $7.5296                │
│ TP2 · 2R          $7.6181                │
│                                          │
│ ✓ candle bullish  ✓ MAVOL5>14            │  ⑥
│ ✓ harga>EMA50                            │
│                                          │
│ RSI 30M   TREND 1H   ATR 30M             │  ⑦
│ 58        BULL       0.85%               │
│ FUNDING   OI / 15M   LONG / SHORT        │
│ +0.010%   +0.24%     1.35                │
│ TAKER RATIO                              │
│ 1.18                                     │
│                                          │
│ Signal is informational.      [CHART ↗]  │  ⑧
└──────────────────────────────────────────┘
```

**① Nama & arah.** `LONG` = kandidat beli. `SHORT` = kandidat jual.
`WAIT` = tidak ada setup, cuma dipantau. `PERPETUAL` = kontrak futures tanpa
tanggal kedaluwarsa. `30M` = timeframe sinyal.

**② Harga.** Mark price realtime dari WebSocket, update ±1 detik.
Mark price adalah harga acuan Binance untuk hitung PnL dan likuidasi — beda
tipis dari last traded price, dan ini yang benar dipakai.

**③ Label status.** Dibahas detail di [bagian 7](#7-status-sinyal-dan-umurnya).

**④ Skor.** Angka + bar visual. `4/6` artinya 4 dari maksimal 6 poin.

**⑤ Rencana trade.** Dibahas di [bagian 6](#6-rencana-trade-entry-stop-tp).

**⑥ Alasan.** Ini bagian terpenting kartu. Skor `4/6` tanpa alasan itu
angka kosong. Dengan alasan, lo bisa nilai sendiri:

```text
✓ candle bullish, ✓ MAVOL5>14, ✓ harga>EMA50
    → pola candle + volume + posisi EMA. Nggak ada RSI tembus.
      Ini setup "lanjutan tren", bukan "pembalikan".

✓ RSI tembus↑30, ✓ candle bullish
    → oversold mantul + dikonfirmasi pola candle.
      Ini setup "pembalikan".
```

Dua-duanya bisa skor 4, tapi karakternya beda jauh. Jangan cuma lihat angka.

**⑦ Panel metrik.** Dibahas di [bagian 8](#8-panel-konteks-funding-oi-ratio).

**⑧ Tombol chart.** Buka chart 30m dengan level rencana tergambar.

### Kartu yang meredup

Kalau kartu kelihatan pudar/transparan, artinya sinyalnya sudah `EXPIRED`
atau `INVALIDATED`. Masih ditampilkan biar lo tahu apa yang baru saja terjadi,
tapi sudah tidak actionable. Klik `FRESH ONLY` di baris filter buat
menyembunyikan semuanya.

---

## 6. Rencana trade: entry, stop, TP

Semua level dihitung dari **ATR** — bukan dari persentase karangan.

### ATR itu apa

**ATR (Average True Range)** = rata-rata jarak gerak harga per candle,
dihitung dari 14 candle terakhir. Ini ukuran volatilitas.

```text
ATR 30m = 0.85%  →  AVAX rata-rata bergerak 0.85% tiap 30 menit
```

Kenapa penting: stop 1% itu ketat untuk coin dengan ATR 2%, tapi kelonggaran
untuk coin dengan ATR 0.3%. Stop yang benar harus menyesuaikan volatilitas,
bukan angka bulat yang sama untuk semua coin.

### Cara tiap level dihitung

Ambil contoh AVAX LONG di atas — harga tutup candle `$7.4410`, ATR `$0.0632`:

**ENTRY ZONE** — dari harga tutup sampai retrace 0.25 ATR:

```text
entry_high = harga tutup            = $7.4410
entry_low  = harga tutup − 0.25×ATR = $7.4252
```

Rentang, bukan satu angka, karena harga sudah bergerak sejak candle tutup.
Idealnya lo masuk di dalam zona ini. Kalau harga sudah jauh di atas
`entry_high`, lo **telat** — jangan dipaksa, risk/reward-nya sudah rusak.

**INVALIDATION (stop)** — di bawah struktur candle sinyal:

```text
kandidat = min(low candle ini, low candle sebelumnya) − 0.5×ATR
batas    = harga tutup × 0.92        (maksimal 8%)
stop     = yang lebih tinggi dari keduanya
```

Kenapa di bawah low, bukan angka persen? Karena kalau harga turun di bawah
low candle sinyal, **premis setupnya sudah salah**. Buffer 0.5 ATR mencegah
kena stop cuma karena sumbu candle atau spike sesaat.

Batas 8% itu pagar terakhir, warisan dari SL strategi lama. Kalau stop
struktural lebih jauh dari 8%, dipotong ke 8%.

Untuk SHORT semuanya dibalik: stop di **atas** high, batas `× 1.08`.

**TP1 dan TP2** — kelipatan risiko:

```text
risiko = entry_high − stop = 7.4410 − 7.3524 = $0.0886  (1R)

TP1 = entry + 1×risiko = $7.5296   (1R)
TP2 = entry + 2×risiko = $7.6181   (2R)
```

### Apa itu "R"

**R = satu satuan risiko.** Ini cara paling jujur mengukur hasil trading,
karena bebas dari ukuran modal.

```text
Lo risiko $10 per trade.
  Kena TP1 → +1R → +$10
  Kena TP2 → +2R → +$20
  Kena stop → −1R → −$10
```

Kenapa pakai R dan bukan dolar? Karena "+$50" nggak bermakna tanpa tahu
lo risiko berapa. Kalau lo risiko $500 untuk dapat $50, itu trade buruk.
Kalau lo risiko $10 untuk dapat $50, itu trade bagus. R menormalkan itu.

### RISK % di kartu

```text
INVALIDATION   $7.3524 (1.19%)
```

`1.19%` = jarak dari entry ke stop dalam persen. Ini yang lo pakai buat
sanity check:

| Risk % | Artinya |
|---|---|
| < 0.5% | Stop sangat ketat, gampang kena noise |
| 0.5%–2% | Wajar untuk 30m |
| 2%–4% | Lebar, kecilkan ukuran posisi |
| > 5% | Sangat lebar, pertimbangkan skip |

### Kenapa TP cuma 1R dan 2R

Karena ini **level referensi**, bukan prediksi. Sistem nggak tahu di mana
resistance sebenarnya. 1R dan 2R adalah cara netral bilang "di sini lo
sudah untung sebanding risiko lo, di sini dua kali".

Kalau lo lihat resistance jelas di chart sebelum TP1, pakai level lo sendiri.
Angka di kartu itu titik awal berpikir, bukan perintah.

---

## 7. Status sinyal dan umurnya

### Status entry realtime di kartu

Setiap kartu yang punya rencana sekarang membandingkan **mark price realtime** dengan
entry zone dan stop. Status ini berbeda dari status umur `NEW/VALID/WEAKENING/EXPIRED`:

| Status entry | LONG | SHORT | Arti |
|---|---|---|---|
| `BELUM MASUK ZONA` | harga di bawah `entry_low`, tetapi belum menembus stop | harga di atas `entry_high`, tetapi belum menembus stop | Harga belum mencapai zona dari sisi retrace. |
| `DALAM ZONA VALID` | `entry_low` sampai `entry_high` | `entry_low` sampai `entry_high` | Mark price sedang di dalam zona rencana. |
| `TERLAMBAT` | harga sudah di atas `entry_high` | harga sudah di bawah `entry_low` | Harga sudah bergerak ke arah target melewati zona. **Ini informasi geometri harga, bukan cutoff chase empiris.** |
| `INVALID` | harga ≤ stop | harga ≥ stop | Premis rencana gugur; status umur kartu juga menjadi `INVALIDATED`. |

Panel yang sama menampilkan jarak mark saat ini ke referensi entry, SL, TP1, dan TP2.
Tanda positif berarti level itu masih berada di arah yang menguntungkan dari mark;
tanda negatif berarti mark sudah melewatinya. Karena penyebutnya adalah mark saat ini,
angka ini bergerak setiap tick dan berbeda dari persen level statis yang dihitung dari
entry di bagian rencana.

`PROGRES ENTRY → TP1` mengukur posisi mark pada garis lurus entry ke TP1: 0% tepat di
entry dan 100% tepat di TP1. Angka teks sengaja boleh negatif (belum mencapai entry)
atau lebih dari 100% (sudah melewati TP1), sementara bar visual dibatasi 0–100% agar
tata letak tetap stabil. Ini indikator posisi, bukan hasil trade atau bukti fill.

`UMUR SINYAL` dihitung tiap detik dari `signal_closed_at`. Countdown `CANDLE 30M
BERIKUT` memakai batas waktu UTC yang sejajar di menit `:00` dan `:30`; countdown
bukan berarti sinyal baru pasti muncul saat mencapai nol. Logika lahirnya sinyal tetap
hanya memakai candle tertutup dan tetap direfresh setiap 30 detik.

Sinyal punya masa berlaku. Setup dari 3 jam lalu bukan setup lagi.

```text
signal_closed_at = waktu candle 30m sinyal itu tutup
umur             = sekarang − signal_closed_at
```

| Status | Umur | Warna | Artinya |
|---|---|---|---|
| `NEW` | ≤ 5 menit | hijau | Baru muncul. Harga masih dekat entry zone. Paling actionable. |
| `VALID` | ≤ 30 menit | putih | Masih dalam candle yang sama. Cek harga masih di zona. |
| `WEAKENING` | ≤ 60 menit | kuning | Sudah lewat satu candle. Premisnya menua. |
| `EXPIRED` | > 60 menit | merah | Sudah basi. Jangan dipakai. |
| `INVALIDATED` | kapan saja | merah | **Harga sudah nembus stop.** Rencana batal. |
| `NONE` | — | abu | Tidak ada sinyal di coin ini. |

### INVALIDATED itu spesial

Semua status lain dihitung dari umur, jadi cuma berubah saat refresh 30 detik.
`INVALIDATED` dihitung dari **mark price realtime**:

```text
LONG  → harga sekarang ≤ stop  →  INVALIDATED
SHORT → harga sekarang ≥ stop  →  INVALIDATED
```

Jadi begitu harga nembos stop, kartunya langsung berubah dalam hitungan detik.
Alasannya sederhana: informasi "jangan masuk lagi, premisnya sudah gugur"
nggak boleh nunggu satu menit.

### Aturan praktis

```text
NEW / VALID     → boleh dipertimbangkan
WEAKENING       → cuma kalau harga masih di entry zone dan lo yakin
EXPIRED         → abaikan
INVALIDATED     → abaikan, sudah gugur
```

### Label mode

Selain status, ada label arah relatif terhadap tren besar:

```text
SEARAH TREN (TREND)      → LONG saat tren 1h BULL, atau SHORT saat BEAR
COUNTER-TREND (COUNTER)  → melawan tren 1h, biasanya dari RSI tembus
```

`COUNTER` bukan berarti jelek — pantulan oversold itu setup yang sah.
Tapi karakternya beda: biasanya lebih cepat, lebih berisiko, dan lebih
butuh keputusan cepat. Panel History bisa kasih tahu lo mana yang lebih
cocok buat lo, per data.

---

## 8. Panel konteks: funding, OI, ratio

Empat angka ini **tidak masuk skor**. Mereka konteks — buat lo nilai
apakah sinyal teknikal tadi didukung atau ditentang oleh posisi pasar.

### FUNDING

Biaya berkala yang dibayar antar pemegang posisi futures perpetual,
biasanya tiap 8 jam.

```text
funding positif (+0.010%)  →  pemegang LONG bayar ke SHORT
                              → banyak yang LONG, sentimen bullish ramai

funding negatif (−0.010%)  →  pemegang SHORT bayar ke LONG
                              → banyak yang SHORT, sentimen bearish ramai
```

Cara pakai: funding yang **sangat** positif (misal > +0.05%) artinya posisi
LONG sudah terlalu padat. Ikut LONG di situ berarti lo masuk paling belakang,
dan lo yang bayar biaya. Ini kondisi rawan long squeeze.

Angka wajar: −0.01% sampai +0.01%. Di luar itu mulai patut dicurigai.

### OI / 15M (Open Interest)

Total kontrak yang masih terbuka, dibandingkan 15 menit lalu.

```text
OI naik  + harga naik   →  uang baru masuk, kenaikan didukung  ✓
OI naik  + harga turun  →  posisi short baru masuk, tekanan jual nyata
OI turun + harga naik   →  short pada tutup posisi (short squeeze),
                           bukan pembelian baru — lebih rapuh
OI turun + harga turun  →  long pada nyerah, tekanan mereda
```

Ini salah satu konteks paling berguna. Kenaikan harga dengan OI turun
sering cuma squeeze yang cepat balik.

### LONG / SHORT

Rasio jumlah **akun** retail yang LONG vs SHORT.

```text
1.35  →  1.35 akun LONG untuk tiap 1 akun SHORT
1.00  →  seimbang
2.50  →  retail sangat berat ke LONG
```

Retail terkenal sering salah di titik ekstrem. Rasio 2.5+ saat lo mau LONG
adalah tanda kehati-hatian, bukan konfirmasi. Angka ini soal **jumlah akun**,
bukan besar posisi — jadi bacanya "sentimen ritel", bukan "aliran uang".

### TAKER RATIO

Perbandingan volume market buy vs market sell — order agresif yang langsung
mengambil harga pasar.

```text
> 1.0  →  pembeli agresif lebih dominan
< 1.0  →  penjual agresif lebih dominan
```

Ini yang paling dekat dengan "tekanan sekarang". Sinyal LONG dengan taker
ratio 0.85 artinya secara teknikal setup naik, tapi yang aktif di pasar
justru penjual. Sinyal yang bertentangan dengan taker ratio patut diragukan.

### Contoh membaca konteks

Kasus mendukung:

```text
Sinyal   : LONG skor 4
FUNDING  : +0.008%   (wajar, belum padat)
OI       : +1.20%    (uang baru masuk)
L/S      : 1.20      (belum ekstrem)
TAKER    : 1.18      (pembeli aktif)
→ konteks searah sinyal
```

Kasus menentang:

```text
Sinyal   : LONG skor 4
FUNDING  : +0.078%   (LONG sudah sangat padat)
OI       : −2.10%    (posisi ditutup, bukan uang baru)
L/S      : 2.90      (retail berat LONG)
TAKER    : 0.82      (yang aktif justru penjual)
→ empat-empatnya menentang. Setup teknikalnya bagus, tapi
  posisinya jelek. Ini kandidat skip.
```

Skornya sama-sama 4. Konteksnya beda jauh. Ini persis kenapa keempat angka
ini ada di kartu.

---

## 9. Chart 30m

Klik `CHART ↗` di kartu mana pun. Yang muncul:

```text
┌─ Panel harga ──────────────────────────────┐
│  candlestick 30m (120 bar terakhir)        │
│  ── EMA50 (garis emas)                     │
│  ┈┈ ENTRY (biru)                           │
│  ┈┈ STOP  (merah)                          │
│  ┈┈ TP1 / TP2 (hijau)                      │
├─ Panel volume ─────────────────────────────┤
│  batang volume + MAVOL5 + MAVOL14          │
├─ Panel RSI ────────────────────────────────┤
│  RSI14 + band 30 / 50 / 70                 │
└────────────────────────────────────────────┘
```

Semua candle di sini **sudah tutup** — sama dengan yang dipakai hitung sinyal.
Jadi apa yang lo lihat di chart persis apa yang dilihat mesin sinyal.

### Kenapa chart ini penting

Angka `$7.3524` sebagai stop itu abstrak. Di chart lo bisa lihat: apakah stop
itu di bawah swing low yang jelas, atau nyempil di tengah-tengah tanpa
struktur pendukung. Lo juga bisa lihat apakah TP1 kehalang resistance.

Tiga hal yang layak lo cek tiap kali buka chart:

1. **Stop-nya di bawah struktur nyata?** Kalau ada swing low jelas di bawah
   garis stop, bagus. Kalau garis stop menggantung di area kosong, hati-hati.
2. **Ada resistance sebelum TP1?** Kalau iya, target realistisnya lebih dekat
   dari yang dihitung sistem.
3. **Volume mendukung?** Candle sinyal dengan volume di atas MAVOL14 lebih
   meyakinkan daripada yang di bawah.

### Catatan teknis

Chart digambar dengan SVG murni, tanpa library chart. Ini keputusan sadar:
VM-nya cuma punya RAM 1.7 GB, dan nambah library chart berarti nambah
puluhan MB bundle plus risiko OOM saat build. Trade-off-nya chart ini lebih
sederhana — nggak ada zoom, pan, atau drawing tool. Buat verifikasi struktur
sudah cukup; buat analisa serius tetap buka TradingView.

---

## 10. Filter

Baris `MARKET SCAN` punya empat kelompok filter yang bisa dikombinasi:

### Side

```text
[ALL]  [LONG]  [SHORT]
```

Tampilkan semua, atau cuma satu arah. `LONG` menyembunyikan juga coin `WAIT`.

### Mode

```text
[ANY MODE]  [TREND]  [COUNTER]
```

`TREND` = cuma setup searah tren 1h. `COUNTER` = cuma yang melawan tren.
Berguna kalau lo tahu gaya mana yang cocok buat lo — dan panel History
bisa membuktikan mana yang lebih baik untuk lo secara data.

### Score

```text
[ANY SCORE]  [≥3]  [≥4]  [≥5]
```

Filter tampilan, **bukan** filter mesin. Bedanya penting:

```text
SCREENER_MIN_SCORE = 4   →  skor < 4 tidak jadi sinyal sama sekali
Filter [≥5] di layar     →  sinyal skor 4 tetap ada, cuma disembunyikan
```

Jadi filter layar nggak bisa menampilkan sinyal skor 3 kalau MIN_SCORE-nya 4 —
sinyalnya nggak pernah dibuat. Kalau mau lihat yang lebih longgar, ubah env,
bukan filter.

### Fresh only

```text
[FRESH ONLY]
```

Sembunyikan yang `EXPIRED` dan `INVALIDATED`. Kalau lo cuma mau lihat yang
masih actionable, nyalain ini.

### Kalau kosong

```text
Tidak ada market yang lolos filter ini.
```

Ini pesan normal, bukan error. Longgarkan filter atau tunggu candle berikutnya.

---

## 11. Risk Calculator

Panel ini menjawab satu pertanyaan: **"berapa banyak yang boleh gue beli?"**

### Cara pakai

```text
SETUP              EQUITY (USDT)       RISK / TRADE (%)
[AVAX · LONG · 4/6]  [1000]              [1]
```

- **SETUP** — pilih dari sinyal yang punya rencana. Entry dan stop diambil otomatis.
- **EQUITY** — total modal lo, bukan yang mau dipakai untuk trade ini.
- **RISK / TRADE** — berapa persen equity yang lo rela hilang kalau stop kena.

### Yang keluar

```text
ENTRY            $7.4410
STOP             $7.3524
RISK / UNIT      $0.0886
RISK AMOUNT      $10.00
POSITION SIZE    112.867 AVAX
NOTIONAL         $839.85
LOSS @ STOP      −$10.00
GAIN @ TP1       +$10.00
GAIN @ TP2       +$20.00
```

### Matematikanya

```text
risk amount   = equity × risk%          = 1000 × 1%     = $10
risk per unit = |entry − stop|          = |7.4410−7.3524| = $0.0886
position size = risk amount ÷ risk/unit = 10 ÷ 0.0886   = 112.867 AVAX
notional      = size × entry            = 112.867 × 7.4410 = $839.85
```

Logikanya dibalik dari cara orang biasanya berpikir. Bukan "gue mau beli
$800 AVAX", tapi "gue rela rugi $10, jadi ukurannya harus 112 AVAX".
Stop menentukan ukuran, bukan sebaliknya.

### Soal leverage

**Kalkulator ini sengaja tidak punya input leverage.** Ini keputusan desain,
bukan fitur yang kelupaan.

Yang muncul malah catatan seperti ini:

```text
Notional $839.85 dari equity $1,000.00 masih di bawah equity,
jadi tidak butuh leverage.
```

Atau kalau ukurannya melebihi modal:

```text
Notional $2,450.00 dari equity $1,000.00 berarti butuh leverage ±2.5x —
margin naik, jarak likuidasi mengecil. Stop harus tetap $7.3524;
memperbesar posisi tanpa memperlebar stop tidak menambah edge,
hanya menambah risiko likuidasi.
```

Jadi leverage disajikan sebagai **konsekuensi** dari ukuran posisi, bukan
sebagai target yang lo kejar.

Kenapa begini? Karena begitu leverage jadi input, pola pikirnya berubah jadi
"gue pakai 20x biar untungnya gede". Padahal secara matematis, dengan risk
amount yang sama, leverage **tidak mengubah** berapa dolar yang lo untung
atau rugi. Yang berubah cuma seberapa dekat harga likuidasi.

```text
Risiko $10, stop 1.19% dari entry:

Leverage 3x  → margin $280, likuidasi jauh dari stop   → aman
Leverage 20x → margin $42,  likuidasi DEKAT stop       → bisa
                                                         likuidasi
                                                         sebelum
                                                         stop kena
```

Kasus kedua itu bahaya nyata: lo kena likuidasi padahal analisa lo belum
terbukti salah. Karena itu alat ini nggak akan pernah menyarankan leverage
tinggi — dan lo trading futures manual 15–20x, jadi ini perlu gue sebut
terus terang.

### Angka risk % yang wajar

| Risk/trade | Untuk siapa |
|---|---|
| 0.25%–0.5% | Sedang belajar, atau strategi belum terbukti |
| **1%** | **Standar umum, default** |
| 2% | Agresif, cuma untuk strategi yang sudah terbukti punya expectancy positif |
| > 3% | 10 loss berturut-turut menghabiskan sepertiga modal. Jangan. |

Ingat: loss 10x berturut-turut itu **normal** dalam statistik, bukan sial.
Dengan win rate 50%, peluangnya sekitar 1 dari 1000 — artinya kalau lo
trading ratusan kali, itu akan terjadi.

---

## 12. Signal History & Evaluasi

Ini panel paling penting di seluruh dashboard, dan yang paling sering
diabaikan orang. Klik `▼ BUKA` di bagian bawah.

### Kenapa ini yang paling penting

Skor `5/6` kelihatan meyakinkan. Tapi meyakinkan ≠ menguntungkan. Panel ini
satu-satunya bagian yang bisa menjawab: **"sinyal ini sebenarnya menghasilkan
apa?"**

Tanpa ini, lo cuma percaya pada angka yang kelihatan rapi.

### Cara kerjanya

**1. Pencatatan.** Tiap kali `/api/market` jalan dan ketemu sinyal, dia
dicatat ke file JSONL — satu record per candle yang tutup. Refresh berulang
nggak bikin duplikat, karena kuncinya `coin + waktu candle tutup`.

Yang dicatat: coin, arah, skor, mode, entry, stop, TP1, TP2, RSI, tren 1h,
ATR, dan daftar alasan.

**2. Replay.** Saat lo buka panel, tiap sinyal diputar ulang ke candle 30m
**sesudahnya**, dicek mana yang kena lebih dulu:

```text
STOP    → harga menyentuh stop
TP1     → harga menyentuh target 1R
TP2     → harga menyentuh target 2R
TIMEOUT → 48 candle (24 jam) lewat tanpa kena apa pun
OPEN    → belum ada candle baru sejak sinyal
```

**3. Asumsi konservatif.** Kalau satu candle menyentuh stop **dan** target
sekaligus, sistem menganggap **stop yang kena dulu**.

Ini penting dijelaskan. Dari data OHLC (open/high/low/close) mustahil tahu
urutan kejadian di dalam satu candle 30 menit. Banyak backtest curang di
titik ini — mereka asumsikan target kena dulu, dan hasilnya kelihatan bagus
padahal palsu. Sistem ini memilih asumsi terburuk, jadi angka yang keluar
adalah **batas bawah**, bukan angka yang dipermanis.

**4. Fee dihitung.** Taker bolak-balik (default 0.1%) dikonversi ke satuan R
dan dipotong dari tiap trade. Ini bukan detail kecil — ini justru inti
masalahnya, karena edge sistem ini tipis.

### Ringkasan yang ditampilkan

```text
SINYAL TERCATAT   41       ← total yang pernah dicatat
SELESAI           40       ← sudah ada hasil
MASIH BERJALAN     1       ← belum selesai
WIN RATE (NET)    50.0%    ← persen menang SETELAH fee
WIN / LOSS        20 / 20
AVG WIN          +0.95R    ← rata-rata besar kemenangan
AVG LOSS         −1.10R    ← rata-rata besar kekalahan
EXPECTANCY GROSS +0.025R   ← untung rata-rata per trade, SEBELUM fee
EXPECTANCY NET   −0.079R   ← untung rata-rata per trade, SETELAH fee
PROFIT FACTOR     0.86     ← total menang ÷ total kalah
TOTAL NET        −3.14R    ← akumulasi hasil
MAX DRAWDOWN      4.81R    ← penurunan terdalam dari puncak
```

### Angka mana yang paling penting

**EXPECTANCY NET.** Ini satu-satunya angka yang menentukan sistem ini layak
atau tidak.

```text
Expectancy net POSITIF  →  secara statistik menguntungkan jangka panjang
Expectancy net NEGATIF  →  makin banyak trading, makin rugi
```

Win rate itu menipu. Win rate 77% dengan avg loss 3x avg win tetap rugi.
Win rate 35% dengan avg win 4x avg loss tetap untung. Expectancy
menggabungkan keduanya jadi satu angka.

### Kasus gross positif, net negatif

Ini pola yang ditemukan di uji nyata sistem ini:

```text
EXPECTANCY GROSS  +0.025R
EXPECTANCY NET    −0.079R
fee/trade          0.104R
```

Bacanya: strateginya **memang** punya sedikit keunggulan — gross positif.
Tapi keunggulan itu (0.025R) jauh lebih kecil dari biaya transaksi (0.104R).
Jadi setiap trade, edge-nya habis di fee dan masih nombok.

Panel ini akan memberi tahu lo secara eksplisit kalau kondisi ini terdeteksi:

> Gross positif tapi net negatif — edge-nya habis di fee, jadi setup ini
> belum layak ditradingkan.

Ini persis temuan riset strategi lo sebelumnya (edge 0.05–0.14% vs fee 0.15%).
Panel ini bikin masalah itu kelihatan angkanya, bukan cuma teori.

### Peringatan sampel kecil

Kalau trade selesai kurang dari 30, panel bilang:

```text
Sampel baru 12 trade selesai; di bawah ~30 trade angka ini
belum bisa dipercaya.
```

Ini bukan formalitas. Dengan 5 trade, win rate 80% bisa terjadi murni
karena kebetulan. Kesimpulan dari sampel kecil lebih berbahaya daripada
tidak ada kesimpulan, karena lo jadi percaya pada pola yang nggak ada.

### Filter waktu dan analitik lanjutan

Tombol `30 HARI`, `60 HARI`, `90 HARI`, dan `SEMUA` membatasi **record sinyal
tersimpan** berdasarkan waktu candle sinyal. Tidak ada hasil sintetis atau
backfill yang diciptakan untuk mengisi rentang kosong. Setiap ganti rentang,
semua ringkasan dan tabel dihitung ulang dari subset yang sama.

Kurva **EQUITY NET-R** mengurutkan trade selesai secara kronologis, lalu
menjumlahkan `net_r` setelah fee. Distribusi outcome memisahkan TP2, TP1,
STOP, TIMEOUT, OPEN, dan UNKNOWN. Semua persentase memakai seluruh sinyal
dalam rentang sebagai penyebut, sehingga distribusinya konsisten dan berjumlah 100%.

Statistik holding hanya memakai trade selesai yang punya `bars_held`:

- rata-rata dan median menunjukkan pusat durasi;
- P90 menunjukkan durasi yang menaungi 90% trade;
- bucket `1–3`, `4–8`, `9–24`, `25–48`, dan `>48` bar menunjukkan distribusi;
- satu bar = 30 menit, sehingga rata-rata jam = rata-rata bar ÷ 2.

### Breakdown

Enam tabel pecahan:

| Tabel | Pertanyaan yang dijawab |
|---|---|
| **ATR BUCKET** | Volatilitas `<1%`, `1–2%`, atau `≥2%` mana yang efektif? |
| **TREND 1H** | Kondisi tren 1h tersimpan mana yang mendukung hasil? |
| **SCORE** | Apakah skor 5 benar-benar lebih baik dari skor 4? |
| **SIDE** | LONG atau SHORT yang lebih cocok? |
| **MODE** | Searah tren atau counter-trend? |
| **COIN** | Coin mana yang cocok, mana yang buang-buang fee? |

Setiap baris bucket selalu membawa status sampel. Di bawah 30 trade selesai,
label `⚠ KECIL n/30` ditampilkan menonjol. Peringatan ini berlaku per bucket,
bukan hanya total keseluruhan—total 100 trade tidak membuat bucket ATR berisi
4 trade menjadi tepercaya.

Tabel SCORE yang paling menarik, karena menguji asumsi dasar sistem ini.
Kalau ternyata skor 5 hasilnya lebih buruk dari skor 4, artinya pembobotan
skornya salah dan perlu diperbaiki. Contoh dari uji nyata:

```text
SCORE   N    SELESAI   WR      EXP NET   PF
4       20   20        55.0%   +0.02R    1.04
5       20   20        45.0%   −0.18R    0.71
```

Kalau pola begini muncul di data asli lo dengan sampel cukup, itu bukti
bahwa "skor lebih tinggi = lebih baik" tidak berlaku — dan lebih baik tahu
sekarang daripada setelah kehilangan modal.

Tabel SIDE juga sering membuka mata:

```text
LONG   exp_net  +0.046R
SHORT  exp_net  −0.204R
```

Kalau begini di data lo, kesimpulannya jelas: matikan SHORT.

### Tabel riwayat

```text
WAKTU        COIN  SIDE   SCORE  ENTRY     STOP      HASIL  NET     BAR
28 Agu 04:30 AVAX  LONG   4      $7.4410   $7.3524   TP1    +0.90R  3
28 Agu 03:00 LINK  LONG   4      $11.8010  $11.6412  STOP   −1.10R  5
27 Agu 22:30 ETH   SHORT  5      $2501.88  $2524.03  TIMEOUT −0.15R 48
```

Kolom `BAR` = berapa candle 30m sampai selesai. Ini info yang berguna:
kalau rata-rata sinyal selesai dalam 2–3 bar, artinya ini setup cepat dan
lo nggak perlu pantau berjam-jam. Kalau rata-rata 30+ bar, lo butuh
kesabaran atau perlu perpendek target.

### Realitas waktu

Sinyal cuma tercatat saat dashboard hidup dan ada setup yang lolos threshold.
Dari pengujian, itu sekitar 0–2 sinyal per scan.

```text
~2 sinyal/hari  →  30 trade butuh sekitar 2 minggu
```

Jadi realistisnya **beberapa minggu** sebelum panel ini bisa dipercaya.
Sebelum itu, baca sebagai data yang sedang dikumpulkan.

### History bisa hilang

File JSONL ada di dalam container. Tanpa volume Docker, tiap
`docker compose up --force-recreate` riwayatnya hangus dan statistik
mulai dari nol.

Pastikan Compose lo punya:

```yaml
volumes:
  - screener_data:/data
environment:
  SCREENER_DATA_DIR: /data
```

Ini bukan opsional kalau lo mau panel ini berguna.

---

## 13. Semua parameter environment

### Sinyal

| Variabel | Default | Fungsi |
|---|---|---|
| `SCREENER_COINS` | `BTC,ETH,SOL,XRP,BNB,DOGE,ADA,AVAX,LINK,DOT` | Coin yang dipantau, dipisah koma, tanpa `USDT` |
| `SCREENER_MIN_SCORE` | `4` | Skor minimum agar jadi sinyal (0–6) |
| `BINANCE_FAPI_URL` | `https://fapi.binance.com` | Endpoint Binance Futures |

### History & evaluasi

| Variabel | Default | Fungsi |
|---|---|---|
| `SCREENER_DATA_DIR` | `.data` di folder app | Lokasi file riwayat. **Mount volume ke sini.** |
| `SCREENER_HISTORY_MAX` | `2000` | Jumlah record maksimal yang dibaca |
| `SCREENER_FEE_PCT` | `0.1` | Fee taker bolak-balik untuk hitung expectancy net |
| `SCREENER_EVAL_BARS` | `48` | Batas candle 30m sebelum sinyal dianggap `TIMEOUT` (48 = 24 jam) |

### Login & TLS

| Variabel | Default | Fungsi |
|---|---|---|
| `SCREENER_COOKIE_SECURE` | mati | Set `1` **hanya setelah** situs jalan di HTTPS. Cookie ditandai `Secure` dan HSTS dikirim. Kalau dinyalakan di HTTP biasa, login muter terus. |
| `RANKING_SNAPSHOT_TOKEN` | kosong | Wajib diisi agar POST snapshot bisa jalan; POST tetap harus same-origin dan sudah login. |

Password tidak pakai environment variable. Password awal `098123plm` di-seed jadi
hash `scrypt` di `${SCREENER_DATA_DIR}/auth.json` saat run pertama, lalu diganti
dari tombol `AKUN` di dalam web. Lupa password: hapus `auth.json`, start ulang.

### Contoh konfigurasi

**Sangat selektif, cuma coin besar:**

```yaml
SCREENER_COINS: BTC,ETH,SOL
SCREENER_MIN_SCORE: "5"
```

**Fee VIP (maker/taker lebih murah):**

```yaml
SCREENER_FEE_PCT: "0.07"
```

**Setup cepat, jangan tunggu 24 jam:**

```yaml
SCREENER_EVAL_BARS: "16"    # 8 jam
```

**Pantau lebih banyak coin** — hati-hati rate limit:

```yaml
SCREENER_COINS: BTC,ETH,SOL,XRP,BNB,DOGE,ADA,AVAX,LINK,DOT,MATIC,ATOM,NEAR,APT,ARB
```

> Tiap coin memakai 6 request per scan (candle 30m, candle 1h, funding, OI,
> L/S ratio, taker ratio). 10 coin = 60 request/menit. 20 coin = 120
> request/menit. Binance punya batas — kalau kebanyakan, sebagian data
> jadi `—`. Tambah coin secukupnya, dan perhatikan apakah ada kolom
> yang mulai kosong.

Setelah ubah env, cukup restart — nggak perlu rebuild:

```bash
cd ~/ai-stack
docker compose up -d --force-recreate screener-dashboard
```

---

## 14. API: buat dipakai sendiri

Semua endpoint mengembalikan JSON, dan **semuanya butuh login**. Tanpa cookie
sesi yang sah, jawabannya `401` — termasuk kalau dipanggil dari dalam VPS.

Contoh `curl` di bawah memakai `127.0.0.1:8643` (dari dalam VPS) supaya ringkas.
Ambil cookie sesinya dulu:

```bash
curl -s -c /tmp/cookie -X POST http://127.0.0.1:8643/api/auth/login \
  -H "Origin: http://127.0.0.1:8643" -H 'Content-Type: application/json' \
  -d '{"password":"PASSWORD-LO"}'

curl -s -b /tmp/cookie http://127.0.0.1:8643/api/market
```

Jadi tiap contoh di bawah sebenarnya perlu tambahan `-b /tmp/cookie`. Header
`Origin` hanya wajib untuk `POST`. Cookie itu ikut mati setelah 2 jam idle.

### GET /api/market

Sinyal lengkap semua coin. Ini yang dipanggil dashboard tiap 30 detik.

```bash
curl -s http://127.0.0.1:8643/api/market
```

```json
{
  "source": "binance-futures",
  "ts": 1787839200000,
  "min_score": 4,
  "logged": 1,
  "rows": [{
    "coin": "AVAX",
    "price": 7.4410,
    "sig": "LONG",
    "score": 4,
    "reasons": ["candle bullish", "MAVOL5>14", "harga>EMA50"],
    "mode": "TREND",
    "status": "NEW",
    "signal_closed_at": 1787839199999,
    "age_min": 12,
    "atr": 0.0632,
    "atr_pct": 0.85,
    "plan": {
      "entry_low": 7.4252, "entry_high": 7.4410,
      "invalidation": 7.3524, "risk_pct": 1.19,
      "tp1": 7.5296, "tp2": 7.6181, "rr1": 1, "rr2": 2
    },
    "rsi": 58.2,
    "trend_1h": "BULL",
    "timeframe": "30m",
    "funding": 0.010, "mark": 7.4408,
    "oi_chg": 0.24, "ls_ratio": 1.35, "taker": 1.18
  }]
}
```

`logged` = berapa sinyal baru dicatat ke history di panggilan ini.

### GET /api/context

Cuma data microstructure. Ringan, dipanggil tiap 30 detik.

```bash
curl -s http://127.0.0.1:8643/api/context
```

```json
{
  "AVAX": { "funding": 0.010, "oi_chg": 0.24, "ls_ratio": 1.35, "taker": 1.18 }
}
```

### GET /api/price

Mark price semua coin dalam satu request. Ini fallback yang dipakai frontend
tiap 3 detik saat WebSocket tidak mengirim data.

```bash
curl -s http://127.0.0.1:8643/api/price
```

```json
{
  "ts": 1787904249002,
  "prices": { "BTC": 79797.0, "ETH": 2501.74, "AVAX": 7.4282 }
}
```

Endpoint ini memakai `premiumIndex` **tanpa filter symbol**, jadi satu request
ke Binance mengembalikan semua market sekaligus — biaya upstream-nya tetap
satu request berapa pun jumlah coin yang dipantau.

### GET /api/candles?coin=BTC

120 candle 30m terakhir plus overlay indikator. Dipakai chart.

```bash
curl -s "http://127.0.0.1:8643/api/candles?coin=BTC"
```

```json
{
  "coin": "BTC", "interval": "30m", "atr_pct": 0.567,
  "bars": [{
    "t": 1787839199999,
    "o": 79317.8, "h": 79539.8, "l": 78864.0, "c": 79492.9,
    "v": 9483.774,
    "ema50": 79043.37, "rsi": 55.44,
    "mavol5": 3936.06, "mavol14": 4932.91
  }]
}
```

### GET /api/history

Riwayat + statistik lengkap.

```bash
curl -s http://127.0.0.1:8643/api/history
```

Kalau belum ada data:

```json
{
  "empty": true,
  "note": "Belum ada sinyal tercatat. History terisi otomatis setiap /api/market menemukan setup baru."
}
```

Kalau sudah ada:

```json
{
  "empty": false,
  "stats": {
    "total": 41, "resolved": 40, "open": 1,
    "wins": 20, "losses": 20, "win_rate": 50.0,
    "avg_win_r": 0.95, "avg_loss_r": -1.10,
    "expectancy_r": 0.025, "expectancy_net_r": -0.079,
    "profit_factor": 0.86, "gross_r": 1.0, "net_r": -3.14,
    "max_drawdown_r": 4.81, "fee_r_per_trade": 0.104
  },
  "by_score": [{ "bucket": 4, "stats": { "...": "..." } }],
  "by_side":  [{ "bucket": "LONG", "stats": { "...": "..." } }],
  "by_mode":  [{ "bucket": "TREND", "stats": { "...": "..." } }],
  "by_coin":  [{ "bucket": "AVAX", "stats": { "...": "..." } }],
  "rows": [{ "coin": "AVAX", "outcome": "TP1", "net_r": 0.90, "bars_held": 3 }]
}
```

### Contoh: alert sederhana ke terminal

```bash
watch -n 60 'curl -s http://127.0.0.1:8643/api/market \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
for r in d[\"rows\"]:
    if r.get(\"sig\") and r.get(\"status\") in (\"NEW\",\"VALID\"):
        p=r[\"plan\"]
        print(f\"{r[\"sig\"]} {r[\"coin\"]} skor {r[\"score\"]}/6 | entry {p[\"entry_low\"]:.4f}-{p[\"entry_high\"]:.4f} | stop {p[\"invalidation\"]:.4f}\")
"'
```

---

## 15. Alur kerja harian

### Saat buka dashboard

```text
1. Lihat ACTIVE SETUPS.
   Nol? Tutup, balik nanti. Nggak ada yang perlu dikerjakan.

2. Nyalain FRESH ONLY. Buang yang sudah basi.

3. Untuk tiap kartu bersinyal:

   a. Cek status.
      NEW / VALID → lanjut.  WEAKENING → hati-hati.  lainnya → skip.

   b. Baca alasan, bukan cuma skor.
      Ini setup pembalikan (ada RSI tembus) atau lanjutan tren?

   c. Cek label mode.
      COUNTER = melawan tren 1h. Sadar risikonya.

   d. Baca panel konteks.
      Funding, OI, L/S, taker — mendukung atau menentang?
      Kalau tiga dari empat menentang, pertimbangkan skip.

   e. Buka CHART ↗.
      Stop-nya di bawah struktur nyata? Ada resistance sebelum TP1?
      Volume candle sinyal di atas MAVOL14?

   f. Kalau masih masuk akal → Risk Calculator.
      Masukkan equity + risk 1%. Catat position size.

   g. Cek harga masih di dalam entry zone.
      Sudah jauh lewat? Skip. Telat itu bukan alasan buat maksa.

   h. Eksekusi manual di Binance.
      Stop loss dipasang SEKARANG, bukan nanti.
```

### Mingguan

```text
1. Buka SIGNAL HISTORY, klik HITUNG ULANG.
2. Cek EXPECTANCY NET.
3. Lihat tabel SCORE — apakah skor tinggi benar lebih baik?
4. Lihat tabel SIDE — LONG dan SHORT dua-duanya layak?
5. Lihat tabel COIN — ada coin yang cuma buang fee?
6. Kalau sampel < 30, jangan simpulkan apa pun. Tunggu.
```

### Yang jangan dilakukan

```text
❌ Entry cuma karena skor 5/6, tanpa buka chart
❌ Entry saat status EXPIRED atau INVALIDATED
❌ Entry saat harga sudah jauh lewat entry zone
❌ Geser stop menjauh setelah posisi terbuka
❌ Naikkan leverage supaya "untungnya lebih gede"
❌ Percaya statistik dari 5 trade
❌ Anggap ini sistem auto-trading
```

---

## 16. Contoh kasus lengkap

### Kasus A — setup layak

Kartu:

```text
AVAX/USDT                          [LONG]
$7.4410
[NEW] [SEARAH TREN] [3m lalu]
SCORE 4/6

ENTRY ZONE      $7.4252 — $7.4410
INVALIDATION    $7.3524 (1.19%)
TP1 · 1R        $7.5296
TP2 · 2R        $7.6181

✓ candle bullish  ✓ MAVOL5>14  ✓ harga>EMA50

RSI 30M 58   TREND 1H BULL   ATR 0.85%
FUNDING +0.010%   OI +0.24%   L/S 1.35   TAKER 1.18
```

Penilaian:

```text
Status NEW           ✓ baru 3 menit, harga masih dekat entry
Mode SEARAH TREN     ✓ nggak melawan tren besar
Skor 4/6             ✓ lolos threshold
Alasan               → pola candle + volume + posisi EMA
                       (setup lanjutan tren, bukan pembalikan)
Risk 1.19%           ✓ wajar untuk 30m
Funding +0.010%      ✓ belum padat
OI +0.24%            ✓ uang baru masuk
L/S 1.35             ✓ belum ekstrem
TAKER 1.18           ✓ pembeli aktif dominan
→ konteks searah sinyal
```

Chart dicek: stop `$7.3524` ada di bawah swing low jelas ✓, nggak ada
resistance mencolok sebelum TP1 ✓, volume candle sinyal di atas MAVOL14 ✓.

Risk Calculator, equity $1000, risk 1%:

```text
POSITION SIZE   112.867 AVAX
NOTIONAL        $839.85
LOSS @ STOP     −$10.00
GAIN @ TP1      +$10.00
GAIN @ TP2      +$20.00
```

Notional $839 < equity $1000 → nggak butuh leverage sama sekali.

Eksekusi: beli 112.867 AVAX di sekitar $7.4410, **pasang stop $7.3524
langsung**, TP1 $7.5296.

### Kasus B — skip walaupun skornya bagus

```text
DOGE/USDT                         [SHORT]
$0.089090
[VALID] [COUNTER-TREND] [22m lalu]
SCORE 5/6

ENTRY ZONE      $0.089090 — $0.089340
INVALIDATION    $0.091200 (2.37%)
TP1 · 1R        $0.086980

✓ candle bearish  ✓ RSI tembus↓70  ✓ MAVOL5>14

RSI 30M 68   TREND 1H BULL   ATR 1.42%
FUNDING −0.045%   OI −1.80%   L/S 0.72   TAKER 1.24
```

Penilaian:

```text
Skor 5/6             ✓ tinggi
Status VALID         ~ 22 menit, mulai menua
Mode COUNTER-TREND   ⚠ SHORT saat tren 1h BULL
Funding −0.045%      ⚠ SHORT sudah padat, lo yang bakal dibayarin
                       tapi juga berarti rawan short squeeze
OI −1.80%            ⚠ posisi ditutup, bukan tekanan jual baru
L/S 0.72             ⚠ retail sudah berat SHORT
TAKER 1.24           ⚠ yang aktif justru PEMBELI, bertentangan
                       dengan sinyal SHORT
```

Keputusan: **skip.** Skornya paling tinggi hari itu, tapi empat dari empat
konteks menentang, dan taker ratio secara langsung bertentangan dengan arah
sinyal. Ini kondisi klasik menjelang short squeeze.

Ini contoh kenapa skor bukan segalanya. Angka 5/6 di kasus ini lebih
berbahaya daripada angka 4/6 di kasus A.

### Kasus C — sinyal gugur di tengah jalan

```text
LINK/USDT                          [LONG]
$11.6380
[INVALIDATED] [SEARAH TREN] [18m lalu]
SCORE 4/6

ENTRY ZONE      $11.7716 — $11.8010
INVALIDATION    $11.6412 (1.35%)
```

Harga realtime `$11.6380` sudah di **bawah** stop `$11.6412`.

Keputusan: **jangan sentuh.** Premis setupnya sudah gugur sebelum lo masuk.
Kalau lo masuk sekarang, lo entry di posisi yang secara definisi sudah salah
menurut rencananya sendiri.

Ini gunanya perhitungan `INVALIDATED` realtime — tanpa itu, kartu ini masih
akan terlihat `VALID` sampai refresh berikutnya, dan lo bisa entry ke setup
yang sudah mati.

---

## 17. Batasan yang harus lo tahu

Bagian ini bukan disclaimer formalitas. Ini hal-hal yang bisa bikin lo
salah paham dan kehilangan uang.

### Edge-nya tipis, dan mungkin nggak ada

Riset strategi sebelumnya menemukan edge per sinyal **0.05%–0.14%**,
sementara fee taker bolak-balik sekitar **0.15%**. Artinya sinyal mentah
sistem ini kemungkinan besar **rugi setelah fee**.

Ini bukan spekulasi — uji panel History dengan data candle nyata sudah
menunjukkan pola gross positif tapi net negatif. Fungsi sistem ini adalah
penyaring perhatian, bukan generator profit.

### "Win rate 77%" tidak berlaku di sini

Angka itu berasal dari backtest in-sample strategi Freqtrade lama, dengan
kombinasi entry + exit + stop + periode data tertentu. Saat diuji
out-of-sample di coin dan periode lain, hasilnya jatuh:

```text
XRP in-sample 2023  : sekitar +10%  (225 trade, WR 77%)
ETH out-of-sample   : sekitar −21% sampai −27%
SOL out-of-sample   : sekitar −48% sampai −63%
```

Logika entry di dashboard ini memang **mengacu** pada konfluensi yang sama,
tapi:
- Implementasi pola candle di TypeScript **tidak identik** dengan TA-Lib
- Tidak ada simulasi exit, funding, atau slippage di sisi live
- Belum diverifikasi 1:1 dengan strategi lama

Jadi jangan pernah menempelkan angka 77% ke dashboard ini.

### Keterbatasan teknis

- **Candle 30m** — sinyal maksimal muncul 2x per jam per coin. Kalau lo
  butuh reaksi lebih cepat, ini alat yang salah.
- **Asumsi stop-first** — hasil evaluasi adalah batas bawah. Realitanya
  mungkin sedikit lebih baik, tapi lebih aman meremehkan.
- **Tanpa slippage & funding di evaluasi** — cuma fee taker yang dihitung.
  Slippage di coin tipis bisa signifikan.
- **TIMEOUT dihitung sebagai selesai** — modal sudah terpakai, jadi masuk
  statistik. Ini pilihan sadar supaya expectancy nggak dipermanis.
- **History hilang tanpa volume** — sudah dijelaskan, tapi diulang karena
  penting.
- **Rate limit Binance** — makin banyak coin, makin dekat batas.
- **Chart sederhana** — nggak ada zoom/pan/drawing. Buat analisa serius
  tetap pakai TradingView.

### Keamanan

- **Ada login.** Semua halaman dan endpoint API tertutup; tanpa sesi API
  menjawab `401`. Password disimpan sebagai hash `scrypt` + salt acak.
- **Sesi mati 2 jam idle**, dan 10 kali salah password mengunci login 15 menit.
- **Ada TLS** di port 443, port 80 dialihkan otomatis, dan port `8643` tidak bisa
  dijangkau dari internet.
- **Sertifikatnya asli dari Let's Encrypt** untuk `scansignal.my.id` dan
  `www.scansignal.my.id`; perpanjangan otomatis lewat `certbot.timer`.
- **Satu operator saja.** Belum ada multi-user, role, atau 2FA.
- **Password awal `098123plm` harus diganti.** Lihat bagian 0c.
- **Nggak ada API key Binance** di mana pun. Semua endpoint yang dipakai
  publik. Ini disengaja — dashboard ini secara arsitektur **tidak bisa**
  eksekusi order, jadi walaupun ada yang akses, mereka nggak bisa
  menyentuh akun lo.

### Soal leverage

Lo trading futures manual 15–20x. Dengan risk 1% dan stop 1.2%, leverage
20x menaruh harga likuidasi lo **sangat dekat** dengan stop loss. Artinya:
lo bisa kena likuidasi sebelum stop lo kena, padahal analisa lo belum
terbukti salah.

Alat ini nggak akan pernah menyarankan leverage tinggi, dan Risk Calculator
sengaja nggak punya input leverage. Ukuran posisi ditentukan oleh jarak
stop dan risk amount — bukan oleh seberapa besar leverage yang tersedia.

---

## 18. Troubleshooting

### Dashboard nggak kebuka

```bash
docker compose ps                    # container hidup?
docker compose logs --tail 50 screener-dashboard
curl -i http://127.0.0.1:8643/login  # dari dalam VPS, harus 200
sudo ss -ltnp | grep ':8643'         # harus 127.0.0.1:8643
sudo nginx -t                        # config nginx sehat?
sudo systemctl status nginx --no-pager | head -5
```

Kalau `curl` di dalam VPS jalan tapi lewat `https://` tidak, masalahnya di nginx,
bukan di app. Kalau `ss` menunjukkan `0.0.0.0:8643`, mapping compose-nya salah —
harus `127.0.0.1:8643:3000`.

### Balik ke halaman login terus

1. **Sesi memang mati.** Idle 2 jam. Login ulang saja.
2. **Flag `Secure` menyala tapi lo buka lewat `http://`.** Browser tidak mengirim
   cookie balik, jadi login tampak sukses lalu langsung dilempar ke login lagi.
   Buka pakai `https://`.
3. **Volume `/data` tidak terpasang.** `auth.json` hilang tiap recreate:
   ```bash
   docker compose exec screener-dashboard sh -c 'ls -la /data/auth.json'
   ```

### Lupa password

```bash
docker compose exec screener-dashboard sh -c 'rm -f /data/auth.json'
docker compose restart screener-dashboard
```

Password kembali ke `098123plm` dan semua sesi terhapus. Snapshot ranking tidak
terpengaruh karena tersimpan di file lain (`ranking-snapshots.jsonl`).

### Login terkunci padahal password benar

Sepuluh percobaan gagal dalam 15 menit mengunci login sampai jendela itu lewat;
jawabannya `429`. Tunggu 15 menit, atau reset dengan menghapus `auth.json` di atas
(konsekuensinya password ikut kembali ke awal).

### Peringatan sertifikat di browser

Seharusnya sudah tidak ada, karena sertifikatnya asli. Kalau tetap muncul, cek dua
hal ini dulu: lo membuka lewat **domain** (bukan alamat IP — sertifikat hanya sah
untuk nama domain), dan sertifikatnya belum kedaluwarsa (`sudo certbot certificates`
di VPS). Kalau perpanjangan otomatis gagal, `sudo certbot renew` memaksa sekarang.

### Semua kolom konteks `—`

Kemungkinan besar rate limit Binance. Kurangi jumlah coin di
`SCREENER_COINS`, atau tunggu beberapa menit.

Cek langsung:

```bash
curl -s "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT"
```

### ACTIVE SETUPS selalu 00

Ini kemungkinan besar **normal** dengan `MIN_SCORE=4`. Bisa berjam-jam nggak
ada setup. Kalau mau lihat lebih banyak kandidat, turunkan ke `3` — tapi
sadar bahwa sinyalnya jadi lebih lemah.

Cek apakah mesinnya jalan:

```bash
curl -s http://127.0.0.1:8643/api/market | head -c 300
```

Kalau `rows` ada isinya dan skor semua di bawah 4, berarti sistemnya sehat,
memang nggak ada setup.

### History kosong terus

```bash
# apakah volume kepasang?
docker compose exec screener-dashboard sh -c 'ls -la /data'

# apakah ada sinyal yang tercatat?
curl -s http://127.0.0.1:8643/api/market | grep -o '"logged":[0-9]*'
```

Kalau `logged` selalu 0 dan nggak pernah ada sinyal, ya memang belum ada
yang bisa dicatat. Kalau `/data` nggak ada atau read-only, volume-nya
belum benar.

### Chart nggak muncul

```bash
curl -s "http://127.0.0.1:8643/api/candles?coin=BTC" | head -c 200
```

Kalau `502 data unavailable`, Binance nggak mengembalikan candle cukup
(minimal 60). Coba coin lain.

### Harga diam / WebSocket mati

Cek label di header dulu:

- `LIVE · POLLING 3S` → WebSocket memang diam, tapi harga **tetap jalan**
  lewat REST tiap 3 detik. Ini normal, nggak perlu diapa-apain.
- `MENGHUBUNGKAN…` yang nggak hilang → fallback-nya juga gagal. Cek:

```bash
curl -s http://127.0.0.1:8643/api/price | head -c 200
```

Kalau balasannya `502`, server nggak bisa menghubungi Binance. Cek koneksi
keluar dari host:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://fapi.binance.com/fapi/v1/premiumIndex
```

### Statistik berubah drastis tiap dihitung

Normal kalau sampel masih kecil. Satu trade baru bisa menggeser win rate
dari 40% ke 50% kalau totalnya cuma 10. Ini justru alasan kenapa peringatan
"< 30 trade" itu ada.

---

## 19. Kamus istilah

| Istilah | Penjelasan |
|---|---|
| **ATR** | Average True Range. Rata-rata jarak gerak harga per candle. Ukuran volatilitas. |
| **Confluence** | Beberapa kondisi teknikal yang terjadi bersamaan. Dasar sistem skor ini. |
| **Counter-trend** | Posisi melawan arah tren besar. |
| **Drawdown** | Penurunan dari puncak ekuitas. Ukuran seberapa sakit periode buruknya. |
| **EMA** | Exponential Moving Average. Rata-rata harga dengan bobot lebih pada data baru. |
| **Entry zone** | Rentang harga yang masih layak buat masuk. |
| **Expectancy** | Rata-rata untung/rugi per trade dalam satuan R. Angka penentu layak atau tidak. |
| **Fee taker** | Biaya order yang langsung ambil harga pasar. Di Binance Futures sekitar 0.05% per sisi. |
| **Funding** | Biaya berkala antar pemegang posisi perpetual, biasanya tiap 8 jam. |
| **In-sample** | Data yang dipakai saat mengembangkan strategi. Hasil di sini selalu terlalu bagus. |
| **Invalidation** | Harga yang membuktikan premis setup salah. Sama dengan stop loss. |
| **Likuidasi** | Posisi ditutup paksa bursa karena margin habis. Beda dari stop loss. |
| **Long squeeze** | Pemegang LONG dipaksa keluar beruntun, harga jatuh cepat. |
| **Mark price** | Harga acuan Binance untuk PnL dan likuidasi. Beda tipis dari harga transaksi terakhir. |
| **MAVOL** | Moving Average Volume. Rata-rata **volume**, bukan harga. |
| **Notional** | Nilai total posisi = ukuran × harga. |
| **OHLC** | Open, High, Low, Close. Empat angka pembentuk satu candle. |
| **OI** | Open Interest. Total kontrak yang masih terbuka. |
| **Out-of-sample** | Data yang belum pernah dipakai saat mengembangkan strategi. Tes yang jujur. |
| **Overbought** | RSI > 70. Kenaikan sudah jauh, rawan koreksi. |
| **Oversold** | RSI < 30. Penurunan sudah jauh, rawan pantulan. |
| **Perpetual** | Kontrak futures tanpa tanggal kedaluwarsa. |
| **Profit factor** | Total kemenangan ÷ total kekalahan. Di atas 1 = untung. |
| **R** | Satu satuan risiko. +2R = untung dua kali risiko awal. |
| **RSI** | Relative Strength Index. Indikator momentum 0–100. |
| **Short squeeze** | Pemegang SHORT dipaksa keluar beruntun, harga naik cepat. |
| **Slippage** | Selisih harga yang lo harapkan dan yang benar-benar dieksekusi. |
| **Taker ratio** | Perbandingan volume market buy vs market sell. |
| **Win rate** | Persentase trade yang untung. **Bukan** penentu profitabilitas sendirian. |

---

## Penutup

Satu kalimat yang merangkum semuanya:

> Alat ini mengecilkan 10 coin jadi 1–2 coin yang layak lo buka chartnya.
> Sisanya tetap kerja lo.

Dan satu angka yang perlu lo pantau di atas semua yang lain:

> **EXPECTANCY NET** di panel Signal History. Kalau negatif setelah
> 30+ trade, sistemnya belum layak ditradingkan — seberapa rapi pun
> tampilannya.

Dashboard ini dibuat supaya lo bisa melihat itu dengan jujur, bukan
supaya angkanya kelihatan bagus.
