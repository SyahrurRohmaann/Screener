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

export type InboxItem = {
  key: string;
  coin: string;
  sig: "LONG" | "SHORT";
  score: number;
  mode: "TREND" | "COUNTER" | null;
  signal_closed_at: number;
  text: string;
  read: boolean;
};

export const MAX_INBOX = 100;

/** Merge newly born signals into a bounded, newest-first persistent inbox. */
export function mergeInbox(current: InboxItem[], fresh: Row[]): InboxItem[] {
  const byKey = new Map(current.map((item) => [item.key, item]));
  for (const r of notifiable(fresh)) {
    const key = signalKey(r);
    if (byKey.has(key)) continue; // preserve the existing item's read state
    byKey.set(key, {
      key,
      coin: r.coin,
      sig: r.sig!,
      score: r.score,
      mode: r.mode ?? null,
      signal_closed_at: r.signal_closed_at!,
      text: summarize(r),
      read: false,
    });
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.signal_closed_at - a.signal_closed_at)
    .slice(0, MAX_INBOX);
}

/** Mark one item, or every item when key is omitted. Returns a new array. */
export const markInboxRead = (items: InboxItem[], key?: string): InboxItem[] =>
  items.map((item) => (!key || item.key === key ? { ...item, read: true } : item));

export const inboxUnread = (items: InboxItem[]) =>
  items.reduce((count, item) => count + (item.read ? 0 : 1), 0);

/** First-page load: add current signals as read without clearing older unread news. */
export function mergeInboxBaseline(current: InboxItem[], baseline: Row[]): InboxItem[] {
  const existing = new Set(current.map((item) => item.key));
  return mergeInbox(current, baseline).map((item) =>
    existing.has(item.key) ? item : { ...item, read: true });
}
