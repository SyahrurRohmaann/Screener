import { NextResponse } from "next/server";
import { guard } from "../../lib/session";
import { readHistory } from "../../lib/store";
import { compareReverse } from "../../lib/reverse";
import type { HistoryRange } from "../../lib/history-analytics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const range = new URL(request.url).searchParams.get("range") ?? "30";
  if (!["30", "60", "90", "all"].includes(range)) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }
  return NextResponse.json(await compareReverse(await readHistory(), range as HistoryRange),
    { headers: { "Cache-Control": "private, no-store" } });
}
