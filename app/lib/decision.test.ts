import test from "node:test";
import assert from "node:assert/strict";
import { entryDecision, verdictClass } from "./decision";
import type { Plan, Row } from "./format";

function row(sig: "LONG" | "SHORT" = "LONG", override: Partial<Plan> = {}): Row {
  return {
    coin: "TEST", price: 100, sig, score: 4, rsi: 50, trend_1h: "BULL", atr: 2,
    plan: {
      entry_low: 99, entry_high: 101, invalidation: sig === "LONG" ? 98 : 102,
      risk_pct: 2, tp1: sig === "LONG" ? 104 : 96, tp2: sig === "LONG" ? 106 : 94,
      rr1: 2, rr2: 3, ...override,
    },
  };
}

test("LONG and SHORT in zone have healthy net RR after round-trip fees", () => {
  for (const sig of ["LONG", "SHORT"] as const) {
    assert.deepEqual(entryDecision(row(sig)), {
      verdict: "LAYAK DITIMBANG", risk_pct: 2, rr1_net: 1.9, rr2_net: 2.9,
      fee_r: 0.1, chase_pct: 0,
      reason: "RR TP1 net 1.90 dengan fee round-trip 0.10R.",
    });
  }
});

test("displaced late marks must not be chased, mirrored for SHORT", () => {
  for (const [sig, mark] of [["LONG", 103], ["SHORT", 97]] as const) {
    const decision = entryDecision(row(sig), mark);
    assert.equal(decision?.verdict, "JANGAN KEJAR");
    assert.equal(decision?.chase_pct, 2 / mark * 100);
    assert.equal(decision?.risk_pct, 5 / mark * 100);
    assert.equal(decision?.reason, `Harga sudah ${(2 / mark * 100).toFixed(2)}% di luar zona (>0.50 ATR).`);
  }
});

test("marks before the zone wait unless displaced", () => {
  for (const [sig, mark] of [["LONG", 98.5], ["SHORT", 101.5]] as const) {
    const decision = entryDecision(row(sig), mark);
    assert.equal(decision?.verdict, "TUNGGU ZONA");
    assert.equal(decision?.reason, `Jarak harga ke zona masih ${(0.5 / mark * 100).toFixed(2)}%.`);
    assert.equal(entryDecision({ ...row(sig), atr: 0.1 }, mark)?.verdict, "LAYAK DITIMBANG");
  }
});

test("stop breaches take priority over displacement and RR", () => {
  for (const [sig, mark] of [["LONG", 97], ["SHORT", 103]] as const) {
    const decision = entryDecision(row(sig), mark);
    assert.equal(decision?.verdict, "PLAN INVALID");
    assert.match(decision?.reason ?? "", /Stop sudah tembus/);
  }
});

test("thin rewards or larger fees exhaust net RR", () => {
  const decision = entryDecision(row("LONG", { tp1: 102 }));
  assert.equal(decision?.verdict, "R:R HABIS");
  assert.equal(decision?.reason, "Fee 0.10R memakan edge; RR TP1 net tinggal 0.90.");
  assert.equal(entryDecision(row(), 100, 1.1)?.verdict, "R:R HABIS");
  assert.equal(entryDecision(row("LONG", { tp1: 102 }), 100, 0)?.verdict, "LAYAK DITIMBANG");
});

test("displacement requires strictly over half a finite positive ATR", () => {
  assert.equal(entryDecision(row(), 102)?.verdict, "R:R HABIS");
  assert.equal(entryDecision(row(), 102.01)?.verdict, "JANGAN KEJAR");
  for (const atr of [undefined, null, 0, -1, NaN, Infinity]) {
    assert.equal(entryDecision({ ...row(), atr }, 103)?.verdict, "R:R HABIS");
  }
});

test("missing signal or plan, invalid marks, and zero risk return null", () => {
  assert.equal(entryDecision({ ...row(), plan: null }), null);
  assert.equal(entryDecision({ ...row(), sig: null }), null);
  for (const mark of [0, -1, NaN, Infinity, -Infinity, 98]) {
    assert.equal(entryDecision(row(), mark), null);
  }
});

test("verdict classes map to the specified severity colors", () => {
  assert.equal(verdictClass("LAYAK DITIMBANG"), "ok");
  assert.equal(verdictClass("TUNGGU ZONA"), "warn");
  for (const verdict of ["JANGAN KEJAR", "R:R HABIS", "PLAN INVALID"] as const) {
    assert.equal(verdictClass(verdict), "bad");
  }
});
