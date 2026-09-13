import { NextResponse } from "next/server";
import { login, sessionCookie, loginLocked } from "../../../lib/auth";
import { createLoginGuard } from "../../../lib/login-guard";

export const dynamic = "force-dynamic";
const guard = createLoginGuard();

export async function POST(req: Request) {
  const t0 = Date.now();
  async function fail(error: string, status: number, headers?: HeadersInit) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 400 - (Date.now() - t0))));
    return NextResponse.json({ error }, { status, headers });
  }
  const origin = req.headers.get("origin"), host = req.headers.get("host");
  if (!origin || !host) return NextResponse.json({ error: "Origin wajib." }, { status: 403 });
  try { if (new URL(origin).host !== host) return NextResponse.json({ error: "Origin tidak sama." }, { status: 403 }); }
  catch { return NextResponse.json({ error: "Origin tidak valid." }, { status: 403 }); }

  let password = "";
  try {
    const body = await req.json();
    if (body?.website !== "") return fail("Body tidak valid.", 400);
    password = String(body?.password ?? "");
  }
  catch { return fail("Body tidak valid.", 400); }

  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown").slice(0, 45);
  const check = guard.check(ip, Date.now());
  if (!check.ok) {
    return fail(`Terlalu banyak percobaan. Coba lagi dalam ${check.retryAfterSec} detik.`, 429,
      { "Retry-After": String(check.retryAfterSec) });
  }

  if (await loginLocked()) {
    return fail("Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.", 429);
  }
  const session = await login(password);
  guard.record(ip, !!session, Date.now());
  // Same message for wrong password and unknown state: never reveal which part failed.
  if (!session) return fail("Password salah.", 401);
  return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(session.id) } });
}
