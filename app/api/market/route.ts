import { NextResponse } from "next/server";
import { atr, candles, ema, getJson, rsi, sma, type Market } from "../../lib/indicators";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const COINS = (process.env.SCREENER_COINS ?? "BTC,ETH,SOL,XRP,BNB,DOGE,ADA,AVAX,LINK,DOT")
  .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
// Threshold 2 (parity MultiTFTrend) menyalakan hampir semua coin saat market trending,
// sehingga nilai penyaringnya hilang. Default dinaikkan ke 4 = butuh konfluensi nyata.
const MIN_SCORE = Number(process.env.SCREENER_MIN_SCORE ?? 4);

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
  const [m30, m1h] = await Promise.all([candles(coin, "30m", 200), candles(coin, "1h", 100)]);
  if (!m30 || !m1h) return { coin, error: "data unavailable" };
  const i = m30.c.length - 1;
  const e30 = ema(m30.c, 50), e1h = ema(m1h.c, 50), r = rsi(m30.c), mv5 = sma(m30.v, 5), mv14 = sma(m30.v, 14);
  const bullish1h = m1h.c.at(-1)! > e1h.at(-1)!;
  const rsiUp30 = r[i] > 30 && r[i - 1] <= 30;
  const rsiDown70 = r[i] < 70 && r[i - 1] >= 70;
  const volumeUp = mv5[i] > mv14[i];
  const bullCandle = pattern(m30, i, true), bearCandle = pattern(m30, i, false);
  const aboveEma = m30.c[i] > e30[i], belowEma = m30.c[i] < e30[i];
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

  const close = m30.c[i];
  const a = atr(m30, 14);
  const atrPct = Number.isFinite(a) ? (a / close) * 100 : null;
  const mode = sig
    ? ((sig === "LONG" && bullish1h) || (sig === "SHORT" && !bullish1h) ? "TREND" : "COUNTER")
    : null;

  // Entry zone: close ke arah retrace 0.25 ATR; stop mengikuti struktur candle
  // sinyal + buffer 0.5 ATR, dibatasi maksimal 8% (SL strategi lama).
  let plan: null | {
    entry_low: number; entry_high: number; invalidation: number;
    risk_pct: number; tp1: number; tp2: number; rr1: number; rr2: number;
  } = null;
  if (sig && Number.isFinite(a)) {
    const buf = 0.5 * a;
    if (sig === "LONG") {
      const entryLow = close - 0.25 * a, entryHigh = close;
      const capped = Math.max(Math.min(m30.l[i], m30.l[i - 1]) - buf, close * 0.92);
      const risk = entryHigh - capped;
      plan = {
        entry_low: entryLow, entry_high: entryHigh, invalidation: capped,
        risk_pct: (risk / entryHigh) * 100,
        tp1: entryHigh + risk, tp2: entryHigh + 2 * risk, rr1: 1, rr2: 2,
      };
    } else {
      const entryHigh = close + 0.25 * a, entryLow = close;
      const capped = Math.min(Math.max(m30.h[i], m30.h[i - 1]) + buf, close * 1.08);
      const risk = capped - entryLow;
      plan = {
        entry_low: entryLow, entry_high: entryHigh, invalidation: capped,
        risk_pct: (risk / entryLow) * 100,
        tp1: entryLow - risk, tp2: entryLow - 2 * risk, rr1: 1, rr2: 2,
      };
    }
  }

  const closedAt = m30.t[i];
  const ageMin = Math.max(0, Math.round((Date.now() - closedAt) / 60000));
  const status = !sig ? "NONE" : ageMin <= 5 ? "NEW" : ageMin <= 30 ? "VALID" : ageMin <= 60 ? "WEAKENING" : "EXPIRED";

  return {
    coin, price: close, sig, score, reasons, mode, status,
    signal_closed_at: closedAt, age_min: ageMin,
    atr: Number.isFinite(a) ? a : null, atr_pct: atrPct,
    plan, rsi: r[i], trend_1h: bullish1h ? "BULL" : "BEAR", timeframe: "30m",
    ...await microstructure(coin),
  };
}

export async function GET() {
  const rows = await Promise.all(COINS.map(analyze));
  return NextResponse.json({ source: "binance-futures", ts: Date.now(), min_score: MIN_SCORE, rows });
}
