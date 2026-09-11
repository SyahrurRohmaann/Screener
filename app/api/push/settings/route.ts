import { guard } from "../../../lib/session";
import { getPushSettings, setPushSettings, readPushBody, sameOriginMutation } from "../../../lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const denied = await guard();
  if (denied) { denied.headers.set("Cache-Control", "no-store"); return denied; }
  return Response.json(await getPushSettings(), { headers });
}

export async function POST(request: Request) {
  const denied = await guard();
  if (denied) { denied.headers.set("Cache-Control", "no-store"); return denied; }
  if (!sameOriginMutation(request)) return Response.json({ error: "invalid_origin" }, { status: 403, headers });
  try {
    return Response.json(await setPushSettings(await readPushBody(request)), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "payload_too_large" ? 413 : ["invalid_payload", "invalid_settings"].includes(message) ? 400 : 503;
    return Response.json({ error: status === 503 ? "push_unavailable" : message }, { status, headers });
  }
}
