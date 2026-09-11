import { planEntry } from "./format";
import type { Row } from "./format";

export const AGGREGATE_LIMIT_PCT = 10;
export const AGGREGATE_WARN_PCT = 5;
// Daily loss needs today's ledger, unavailable here; this panel only models equity exposure.
export const DAILY_LIMIT_PCT = 5;

export type ExposureVerdict = "AMAN" | "WASPADA" | "MELEBIHI BATAS" | "KOSONG";
export type ExposureItem = { coin: string; sig: "LONG" | "SHORT"; risk_pct: number };
export type ExposureSummary = {
  verdict: ExposureVerdict;
  n_active: number;
  sum_risk_pct: number;
  avg_risk_pct: number;
  worst: ExposureItem | null;
  reason: string;
};

export function exposureSummary(rows: Row[], limit = AGGREGATE_LIMIT_PCT, warn = AGGREGATE_WARN_PCT): ExposureSummary {
  let n_active = 0;
  let sum_risk_pct = 0;
  let worst: ExposureItem | null = null;
  for (const r of rows) {
    // Use row status, not liveStatus: deterministic, with WEAKENING still included.
    if (!r.sig || !r.plan || planEntry(r) == null || r.status === "EXPIRED" || r.status === "INVALIDATED") continue;
    if (!Number.isFinite(r.price) || r.price <= 0) continue;
    const risk_pct = Math.abs(r.price - r.plan.invalidation) / r.price * 100;
    if (!Number.isFinite(risk_pct) || risk_pct <= 0) continue;
    n_active++;
    sum_risk_pct += risk_pct;
    if (!worst || risk_pct > worst.risk_pct) worst = { coin: r.coin, sig: r.sig, risk_pct };
  }
  const avg_risk_pct = n_active ? sum_risk_pct / n_active : 0;
  const verdict: ExposureVerdict = !n_active ? "KOSONG"
    : sum_risk_pct > limit ? "MELEBIHI BATAS" : sum_risk_pct > warn ? "WASPADA" : "AMAN";
  let reason = n_active
    ? `${n_active} setup aktif; total risiko ${sum_risk_pct.toFixed(1)}% equity bila semua SL bersamaan (rata-rata ${avg_risk_pct.toFixed(1)}%/setup).`
    : "Tidak ada setup aktif dengan risiko valid.";
  if (verdict === "MELEBIHI BATAS") reason += ` MELEBIHI batas ${limit.toFixed(1)}% - kurangi jumlah posisi atau perkecil size.`;
  if (worst && worst.risk_pct > AGGREGATE_WARN_PCT) {
    reason += ` Peringatan N-1: ${worst.coin} ${worst.sig} sendiri berisiko ${worst.risk_pct.toFixed(1)}%, melewati ${AGGREGATE_WARN_PCT.toFixed(1)}%/setup.`;
  }
  return { verdict, n_active, sum_risk_pct, avg_risk_pct, worst, reason };
}
