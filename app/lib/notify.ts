import type { Row } from "./format";
import { levelPct, num, planEntry } from "./format";

/**
 * A signal is identified by coin + the closed candle it was born on. That pair is
 * stable across refreshes, so re-reading the same signal never looks new, and a
 * genuinely new candle always does.
 */
export const signalKey = (r: Row) => `${r.coin}-${r.signal_closed_at ?? 0}`;

/** Signals worth announcing: a side, a plan, and a candle we can key on. */
export const notifiable = (rows: Row[]) =>
  rows.filter((r) => r.sig && r.plan && r.signal_closed_at);

/**
 * Returns signals present now that were absent from `seen`.
 *
 * The caller owns `seen` so the very first load can be used as a baseline instead
 * of firing one notification per existing signal — opening the page is not news.
 */
export function newSignals(rows: Row[], seen: ReadonlySet<string>): Row[] {
  return notifiable(rows).filter((r) => !seen.has(signalKey(r)));
}

/** One-line summary used for both the OS notification and the in-page toast. */
export function summarize(r: Row): string {
  const parts = [r.coin, r.sig!];
  if (r.score != null) parts.push(`skor ${r.score}`);
  if (r.mode) parts.push(r.mode);
  // Same sign convention as the signal card: TP1 is the gain, SL is the loss,
  // both measured from the entry side that actually fills.
  const entry = planEntry(r);
  if (r.plan && entry) {
    const tp1 = levelPct(r, r.plan.tp1);
    const stop = levelPct(r, r.plan.invalidation);
    if (tp1 != null && stop != null) parts.push(`TP1 +${num(tp1)}% · SL −${num(stop)}%`);
  }
  return parts.join(" · ");
}

/**
 * Keeps the stored key set bounded. Without a cap this grows forever in
 * localStorage; with it, only keys old enough to never reappear are dropped.
 */
export const MAX_SEEN = 400;
export const trimSeen = (keys: string[]) =>
  keys.length <= MAX_SEEN ? keys : keys.slice(keys.length - MAX_SEEN);
