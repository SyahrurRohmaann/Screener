# Screener

Realtime Binance USDT-M Futures screener built with Next.js, React, and TypeScript.

**Panduan lengkap bahasa Indonesia untuk pengguna: [PANDUAN.md](PANDUAN.md)**

## Features

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
- Responsive dark trading terminal UI
- Automatic refresh every 60 seconds and manual refresh button
- No API key required for the public Binance endpoints

> This is an information tool for manual validation, not an auto-trading system. The historical edge is thin; do not treat a signal as a guaranteed entry or use it as a leverage recommendation.

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
```

Ranking snapshots live at `${SCREENER_DATA_DIR}/ranking-snapshots.jsonl`. The
frozen formation schedule is Monday 08:00 UTC (30-minute window). Keep `/data`
mounted and back up the whole file; never edit or backfill JSONL lines. Snapshot
POSTs fail closed unless `RANKING_SNAPSHOT_TOKEN` is configured, and require both
a same-origin `Origin` plus `Authorization: Bearer <token>`. Do not expose this
site publicly without authentication and TLS.

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

app/api/candles/route.ts
  -> closed 30m candles + EMA50 / RSI14 / MAVOL overlays for the chart

app/api/context/route.ts
  -> funding, open interest, long/short and taker ratios

app/api/history/route.ts
  -> replays logged signals against closed 30m candles and aggregates statistics

app/lib/store.ts      -> append-only JSONL signal log
app/lib/evaluate.ts   -> outcome replay + statistics

app/api/ranking/{preview,snapshot,history}/route.ts
app/lib/ranking*.ts, portfolio.ts, forward-stats.ts
  -> fixed-universe experiment and immutable weekly observations

app/page.tsx
  -> polls /api/market every 60 seconds; mark price uses Binance WebSocket
  -> renders the dashboard
```

The dashboard intentionally does not place trades.
