import { NextResponse } from "next/server";
import { guard } from "../../lib/session";
import { createApiCounter, type ApiCounter } from "../../lib/api-counter";
import { buildContextDiagnostics } from "../../lib/diagnostics";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const BINANCE = process.env.BINANCE_FAPI_URL ?? "https://fapi.binance.com";
const COINS = (process.env.SCREENER_COINS ?? "BTC,ETH,SOL,XRP,BNB,DOGE,ADA,AVAX,LINK,DOT").split(",").map(x => x.trim().toUpperCase()).filter(Boolean);

async function getJson<T>(path: string, counter: ApiCounter): Promise<T | null> {
  try {
    const r = await fetch(`${BINANCE}${path}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    counter.record({ ok: r.ok, status: r.status });
    return r.ok ? await r.json() as T : null;
  } catch {
    // Timeout or transport failure — counted so partial coverage is visible.
    counter.record({ ok: false, status: null });
    return null;
  }
}

async function context(coin: string, counter: ApiCounter) {
  const symbol = `${coin}USDT`;
  const [premium, oi, ls, taker] = await Promise.all([
    getJson<{ lastFundingRate: string; markPrice: string }>(`/fapi/v1/premiumIndex?symbol=${symbol}`, counter),
    getJson<Array<{ sumOpenInterest: string }>>(`/futures/data/openInterestHist?symbol=${symbol}&period=15m&limit=5`, counter),
    getJson<Array<{ longShortRatio: string }>>(`/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=1`, counter),
    getJson<Array<{ buySellRatio: string }>>(`/futures/data/takerlongshortRatio?symbol=${symbol}&period=15m&limit=1`, counter),
  ]);
  const first = oi?.[0] ? Number(oi[0].sumOpenInterest) : NaN;
  const last = oi?.at(-1) ? Number(oi.at(-1)!.sumOpenInterest) : NaN;
  return { coin, funding: premium ? Number(premium.lastFundingRate) * 100 : null, mark: premium ? Number(premium.markPrice) : null, oi_chg: Number.isFinite(first) && first !== 0 && Number.isFinite(last) ? (last - first) / first * 100 : null, ls_ratio: ls?.at(-1) ? Number(ls.at(-1)!.longShortRatio) : null, taker: taker?.at(-1) ? Number(taker.at(-1)!.buySellRatio) : null };
}

export async function GET() {
  const denied = await guard();
  if (denied) return denied;

  const counter = createApiCounter();
  const values = await Promise.all(COINS.map((coin) => context(coin, counter)));

  // The per-coin map stays at the top level so existing clients keep working; the
  // diagnostics live under a reserved key that is not a coin symbol.
  const diagnostics = buildContextDiagnostics({
    now: Date.now(),
    expectedCoins: COINS,
    values,
    api: counter.counts(),
  });

  return NextResponse.json({
    ...Object.fromEntries(values.map(x => [x.coin, x])),
    diagnostics,
  });
}
