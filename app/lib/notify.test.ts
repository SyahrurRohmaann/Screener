import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_INBOX, MAX_SEEN, alertTransitions, defaultAlertPrefs, inboxUnread,
  markInboxRead, mergeInbox, mergeInboxBaseline, newSignals, notifiable,
  signalKey, summarize, trimSeen,
} from "./notify";
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

test("fresh signals become unread inbox items, newest first", () => {
  const current = [{
    key: "SOL-500", coin: "SOL", sig: "LONG" as const, score: 5,
    mode: "TREND" as const, signal_closed_at: 500, text: "old", read: true,
  }];
  const fresh = [
    row({ coin: "ETH", signal_closed_at: 1000 }),
    row({ coin: "BTC", signal_closed_at: 2000 }),
  ];
  const merged = mergeInbox(current, fresh);
  assert.deepEqual(merged.map((x) => x.key), ["BTC-2000", "ETH-1000", "SOL-500"]);
  assert.equal(merged[0].read, false);
  assert.equal(merged[1].text, summarize(fresh[0]));
  assert.equal(merged[2].read, true);
});

test("inbox merge dedupes by key and preserves read state", () => {
  const original = [{
    key: "ETH-1000", coin: "ETH", sig: "SHORT" as const, score: 4,
    mode: null, signal_closed_at: 1000, text: "ETH old", read: true,
  }];
  const merged = mergeInbox(original, [row()]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].read, true);
});

test("inbox is capped and drops the oldest records", () => {
  const fresh = Array.from({ length: MAX_INBOX + 5 }, (_, i) =>
    row({ coin: `C${i}`, signal_closed_at: i + 1 }));
  const merged = mergeInbox([], fresh);
  assert.equal(merged.length, MAX_INBOX);
  assert.equal(merged[0].signal_closed_at, MAX_INBOX + 5);
  assert.equal(merged.at(-1)?.signal_closed_at, 6);
});

test("mark read supports one item and all items without mutation", () => {
  const inbox = mergeInbox([], [row(), row({ coin: "BTC", signal_closed_at: 2000 })]);
  const one = markInboxRead(inbox, "ETH-1000");
  assert.equal(inboxUnread(one), 1);
  assert.equal(one.find((x) => x.key === "ETH-1000")?.read, true);
  assert.equal(inboxUnread(markInboxRead(one)), 0);
  assert.equal(inboxUnread(inbox), 2);
});

test("baseline merge marks only baseline additions read, preserving older unread items", () => {
  const oldUnread = mergeInbox([], [row({ coin: "SOL", signal_closed_at: 500 })]);
  const merged = mergeInboxBaseline(oldUnread, [row()]);
  assert.equal(merged.find((x) => x.key === "SOL-500")?.read, false);
  assert.equal(merged.find((x) => x.key === "ETH-1000")?.read, true);
  assert.equal(inboxUnread(merged), 1);
});

test("status alerts fire once when price crosses entry, TP1, TP2, or stop", () => {
  const long = row({ sig: "LONG", price: 99.5, plan: {
    entry_low: 99, entry_high: 100, invalidation: 97,
    risk_pct: 3, tp1: 102, tp2: 104, rr1: 1, rr2: 2,
  } });
  const key = signalKey(long);
  const prefs = { ...defaultAlertPrefs, entry: true, invalidated: true, tp1: true, tp2: true, timeout: false };

  const entry = alertTransitions([long], new Map([[key, "WAITING"]]), prefs);
  assert.deepEqual(entry.events.map((e) => e.kind), ["ENTRY"]);
  assert.equal(entry.states.get(key), "ENTRY");

  const firstTp = alertTransitions([{ ...long, price: 102 }], entry.states, prefs);
  assert.deepEqual(firstTp.events.map((e) => e.kind), ["TP1"]);

  const secondTp = alertTransitions([{ ...long, price: 104 }], firstTp.states, prefs);
  assert.deepEqual(secondTp.events.map((e) => e.kind), ["TP2"]);

  const stop = alertTransitions([{ ...long, price: 97 }], entry.states, prefs);
  assert.deepEqual(stop.events.map((e) => e.kind), ["INVALIDATED"]);
});

test("status alerts understand SHORT direction and never repeat unchanged state", () => {
  const short = row({ sig: "SHORT", price: 100 });
  const key = signalKey(short);
  const prefs = { ...defaultAlertPrefs, entry: true, invalidated: true, tp1: true, tp2: true };
  const initial = alertTransitions([short], new Map([[key, "WAITING"]]), prefs);
  assert.deepEqual(initial.events.map((e) => e.kind), ["ENTRY"]);
  const same = alertTransitions([short], initial.states, prefs);
  assert.deepEqual(same.events, []);
  const tp1 = alertTransitions([{ ...short, price: 97 }], same.states, prefs);
  assert.deepEqual(tp1.events.map((e) => e.kind), ["TP1"]);
  const stop = alertTransitions([{ ...short, price: 101 }], initial.states, prefs);
  assert.deepEqual(stop.events.map((e) => e.kind), ["INVALIDATED"]);
});

test("disabled alert kinds still advance state so enabling later does not replay history", () => {
  const long = row({ sig: "LONG", price: 102, plan: {
    entry_low: 99, entry_high: 100, invalidation: 97,
    risk_pct: 3, tp1: 102, tp2: 104, rr1: 1, rr2: 2,
  } });
  const key = signalKey(long);
  const off = alertTransitions([long], new Map([[key, "WAITING"]]), { ...defaultAlertPrefs, entry: false, tp1: false });
  assert.deepEqual(off.events, []);
  assert.equal(off.states.get(key), "TP1");
  const enabled = alertTransitions([long], off.states, { ...defaultAlertPrefs, tp1: true });
  assert.deepEqual(enabled.events, []);
});
