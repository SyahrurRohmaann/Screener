import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { join } from "node:path";

/** Idle timeout: a session dies after two hours without any request. */
export const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const SESSION_COOKIE = "screener_session";
const MIN_PASSWORD_LENGTH = 8;
const MAX_FAILURES = 10;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const INITIAL_PASSWORD = "098123plm";

type Session = { id: string; lastSeen: number };
type AuthFile = {
  salt: string; hash: string; passwordVersion: number;
  sessions: Session[]; failures: number[];
};

const authPath = () => join(process.env.SCREENER_DATA_DIR ?? "/tmp/screener-data", "auth.json");

function derive(password: string, salt: string) {
  return new Promise<string>((resolve, reject) =>
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) =>
      error ? reject(error) : resolve(key.toString("hex"))));
}

function sameSecret(a: string, b: string) {
  const left = Buffer.from(a, "utf8"), right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function write(state: AuthFile) {
  const path = authPath();
  await mkdir(join(path, ".."), { recursive: true });
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
  return state;
}

/**
 * Read the auth file, seeding the initial password on first run. A corrupt file is a hard
 * error: silently reseeding would reset the password back to the shipped default.
 */
export async function authState(): Promise<AuthFile> {
  const path = authPath();
  let text = "";
  try { text = await readFile(path, "utf8"); }
  catch (error: any) {
    if (error.code !== "ENOENT") throw error;
    const salt = randomBytes(32).toString("hex");
    return write({ salt, hash: await derive(INITIAL_PASSWORD, salt), passwordVersion: 1, sessions: [], failures: [] });
  }
  let parsed: AuthFile;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("Corrupt auth.json; refusing to reset the password automatically"); }
  if (!parsed?.salt || !parsed?.hash) throw new Error("Corrupt auth.json; missing credential fields");
  return {
    salt: parsed.salt, hash: parsed.hash,
    passwordVersion: parsed.passwordVersion ?? 1,
    sessions: parsed.sessions ?? [], failures: parsed.failures ?? [],
  };
}

export async function recordFailure(now = Date.now()) {
  const state = await authState();
  const failures = [...state.failures, now].filter((x) => now - x < LOCK_WINDOW_MS);
  return write({ ...state, failures });
}

export async function loginLocked(now = Date.now()) {
  const state = await authState();
  return state.failures.filter((x) => now - x < LOCK_WINDOW_MS).length >= MAX_FAILURES;
}

export async function login(password: string, now = Date.now()) {
  if (await loginLocked(now)) return null;
  const state = await authState();
  if (!sameSecret(await derive(password, state.salt), state.hash)) { await recordFailure(now); return null; }
  const session: Session = { id: randomBytes(32).toString("hex"), lastSeen: now };
  const sessions = [...state.sessions.filter((x) => now - x.lastSeen < IDLE_TIMEOUT_MS), session];
  await write({ ...state, sessions, failures: [] });
  return session;
}

/** Validate a session and slide its idle window forward on every use. */
export async function readSession(id: string, now = Date.now()) {
  if (!id) return null;
  const state = await authState();
  const live = state.sessions.filter((x) => now - x.lastSeen < IDLE_TIMEOUT_MS);
  const found = live.find((x) => sameSecret(x.id, id));
  if (!found) {
    if (live.length !== state.sessions.length) await write({ ...state, sessions: live });
    return null;
  }
  await write({ ...state, sessions: live.map((x) => (x.id === found.id ? { ...x, lastSeen: now } : x)) });
  return { ...found, lastSeen: now };
}

export async function logout(id: string) {
  const state = await authState();
  return write({ ...state, sessions: state.sessions.filter((x) => !sameSecret(x.id, id)) });
}

/** Rotate the password; every other session is invalidated so a stolen cookie dies with it. */
export async function changePassword(current: string, next: string, keepSessionId: string, now = Date.now()) {
  const state = await authState();
  if (!sameSecret(await derive(current, state.salt), state.hash)) throw new Error("Password sekarang salah.");
  if (next.length < MIN_PASSWORD_LENGTH) throw new Error(`Password baru minimal ${MIN_PASSWORD_LENGTH} karakter.`);
  if (next === current) throw new Error("Password baru harus berbeda.");
  const salt = randomBytes(32).toString("hex");
  return write({
    salt, hash: await derive(next, salt), passwordVersion: state.passwordVersion + 1,
    sessions: state.sessions.filter((x) => sameSecret(x.id, keepSessionId)).map((x) => ({ ...x, lastSeen: now })),
    failures: [],
  });
}

/**
 * `Secure` is opt-in via SCREENER_COOKIE_SECURE=1 rather than tied to NODE_ENV: a production
 * build served over plain HTTP would otherwise set a cookie the browser never sends back,
 * making login loop forever. Turn it on as soon as the site is behind TLS.
 */
export const cookieSecure = () => process.env.SCREENER_COOKIE_SECURE === "1";
const base = (secure: boolean) =>
  `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
export const sessionCookie = (id: string, secure = cookieSecure()) =>
  `${SESSION_COOKIE}=${id}; ${base(secure)}; Max-Age=${Math.floor(IDLE_TIMEOUT_MS / 1000)}`;
export const clearedCookie = (secure = cookieSecure()) =>
  `${SESSION_COOKIE}=; ${base(secure)}; Max-Age=0`;
