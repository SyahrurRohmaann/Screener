import test from "node:test";
import assert from "node:assert/strict";
import { compareReverse, mirrorPlan, replayPaper, reverseRecord, reverseSide } from "./reverse";
import type { SignalRecord } from "./store";
import type { Market } from "./indicators";
import { compareOriginal } from "./reverse";

const record: SignalRecord = { key: "BTC-1799999", coin: "BTC", sig: "LONG", score: 4,
  mode: "TREND", signal_closed_at: 1799999, recorded_at: 1800000, close: 100,
  entry: 100, stop: 90, tp1: 110, tp2: 120, risk_pct: 10, rsi: 55,
  trend_1h: "BULL", atr_pct: 1, reasons: ["original condition"] };
const market = (high = 105, low = 95, close = 100): Market => ({
  o: [100, 100], h: [101, high], l: [99, low], c: [100, close],
  v: [1, 1], t: [1799999, 3599999] });

test("mirrorPlan preserves risk, valid geometry and round trips in both directions", () => {
  const long = { entry_low: 98, entry_high: 100, invalidation: 90,
    tp1: 110, tp2: 120, risk_pct: 10, rr1: 1, rr2: 2 };
  const short = { ...long, entry_low: 100, entry_high: 102, invalidation: 110, tp1: 90, tp2: 80 };
  assert.deepEqual(mirrorPlan(long, 100), short);
  assert.deepEqual(mirrorPlan(short, 100), long);
  for (const plan of [long, short]) {
    const mirrored = mirrorPlan(plan, 100);
    assert.ok(mirrored.entry_low < mirrored.entry_high);
    assert.ok(mirrored.invalidation > mirrored.entry_high
      ? mirrored.tp2 < mirrored.tp1 && mirrored.tp1 < mirrored.entry_low
      : mirrored.invalidation < mirrored.entry_low && mirrored.tp2 > mirrored.tp1 && mirrored.tp1 > mirrored.entry_high);
    assert.equal(Math.abs(mirrored.invalidation - 100), Math.abs(plan.invalidation - 100));
    assert.equal(mirrored.risk_pct, plan.risk_pct);
    assert.equal(mirrored.rr1, plan.rr1);
    assert.equal(mirrored.rr2, plan.rr2);
    assert.deepEqual(mirrorPlan(mirrored, 100), plan);
  }
});

test("reverse sides including WAIT; reflected percentages and original evidence stay intact", () => {
  assert.equal(reverseSide("WAIT"), "WAIT");
  assert.equal(reverseSide("LONG"), "SHORT");
  assert.equal(reverseSide("SHORT"), "LONG");
  const reversed = reverseRecord(record);
  assert.equal(reversed.sig, "SHORT");
  assert.deepEqual([reversed.entry, reversed.stop, reversed.tp1, reversed.tp2], [100, 110, 90, 80]);
  assert.equal(reversed.mode, "COUNTER");
  assert.equal(reversed.score, record.score);
  assert.deepEqual(reversed.reasons, record.reasons);
  assert.equal(reversed.signal_closed_at, record.signal_closed_at);
  assert.deepEqual(reverseRecord(reversed), record);
  assert.equal(record.stop, 90);
});

test("both-touch is STOP for both directions, including TP2", () => {
  for (const row of [record, reverseRecord(record)]) {
    const result = replayPaper(row, market(125, 75), 0.1, 48);
    assert.equal(result.outcome, "STOP");
    assert.equal(result.r_multiple, -1);
    assert.equal(result.net_r, -1.01);
  }
});

test("fees are subtracted on wins, losses and timeouts; TP1 exits fully", () => {
  const win = replayPaper(reverseRecord(record), market(105, 85, 90), 0.1, 48);
  assert.equal(win.outcome, "TP1");
  assert.equal(win.net_r, 0.99);
  assert.equal(replayPaper(reverseRecord(record), market(105, 75, 80), 0, 48).net_r, 2);
  const timeout = replayPaper(record, market(), 0.1, 1);
  assert.equal(timeout.outcome, "TIMEOUT");
  assert.equal(timeout.net_r, -0.01);
  assert.equal(replayPaper(record, market(), 0.1, 48).outcome, "OPEN");
});

test("missing signal coverage or intervening candle fails closed, no signal candle exits", () => {
  const missing = market(); missing.t = [5399999, 7199999];
  assert.equal(replayPaper(record, missing, 0.1, 48).outcome, "UNKNOWN");
  const gap = market(125); gap.t[1] += 1800000;
  assert.equal(replayPaper(record, gap, 0.1, 48).outcome, "UNKNOWN");
  const onlySignal = market();
  for (const key of Object.keys(onlySignal) as (keyof Market)[]) onlySignal[key] = onlySignal[key].slice(0, 1);
  onlySignal.h[0] = 200;
  assert.equal(replayPaper(record, onlySignal, 0.1, 48).outcome, "OPEN");
});

test("paired reverse stats use one feed and never negate original net returns", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify([
      [0, "100", "101", "99", "100", "1", 1799999],
      [1800000, "100", "105", "75", "80", "1", 3599999],
    ]));
  };
  try {
    const result = await compareReverse([record], "all");
    assert.equal(calls, 1);
    assert.equal(result.evidence, "RETROSPECTIVE_REPLAY");
    assert.equal(result.original.stats.resolved, 1);
    assert.equal(result.original.stats.win_rate, 0);
    assert.equal(result.reverse.stats.resolved, 1);
    assert.equal(result.reverse.stats.win_rate, 100);
    const fee = 100 * result.fee_pct / 100 / 10;
    assert.equal(result.reverse.stats.net_r, 2 - fee);
    assert.equal(result.reverse.stats.expectancy_net_r, 2 - fee);
    assert.equal(result.original.stats.max_drawdown_r, 1 + fee);
    assert.equal(result.reverse.stats.max_drawdown_r, 0);
    assert.equal(result.reverse.stats.profit_factor, null);
    assert.equal(result.reverse.outcomes.find(o => o.outcome === "TP2")?.count, 1);
  } finally { globalThis.fetch = previous; }
});

test("original replay restores the stored reverse and negates zero-fee same-exit returns", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify([
    [0, "100", "101", "99", "100", "1", 1799999],
    [1800000, "100", "105", "95", "104", "1", 3599999],
  ])));
  const fee = process.env.SCREENER_FEE_PCT;
  const bars = process.env.SCREENER_EVAL_BARS;
  process.env.SCREENER_FEE_PCT = "0";
  process.env.SCREENER_EVAL_BARS = "1";
  try {
    const stored = reverseRecord(record);
    const result = await compareOriginal([stored], "all", 3599999);
    assert.deepEqual(reverseRecord(stored), record);
    assert.deepEqual(result.rows, [{ original: replayPaper(record, market(105, 95, 104), 0, 1) }]);
    assert.equal(result.original.stats.net_r, 0.4);
    const active = await compareReverse([stored], "all", 3599999);
    assert.equal(result.original.stats.net_r, -active.original.stats.net_r);
    assert.deepEqual(result.original, active.reverse);
    assert.equal("reverse" in result, false);
    assert.equal("rev" in result.rows[0].original, false);
    assert.equal(stored.sig, "SHORT");
    assert.equal(stored.stop, 110);
    assert.equal(result.evidence, "RETROSPECTIVE_REPLAY");
    assert.equal(result.max_bars, 1);

    process.env.SCREENER_FEE_PCT = "0.1";
    const withFee = await compareOriginal([stored], "all");
    assert.equal(withFee.original.stats.net_r, 0.39);
    assert.equal(replayPaper(stored, market(105, 95, 104), 0.1, 1).net_r, -0.41000000000000003);
  } finally {
    if (fee === undefined) delete process.env.SCREENER_FEE_PCT; else process.env.SCREENER_FEE_PCT = fee;
    if (bars === undefined) delete process.env.SCREENER_EVAL_BARS; else process.env.SCREENER_EVAL_BARS = bars;
  }
});

test("original replay evaluates actual candle exits rather than negating stored outcomes", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify([
    [0, "100", "101", "99", "100", "1", 1799999],
    [1800000, "100", "125", "95", "120", "1", 3599999],
  ])));
  const result = await compareOriginal([reverseRecord(record)], "all");
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(result.rows[0].original.outcome, "TP2");
  const feeR = result.fee_pct / 10;
  assert.equal(result.original.stats.net_r, 2 - feeR);
  assert.equal(result.original.outcomes.find(o => o.outcome === "TP2")?.count, 1);
  // The active SHORT stops at -1R, while ORI exits at +2R: not opposite returns.
  assert.equal(replayPaper(reverseRecord(record), market(125, 95, 120), result.fee_pct, result.max_bars).net_r, -1 - feeR);
});

test("original replay windows are inclusive, sort records, and summarize beyond the row cap", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("[]"));
  const day = 86_400_000;
  const now = 200 * day;
  const records = [91, 90, 60, 30, 0].map(age => reverseRecord({ ...record,
    key: `age-${age}`, signal_closed_at: now - age * day }));
  for (const [range, count] of [["30", 2], ["60", 3], ["90", 4], ["all", 5]] as const) {
    const result = await compareOriginal(records, range, now);
    assert.equal(result.total, count);
    assert.equal(result.range, range);
    assert.equal(result.ts, now);
    assert.equal(result.rows[0].original.key, "age-0");
    assert.equal(result.original.outcomes.find(o => o.outcome === "UNKNOWN")?.count, count);
  }
  assert.equal(fetch.mock.callCount(), 4);
  const many = Array.from({ length: 125 }, (_, i) => ({ ...records[4], key: `row-${i}` }));
  const capped = await compareOriginal(many, "all", now);
  assert.equal(capped.rows.length, 120);
  assert.equal(capped.original.stats.total, 125);
  assert.equal(capped.total, 125);
  const empty = await compareOriginal([records[0]], "30", now);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.rows, []);
  assert.equal(fetch.mock.callCount(), 5);
});
