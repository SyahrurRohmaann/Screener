# Screener

Realtime Binance USDT-M Futures screener built with Next.js, React, and TypeScript.

## Features

- Live 15m + 1h market scan from Binance public Futures API
- LONG / SHORT / WAIT status
- Transparent confluence score (candle, RSI, MAVOL, EMA)
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
SCREENER_MIN_SCORE=3
BINANCE_FAPI_URL=https://fapi.binance.com
```

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
  -> EMA / RSI / SMA(MAVOL) / candle calculations
  -> JSON response

app/page.tsx
  -> polls /api/market every 60 seconds
  -> renders the dashboard
```

The dashboard intentionally does not place trades.
