import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SEEN, newSignals, notifiable, signalKey, summarize, trimSeen } from "./notify";
import type { Row } from "./format";

const row = (over: Partial<Row> = {}): Row => ({
  coin: "ETH", price: 100, score: 4, rsi: 50, trend_1h: "BEAR",
  sig: "SHORT", signal_closed_at: 1000,
  plan: {
    entry_low: 99, entry_high: 100, invalidation: 101,
    risk_pct: 2.02, tp1: 97, tp2: 95, rr1: 1, rr2: 2,
  },
  ...over,
});

test("a signal is keyed by coin and closed candle", () => {
  assert.equal(signalKey(row()), "ETH-1000");
  // Same candle re-read is the same signal; a new candle is a new one.
  assert.equal(signalKey(row({ signal_closed_at: 1000 })), "ETH-1000");
  assert.notEqual(signalKey(row({ signal_closed_at: 2000 })), "ETH-1000");
});

test("rows without a side, plan, or candle are never announced", () => {
  const rows = [
    row(),
    row({ coin: "BTC", sig: null }),
    row({ coin: "SOL", plan: null }),
    row({ coin: "XRP", signal_closed_at: undefined }),
  ];
  assert.deepEqual(notifiable(rows).map((r) => r.coin), ["ETH"]);
});

test("only signals absent from the seen set are new", () => {
  const rows = [row(), row({ coin: "BTC" })];
  assert.deepEqual(newSignals(rows, new Set()).map((r) => r.coin), ["ETH", "BTC"]);
  assert.deepEqual(newSignals(rows, new Set(["ETH-1000"])).map((r) => r.coin), ["BTC"]);
  assert.deepEqual(newSignals(rows, new Set(["ETH-1000", "BTC-1000"])), []);
});

test("re-reading the same signal is not new, a fresh candle is", () => {
  const seen = new Set(["ETH-1000"]);
  assert.deepEqual(newSignals([row()], seen), []);
  assert.equal(newSignals([row({ signal_closed_at: 2000 })], seen).length, 1);
});

test("the summary carries side, score, and percentage levels", () => {
  const text = summarize(row());
  assert.match(text, /^ETH · SHORT · skor 4/);
  // SHORT entry is entry_low = 99: TP1 97 is 2.02% of gain, stop 101 is 2.02% of loss.
  assert.match(text, /TP1 \+2\.02% · SL −2\.02%/);
});

test("the summary survives a missing plan", () => {
  assert.equal(summarize(row({ plan: null })), "ETH · SHORT · skor 4");
});

test("the seen set is capped and keeps the newest keys", () => {
  const keys = Array.from({ length: MAX_SEEN + 50 }, (_, i) => `K-${i}`);
  const kept = trimSeen(keys);
  assert.equal(kept.length, MAX_SEEN);
  assert.equal(kept.at(-1), `K-${MAX_SEEN + 49}`);
  assert.deepEqual(trimSeen(["a", "b"]), ["a", "b"]);
});
