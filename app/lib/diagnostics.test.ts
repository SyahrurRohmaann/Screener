import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketDiagnostics, buildContextDiagnostics } from "./diagnostics";

test("market diagnostics report aligned latest candle, partial API failure, and failed history write", () => {
  const now = 1_800_002_000_000;
  const diagnostics = buildMarketDiagnostics({
    now,
    expectedCoins: ["BTC", "ETH", "SOL"],
    rows: [
      { coin: "BTC", candleClosedAt: 1_800_000_000_000 },
      { coin: "ETH", candleClosedAt: 1_800_000_000_000 },
      { coin: "SOL", candleClosedAt: 1_800_000_000_000 },
    ],
    api: { requests: 19, succeeded: 18, failed: 1, rateLimited: 0 },
    historyWrite: { status: "ERROR", added: 0, error: "write_failed" },
    serverTimeMs: now - 2_500,
  });

  assert.equal(diagnostics.overall, "DEGRADED");
  assert.deepEqual(diagnostics.candle, {
    status: "OK", latestClosedAt: 1_800_000_000_000, ageMs: 2_000_000,
    interval: "30m", alignment: "OK", availableCoins: 3, expectedCoins: 3,
  });
  assert.equal(diagnostics.api.status, "DEGRADED");
  assert.equal(diagnostics.historyWrite.status, "ERROR");
  assert.equal(diagnostics.clock.status, "DEGRADED");
  assert.equal(diagnostics.clock.driftMs, 2_500);
});

test("missing and misaligned coins are explicit and make market health bad", () => {
  const diagnostics = buildMarketDiagnostics({
    now: 2_000,
    expectedCoins: ["BTC", "ETH", "SOL"],
    rows: [{ coin: "BTC", candleClosedAt: 1_000 }, { coin: "ETH", candleClosedAt: 500 }],
    api: { requests: 7, succeeded: 4, failed: 3, rateLimited: 1 },
    historyWrite: { status: "SKIPPED", added: 0 },
    serverTimeMs: null,
  });
  assert.equal(diagnostics.overall, "BAD");
  assert.equal(diagnostics.candle.alignment, "PARTIAL");
  assert.deepEqual(diagnostics.candle.missingCoins, ["SOL"]);
  assert.equal(diagnostics.api.status, "RATE_LIMITED");
  assert.equal(diagnostics.clock.status, "UNKNOWN");
});

test("context diagnostics count fields rather than claiming success for null values", () => {
  const diagnostics = buildContextDiagnostics({
    now: 10_000,
    expectedCoins: ["BTC", "ETH"],
    values: [
      { coin: "BTC", funding: 0.01, oi_chg: null, ls_ratio: 1.1, taker: 0.9 },
      { coin: "ETH", funding: null, oi_chg: null, ls_ratio: null, taker: null },
    ],
    api: { requests: 8, succeeded: 3, failed: 5, rateLimited: 0 },
  });
  assert.equal(diagnostics.status, "DEGRADED");
  assert.equal(diagnostics.observedAt, 10_000);
  assert.deepEqual(diagnostics.coverage, { availableFields: 3, expectedFields: 8, availableCoins: 1, expectedCoins: 2 });
});
