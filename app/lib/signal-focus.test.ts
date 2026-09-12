import test from "node:test";
import assert from "node:assert/strict";
import type { Row } from "./format";
import { type FocusFilters, resolveSignalFocus, rowPassesFilters } from "./signal-focus";

const row: Row = {
  coin: "BTC", signal_closed_at: 1726012345, price: 60000,
  sig: "LONG", mode: "TREND", score: 4, rsi: 55, trend_1h: "BULL",
};
const filters: FocusFilters = { side: "ALL", mode: "ALL", minScore: 0, hideStale: false };
const active = () => "ACTIVE";
const target = { coin: row.coin, closed_at: row.signal_closed_at! };

test("focus prefers an exact match over an earlier row for the same coin", () => {
  const older = { ...row, signal_closed_at: row.signal_closed_at! - 1800 };
  assert.deepEqual(resolveSignalFocus([older, row], target, filters, active), {
    kind: "exact", row, hidden: false,
  });
});

test("focus falls back to the first coin row when the signal was replaced", () => {
  assert.deepEqual(resolveSignalFocus([row, { ...row, signal_closed_at: 42 }], {
    coin: "BTC", closed_at: 1,
  }, filters, active), { kind: "coin", row, hidden: false });
  assert.equal(resolveSignalFocus([row], { coin: "BTC", closed_at: 0 }, filters, active).kind, "coin");
});

test("focus reports missing when the coin is absent", () => {
  assert.deepEqual(resolveSignalFocus([row], { coin: "ETH", closed_at: target.closed_at }, filters, active), {
    kind: "missing",
  });
});

test("focus reports hidden when the side filter differs", () => {
  assert.deepEqual(resolveSignalFocus([row], target, { ...filters, side: "SHORT" }, active), {
    kind: "exact", row, hidden: true,
  });
});

test("focus reports stale rows hidden only when hideStale is enabled", () => {
  for (const status of ["EXPIRED", "INVALIDATED"]) {
    assert.deepEqual(resolveSignalFocus([row], target, { ...filters, hideStale: true }, () => status), {
      kind: "exact", row, hidden: true,
    });
    assert.equal(rowPassesFilters(row, filters, () => status), true);
  }
});

test("focus is visible when all filters pass", () => {
  assert.deepEqual(resolveSignalFocus([row], target, {
    side: "LONG", mode: "TREND", minScore: 4, hideStale: true,
  }, active), { kind: "exact", row, hidden: false });
});

test("row filters preserve mode and minimum score checks", () => {
  assert.equal(rowPassesFilters(row, { ...filters, mode: "COUNTER" }, active), false);
  assert.equal(rowPassesFilters(row, { ...filters, minScore: 5 }, active), false);
  assert.equal(rowPassesFilters({ ...row, score: undefined } as unknown as Row, {
    ...filters, minScore: 1,
  }, active), false);
});
