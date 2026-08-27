import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Candle = [number, string, string, string, string, string, number];
type Market = { o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };

const COINS = (process.env.SCREENER_COINS ?? "BTC,ETH,SOL,XRP,BNB,DOGE,ADA,AVAX,LINK,DOT")
  .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
const BINANCE = process.env.BINANCE_FAPI_URL ?? "https://fapi.binance.com";
// Parity dengan kandidat MultiTFTrend terakhir: entry_threshold=2.
const MIN_SCORE = Number(process.env.SCREENER_MIN_SCORE ?? 2);

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${BINANCE}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json" },
    });
    return response.ok ? await response.json() as T : null;
  } catch { return null; }
}

function ema(values: number[], period: number) {
  const out = Array<number>(values.length).fill(Number.NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  out[period - 1] = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k);
  return out;
}

function sma(values: number[], period: number) {
  const out = Array<number>(values.length).fill(Number.NaN);
  for (let i = period - 1; i < values.length; i++) {
    out[i] = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  }
  return out;
}

function rsi(close: number[], period = 14) {
  const out = Array<number>(close.length).fill(Number.NaN);
  const changes = close.slice(1).map((x, i) => x - close[i]);
  if (changes.length < period) return out;
  let gain = changes.slice(0, period).reduce((a, x) => a + Math.max(x, 0), 0) / period;
  let loss = changes.slice(0, period).reduce((a, x) => a + Math.max(-x, 0), 0) / period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < close.length; i++) {
    const change = changes[i - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

async function candles(symbol: string, interval: string, limit: number): Promise<Market | null> {
  const data = await getJson<Candle[]>(`/fapi/v1/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`);
  if (!data?.length) return null;
  // Freqtrade process_only_new_candles bekerja pada candle yang sudah tutup.
  // Binance sering mengembalikan candle berjalan sebagai elemen terakhir.
  const closed = data.filter((x) => Number(x[6]) <= Date.now());
  return {
    o: closed.map((x) => Number(x[1])), h: closed.map((x) => Number(x[2])),
    l: closed.map((x) => Number(x[3])), c: closed.map((x) => Number(x[4])),
    v: closed.map((x) => Number(x[5])),
  };
}

async function microstructure(symbol: string) {
  const [premium, oi, ls, taker] = await Promise.all([
    getJson<{ lastFundingRate: string; markPrice: string }>(`/fapi/v1/premiumIndex?symbol=${symbol}USDT`),
    getJson<Array<{ sumOpenInterest: string }>>(`/futures/data/openInterestHist?symbol=${symbol}USDT&period=15m&limit=5`),
    getJson<Array<{ longShortRatio: string }>>(`/futures/data/globalLongShortAccountRatio?symbol=${symbol}USDT&period=15m&limit=1`),
    getJson<Array<{ buySellRatio: string }>>(`/futures/data/takerlongshortRatio?symbol=${symbol}USDT&period=15m&limit=1`),
  ]);
  const first = oi?.[0] ? Number(oi[0].sumOpenInterest) : NaN;
  const last = oi?.at(-1) ? Number(oi.at(-1)!.sumOpenInterest) : NaN;
  return {
    funding: premium ? Number(premium.lastFundingRate) * 100 : null,
    mark: premium ? Number(premium.markPrice) : null,
    oi_chg: Number.isFinite(first) && first !== 0 && Number.isFinite(last) ? (last - first) / first * 100 : null,
    ls_ratio: ls?.at(-1) ? Number(ls.at(-1)!.longShortRatio) : null,
    taker: taker?.at(-1) ? Number(taker.at(-1)!.buySellRatio) : null,
  };
}

function pattern(data: Market, i: number, bullish: boolean) {
  if (i < 2) return false;
  const body = Math.abs(data.c[i] - data.o[i]);
  const range = data.h[i] - data.l[i] + 1e-9;
  const upper = data.h[i] - Math.max(data.o[i], data.c[i]);
  const lower = Math.min(data.o[i], data.c[i]) - data.l[i];
  const prevBody = Math.abs(data.c[i - 1] - data.o[i - 1]);
  const prevRange = data.h[i - 1] - data.l[i - 1] + 1e-9;
  const twoBackBear = data.c[i - 2] < data.o[i - 2];
  const twoBackBull = data.c[i - 2] > data.o[i - 2];
  const previousBear = data.c[i - 1] < data.o[i - 1];
  const previousBull = data.c[i - 1] > data.o[i - 1];
  const engulf = bullish
    ? data.c[i] > data.o[i] && previousBear && data.c[i] >= data.o[i - 1] && data.o[i] <= data.c[i - 1]
    : data.c[i] < data.o[i] && previousBull && data.c[i] <= data.o[i - 1] && data.o[i] >= data.c[i - 1];
  const hammer = lower > 2 * body && body / range < 0.35;
  const invertedHammer = upper > 2 * body && body / range < 0.35;
  const morningStar = twoBackBear && prevBody / prevRange < 0.35 && data.c[i] > data.o[i] && data.c[i] > (data.o[i - 2] + data.c[i - 2]) / 2;
  const eveningStar = twoBackBull && prevBody / prevRange < 0.35 && data.c[i] < data.o[i] && data.c[i] < (data.o[i - 2] + data.c[i - 2]) / 2;
  const piercing = previousBear && data.c[i] > data.o[i] && data.o[i] <= data.c[i - 1] && data.c[i] > (data.o[i - 1] + data.c[i - 1]) / 2;
  const darkCloud = previousBull && data.c[i] < data.o[i] && data.o[i] >= data.c[i - 1] && data.c[i] < (data.o[i - 1] + data.c[i - 1]) / 2;
  return bullish ? (engulf || hammer || invertedHammer || morningStar || piercing)
                 : (engulf || hammer || invertedHammer || eveningStar || darkCloud);
}

async function analyze(coin: string) {
  const [m15, m1h] = await Promise.all([candles(coin, "15m", 200), candles(coin, "1h", 100)]);
  if (!m15 || !m1h) return { coin, error: "data unavailable" };
  const i = m15.c.length - 1;
  const e15 = ema(m15.c, 50), e1h = ema(m1h.c, 50), r = rsi(m15.c), mv5 = sma(m15.v, 5), mv14 = sma(m15.v, 14);
  const bullish1h = m1h.c.at(-1)! > e1h.at(-1)!;
  const rsiUp30 = r[i] > 30 && r[i - 1] <= 30;
  const rsiDown70 = r[i] < 70 && r[i - 1] >= 70;
  const volumeUp = mv5[i] > mv14[i];
  const bullCandle = pattern(m15, i, true), bearCandle = pattern(m15, i, false);
  const aboveEma = m15.c[i] > e15[i], belowEma = m15.c[i] < e15[i];
  const longScore = Number(bullCandle) * 2 + Number(rsiUp30) * 2 + Number(volumeUp) + Number(aboveEma);
  const shortScore = Number(bearCandle) * 2 + Number(rsiDown70) * 2 + Number(volumeUp) + Number(belowEma);
  let sig: "LONG" | "SHORT" | null = null;
  let score = 0;
  const reasons: string[] = [];
  if (longScore >= MIN_SCORE && (bullish1h || rsiUp30)) {
    sig = "LONG"; score = longScore;
    if (bullCandle) reasons.push("candle bullish"); if (rsiUp30) reasons.push("RSI tembus↑30");
    if (volumeUp) reasons.push("MAVOL5>14"); if (aboveEma) reasons.push("harga>EMA50");
  } else if (shortScore >= MIN_SCORE && (!bullish1h || rsiDown70)) {
    sig = "SHORT"; score = shortScore;
    if (bearCandle) reasons.push("candle bearish"); if (rsiDown70) reasons.push("RSI tembus↓70");
    if (volumeUp) reasons.push("MAVOL5>14"); if (belowEma) reasons.push("harga<EMA50");
  }
  return { coin, price: m15.c[i], sig, score, reasons, rsi: r[i], trend_1h: bullish1h ? "BULL" : "BEAR", ...await microstructure(coin) };
}

export async function GET() {
  const rows = await Promise.all(COINS.map(analyze));
  return NextResponse.json({ source: "binance-futures", ts: Date.now(), rows });
}
