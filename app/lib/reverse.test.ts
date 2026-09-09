import test from "node:test";
import assert from "node:assert/strict";
import { compareReverse, replayPaper, reverseRecord, reverseSide } from "./reverse";
import type { SignalRecord } from "./store";
import type { Market } from "./indicators";

const record: SignalRecord = { key: "BTC-1799999", coin: "BTC", sig: "LONG", score: 4,
  mode: "TREND", signal_closed_at: 1799999, recorded_at: 1800000, close: 100,
  entry: 100, stop: 90, tp1: 110, tp2: 120, risk_pct: 10, rsi: 55,
  trend_1h: "BULL", atr_pct: 1, reasons: ["original condition"] };
const market = (high = 105, low = 95, close = 100): Market => ({
  o: [100, 100], h: [101, high], l: [99, low], c: [100, close],
  v: [1, 1], t: [1799999, 3599999] });

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
