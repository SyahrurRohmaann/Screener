import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContextDiagnostics, buildMarketDiagnostics, buildPriceDiagnostics,
  PAYLOAD_STALE_MS, summarizeDataHealth,
} from "./diagnostics";

const healthyMarket = (now: number) => buildMarketDiagnostics({
  now,
  expectedCoins: ["BTC", "ETH"],
  rows: [{ coin: "BTC", candleClosedAt: now - 60_000 }, { coin: "ETH", candleClosedAt: now - 60_000 }],
  api: { requests: 10, succeeded: 10, failed: 0, rateLimited: 0 },
  historyWrite: { status: "SKIPPED", added: 0 },
  serverTimeMs: now,
});
const healthyContext = (now: number) => buildContextDiagnostics({
  now,
  expectedCoins: ["BTC"],
  values: [{ coin: "BTC", funding: 0.01, oi_chg: 1, ls_ratio: 1, taker: 1 }],
  api: { requests: 4, succeeded: 4, failed: 0, rateLimited: 0 },
});
const healthyPrice = (now: number) => buildPriceDiagnostics({
  now, expectedCoins: ["BTC"], prices: { BTC: 60000 }, sourceTs: now - 500,
  api: { requests: 1, succeeded: 1, failed: 0, rateLimited: 0 },
});

const rowOf = (summary: ReturnType<typeof summarizeDataHealth>, key: string) =>
  summary.items.find((item) => item.key === key)!;

test("a quiet market with nothing new to log reads OK, not UNKNOWN", () => {
  const now = 1_800_000_000_000;
  const summary = summarizeDataHealth({
    market: healthyMarket(now), context: healthyContext(now), price: healthyPrice(now), now,
  });
  assert.equal(rowOf(summary, "history").status, "OK");
  assert.equal(rowOf(summary, "history").detail, "tidak ada sinyal baru untuk dicatat");
  assert.equal(summary.overall, "OK");
});

test("a source that stopped answering goes STALE instead of keeping its last good status", () => {
  const now = 1_800_000_000_000;
  const market = healthyMarket(now);
  const later = now + PAYLOAD_STALE_MS.market + 1;
  const summary = summarizeDataHealth({
    market, context: healthyContext(later), price: healthyPrice(later), now: later,
  });
  for (const key of ["candle", "api", "history", "clock"]) {
    assert.equal(rowOf(summary, key).status, "STALE", key);
    assert.match(rowOf(summary, key).detail, /berhenti menjawab/);
  }
  assert.equal(summary.overall, "BAD");
});

test("a fresh but half-empty mark price feed is not reported healthy", () => {
  const now = 1_800_000_000_000;
  const price = buildPriceDiagnostics({
    now, expectedCoins: ["BTC", "ETH", "SOL"], prices: { BTC: 60000 }, sourceTs: now - 200,
    api: { requests: 1, succeeded: 1, failed: 0, rateLimited: 0 },
  });
  // The exchange stamp is fresh, so freshness alone would have said OK.
  assert.equal(price.feed.status, "OK");
  const summary = summarizeDataHealth({ market: healthyMarket(now), context: healthyContext(now), price, now });
  assert.equal(rowOf(summary, "price").status, "DEGRADED");
  assert.match(rowOf(summary, "price").detail, /hilang ETH, SOL/);
});

test("a 502 mark price answer is BAD rather than merely unknown", () => {
  const now = 1_800_000_000_000;
  const price = buildPriceDiagnostics({
    now, expectedCoins: ["BTC", "ETH"], prices: {}, sourceTs: null,
    api: { requests: 1, succeeded: 0, failed: 1, rateLimited: 0 },
  });
  const summary = summarizeDataHealth({ market: healthyMarket(now), context: healthyContext(now), price, now });
  assert.equal(rowOf(summary, "price").status, "BAD");
  assert.equal(summary.overall, "BAD");
});

test("a source that never answered still reads UNKNOWN, never OK", () => {
  const now = 1_800_000_000_000;
  const summary = summarizeDataHealth({ market: null, context: null, price: null, now });
  assert.equal(summary.overall, "UNKNOWN");
  assert.deepEqual(summary.items.map((item) => item.status), Array(6).fill("UNKNOWN"));
  assert.match(rowOf(summary, "candle").detail, /menunggu/);
});

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
