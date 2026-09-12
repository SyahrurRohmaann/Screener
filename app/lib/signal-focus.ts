import type { Row } from "./format";

export type FocusFilters = { side: string; mode: string; minScore: number; hideStale: boolean };
export type FocusTarget = { coin: string; closed_at: number };
export type FocusPlan =
  | { kind: "exact"; row: Row; hidden: boolean }
  | { kind: "coin"; row: Row; hidden: boolean }
  | { kind: "missing" };

export function rowPassesFilters(r: Row, f: FocusFilters, statusOf: (r: Row) => string): boolean {
  if (f.side !== "ALL" && r.sig !== f.side) return false;
  if (f.mode !== "ALL" && r.mode !== f.mode) return false;
  if (f.minScore > 0 && (r.score ?? 0) < f.minScore) return false;
  if (f.hideStale) {
    const state = statusOf(r);
    if (state === "EXPIRED" || state === "INVALIDATED") return false;
  }
  return true;
}

export function resolveSignalFocus(
  rows: Row[], ref: FocusTarget, f: FocusFilters, statusOf: (r: Row) => string,
): FocusPlan {
  const exact = rows.find((r) => r.coin === ref.coin && r.signal_closed_at === ref.closed_at);
  const row = exact ?? rows.find((r) => r.coin === ref.coin);
  if (!row) return { kind: "missing" };
  return { kind: exact ? "exact" : "coin", row, hidden: !rowPassesFilters(row, f, statusOf) };
}
