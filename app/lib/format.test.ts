import test from "node:test";
import assert from "node:assert/strict";
import { entryStatus, liveEntrySnapshot, levelPct, planEntry, type Plan, type Row, money, priceDigits, priceStr } from "./format";

const plan: Plan = {
  entry_low: 99, entry_high: 100, invalidation: 98,
  risk_pct: 2, tp1: 102, tp2: 104, rr1: 1, rr2: 2,
};

function row(sig: "LONG" | "SHORT", override: Partial<Plan> = {}): Row {
  return { coin: "TEST", price: 100, sig, score: 4, rsi: 50, trend_1h: "BULL", plan: { ...plan, ...override } };
}

test("LONG measures from the top of the entry zone, SHORT from the bottom", () => {
  // A LONG fills at entry_high, so its reference is 100; a SHORT fills at entry_low (99).
  assert.equal(planEntry(row("LONG")), 100);
  assert.equal(planEntry(row("SHORT")), 99);
});

test("percentages match the plan's own risk_pct for the stop", () => {
  // invalidation 98 against entry 100 is exactly the 2% the API reports.
  const pct = levelPct(row("LONG"), plan.invalidation);
  assert.ok(pct !== null);
  assert.equal(Number(pct!.toFixed(4)), 2);
});

test("TP2 is twice TP1 in percent, mirroring the 1R/2R construction", () => {
  const r = row("LONG");
  const tp1 = levelPct(r, plan.tp1)!, tp2 = levelPct(r, plan.tp2)!;
  assert.equal(Number(tp1.toFixed(4)), 2);
  assert.equal(Number((tp2 / tp1).toFixed(4)), 2);
});

test("SHORT percentages are positive distances, not negative numbers", () => {
  // SHORT targets sit below entry; the UI labels direction separately, so the
  // magnitude must stay positive or the screen shows "-1.01%" for a gain.
  const r = row("SHORT", { invalidation: 101, tp1: 97, tp2: 95 });
  assert.ok(levelPct(r, 101)! > 0);
  assert.ok(levelPct(r, 97)! > 0);
  assert.equal(Number(levelPct(r, 97)!.toFixed(4)), Number((2 / 99 * 100).toFixed(4)));
});

test("missing plan, missing signal, or non-finite level yields null instead of NaN", () => {
  assert.equal(planEntry({ coin: "X", price: 1, score: 0, rsi: 50, trend_1h: "BULL" }), null);
  assert.equal(levelPct({ coin: "X", price: 1, score: 0, rsi: 50, trend_1h: "BULL" }, 5), null);
  assert.equal(levelPct(row("LONG"), Number.NaN), null);
  assert.equal(levelPct(row("LONG"), null), null);
  assert.equal(levelPct(row("LONG"), undefined), null);
});

test("zero entry cannot divide by zero", () => {
  const r = row("LONG", { entry_high: 0 });
  assert.equal(levelPct(r, 10), null);
});

test("LONG realtime entry status follows stop, zone, and directional price geometry", () => {
  assert.equal(entryStatus(row("LONG", { invalidation: 98 }), 97.99), "INVALID");
  assert.equal(entryStatus(row("LONG"), 98.5), "BELUM MASUK ZONA");
  assert.equal(entryStatus(row("LONG"), 99), "DALAM ZONA VALID");
  assert.equal(entryStatus(row("LONG"), 100), "DALAM ZONA VALID");
  assert.equal(entryStatus(row("LONG"), 100.01), "TERLAMBAT");
});

test("SHORT realtime entry status mirrors LONG boundaries", () => {
  const short = row("SHORT", { invalidation: 101, tp1: 97, tp2: 95 });
  assert.equal(entryStatus(short, 101), "INVALID");
  assert.equal(entryStatus(short, 100.01), "BELUM MASUK ZONA");
  assert.equal(entryStatus(short, 100), "DALAM ZONA VALID");
  assert.equal(entryStatus(short, 99), "DALAM ZONA VALID");
  assert.equal(entryStatus(short, 98.99), "TERLAMBAT");
});

test("live snapshot reports signed mark distances and entry-to-TP1 progress", () => {
  assert.deepEqual(liveEntrySnapshot(row("LONG"), 101), {
    status: "TERLAMBAT", entry_pct: -0.9900990099009901, sl_pct: -2.9702970297029703,
    tp1_pct: 0.9900990099009901, tp2_pct: 2.9702970297029703, progress_tp1_pct: 50,
  });
  assert.deepEqual(liveEntrySnapshot(row("SHORT", { invalidation: 101, tp1: 97, tp2: 95 }), 98), {
    status: "TERLAMBAT", entry_pct: -1.0204081632653061, sl_pct: -3.061224489795918,
    tp1_pct: 1.0204081632653061, tp2_pct: 3.061224489795918, progress_tp1_pct: 50,
  });
});

test("TP1 progress is informational and not clamped before entry or beyond target", () => {
  assert.equal(liveEntrySnapshot(row("LONG"), 99)?.progress_tp1_pct, -50);
  assert.equal(liveEntrySnapshot(row("LONG"), 103)?.progress_tp1_pct, 150);
});

test("countdown uses the next UTC-aligned 30m boundary", () => {
  const snap = liveEntrySnapshot(row("LONG"), 100, Date.UTC(2026, 7, 29, 12, 17, 45));
  assert.equal(snap?.signal_age_min, null);
  assert.equal(snap?.next_candle_ms, 12 * 60_000 + 15_000);
  const born = liveEntrySnapshot({ ...row("LONG"), signal_closed_at: Date.UTC(2026, 7, 29, 12, 0) }, 100, Date.UTC(2026, 7, 29, 12, 17, 45));
  assert.equal(born?.signal_age_min, 17);
  assert.equal(liveEntrySnapshot(row("LONG"), 100, Date.UTC(2026, 7, 29, 12, 30))?.next_candle_ms, 30 * 60_000);
});

test("priceDigits chooses decimal precision for four significant digits", () => {
  assert.equal(priceDigits(0.11847), 4);
  assert.equal(priceDigits(0.011847), 5);
  assert.equal(priceDigits(0.00011847), 7);
  assert.equal(priceDigits(2.8456), 3);
  assert.equal(priceDigits(45.234), 2);
  assert.equal(priceDigits(117845.23), 2);
});

test("priceDigits caps decimal precision and handles magnitude boundaries", () => {
  assert.equal(priceDigits(1e-15), 12);
  assert.equal(priceDigits(1), 3);
  assert.equal(priceDigits(10), 2);
  assert.equal(priceDigits(100), 2);
  assert.equal(priceDigits(1000), 2);
  assert.equal(priceDigits(-2.8456), 3);
  for (const value of [0, NaN, Infinity, -Infinity]) {
    assert.equal(priceDigits(value), 0);
  }
});

test("money rounds prices with a dollar prefix and en-US grouping", () => {
  assert.equal(money(0.11847), "$0.1185");
  assert.equal(money(2.8456), "$2.846");
  assert.equal(money(117845.23), "$117,845.23");
  assert.equal(money(0.00011847), "$0.0001185");
  assert.equal(money(-2.8456), "$-2.846");
  assert.equal(money(1), "$1");
});

test("priceStr uses the same precision without a dollar prefix", () => {
  assert.equal(priceStr(0.011847), "0.01185");
  assert.equal(priceStr(117845.23), "117,845.23");
  assert.equal(priceStr(1), "1");
});

test("money and priceStr return a placeholder for missing, non-finite, and zero values", () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, 0]) {
    assert.equal(money(value), "\u2014");
    assert.equal(priceStr(value), "\u2014");
  }
});
