import test from "node:test";
import assert from "node:assert/strict";
import type { Evaluated } from "./evaluate";
import type { Decision } from "./decision-journal";
import { buildWeeklyReview } from "./weekly-review";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 11);
function row(over: Partial<Evaluated> = {}): Evaluated {
  return {
    key: "BTC-1234567890", coin: "BTC", sig: "LONG", score: 4, mode: "TREND",
    signal_closed_at: NOW - DAY, recorded_at: NOW - DAY, close: 100,
    entry: 100, stop: 99, tp1: 101, tp2: 102, risk_pct: 1,
    rsi: 50, trend_1h: "UP", atr_pct: 0.5, reasons: [], outcome: "TP1",
    r_multiple: 1, net_r: 0.9, bars_held: 2, exit_price: 101, resolved_at: NOW, ...over,
  };
}
const batch = (n: number, over: Partial<Evaluated> = {}) => Array.from({ length: n }, (_, i) => row({ key: `${over.sig ?? "LONG"}-${i}`, ...over }));
const skip = (over: Partial<Decision> = {}): Decision => ({
  id: "decision", signal_key: "BTC-1234567890", signal: row(), decided_at: NOW,
  action: "SKIP", skip_reason: "LATE", ...over,
} as Decision);
const review = (rows: Evaluated[] = [], decisions: Decision[] = []) => buildWeeklyReview({ rows, decisions, now: NOW });

test("empty review requests samples with null WR and zero net R", () => {
  const result = review();
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].title, "KUMPULKAN SAMPEL, JANGAN SIMPULKAN");
  assert.match(result.actions[0].why, /0 trade/);
  assert.equal(result.metrics.wr_pct, null);
  assert.equal(result.metrics.net_r, 0);
  assert.equal(result.metrics.prev_net_r, null);
  assert.equal(result.metrics.avg_hold_bars, null);
  assert.equal(result.metrics.worst_bucket, null);
});

test("rule a includes the small sample count and precedes journal evidence", () => {
  const result = review(batch(4), [skip(), skip(), skip()]);
  assert.match(result.actions[0].why, /4 trade/);
  assert.equal(result.actions[1].title, "UJI BUKTI ALASAN SKIP");
});

test("rule b uses an existing analytics bucket label and risk action", () => {
  const result = review(batch(5, { net_r: -1 }));
  assert.deepEqual(result.metrics.worst_bucket, { label: "<1%", n: 5, net_r: -5 });
  assert.equal(result.actions[0].title, "PANTAU DAN TURUNKAN RISIKO BUCKET");
  assert.match(result.actions[0].why, /-5\.0R/);
});

test("rule c requires five samples per direction and opposite three-R totals", () => {
  const rows = [...batch(5, { net_r: 0.6 }), ...batch(5, { sig: "SHORT", net_r: -0.6 })];
  const result = review(rows);
  assert.equal(result.actions[0].title, "EKSEKUSI SELEKTIF PER ARAH");
  assert.deepEqual(result.metrics.by_dir, [
    { dir: "LONG", n: 5, wr_pct: 100, net_r: 3 },
    { dir: "SHORT", n: 5, wr_pct: 0, net_r: -3 },
  ]);
  assert.ok(!review(rows.slice(1)).actions.some((action) => action.title === "EKSEKUSI SELEKTIF PER ARAH"));
});

test("rule d combines TIMEOUT and STOP at the inclusive sixty-percent threshold", () => {
  const result = review([...batch(2), ...batch(2, { outcome: "TIMEOUT" }), row({ outcome: "STOP" })]);
  assert.equal(result.actions[0].title, "EVALUASI WAKTU ENTRY");
  assert.match(result.actions[0].why, /3\/5 trade \(60\.0%\)/);
  assert.match(result.actions[0].check, /JANGAN KEJAR/);
  assert.ok(!review([...batch(3), ...batch(2, { outcome: "STOP" })]).actions.some((action) => action.title === "EVALUASI WAKTU ENTRY"));
});

test("rule e compares matched skipped outcomes and counts only current journal decisions", () => {
  const decisions = [skip(), skip({ skip_reason: "OTHER" }), skip(), skip({ decided_at: NOW - 7 * DAY - 1 }),
    skip({ decided_at: NOW + 1 }), skip({ action: "WATCH" }),
    skip({ action: "PAPER", actual_entry: 100, actual_risk_pct: 1 })];
  const result = review([row()], decisions);
  assert.deepEqual(result.metrics.journal, { paper: 1, watch: 1, skip: 3 });
  assert.deepEqual(result.metrics.top_skip_reason, { reason: "LATE", n: 2 });
  assert.match(result.actions[1].why, /LATE: 2 dari 3 SKIP/);
  assert.match(result.actions[1].why, /1 trade, net 0\.9R/);
  assert.match(review([], decisions).actions[1].why, /Belum ada outcome/);
});

test("priority is deterministic and capped at the first three eligible rules b c d before e", () => {
  // Rule a cannot coexist with b/c: fewer than five closed cannot supply five per bucket/direction.
  const rows = [...batch(5, { net_r: 1 }), ...batch(5, { sig: "SHORT", net_r: -2, outcome: "STOP", atr_pct: 2.5 }),
    row({ outcome: "TIMEOUT" }), row({ outcome: "TIMEOUT" }), row({ outcome: "STOP" })];
  const decisions = [skip(), skip(), skip()];
  const input = { rows, decisions, now: NOW };
  const original = structuredClone(input);
  const first = buildWeeklyReview(input);
  assert.deepEqual(first, buildWeeklyReview(input));
  assert.deepEqual(input, original);
  assert.deepEqual(first.actions.map((action) => action.title), [
    "PANTAU DAN TURUNKAN RISIKO BUCKET", "EKSEKUSI SELEKTIF PER ARAH", "EVALUASI WAKTU ENTRY",
  ]);
  assert.ok(first.actions.length <= 3);
});

test("rolling resolution windows include boundaries once and exclude future or unresolved rows", () => {
  const result = review([
    row({ resolved_at: NOW - 7 * DAY, signal_closed_at: NOW - 20 * DAY, net_r: 1 }),
    row({ resolved_at: NOW, net_r: 2 }),
    row({ resolved_at: NOW - 7 * DAY - 1, net_r: 3 }),
    row({ resolved_at: NOW - 14 * DAY, net_r: 4 }),
    row({ resolved_at: NOW - 14 * DAY - 1, net_r: 100 }),
    row({ resolved_at: NOW + 1, net_r: 100 }),
    row({ outcome: "OPEN", net_r: 100 }), row({ outcome: "UNKNOWN" }),
    row({ resolved_at: null }), row({ net_r: null }),
  ]);
  assert.equal(result.period_start, NOW - 7 * DAY);
  assert.equal(result.period_end, NOW);
  assert.equal(result.metrics.closed, 2);
  assert.equal(result.metrics.net_r, 3);
  assert.equal(result.metrics.prev_net_r, 7);
});

test("metrics round net R, WR and holding to one decimal", () => {
  const result = review([row({ net_r: 0.123, bars_held: 1 }), row({ net_r: 0.123, bars_held: 2 }), row({ net_r: -0.01, bars_held: 2 })]);
  assert.equal(result.metrics.net_r, 0.2);
  assert.equal(result.metrics.wr_pct, 66.7);
  assert.equal(result.metrics.avg_hold_bars, 1.7);
  assert.equal(result.metrics.by_dir[0].net_r, 0.2);
});

test("no findings retains journal discipline for nonnegative or negative net results", () => {
  assert.equal(review(batch(5)).actions[0].title, "PERTAHANKAN DISIPLIN CATAT JOURNAL");
  const rows = batch(5, { net_r: -0.1 }).map((item, i) => ({ ...item, atr_pct: i, trend_1h: String(i) }));
  assert.equal(review(rows).actions[0].title, "PERTAHANKAN DISIPLIN CATAT JOURNAL");
});

test("thresholds use unrounded R and skip counts below three do not trigger", () => {
  const result = review([...batch(5, { net_r: 0.599 }), ...batch(5, { sig: "SHORT", net_r: -0.599 })], [skip(), skip()]);
  assert.ok(!result.actions.some((action) => action.title === "EKSEKUSI SELEKTIF PER ARAH" || action.title === "UJI BUKTI ALASAN SKIP"));
});
