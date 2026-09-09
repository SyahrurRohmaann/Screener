import { guard } from "../../../lib/session";
import { pushService, readPushBody, sameOriginMutation } from "../../../lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  if (!sameOriginMutation(request)) return Response.json({ error: "invalid_origin" }, { status: 403 });
  try {
    const body = await readPushBody(request) as { endpoint?: string } | null;
    await pushService().unsubscribe(body?.endpoint ?? "");
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "payload_too_large" ? 413 : ["invalid_payload", "invalid_subscription"].includes(message) ? 400 : 503;
    return Response.json({ error: status === 503 ? "push_unavailable" : message }, { status });
  }
}
