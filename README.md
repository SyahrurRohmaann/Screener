# Screener

Realtime Binance USDT-M Futures screener built with Next.js, React, and TypeScript.

**Panduan lengkap bahasa Indonesia untuk pengguna: [PANDUAN.md](PANDUAN.md)**

## Features

- Separate authenticated `/reverse` paper-only replay with original-versus-reverse statistics; no orders or history writes
- Separate `/ranking` preregistered forward experiment over a fixed 16-asset universe
- Immutable weekly JSONL observations with a strict 16/16 completeness gate
- Paper top-4 versus equal-weight-16 benchmark; breadth is context only
- Live 30m + 1h market scan from Binance public Futures API
- LONG / SHORT / WAIT status with signal state (NEW / VALID / WEAKENING / EXPIRED / INVALIDATED)
- Entry zone, invalidation level, and 1R/2R reference targets derived from ATR + candle structure
- Signal age and TREND / COUNTER-TREND labelling
- Transparent confluence score (candle, RSI, MAVOL, EMA)
- Candlestick chart (30m) with EMA50, volume + MAVOL5/14, RSI14 panel, and entry/stop/TP levels drawn on price
- Filters for side, trend mode, minimum score, and freshness
- Risk calculator: position size from account risk, never from a leverage target
- Signal history: every signal is logged once per closed candle, replayed against later
  candles, and scored for win rate, expectancy (gross and net of fees), profit factor,
  and max drawdown — broken down by score, side, mode, and coin
- Funding, open interest change, long/short ratio, and taker ratio
- Data health panel: per-source status for candles, upstream API calls, derivatives
  context, mark price freshness, history writes, and clock drift — a partial upstream
  failure is shown as DEGRADED/STALE instead of silently looking like a calm market
- Responsive dark trading terminal UI
- Automatic market refresh every 30 seconds and manual refresh button
- No API key required for the public Binance endpoints

> This is an information tool for manual validation, not an auto-trading system. The historical edge is thin; do not treat a signal as a guaranteed entry or use it as a leverage recommendation.

## Signal Freshness Rules (2026-09-09)

Preregistered Task B rules, evaluated in this order:

- No selected signal means `NONE`. Selection, `MIN_SCORE`, confluence, entry/stop/targets and closed 30m + 1h inputs are unchanged.
- `INVALIDATED` wins over every age/displacement rule: LONG mark <= stop or SHORT mark >= stop, including equality. An already invalidated status remains invalidated on the client.
- Age is elapsed milliseconds since `signal_closed_at` divided by 60,000, clamped at zero, without rounding for classification. Age >30 minutes is `EXPIRED`.
- Otherwise failed qualifying conditions or distance outside either entry-zone edge strictly >0.5 ATR means `WEAKENING`. Exactly 0.5 ATR does not downgrade. Missing/nonfinite/nonpositive ATR skips only displacement checking.
- Otherwise age <=5 minutes is `NEW`, age >5 and <=15 is `VALID`, and age >15 and <=30 is `WEAKENING`.
- Server status uses the available finite positive mark (candle close fallback); the response `price` and recorded history close remain the original candle close. Dashboard uses that mark initially, then WebSocket/polled prices, for live downgrades. Server downgrades are not upgraded locally.
- Market re-evaluation is requested every 30 seconds without overlapping requests. The client clock ages displayed statuses every second even if requests fail. Task C also adds a configured server scheduler (below); neither guarantees upstream availability.
- `USANG` marks market response `ts` older than strictly 300 seconds, even while live prices still arrive or failed fetches retain old rows. Missing/invalid timestamps are stale; successful receipt time and price/context updates do not reset market freshness.
- These are display freshness rules, not a validated trading exit or chase cutoff. No historical stop-hit tracking is added.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Production:

```bash
npm run build
npm run start
```

## Configuration

Optional environment variables:

```bash
SCREENER_COINS=BTC,ETH,SOL,XRP,BNB,DOGE,ADA,AVAX,LINK,DOT
SCREENER_MIN_SCORE=4
BINANCE_FAPI_URL=https://fapi.binance.com
```

History settings:

```bash
SCREENER_DATA_DIR=/data      # mount a volume here or history is lost on recreate
SCREENER_HISTORY_MAX=2000    # records kept
SCREENER_FEE_PCT=0.1         # round-trip taker fee used for net expectancy
SCREENER_EVAL_BARS=48        # 30m bars before a setup is marked TIMEOUT
RANKING_SNAPSHOT_TOKEN=...   # optional bearer plus mandatory same-origin POST
SCREENER_COOKIE_SECURE=1     # set ONLY once the site is served over HTTPS
```

## Server Web Push

Web Push is opt-in per browser using **AKTIFKAN PUSH SERVER**. HTTPS is required
(localhost is allowed for development). iOS/iPadOS requires a supported OS and an
installed Home Screen web app. The existing NOTIF control still governs page-local
status notifications; inbox, toasts and optional audio remain unchanged. A browser
with a PushManager subscription suppresses page-local new-signal OS notifications
to avoid doubling the server push. Disable server push separately on each device.

Operator setup, not performed by this implementation:

1. Run `npx web-push generate-vapid-keys` once on a trusted host. Keep the private key secret; never commit either configuration or generated output.
2. Supply `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and preferably `VAPID_SUBJECT=mailto:operator@example.com` (a real contact or HTTPS URL) to the serving Node process through the existing operator-managed environment/Compose configuration. Do not rotate keys casually: existing subscriptions need to be disabled and re-enabled after rotation.
3. Persist `SCREENER_DATA_DIR`. It holds `push-subscriptions.json` and `push-sent.json` alongside signal history; subscription endpoints are sensitive capability URLs. Files are atomically replaced with mode 600. Back up and restrict access to this directory.
4. Restart the serving process, log in over HTTPS, and opt in on each browser. Missing VAPID keys return HTTP 503 `push_not_configured`, displayed as "Notifikasi server belum dikonfigurasi." No keys are generated automatically.

Next.js 14 instrumentation starts an immediate scan and a 30-second timer only in
a configured Node serving runtime. `next build`, Node tests, Edge runtime, and
`SCREENER_DISABLE_WORKER=1` never start it. Without VAPID, market scans remain
request-driven. The route and timer use the same process-global single-flight
service, with the original coin selection, candle intervals, score and entry logic.
Slow scans skip overlapping ticks; this is a cadence, not a 30-second SLA.

The first process scan is a silent baseline, including on restart. Only keys
actually newly appended by `recordSignals` become eligible thereafter. Push
attempt keys are held in memory and persisted before sending (last 4,000 keys;
the append-only signal ledger is the primary long-term dedupe). This is
**at-most-once attempted delivery**, not exactly-once delivery: failures, crashes
after claiming, or no subscribers can lose alerts, and there is no retry backlog.
Each send has a 5-second deadline and a 5-minute TTL; individual failures are
isolated and 404/410 subscriptions are removed. Corrupt/unwritable push storage
fails closed without breaking market responses. Files and scan locks assume
**one long-lived Node process**, not multiple replicas, serverless or an Edge host.
Push jobs serialize separately from scans; a large subscriber fleet requires a
dedicated bounded worker/queue rather than this small single-instance scheduler.

Subscription mutations require the existing live session guard plus an explicit
same-origin Origin; forwarded headers are not trusted. The proxy must preserve
the public request origin. Endpoints allow only HTTPS standard-port FCM, Mozilla,
Apple and Windows browser-push hosts (no arbitrary URLs, IPs, credentials or
redirect targets); unsupported providers need an explicit allowlist review.
Requests are streamed with a 4,096-byte limit; keys require canonical base64url
with 65-byte uncompressed public-key and 16-byte auth-secret shapes. Duplicate
endpoints update one record, with a 1,000-subscription cap. Browser endpoints
remain active after the login session expires or logout: log in to opt out, or
revoke notification permission in browser settings. Notifications expose the
coin, direction and score on the lock screen. They contain no private account data.

Manual operator checks (not automated browser E2E):

- Missing VAPID: opt-in shows the configuration message without breaking inbox/toasts.
- On each target browser/installed PWA: grant permission, confirm subscribe success, reload and confirm active state. Denied/unsupported states should be clear.
- Close every tab, wait for a genuinely new recorded signal after the baseline, and confirm one OS alert. Repeat with a tab open: inbox/toast should remain, without a second page-generated new-signal OS alert.
- Click the notification: focus an existing root tab or open `/`, never a payload-provided URL; expired sessions should land at login.
- Disable push, reload, and confirm no further server alerts for that browser. Re-enable, test a server restart, and confirm old history is not replayed.
- Check persistence permissions, upstream connectivity, background scan warnings, and OS notification/battery settings. Test revoked subscriptions and VAPID rotation on staging only.

24/7 describes server-side scanning while the process and upstream are healthy,
**not guaranteed 24-hour OS delivery**. Force-quitting the browser/PWA, OS power
restrictions, offline devices, push-provider outages and permission revocation can
delay or prevent notifications. Status/entry/TP updates remain tab-local; only new
recorded signals use server push. No real pushes were sent during automated tests.

## Login and sessions

Every page and API route requires a session. The first run seeds the initial password
`098123plm` into `${SCREENER_DATA_DIR}/auth.json` as a scrypt hash with a random 32-byte
salt and file mode `600`; the plaintext is never written to disk or the repository. Change
it from the `AKUN` panel inside the site — changing it rotates the salt, bumps
`passwordVersion`, and signs out every other device while keeping the current browser in.

Sessions are opaque 32-byte ids in an `HttpOnly`, `SameSite=Lax` cookie. The idle timeout
is two hours and slides forward on each request, so an actively used tab stays signed in
while an untouched one dies. Ten failed logins within 15 minutes lock the login for the
rest of that window. Delete `auth.json` to reset back to the seeded initial password.

Serve the site over TLS and set `SCREENER_COOKIE_SECURE=1`. Set it in the Compose service's
`environment:` block (a container does not read the repo's `.env`), or in `.env.local` when
running `npm run start` directly on the host. That flag is deliberately not
tied to `NODE_ENV`: a production build behind plain HTTP would set a `Secure` cookie the
browser never returns, so login would loop forever. With the flag on, the session cookie is
marked `Secure` and an HSTS header is sent. Terminate TLS in front of the container (for
example Caddy or nginx on 443 proxying to `8643`) and keep the plain HTTP port closed to
the internet.

Ranking snapshots live at `${SCREENER_DATA_DIR}/ranking-snapshots.jsonl`. The
frozen formation schedule is Monday 08:00 UTC (30-minute window). Keep `/data`
mounted and back up the whole file; never edit or backfill JSONL lines. Snapshot
POSTs fail closed unless `RANKING_SNAPSHOT_TOKEN` is configured, and require both
a same-origin `Origin` plus `Authorization: Bearer <token>`. The operator token is
typed into the browser at snapshot time, so only serve this page over TLS on a
trusted host. Do not expose this site publicly without authentication and TLS.

Failed formation attempts are appended to `${SCREENER_DATA_DIR}/ranking-attempts.jsonl`
so a retry inside the same 30-minute window can still form a legitimate snapshot; back
up that file alongside the ledger. If a process is killed mid-write, a
`ranking-snapshots.jsonl.lock` file may remain — it is reclaimed automatically after
30 seconds.

`SCREENER_MIN_SCORE` defaults to `4`. A threshold of `2` matches the old backtest
candidate but fires on nearly every market while the trend is up, which removes the
screening value.

## Docker

```bash
docker build -t screener-dashboard .
docker run --rm -p 8643:3000 screener-dashboard
```

The app's internal port is `3000`; map the host port as `8643:3000`. Never commit secrets or private exchange credentials.

## Architecture

The backend is implemented as a Next.js dynamic route:

```text
app/api/market/route.ts
  -> Binance Futures public REST API
  -> EMA / RSI / SMA(MAVOL) / candle calculations on closed 30m candles
  -> JSON response
  -> `diagnostics`: candle age/alignment, upstream call tally, history write
     outcome, and clock drift against `/fapi/v1/time`

app/api/candles/route.ts
  -> closed 30m candles + EMA50 / RSI14 / MAVOL overlays for the chart

app/api/context/route.ts
  -> funding, open interest, long/short and taker ratios
  -> `diagnostics`: upstream call tally + field coverage

app/api/price/route.ts
  -> mark price fallback poll (single premiumIndex call)
  -> `diagnostics`: feed age from the exchange stamp, coverage, call tally
     (also returned on a 502 so the UI can tell DOWN from "no answer")

app/api/history/route.ts
  -> replays logged signals against closed 30m candles and aggregates statistics

app/lib/store.ts      -> append-only JSONL signal log
app/lib/evaluate.ts   -> outcome replay + statistics
app/lib/health.ts     -> pure threshold classifiers (age, API, alignment, clock)
app/lib/diagnostics.ts-> per-route diagnostics builders + dashboard summary
app/lib/api-counter.ts-> upstream success/failure/rate-limit tally per request
app/components/DataHealth.tsx -> collapsible data health panel

app/api/ranking/{preview,snapshot,history}/route.ts
app/lib/ranking*.ts, portfolio.ts, forward-stats.ts
  -> fixed-universe experiment and immutable weekly observations

app/page.tsx
  -> polls /api/market every 30 seconds; mark price uses Binance WebSocket
  -> renders the dashboard
```

The dashboard intentionally does not place trades.

## Reverse Paper Replay

`/reverse` and `GET /api/reverse?range=30` require an active session. Ranges are
`30`, `60`, `90`, and `all`. LONG/SHORT are swapped; WAIT remains WAIT (the
signal log contains only active signals). Entry and signal conditions stay the
same; each stop/target is reflected as `2 * entry - original_level`, preserving
its percentage distance. Trend-relative mode is inverted, not the original evidence.

Both sides use the same logged records and fetched closed 30m candles. This is
retrospective hypothetical replay, not preregistered forward evidence or proof of
fills. The recorded entry is assumed filled; stop wins both-touch ambiguity;
TP2 is checked before TP1, and either target exits fully. Fees use
`SCREENER_FEE_PCT`; timeout uses `SCREENER_EVAL_BARS`. Funding and slippage are
not modeled. Drawdown is signal-order cumulative net R, not account equity.

Only the latest 500 candles per coin are fetched. Missing signal coverage or
gaps needed by either replay mark both sides UNKNOWN and exclude them from
resolved statistics. History is subject to `SCREENER_HISTORY_MAX`; choosing
90 days does not guarantee 90 days of evidence. No reverse results are persisted,
and the original screener and `/api/history` behavior are unchanged.
