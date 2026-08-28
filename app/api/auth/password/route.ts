import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { changePassword, sessionCookie, SESSION_COOKIE } from "../../../lib/auth";
import { currentSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = req.headers.get("origin"), host = req.headers.get("host");
  if (!origin || !host) return NextResponse.json({ error: "Origin wajib." }, { status: 403 });
  try { if (new URL(origin).host !== host) return NextResponse.json({ error: "Origin tidak sama." }, { status: 403 }); }
  catch { return NextResponse.json({ error: "Origin tidak valid." }, { status: 403 }); }

  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sesi tidak aktif." }, { status: 401 });

  let current = "", next = "";
  try {
    const body = (await req.json()) as any;
    current = String(body?.current ?? ""); next = String(body?.next ?? "");
  } catch { return NextResponse.json({ error: "Body tidak valid." }, { status: 400 }); }

  try {
    const id = cookies().get(SESSION_COOKIE)?.value ?? "";
    await changePassword(current, next, id);
    // Keep this browser signed in; every other session was invalidated.
    return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(id) } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
