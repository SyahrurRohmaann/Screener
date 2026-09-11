import test from "node:test";
import assert from "node:assert/strict";
import { gatePushSignals, PUSH_GATE, toGateDiagnostics, type GateDiagnostics, type GateSignal } from "./push-gate";
import { buildMarketDiagnostics } from "./diagnostics";

const signal: GateSignal = { key: "BTC-1", coin: "BTC", score: 6, atr_pct: null };
const input = { signals: [signal], diagnostics: { overall: "OK" }, now: 20_000_000, lastSentAt: {} };

for (const diagnostics of [
  { overall: "DEGRADED" }, { overall: "UNKNOWN" }, { overall: "BAD" },
  { overall: "OK", missingCoins: ["ETH"] }, { overall: "OK", candle: { status: "STALE" } },
] satisfies GateDiagnostics[]) {
  test(`gate halts unhealthy data: ${JSON.stringify(diagnostics)}`, () => {
    assert.deepEqual(gatePushSignals({ ...input, diagnostics, signals: [{ ...signal, score: 4 }] }), {
      allowed: [], suppressed: [{ signal: { ...signal, score: 4 }, reason: "DATA_UNHEALTHY" }],
    });
  });
}

test("gate suppresses scores below six and allows the threshold", () => {
  const low = { ...signal, score: 5 };
  assert.deepEqual(gatePushSignals({ ...input, signals: [low, signal] }), {
    allowed: [signal], suppressed: [{ signal: low, reason: "LOW_SCORE" }],
  });
});

test("cooldown is per coin, with the exact four-hour boundary allowed", () => {
  const eth = { ...signal, coin: "ETH", key: "ETH-1" };
  assert.deepEqual(gatePushSignals({ ...input, signals: [signal, eth], lastSentAt: { BTC: input.now - 1 } }), {
    allowed: [eth], suppressed: [{ signal, reason: "COOLDOWN" }],
  });
  assert.deepEqual(gatePushSignals({ ...input, lastSentAt: { BTC: input.now - PUSH_GATE.cooldownMs } }).allowed, [signal]);
});

test("allowed order is stable and repeated inputs are deterministic without mutation", () => {
  const data = { ...input, signals: [signal, { ...signal, coin: "ETH" }, { ...signal, key: "BTC-2" }] };
  const before = structuredClone(data);
  assert.deepEqual(gatePushSignals(data).allowed, data.signals);
  assert.deepEqual(gatePushSignals(data), gatePushSignals(data));
  assert.deepEqual(data, before);
});

test("null diagnostics and optional candle status do not halt quality filtering", () => {
  for (const diagnostics of [null, undefined, { overall: "OK" }, { overall: "OK", candle: {} }]) {
    assert.deepEqual(gatePushSignals({ ...input, diagnostics }).allowed, [signal]);
  }
  assert.equal(toGateDiagnostics(null), null);
  assert.equal(toGateDiagnostics(undefined), null);
  assert.equal(toGateDiagnostics({})?.overall, "UNKNOWN");
});

test("diagnostics conversion includes nested missing coins", () => {
  const diagnostics = toGateDiagnostics({ overall: "OK", candle: { status: "OK", missingCoins: ["ETH"] } });
  assert.deepEqual(diagnostics?.missingCoins, ["ETH"]);
  assert.equal(gatePushSignals({ ...input, diagnostics }).suppressed[0].reason, "DATA_UNHEALTHY");
});

test("production clock diagnostics halt push on bad clock drift", () => {
  const diagnostics = buildMarketDiagnostics({
    now: input.now, expectedCoins: ["BTC"], rows: [{ coin: "BTC", candleClosedAt: input.now }],
    api: { requests: 1, succeeded: 1, failed: 0, rateLimited: 0 },
    historyWrite: { status: "OK", added: 1 }, serverTimeMs: input.now - 600_000,
  });
  assert.equal(gatePushSignals({ ...input, diagnostics: toGateDiagnostics(diagnostics) }).suppressed[0].reason, "DATA_UNHEALTHY");
});
