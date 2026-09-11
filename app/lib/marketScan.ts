import { atr, candles, ema, getJson, rsi, sma, type Market } from "./indicators";
import { recordSignals, type SignalRecord } from "./store";
import { createApiCounter, type ApiCounter } from "./api-counter";
import { buildMarketDiagnostics } from "./diagnostics";
import { liveStatus } from "./format";
import { pushService } from "./push";
import { singleFlight } from "./scanWorker";
import { mirrorPlan, reverseSide } from "./reverse";

const COINS = (process.env.SCREENER_COINS ?? "BTC,ETH,SOL,XRP,BNB,DOGE,ADA,AVAX,LINK,DOT")
  .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
// Threshold 2 (parity MultiTFTrend) menyalakan hampir semua coin saat market trending,
// sehingga nilai penyaringnya hilang. Default dinaikkan ke 4 = butuh konfluensi nyata.
const MIN_SCORE = Number(process.env.SCREENER_MIN_SCORE ?? 4);

async function microstructure(symbol: string, counter: ApiCounter) {
  const [premium, oi, ls, taker] = await Promise.all([
    getJson<{ lastFundingRate: string; markPrice: string }>(`/fapi/v1/premiumIndex?symbol=${symbol}USDT`, counter),
    getJson<Array<{ sumOpenInterest: string }>>(`/futures/data/openInterestHist?symbol=${symbol}USDT&period=15m&limit=5`, counter),
    getJson<Array<{ longShortRatio: string }>>(`/futures/data/globalLongShortAccountRatio?symbol=${symbol}USDT&period=15m&limit=1`, counter),
    getJson<Array<{ buySellRatio: string }>>(`/futures/data/takerlongshortRatio?symbol=${symbol}USDT&period=15m&limit=1`, counter),
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

async function analyze(coin: string, counter: ApiCounter) {
  const REVERSE = process.env.SCREENER_REVERSE === "1";
  const [m30, m1h] = await Promise.all([candles(coin, "30m", 200, counter), candles(coin, "1h", 100, counter)]);
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
  let mode: "TREND" | "COUNTER" | null = sig
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

  const oriSig = sig;
  if (REVERSE && sig) {
    if (plan) plan = mirrorPlan(plan, sig === "LONG" ? plan.entry_high : plan.entry_low);
    sig = reverseSide(sig);
    mode = mode === "TREND" ? "COUNTER" : mode === "COUNTER" ? "TREND" : null;
    reasons.push(`REVERSE dari sinyal ${oriSig}`);
  }

  const closedAt = m30.t[i];
  const micro = await microstructure(coin, counter);
  const ageMin = Math.max(0, (Date.now() - closedAt) / 60000);
  const status = liveStatus({
    coin, price: micro.mark != null && Number.isFinite(micro.mark) && micro.mark > 0 ? micro.mark : close,
    sig, score, rsi: r[i], trend_1h: bullish1h ? "BULL" : "BEAR", plan,
    atr: a, age_min: ageMin,
  });

  return {
    coin, price: close, sig, score, reasons, mode, status,
    engine: REVERSE ? "reverse" as const : "ori" as const,
    ...(REVERSE ? { ori_sig: oriSig } : {}),
    signal_closed_at: closedAt, age_min: Math.floor(ageMin),
    atr: Number.isFinite(a) ? a : null, atr_pct: atrPct,
    plan, rsi: r[i], trend_1h: bullish1h ? "BULL" : "BEAR", timeframe: "30m",
    ...micro,
  };
}

async function runScan() {
  const REVERSE = process.env.SCREENER_REVERSE === "1";
  const counter = createApiCounter();
  // Clock drift must be stamped immediately around the /fapi/v1/time response, not
  // after the 60-call scan resolves: otherwise the scan duration is misread as skew
  // and a perfectly synced host reports DEGRADED. Half the round trip is the best
  // available correction for network latency.
  let serverTimeMs: number | null = null;
  const timeProbe = (async () => {
    const sentAt = Date.now();
    const answer = await getJson<{ serverTime: number }>("/fapi/v1/time", counter);
    const receivedAt = Date.now();
    if (!answer || !Number.isFinite(answer.serverTime)) return;
    // Compare the exchange stamp against local time at the response's midpoint.
    const localAtStamp = sentAt + (receivedAt - sentAt) / 2;
    serverTimeMs = answer.serverTime + (Date.now() - localAtStamp);
  })().catch(() => undefined);

  const [rows] = await Promise.all([
    Promise.all(COINS.map((coin) => analyze(coin, counter))),
    timeProbe,
  ]);

  // Log every signal once per closed candle so performance can be audited later.
  const now = Date.now();
  const candidates: SignalRecord[] = rows.flatMap((r) => {
    if (!("sig" in r) || !r.sig || !r.plan) return [];
    return [{
      key: `${r.coin}-${r.signal_closed_at}`,
      coin: r.coin, sig: r.sig, score: r.score, mode: r.mode ?? null,
      signal_closed_at: r.signal_closed_at, recorded_at: now,
      close: r.price,
      entry: r.sig === "LONG" ? r.plan.entry_high : r.plan.entry_low,
      stop: r.plan.invalidation, tp1: r.plan.tp1, tp2: r.plan.tp2,
      risk_pct: r.plan.risk_pct,
      rsi: Number.isFinite(r.rsi) ? r.rsi : null,
      trend_1h: r.trend_1h, atr_pct: r.atr_pct, reasons: r.reasons,
    }];
  });
  const historyWrite = await recordSignals(candidates);
  // Delivery failures must not turn a successful market scan into an API error.
  void pushService().publish(candidates, historyWrite.addedKeys ?? []).catch(() => {
    console.warn("Signal push persistence failed");
  });

  const diagnostics = buildMarketDiagnostics({
    now,
    expectedCoins: COINS,
    rows: rows.flatMap((r) => ("signal_closed_at" in r && Number.isFinite(r.signal_closed_at)
      ? [{ coin: r.coin, candleClosedAt: r.signal_closed_at }]
      : [])),
    api: counter.counts(),
    historyWrite,
    serverTimeMs,
  });

  return {
    source: "binance-futures", ts: now, min_score: MIN_SCORE,
    engine: REVERSE ? "reverse" as const : "ori" as const,
    logged: historyWrite.added, history_write: historyWrite,
    diagnostics, rows,
  };
}

const shared = globalThis as typeof globalThis & { screenerScan?: { pending?: ReturnType<typeof runScan>; run?: typeof runScan } };
export function scanMarket() {
  const state = shared.screenerScan ??= {};
  // Next bundles instrumentation and routes separately; retain one store/cache owner.
  return singleFlight(state, state.run ??= runScan);
}
