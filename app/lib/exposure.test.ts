import test from "node:test";
import assert from "node:assert/strict";
import { exposureSummary } from "./exposure";
import type { Plan, Row } from "./format";

function row(sig: "LONG" | "SHORT" = "LONG", override: Partial<Plan> = {}): Row {
  return {
    coin: "TEST", price: 100, sig, score: 4, rsi: 50, trend_1h: "BULL",
    plan: {
      entry_low: 99, entry_high: 101, invalidation: sig === "LONG" ? 98 : 102,
      risk_pct: 2, tp1: sig === "LONG" ? 104 : 96, tp2: sig === "LONG" ? 106 : 94,
      rr1: 2, rr2: 3, ...override,
    },
  };
}

test("empty exposure has no risk or worst setup", () => {
  assert.deepEqual(exposureSummary([]), {
    verdict: "KOSONG", n_active: 0, sum_risk_pct: 0, avg_risk_pct: 0, worst: null,
    reason: "Tidak ada setup aktif dengan risiko valid.",
  });
});

test("LONG and SHORT have mirrored risk from the current mark", () => {
  for (const sig of ["LONG", "SHORT"] as const) {
    const summary = exposureSummary([row(sig)]);
    assert.equal(summary.verdict, "AMAN");
    assert.equal(summary.n_active, 1);
    assert.equal(summary.sum_risk_pct, 2);
    assert.equal(summary.avg_risk_pct, 2);
    assert.deepEqual(summary.worst, { coin: "TEST", sig, risk_pct: 2 });
    assert.match(summary.reason, /total risiko 2\.0% equity.*rata-rata 2\.0%\/setup/);
    const price = sig === "LONG" ? 104 : 96;
    assert.equal(exposureSummary([{ ...row(sig), price }]).sum_risk_pct, 6 / price * 100);
  }
});

test("aggregate thresholds include equality and accept custom limits", () => {
  assert.equal(exposureSummary([row(), row(), row()]).verdict, "WASPADA");
  const bad = exposureSummary(Array.from({ length: 6 }, () => row()));
  assert.equal(bad.verdict, "MELEBIHI BATAS");
  assert.equal(bad.sum_risk_pct, 12);
  assert.equal(bad.avg_risk_pct, 2);
  assert.match(bad.reason, /MELEBIHI batas 10\.0%.*kurangi jumlah posisi atau perkecil size/);
  assert.equal(exposureSummary([row("LONG", { invalidation: 95 })]).verdict, "AMAN");
  assert.equal(exposureSummary(Array.from({ length: 5 }, () => row())).verdict, "WASPADA");
  assert.equal(exposureSummary([row()], 3, 1).verdict, "WASPADA");
  assert.equal(exposureSummary([row(), row()], 3, 1).verdict, "MELEBIHI BATAS");
});

test("worst setup above five percent triggers the N-1 reason", () => {
  const summary = exposureSummary([row(), { ...row("SHORT", { invalidation: 107 }), coin: "WORST" }, row()]);
  assert.deepEqual(summary.worst, { coin: "WORST", sig: "SHORT", risk_pct: 7 / 100 * 100 });
  assert.match(summary.reason, /N-1: WORST SHORT.*7\.0%.*5\.0%\/setup/);
  assert.doesNotMatch(exposureSummary([row("LONG", { invalidation: 95 })]).reason, /N-1/);
});

test("missing setups, invalid marks, and nonpositive or nonfinite risk are skipped", () => {
  const invalid: Row[] = [
    { ...row(), sig: null }, { ...row(), sig: undefined }, { ...row(), plan: null },
    { ...row(), plan: undefined },
    ...[0, -1, NaN, Infinity, -Infinity].map((price) => ({ ...row(), price })),
    ...[100, NaN, Infinity, -Infinity].map((invalidation) => row("LONG", { invalidation })),
  ];
  assert.equal(exposureSummary(invalid).verdict, "KOSONG");
  assert.equal(exposureSummary([...invalid, row()]).n_active, 1);
});

test("row status excludes expired and invalidated but retains weakening", () => {
  const summary = exposureSummary(["EXPIRED", "INVALIDATED", "WEAKENING"].map((status) => ({ ...row(), status })));
  assert.equal(summary.n_active, 1);
  assert.equal(summary.sum_risk_pct, 2);
});
