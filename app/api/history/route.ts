import { NextResponse } from "next/server";
import { evaluate, groupBy, summarize } from "../../lib/evaluate";
import { readHistory } from "../../lib/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/history — logged signals replayed against closed candles. */
export async function GET() {
  const records = await readHistory();
  if (!records.length) {
    return NextResponse.json({
      ts: Date.now(), empty: true,
      note: "Belum ada sinyal tercatat. History terisi otomatis setiap /api/market menemukan setup baru.",
      rows: [], stats: null, by_score: [], by_side: [], by_mode: [], by_coin: [],
    });
  }

  const rows = await evaluate(records);
  return NextResponse.json({
    ts: Date.now(),
    empty: false,
    stats: summarize(rows),
    by_score: groupBy(rows, (r) => r.score).sort((a, b) => Number(a.bucket) - Number(b.bucket)),
    by_side: groupBy(rows, (r) => r.sig),
    by_mode: groupBy(rows, (r) => r.mode ?? "UNKNOWN"),
    by_coin: groupBy(rows, (r) => r.coin).sort((a, b) => b.stats.total - a.stats.total),
    rows: rows.slice(0, 120),
  });
}
