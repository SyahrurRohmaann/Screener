export type Plan = {
  entry_low: number; entry_high: number; invalidation: number;
  risk_pct: number; tp1: number; tp2: number; rr1: number; rr2: number;
};

export type Row = {
  coin: string; price: number; sig?: "LONG" | "SHORT" | null; score: number; rsi: number;
  trend_1h: string; timeframe?: string; mode?: "TREND" | "COUNTER" | null; status?: string;
  age_min?: number; atr_pct?: number | null; plan?: Plan | null; reasons?: string[];
  funding?: number; oi_chg?: number; ls_ratio?: number; taker?: number;
  // Closed candle the signal was born on; the stable half of a signal's identity.
  signal_closed_at?: number;
};

export type Bar = {
  t: number; o: number; h: number; l: number; c: number; v: number;
  ema50: number | null; rsi: number | null; mavol5: number | null; mavol14: number | null;
};

export const money = (n?: number | null) =>
  n == null || !Number.isFinite(n) || n === 0
    ? "—"
    : `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 2 })}`;

export const pct = (n?: number | null) =>
  n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(3)}%`;

export const num = (n?: number | null, d = 2) =>
  n == null || !Number.isFinite(n) ? "—" : n.toFixed(d);

export const age = (m?: number) =>
  m == null ? "—" : m < 60 ? `${m}m lalu` : `${Math.floor(m / 60)}j ${m % 60}m lalu`;

/**
 * Entry reference price for a plan. A LONG fills at the top of the zone, a SHORT
 * at the bottom, so every percentage on screen must be measured from that side —
 * the same one RiskCalculator uses for position sizing.
 */
export function planEntry(row: Row): number | null {
  if (!row.plan || !row.sig) return null;
  return row.sig === "LONG" ? row.plan.entry_high : row.plan.entry_low;
}

/** Distance from entry to a level, in percent of entry. Always non-negative. */
export function levelPct(row: Row, level?: number | null): number | null {
  const entry = planEntry(row);
  if (entry == null || level == null || !Number.isFinite(level) || entry === 0) return null;
  return Math.abs(level - entry) / entry * 100;
}

export type EntryStatus = "BELUM MASUK ZONA" | "DALAM ZONA VALID" | "TERLAMBAT" | "INVALID";

export type LiveEntrySnapshot = {
  status: EntryStatus;
  entry_pct: number;
  sl_pct: number;
  tp1_pct: number;
  tp2_pct: number;
  progress_tp1_pct: number;
  signal_age_min?: number | null;
  next_candle_ms?: number;
};

/** Entry-state geometry evaluated against the realtime mark, not a candle close. */
export function entryStatus(r: Row, mark = r.price): EntryStatus | null {
  if (!r.sig || !r.plan || !Number.isFinite(mark)) return null;
  if (r.sig === "LONG") {
    if (mark <= r.plan.invalidation) return "INVALID";
    if (mark < r.plan.entry_low) return "BELUM MASUK ZONA";
    if (mark <= r.plan.entry_high) return "DALAM ZONA VALID";
    return "TERLAMBAT";
  }
  if (mark >= r.plan.invalidation) return "INVALID";
  if (mark > r.plan.entry_high) return "BELUM MASUK ZONA";
  if (mark >= r.plan.entry_low) return "DALAM ZONA VALID";
  return "TERLAMBAT";
}

/** Signed distance in the signal's favorable direction, relative to live mark. */
function distanceFromMark(r: Row, level: number, mark: number) {
  const favorable = r.sig === "LONG" ? level - mark : mark - level;
  return favorable / mark * 100;
}

/** All realtime card metrics; time fields are included only when `now` is supplied. */
export function liveEntrySnapshot(r: Row, mark = r.price, now?: number): LiveEntrySnapshot | null {
  const status = entryStatus(r, mark);
  const entry = planEntry(r);
  if (!status || !r.plan || entry == null || !(mark > 0)) return null;
  const towardTp1 = r.sig === "LONG" ? mark - entry : entry - mark;
  const tp1Span = Math.abs(r.plan.tp1 - entry);
  const snapshot: LiveEntrySnapshot = {
    status,
    entry_pct: distanceFromMark(r, entry, mark),
    sl_pct: distanceFromMark(r, r.plan.invalidation, mark),
    tp1_pct: distanceFromMark(r, r.plan.tp1, mark),
    tp2_pct: distanceFromMark(r, r.plan.tp2, mark),
    progress_tp1_pct: tp1Span > 0 ? towardTp1 / tp1Span * 100 : 0,
  };
  if (now != null) {
    const candleMs = 30 * 60_000;
    snapshot.signal_age_min = r.signal_closed_at == null
      ? null : Math.max(0, Math.floor((now - r.signal_closed_at) / 60_000));
    const elapsed = now % candleMs;
    snapshot.next_candle_ms = elapsed === 0 ? candleMs : candleMs - elapsed;
  }
  return snapshot;
}

/** Realtime mark price can kill a plan before the next 30s indicator refresh. */
export function liveStatus(r: Row) {
  if (!r.sig || !r.plan) return r.status ?? "NONE";
  return entryStatus(r) === "INVALID" ? "INVALIDATED" : r.status ?? "NONE";
}
