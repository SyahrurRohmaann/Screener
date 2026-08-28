export type Plan = {
  entry_low: number; entry_high: number; invalidation: number;
  risk_pct: number; tp1: number; tp2: number; rr1: number; rr2: number;
};

export type Row = {
  coin: string; price: number; sig?: "LONG" | "SHORT" | null; score: number; rsi: number;
  trend_1h: string; timeframe?: string; mode?: "TREND" | "COUNTER" | null; status?: string;
  age_min?: number; atr_pct?: number | null; plan?: Plan | null; reasons?: string[];
  funding?: number; oi_chg?: number; ls_ratio?: number; taker?: number;
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

/** Realtime mark price can kill a plan before the next 30s indicator refresh. */
export function liveStatus(r: Row) {
  if (!r.sig || !r.plan) return r.status ?? "NONE";
  const hit = r.sig === "LONG" ? r.price <= r.plan.invalidation : r.price >= r.plan.invalidation;
  return hit ? "INVALIDATED" : r.status ?? "NONE";
}
