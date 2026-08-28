import { NextResponse } from "next/server";
import { atr, candles, ema, rsi, sma } from "../../lib/indicators";
import { guard } from "../../lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BARS = 120;

/** GET /api/candles?coin=BTC — closed 30m candles plus overlays for the chart. */
export async function GET(request: Request) {
  const denied = await guard();
  if (denied) return denied;

  const coin = (new URL(request.url).searchParams.get("coin") ?? "BTC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!coin) return NextResponse.json({ error: "coin required" }, { status: 400 });

  const m30 = await candles(coin, "30m", 300);
  if (!m30 || m30.c.length < 60) return NextResponse.json({ error: "data unavailable" }, { status: 502 });

  const e50 = ema(m30.c, 50), r14 = rsi(m30.c), mv5 = sma(m30.v, 5), mv14 = sma(m30.v, 14);
  const start = Math.max(0, m30.c.length - MAX_BARS);
  const nz = (x: number) => (Number.isFinite(x) ? x : null);

  const bars = m30.c.slice(start).map((_, k) => {
    const i = start + k;
    return {
      t: m30.t[i], o: m30.o[i], h: m30.h[i], l: m30.l[i], c: m30.c[i], v: m30.v[i],
      ema50: nz(e50[i]), rsi: nz(r14[i]), mavol5: nz(mv5[i]), mavol14: nz(mv14[i]),
    };
  });

  const a = atr(m30, 14);
  return NextResponse.json({
    coin, interval: "30m", ts: Date.now(),
    atr: Number.isFinite(a) ? a : null,
    atr_pct: Number.isFinite(a) ? (a / m30.c.at(-1)!) * 100 : null,
    bars,
  });
}
