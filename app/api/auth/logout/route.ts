import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { logout, clearedCookie, SESSION_COOKIE } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const id = cookies().get(SESSION_COOKIE)?.value ?? "";
  if (id) await logout(id).catch(() => {});
  return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": clearedCookie() } });
}
