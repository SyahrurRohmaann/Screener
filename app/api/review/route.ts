import { NextResponse } from "next/server";
import { evaluate } from "../../lib/evaluate";
import { readHistory } from "../../lib/store";
import { guard } from "../../lib/session";
import { readDecisions } from "../../lib/decision-journal";
import { buildWeeklyReview } from "../../lib/weekly-review";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  const rows = await evaluate(await readHistory());
  return NextResponse.json(buildWeeklyReview({ rows, decisions: await readDecisions(), now: Date.now() }));
}
