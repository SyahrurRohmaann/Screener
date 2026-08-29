import { appendFile, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const DECISION_ACTIONS = ["PAPER", "WATCH", "SKIP"] as const;
export type DecisionAction = typeof DECISION_ACTIONS[number];
export const SKIP_REASONS = ["RISK_TOO_HIGH", "LATE", "STRUCTURE_UNCLEAR", "EVENT_RISK", "OTHER"] as const;
export type SkipReason = typeof SKIP_REASONS[number];

export type SignalEvidence = {
  key: string;
  coin: string;
  sig: "LONG" | "SHORT";
  signal_closed_at: number;
  score: number;
  mode: "TREND" | "COUNTER" | null;
  close: number;
  entry_low: number;
  entry_high: number;
  invalidation: number;
  tp1: number;
  tp2: number;
  risk_pct: number;
  rsi: number | null;
  trend_1h: string;
  atr_pct: number | null;
  reasons: string[];
};

type BaseInput = { signal: SignalEvidence; note?: string };
export type DecisionInput =
  | (BaseInput & { action: "PAPER"; actual_entry: number; actual_risk_pct: number })
  | (BaseInput & { action: "WATCH" })
  | (BaseInput & { action: "SKIP"; skip_reason: SkipReason });

export type Decision = DecisionInput & { id: string; decided_at: number };

function dataDir() { return process.env.SCREENER_DATA_DIR ?? join(process.cwd(), ".data"); }
function file() { return join(dataDir(), "signal-decisions.jsonl"); }
function lockFile() { return `${file()}.lock`; }

function finitePositive(value: unknown) { return typeof value === "number" && Number.isFinite(value) && value > 0; }

function validate(input: DecisionInput) {
  const s = input?.signal;
  if (!s || s.key !== `${s.coin}-${s.signal_closed_at}` || !/^[A-Z0-9]{2,15}$/.test(s.coin) || !["LONG", "SHORT"].includes(s.sig)) {
    throw new Error("Identitas sinyal tidak valid.");
  }
  if (!DECISION_ACTIONS.includes(input.action)) throw new Error("Aksi keputusan tidak valid.");
  if (input.note != null && (typeof input.note !== "string" || input.note.length > 1000)) throw new Error("Catatan maksimal 1000 karakter.");
  if (input.action === "PAPER" && (!finitePositive(input.actual_entry) || !finitePositive(input.actual_risk_pct) || input.actual_risk_pct > 100)) {
    throw new Error("Actual entry dan risk PAPER harus angka positif yang valid.");
  }
  if (input.action === "SKIP" && !SKIP_REASONS.includes(input.skip_reason)) throw new Error("Alasan LEWATI wajib dipilih.");
  const coreNumbers = [s.signal_closed_at, s.score, s.close, s.entry_low, s.entry_high, s.invalidation, s.tp1, s.tp2, s.risk_pct];
  if (!coreNumbers.every((x) => typeof x === "number" && Number.isFinite(x))) throw new Error("Bukti inti sinyal tidak lengkap.");
}

async function load(): Promise<Decision[]> {
  try {
    const raw = await readFile(file(), "utf8");
    const rows: Decision[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line) as Decision); } catch { /* preserve readable evidence around a corrupt line */ }
    }
    return rows;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function acquireLock() {
  await mkdir(dataDir(), { recursive: true });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { return await open(lockFile(), "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error("Journal sedang dipakai; coba lagi.");
}

export async function appendDecision(input: DecisionInput, now = Date.now()): Promise<Decision> {
  validate(input);
  const lock = await acquireLock();
  try {
    const existing = await load();
    if (existing.some((row) => row.signal.key === input.signal.key)) throw new Error("Sinyal ini sudah memiliki keputusan awal.");
    const decision = { ...structuredClone(input), id: randomUUID(), decided_at: now } as Decision;
    await appendFile(file(), `${JSON.stringify(decision)}\n`, { encoding: "utf8", mode: 0o600 });
    return decision;
  } finally {
    await lock.close();
    await unlink(lockFile()).catch(() => undefined);
  }
}

export async function readDecisions(filter: { action?: DecisionAction; coin?: string } = {}) {
  return (await load())
    .filter((row) => !filter.action || row.action === filter.action)
    .filter((row) => !filter.coin || row.signal.coin === filter.coin.toUpperCase())
    .sort((a, b) => b.decided_at - a.decided_at);
}

export function mutationIsSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
