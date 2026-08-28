import { NextResponse } from "next/server";
import { BINANCE } from "../../lib/indicators";

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
 */
export async function GET() {
  try {
    const response = await fetch(`${BINANCE}/fapi/v1/premiumIndex`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return NextResponse.json({ error: "upstream" }, { status: 502 });
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
    return NextResponse.json({ ts: stamp || Date.now(), prices });
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
