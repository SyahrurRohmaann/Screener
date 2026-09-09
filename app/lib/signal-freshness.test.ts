import test from "node:test";
import assert from "node:assert/strict";
import { signalStatus, isMarketStale } from "./signalFreshness";
import { liveStatus, type Row } from "./format";

for (const [age, expected] of [[0, "NEW"], [5, "NEW"], [5.001, "VALID"], [15, "VALID"], [15.001, "WEAKENING"], [30, "WEAKENING"], [30.001, "EXPIRED"]] as const) {
  test(`age boundary ${age}`, () => assert.equal(signalStatus(age, true), expected));
}
test("failed conditions weaken immediately, but expiry wins", () => {
  for (const age of [0, 5, 10, 15, 30]) assert.equal(signalStatus(age, false), "WEAKENING");
  assert.equal(signalStatus(30.001, false), "EXPIRED");
});
const row: Row = {
  coin: "BTC", price: 100, sig: "LONG", score: 4, rsi: 50, trend_1h: "BULL",
  status: "NEW", age_min: 0, signal_closed_at: 1_000_000, atr: 10,
  plan: { entry_low: 98, entry_high: 100, invalidation: 80, risk_pct: 20, tp1: 120, tp2: 140, rr1: 1, rr2: 2 },
};
test("live displacement is strictly greater than half ATR on either zone edge", () => {
  for (const sig of ["LONG", "SHORT"] as const) {
    const r = { ...row, sig, plan: { ...row.plan!, invalidation: sig === "LONG" ? 80 : 120 } };
    for (const price of [93, 98, 100, 105]) assert.equal(liveStatus({ ...r, price }), "NEW");
    for (const price of [92.999, 105.001]) assert.equal(liveStatus({ ...r, price }), "WEAKENING");
  }
});
test("invalidation including equality wins over expiry and weakening for both sides", () => {
  assert.equal(liveStatus({ ...row, price: 80, age_min: 31 }), "INVALIDATED");
  assert.equal(liveStatus({ ...row, sig: "SHORT", price: 120, age_min: 31, plan: { ...row.plan!, invalidation: 120 } }), "INVALIDATED");
  assert.equal(liveStatus({ ...row, status: "INVALIDATED" }), "INVALIDATED");
});
test("client wallclock ages status without a new market response", () => {
  assert.equal(liveStatus(row, 1_000_000 + 15 * 60_000 + 1), "WEAKENING");
  assert.equal(liveStatus(row, 1_000_000 + 30 * 60_000 + 1), "EXPIRED");
  assert.equal(liveStatus({ ...row, status: "WEAKENING" }), "WEAKENING");
});
test("missing or invalid ATR does not invent displacement; no signal stays NONE", () => {
  for (const atr of [null, undefined, 0, NaN]) assert.equal(liveStatus({ ...row, price: 106, atr }), "NEW");
  assert.equal(liveStatus({ ...row, sig: null, status: "NONE" }), "NONE");
});
test("stale guard uses response ts, strictly over 300s, including retained failed-fetch data", () => {
  const ts = 1_000_000;
  assert.equal(isMarketStale(ts, ts + 300_000), false);
  assert.equal(isMarketStale(ts, ts + 300_001), true);
  assert.equal(isMarketStale(ts, ts + 600_000), true);
  assert.equal(isMarketStale(null, ts), true);
  assert.equal(isMarketStale(NaN, ts), true);
});
