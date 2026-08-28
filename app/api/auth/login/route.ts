import { NextResponse } from "next/server";
import { login, sessionCookie, loginLocked } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = req.headers.get("origin"), host = req.headers.get("host");
  if (!origin || !host) return NextResponse.json({ error: "Origin wajib." }, { status: 403 });
  try { if (new URL(origin).host !== host) return NextResponse.json({ error: "Origin tidak sama." }, { status: 403 }); }
  catch { return NextResponse.json({ error: "Origin tidak valid." }, { status: 403 }); }

  let password = "";
  try { password = String(((await req.json()) as any)?.password ?? ""); }
  catch { return NextResponse.json({ error: "Body tidak valid." }, { status: 400 }); }

  if (await loginLocked()) {
    return NextResponse.json({ error: "Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit." }, { status: 429 });
  }
  const session = await login(password);
  // Same message for wrong password and unknown state: never reveal which part failed.
  if (!session) return NextResponse.json({ error: "Password salah." }, { status: 401 });
  return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(session.id) } });
}
