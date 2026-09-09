import { NextResponse } from "next/server";
import { guard } from "../../lib/session";
import { scanMarket } from "../../lib/marketScan";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  return NextResponse.json(await scanMarket());
}
