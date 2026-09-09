import test from "node:test";
import assert from "node:assert/strict";
import { singleFlight, workerAllowed, startScanLoop } from "./scanWorker";
import { register } from "../../instrumentation";

test("worker only runs in configured Node serving runtime, never tests or production build", () => {
  const env = { NEXT_RUNTIME: "nodejs", NODE_ENV: "production", VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private" };
  assert.equal(workerAllowed(env), true);
  for (const override of [{ NEXT_RUNTIME: "edge" }, { NODE_ENV: "test" }, { NEXT_PHASE: "phase-production-build" }, { NODE_TEST_CONTEXT: "child-v8" }, { VAPID_PRIVATE_KEY: "" }, { SCREENER_DISABLE_WORKER: "1" }]) assert.equal(workerAllowed({ ...env, ...override }), false);
});

test("instrumentation production-build guard does not create a worker even with VAPID present", async () => {
  const previous = { NEXT_PHASE: process.env.NEXT_PHASE, NEXT_RUNTIME: process.env.NEXT_RUNTIME, VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY };
  try {
    Object.assign(process.env, { NEXT_PHASE: "phase-production-build", NEXT_RUNTIME: "nodejs", VAPID_PUBLIC_KEY: "test-placeholder", VAPID_PRIVATE_KEY: "test-placeholder" });
    await register();
    assert.equal((globalThis as typeof globalThis & { screenerWorker?: unknown }).screenerWorker, undefined);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("route and worker share one in-flight scan and unlock after failure", async () => {
  const state = {};
  let calls = 0;
  let release!: () => void;
  const scan = () => singleFlight(state, async () => { calls++; await new Promise<void>((resolve) => { release = resolve; }); return 42; });
  const a = scan(), b = scan();
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all([a, b]), [42, 42]);
  await assert.rejects(singleFlight(state, async () => { throw new Error("upstream"); }));
  assert.equal(await singleFlight(state, async () => 7), 7);
});

test("scheduler starts immediately, uses 30s ticks and does not overlap or stop after errors", async () => {
  let tick!: () => void;
  let release!: () => void;
  let calls = 0;
  const stop = startScanLoop(async () => { calls++; await new Promise<void>((r) => { release = r; }); throw new Error("isolated"); }, (callback, ms) => {
    assert.equal(ms, 30_000); tick = callback; return () => {};
  });
  tick(); tick();
  assert.equal(calls, 1);
  release();
  await new Promise((r) => setImmediate(r));
  tick();
  assert.equal(calls, 2);
  release(); stop();
});
