import { guard } from "../../../lib/session";
import { pushConfigured, pushService, readPushBody, sameOriginMutation } from "../../../lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  return pushConfigured()
    ? Response.json({ publicKey: process.env.VAPID_PUBLIC_KEY }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "push_not_configured" }, { status: 503 });
}

export async function POST(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  if (!sameOriginMutation(request)) return Response.json({ error: "invalid_origin" }, { status: 403 });
  if (!pushConfigured()) return Response.json({ error: "push_not_configured" }, { status: 503 });
  try {
    await pushService().subscribe(await readPushBody(request));
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "payload_too_large" ? 413 : ["invalid_payload", "invalid_subscription"].includes(message) ? 400 : 503;
    return Response.json({ error: status === 503 ? "push_unavailable" : message }, { status });
  }
}
