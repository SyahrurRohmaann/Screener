import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readSession, SESSION_COOKIE } from "./auth";

/** Resolve the caller's live session, sliding its idle window forward. */
export async function currentSession() {
  const id = cookies().get(SESSION_COOKIE)?.value ?? "";
  try { return await readSession(id); } catch { return null; }
}

/** Guard for route handlers: returns a 401 response when the caller has no live session. */
export async function guard() {
  const session = await currentSession();
  if (session) return null;
  return NextResponse.json({ error: "Unauthorized: sesi tidak aktif atau sudah kedaluwarsa." }, { status: 401 });
}
