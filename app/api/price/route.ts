import { NextResponse } from "next/server";
import { BINANCE } from "../../lib/indicators";
import { guard } from "../../lib/session";
import { createApiCounter } from "../../lib/api-counter";
import { buildPriceDiagnostics } from "../../lib/diagnostics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const COINS = (process.env.SCREENER_COINS ?? "BTC,ETH,SOL,XRP,BNB,DOGE,ADA,AVAX,LINK,DOT")
  .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);

type Premium = { symbol: string; markPrice: string; time: number };

/**
 * Mark price fallback for browsers/networks where wss://fstream.binance.com
 * connects but never delivers frames. One unfiltered premiumIndex call returns
 * every symbol, so polling this stays a single upstream request regardless of
 * how many coins are tracked.
 *
 * A 502 still carries diagnostics: the dashboard must be able to tell "the feed is
 * down" apart from "the request never completed".
 */
export async function GET() {
  const denied = await guard();
  if (denied) return denied;

  const counter = createApiCounter();
  const failed = (reason: "upstream" | "unreachable") => NextResponse.json({
    error: reason,
    prices: {},
    diagnostics: buildPriceDiagnostics({
      now: Date.now(), expectedCoins: COINS, prices: {}, sourceTs: null, api: counter.counts(),
    }),
  }, { status: 502 });

  try {
    const response = await fetch(`${BINANCE}/fapi/v1/premiumIndex`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    counter.record({ ok: response.ok, status: response.status });
    if (!response.ok) return failed("upstream");
    const all = (await response.json()) as Premium[];

    const wanted = new Set(COINS.map((c) => `${c}USDT`));
    const prices: Record<string, number> = {};
    let stamp = 0;
    for (const entry of all) {
      if (!wanted.has(entry.symbol)) continue;
      const price = Number(entry.markPrice);
      if (Number.isFinite(price) && price > 0) {
        prices[entry.symbol.replace("USDT", "")] = price;
        stamp = Math.max(stamp, entry.time ?? 0);
      }
    }
    const now = Date.now();
    // Freshness is judged on the exchange stamp, so a frozen-but-fast response is
    // reported as STALE instead of looking healthy.
    const diagnostics = buildPriceDiagnostics({
      now, expectedCoins: COINS, prices, sourceTs: stamp || null, api: counter.counts(),
    });
    return NextResponse.json({ ts: stamp || now, prices, diagnostics });
  } catch {
    counter.record({ ok: false, status: null });
    return failed("unreachable");
  }
}
