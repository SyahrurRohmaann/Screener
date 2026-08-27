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

/** Realtime mark price can kill a plan before the next 60s indicator refresh. */
export function liveStatus(r: Row) {
  if (!r.sig || !r.plan) return r.status ?? "NONE";
  const hit = r.sig === "LONG" ? r.price <= r.plan.invalidation : r.price >= r.plan.invalidation;
  return hit ? "INVALIDATED" : r.status ?? "NONE";
}
