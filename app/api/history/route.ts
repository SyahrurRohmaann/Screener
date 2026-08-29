import { NextResponse } from "next/server";
import { evaluate, groupBy } from "../../lib/evaluate";
import { analyzeHistory, type HistoryRange } from "../../lib/history-analytics";
import { readHistory } from "../../lib/store";
import { guard } from "../../lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/history — logged signals replayed against closed candles. */
export async function GET(request: Request) {
  const denied = await guard();
  if (denied) return denied;

  const rawRange = new URL(request.url).searchParams.get("range") ?? "30";
  const range: HistoryRange = ["30", "60", "90", "all"].includes(rawRange)
    ? rawRange as HistoryRange : "30";
  const records = await readHistory();
  if (!records.length) {
    return NextResponse.json({
      ts: Date.now(), empty: true,
      note: "Belum ada sinyal tercatat. History terisi otomatis setiap /api/market menemukan setup baru.",
      range, cutoff: range === "all" ? null : Date.now() - Number(range) * 86_400_000,
      rows: [], stats: null, equity_curve: [], outcomes: [], holding: null,
      by_score: [], by_side: [], by_mode: [], by_coin: [], by_atr: [], by_trend_1h: [],
    });
  }

  const evaluated = await evaluate(records);
  const analytics = analyzeHistory(evaluated, range);
  const rows = analytics.rows;
  return NextResponse.json({
    ts: Date.now(),
    empty: false,
    range: analytics.range,
    cutoff: analytics.cutoff,
    stats: analytics.stats,
    equity_curve: analytics.equity_curve,
    outcomes: analytics.outcomes,
    holding: analytics.holding,
    by_atr: analytics.by_atr,
    by_trend_1h: analytics.by_trend_1h,
    by_score: groupBy(rows, (r) => r.score).sort((a, b) => Number(a.bucket) - Number(b.bucket)),
    by_side: groupBy(rows, (r) => r.sig),
    by_mode: groupBy(rows, (r) => r.mode ?? "UNKNOWN"),
    by_coin: groupBy(rows, (r) => r.coin).sort((a, b) => b.stats.total - a.stats.total),
    rows: rows.slice(0, 120),
  });
}
