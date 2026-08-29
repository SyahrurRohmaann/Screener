import { NextResponse } from "next/server";
import { appendDecision, DECISION_ACTIONS, mutationIsSameOrigin, readDecisions, type DecisionAction, type DecisionInput } from "../../lib/decision-journal";
import { guard } from "../../lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const url = new URL(req.url);
  const action = url.searchParams.get("action")?.toUpperCase();
  const coin = url.searchParams.get("coin") ?? undefined;
  if (action && !DECISION_ACTIONS.includes(action as DecisionAction)) {
    return NextResponse.json({ error: "Filter aksi tidak valid." }, { status: 400 });
  }
  return NextResponse.json({ rows: await readDecisions({ action: action as DecisionAction | undefined, coin }) });
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  if (!mutationIsSameOrigin(req)) return NextResponse.json({ error: "Forbidden: mutasi wajib same-origin." }, { status: 403 });
  try {
    const input = await req.json() as DecisionInput;
    return NextResponse.json(await appendDecision(input), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Keputusan tidak valid." }, { status: 400 });
  }
}
