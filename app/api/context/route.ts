import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const BINANCE = process.env.BINANCE_FAPI_URL ?? "https://fapi.binance.com";
const COINS = (process.env.SCREENER_COINS ?? "BTC,ETH,SOL,XRP,BNB,DOGE,ADA,AVAX,LINK,DOT").split(",").map(x => x.trim().toUpperCase()).filter(Boolean);

async function getJson<T>(path: string): Promise<T | null> {
  try { const r = await fetch(`${BINANCE}${path}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }); return r.ok ? await r.json() as T : null; }
  catch { return null; }
}

async function context(coin: string) {
  const symbol = `${coin}USDT`;
  const [premium, oi, ls, taker] = await Promise.all([
    getJson<{ lastFundingRate: string; markPrice: string }>(`/fapi/v1/premiumIndex?symbol=${symbol}`),
    getJson<Array<{ sumOpenInterest: string }>>(`/futures/data/openInterestHist?symbol=${symbol}&period=15m&limit=5`),
    getJson<Array<{ longShortRatio: string }>>(`/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=1`),
    getJson<Array<{ buySellRatio: string }>>(`/futures/data/takerlongshortRatio?symbol=${symbol}&period=15m&limit=1`),
  ]);
  const first = oi?.[0] ? Number(oi[0].sumOpenInterest) : NaN;
  const last = oi?.at(-1) ? Number(oi.at(-1)!.sumOpenInterest) : NaN;
  return { coin, funding: premium ? Number(premium.lastFundingRate) * 100 : null, mark: premium ? Number(premium.markPrice) : null, oi_chg: Number.isFinite(first) && first !== 0 && Number.isFinite(last) ? (last - first) / first * 100 : null, ls_ratio: ls?.at(-1) ? Number(ls.at(-1)!.longShortRatio) : null, taker: taker?.at(-1) ? Number(taker.at(-1)!.buySellRatio) : null };
}

export async function GET() {
  const values = await Promise.all(COINS.map(context));
  return NextResponse.json(Object.fromEntries(values.map(x => [x.coin, x])));
}


