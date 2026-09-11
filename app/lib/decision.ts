import { entryStatus, type Row } from "./format";

export type DecisionVerdict = "LAYAK DITIMBANG" | "TUNGGU ZONA" | "JANGAN KEJAR" | "R:R HABIS" | "PLAN INVALID";

export type EntryDecision = {
  verdict: DecisionVerdict;
  risk_pct: number;
  rr1_net: number;
  rr2_net: number;
  fee_r: number;
  chase_pct: number | null;
  reason: string;
};

export function verdictClass(verdict: DecisionVerdict): "ok" | "warn" | "bad" {
  return verdict === "LAYAK DITIMBANG" ? "ok" : verdict === "TUNGGU ZONA" ? "warn" : "bad";
}

export function entryDecision(r: Row, mark = r.price, feePctPerSide = 0.1): EntryDecision | null {
  if (!r.sig || !r.plan || !Number.isFinite(mark) || mark <= 0) return null;
  const risk_pct = Math.abs(mark - r.plan.invalidation) / mark * 100;
  if (risk_pct <= 0) return null;
  const fee_pct = feePctPerSide * 2;
  const rr1_net = (Math.abs(r.plan.tp1 - mark) / mark * 100 - fee_pct) / risk_pct;
  const rr2_net = (Math.abs(r.plan.tp2 - mark) / mark * 100 - fee_pct) / risk_pct;
  const fee_r = fee_pct / risk_pct;
  const distance = Math.max(0, r.plan.entry_low - mark, mark - r.plan.entry_high);
  const chase_pct = distance / mark * 100;
  const displaced = r.atr != null && Number.isFinite(r.atr) && r.atr > 0 && distance > 0.5 * r.atr;
  const status = entryStatus(r, mark);
  let verdict: DecisionVerdict;
  let reason: string;
  if (status === "INVALID") {
    verdict = "PLAN INVALID";
    reason = `Stop sudah tembus; harga melewati invalidation sejauh ${risk_pct.toFixed(2)}%.`;
  } else if (status === "TERLAMBAT" && displaced) {
    verdict = "JANGAN KEJAR";
    reason = `Harga sudah ${chase_pct.toFixed(2)}% di luar zona (>0.50 ATR).`;
  } else if (status === "BELUM MASUK ZONA" && !displaced) {
    verdict = "TUNGGU ZONA";
    reason = `Jarak harga ke zona masih ${chase_pct.toFixed(2)}%.`;
  } else if (rr1_net >= 1) {
    verdict = "LAYAK DITIMBANG";
    reason = `RR TP1 net ${rr1_net.toFixed(2)} dengan fee round-trip ${fee_r.toFixed(2)}R.`;
  } else {
    verdict = "R:R HABIS";
    reason = `Fee ${fee_r.toFixed(2)}R memakan edge; RR TP1 net tinggal ${rr1_net.toFixed(2)}.`;
  }
  return { verdict, risk_pct, rr1_net, rr2_net, fee_r, chase_pct, reason };
}
