import test from "node:test";
import assert from "node:assert/strict";
import { buildPriceDiagnostics, summarizeDataHealth } from "./diagnostics";

test("price diagnostics age the upstream stamp, not the response time", () => {
  const now = 1_800_000_010_000;
  const diagnostics = buildPriceDiagnostics({
    now,
    expectedCoins: ["BTC", "ETH"],
    prices: { BTC: 60_000, ETH: 3_000 },
    sourceTs: now - 1_000,
    api: { requests: 1, succeeded: 1, failed: 0, rateLimited: 0 },
  });

  assert.equal(diagnostics.status, "OK");
  assert.equal(diagnostics.feed.status, "OK");
  assert.equal(diagnostics.feed.ageMs, 1_000);
  assert.equal(diagnostics.observedAt, now);
  assert.deepEqual(diagnostics.coverage, { availableCoins: 2, expectedCoins: 2 });
});

test("a stale stamp and a missing coin are reported instead of a green feed", () => {
  const now = 1_800_000_100_000;
  const diagnostics = buildPriceDiagnostics({
    now,
    expectedCoins: ["BTC", "ETH"],
    prices: { BTC: 60_000 },
    sourceTs: now - 20_000,
    api: { requests: 1, succeeded: 1, failed: 0, rateLimited: 0 },
  });

  assert.equal(diagnostics.feed.status, "STALE");
  assert.equal(diagnostics.status, "BAD");
  assert.deepEqual(diagnostics.coverage.missingCoins, ["ETH"]);
});

test("an unreachable price endpoint is DOWN with an unknown feed age", () => {
  const diagnostics = buildPriceDiagnostics({
    now: 5_000,
    expectedCoins: ["BTC"],
    prices: {},
    sourceTs: null,
    api: { requests: 1, succeeded: 0, failed: 1, rateLimited: 0 },
  });

  assert.equal(diagnostics.api.status, "DOWN");
  assert.equal(diagnostics.feed.status, "UNKNOWN");
  assert.equal(diagnostics.feed.ageMs, null);
  assert.equal(diagnostics.status, "BAD");
});

test("dashboard summary keeps every source visible and takes the worst level", () => {
  const now = 1_800_000_000_000;
  const summary = summarizeDataHealth({
    market: {
      overall: "DEGRADED",
      generatedAt: now,
      candle: { status: "OK", latestClosedAt: now - 1_000, ageMs: 1_000, interval: "30m", alignment: "OK", availableCoins: 2, expectedCoins: 2 },
      api: { status: "DEGRADED", requests: 4, succeeded: 3, failed: 1, rateLimited: 0 },
      historyWrite: { status: "OK", added: 1 },
      clock: { status: "OK", driftMs: 10, source: "binance-time" },
    },
    context: {
      status: "OK",
      observedAt: now,
      ageMs: 0,
      api: { status: "OK", requests: 8, succeeded: 8, failed: 0, rateLimited: 0 },
      coverage: { availableFields: 8, expectedFields: 8, availableCoins: 2, expectedCoins: 2 },
    },
    price: null,
  });

  assert.equal(summary.overall, "DEGRADED");
  const keys = summary.items.map((item) => item.key);
  assert.deepEqual(keys, ["candle", "api", "context", "price", "history", "clock"]);
  const price = summary.items.find((item) => item.key === "price")!;
  assert.equal(price.status, "UNKNOWN");
  assert.match(price.detail, /menunggu/i);
  assert.equal(summary.items.find((item) => item.key === "api")!.status, "DEGRADED");
});

test("summary with no data at all is UNKNOWN rather than OK", () => {
  const summary = summarizeDataHealth({ market: null, context: null, price: null });
  assert.equal(summary.overall, "UNKNOWN");
  assert.equal(summary.items.length, 6);
  assert.ok(summary.items.every((item) => item.status === "UNKNOWN"));
});
