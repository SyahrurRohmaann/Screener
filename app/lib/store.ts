import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { HistoryWriteOutcome } from "./diagnostics";

export type SignalRecord = {
  key: string;              // coin + closed candle timestamp
  coin: string;
  sig: "LONG" | "SHORT";
  score: number;
  mode: "TREND" | "COUNTER" | null;
  signal_closed_at: number;
  recorded_at: number;
  close: number;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  risk_pct: number;
  rsi: number | null;
  trend_1h: string;
  atr_pct: number | null;
  reasons: string[];
};

// Container filesystems are ephemeral — mount SCREENER_DATA_DIR to keep history
// across `docker compose up --force-recreate`.
const MAX_RECORDS = Number(process.env.SCREENER_HISTORY_MAX ?? 2000);

let seen: Set<string> | null = null;

// Read the env var per call so a test (or a re-configured deployment) is not stuck
// with the directory that happened to exist when this module was first imported.
function file() {
  return join(process.env.SCREENER_DATA_DIR ?? join(process.cwd(), ".data"), "signals.jsonl");
}

/** Drop the dedupe cache; used by tests that point SCREENER_DATA_DIR somewhere new. */
export function resetHistoryCache() { seen = null; }

async function loadAll(): Promise<SignalRecord[]> {
  try {
    const raw = await readFile(file(), "utf8");
    const rows: SignalRecord[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line) as SignalRecord); } catch { /* skip corrupt line */ }
    }
    return rows;
  } catch { return []; }
}

export async function readHistory(): Promise<SignalRecord[]> {
  const rows = await loadAll();
  // Newest first, deduped by key (a rewritten line wins).
  const byKey = new Map<string, SignalRecord>();
  for (const row of rows) byKey.set(row.key, row);
  return Array.from(byKey.values()).sort((a, b) => b.signal_closed_at - a.signal_closed_at).slice(0, MAX_RECORDS);
}

/**
 * Append-only; a signal is recorded once per closed candle. Never throws, but the
 * outcome distinguishes "wrote", "had nothing new to write", and "the volume
 * rejected the write" so /api/market can report a broken history mount instead of
 * reporting `logged: 0` that looks exactly like a quiet market.
 */
export async function recordSignals(candidates: SignalRecord[]): Promise<HistoryWriteOutcome> {
  if (!candidates.length) return { status: "SKIPPED", added: 0 };
  try {
    if (!seen) seen = new Set((await loadAll()).map((r) => r.key));
    const fresh = candidates.filter((r) => !seen!.has(r.key));
    if (!fresh.length) return { status: "SKIPPED", added: 0 };
    const target = file();
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, fresh.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    for (const r of fresh) seen!.add(r.key);
    return { status: "OK", added: fresh.length };
  } catch {
    // Read-only volume or disk pressure must never break the live screener.
    return { status: "ERROR", added: 0, error: "write_failed" };
  }
}
