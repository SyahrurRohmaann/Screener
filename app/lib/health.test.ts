import test from "node:test";
import assert from "node:assert/strict";
import {
  HEALTH_THRESHOLDS,
  classifyAge,
  classifyAlignment,
  classifyApi,
  classifyClockDrift,
  overallHealth,
} from "./health";

test("age thresholds classify fresh, degraded, and stale at explicit boundaries", () => {
  assert.equal(HEALTH_THRESHOLDS.feedFreshMs, 5_000);
  assert.equal(HEALTH_THRESHOLDS.feedStaleMs, 15_000);
  assert.equal(classifyAge(5_000, "feed"), "OK");
  assert.equal(classifyAge(5_001, "feed"), "DEGRADED");
  assert.equal(classifyAge(15_000, "feed"), "DEGRADED");
  assert.equal(classifyAge(15_001, "feed"), "STALE");
  assert.equal(classifyAge(null, "feed"), "UNKNOWN");

  assert.equal(HEALTH_THRESHOLDS.candleFreshMs, 35 * 60_000);
  assert.equal(HEALTH_THRESHOLDS.candleStaleMs, 65 * 60_000);
  assert.equal(classifyAge(35 * 60_000, "candle"), "OK");
  assert.equal(classifyAge(35 * 60_000 + 1, "candle"), "DEGRADED");
  assert.equal(classifyAge(65 * 60_000 + 1, "candle"), "STALE");

  assert.equal(HEALTH_THRESHOLDS.contextFreshMs, 90_000);
  assert.equal(HEALTH_THRESHOLDS.contextStaleMs, 5 * 60_000);
  assert.equal(classifyAge(90_001, "context"), "DEGRADED");
});

test("API classification exposes partial failures and rate limits", () => {
  assert.equal(classifyApi({ requests: 8, succeeded: 8, failed: 0, rateLimited: 0 }), "OK");
  assert.equal(classifyApi({ requests: 8, succeeded: 7, failed: 1, rateLimited: 0 }), "DEGRADED");
  assert.equal(classifyApi({ requests: 8, succeeded: 7, failed: 1, rateLimited: 1 }), "RATE_LIMITED");
  assert.equal(classifyApi({ requests: 8, succeeded: 0, failed: 8, rateLimited: 0 }), "DOWN");
  assert.equal(classifyApi({ requests: 0, succeeded: 0, failed: 0, rateLimited: 0 }), "UNKNOWN");
});

test("alignment requires every configured coin on the same closed candle", () => {
  assert.equal(classifyAlignment([100, 100, 100], 3), "OK");
  assert.equal(classifyAlignment([100, 100], 3), "PARTIAL");
  assert.equal(classifyAlignment([100, 200, 100], 3), "MISALIGNED");
  assert.equal(classifyAlignment([], 3), "UNKNOWN");
});

test("clock drift is degraded beyond two seconds and unsafe beyond ten", () => {
  assert.equal(HEALTH_THRESHOLDS.clockDriftWarnMs, 2_000);
  assert.equal(HEALTH_THRESHOLDS.clockDriftBadMs, 10_000);
  assert.equal(classifyClockDrift(2_000), "OK");
  assert.equal(classifyClockDrift(-2_001), "DEGRADED");
  assert.equal(classifyClockDrift(10_001), "BAD");
  assert.equal(classifyClockDrift(null), "UNKNOWN");
});

test("overall health never lets degraded or unknown data masquerade as OK", () => {
  assert.equal(overallHealth(["OK", "OK"]), "OK");
  assert.equal(overallHealth(["OK", "UNKNOWN"]), "UNKNOWN");
  assert.equal(overallHealth(["OK", "DEGRADED"]), "DEGRADED");
  assert.equal(overallHealth(["OK", "STALE"]), "BAD");
  assert.equal(overallHealth(["OK", "DOWN"]), "BAD");
});
