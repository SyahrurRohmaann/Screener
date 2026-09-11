import test from "node:test";
import assert from "node:assert/strict";
import type { SignalRecord } from "./store";
import { resetHistoryCache } from "./store";
import { createPushService, pushService } from "./push";
import { scanMarket } from "./marketScan";
import { mirrorPlan, reverseRecord } from "./reverse";
import { liveStatus } from "./format";

test("scan loads selection once, publishes low scores only when off and retains unhealthy halt", async (t) => {
  const fs = require("node:fs/promises") as typeof import("node:fs/promises");
  let now = Date.now();
  let healthy = true;
  t.mock.method(Date, "now", () => now);
  const files = new Map<string, string>();
  t.mock.method(fs, "readFile", async (path: string) => {
    if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return files.get(path)!;
  });
  t.mock.method(fs, "mkdir", async () => undefined);
  t.mock.method(fs, "appendFile", async () => undefined);
  t.mock.method(fs, "writeFile", async (path: string, data: string) => { files.set(path, data); });
  t.mock.method(fs, "rename", async (from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from); });
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    let body: unknown = [];
    if (url.pathname.endsWith("/time")) body = { serverTime: now + (healthy ? 0 : 600_000) };
    if (url.pathname.endsWith("/premiumIndex")) body = { lastFundingRate: "0", markPrice: "200" };
    if (url.pathname.endsWith("/klines")) body = Array.from({ length: 100 }, (_, i) => {
      const close = 100 + i;
      return [now - (100 - i) * 1_800_000, close - 0.1, close + 0.2, close - 0.3,
        close, i > 94 ? 10 : 1, now - (99 - i) * 1_800_000];
    });
    return new Response(JSON.stringify(body));
  });
  const delivered: string[] = [];
  const service = createPushService({ dir: process.cwd(), configured: () => true,
    send: async (_sub, payload) => { delivered.push(JSON.parse(payload).tag); } });
  let gateEnabled = true;
  const settings = t.mock.method(pushService(), "getPushSettings", async () => ({ gateEnabled }));
  let pending = Promise.resolve({ sent: 0, suppressed: 0 });
  t.mock.method(pushService(), "publish", (...args: Parameters<typeof service.publish>) => {
    pending = service.publish(...args); return pending;
  });
  resetHistoryCache();
  try {
    await service.subscribe({ endpoint: "https://fcm.googleapis.com/scan-test", keys: {
      p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"),
      auth: Buffer.alloc(16, 2).toString("base64url"),
    } });
    await service.publish([], []);
    const selected = await scanMarket();
    const count = selected.rows.filter(row => "sig" in row && row.sig).length;
    assert.ok(count > 0);
    assert.equal(selected.diagnostics.overall, "OK");
    assert.ok(selected.rows.every(row => !("sig" in row) || !row.sig || row.score < 6));
    assert.deepEqual(await pending, { sent: 0, suppressed: count });
    const audit = files.get(`${process.cwd()}/push-suppressed.json`);
    gateEnabled = false;
    now += 1_800_000;
    await scanMarket();
    assert.deepEqual(await pending, { sent: count, suppressed: 0 });
    assert.equal(files.get(`${process.cwd()}/push-suppressed.json`), audit);
    healthy = false;
    now += 1_800_000;
    await scanMarket();
    assert.deepEqual(await pending, { sent: 0, suppressed: count });
    assert.equal(delivered.length, count);
    assert.equal(settings.mock.callCount(), 3);
  } finally { resetHistoryCache(); }
});

test("scan flips analyzed rows and downstream candidates only for SCREENER_REVERSE=1", async (t) => {
  const previous = process.env.SCREENER_REVERSE;
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  const fs = require("node:fs/promises") as typeof import("node:fs/promises");
  t.mock.method(fs, "readFile", async () => "");
  t.mock.method(fs, "mkdir", async () => undefined);
  t.mock.method(fs, "appendFile", async () => { resetHistoryCache(); });
  resetHistoryCache();
  let candidates: SignalRecord[] = [];
  let published: unknown;
  let publishedDiagnostics: unknown;
  let publishedKeys: string[] = [];
  t.mock.method(pushService(), "publish", async (rows: SignalRecord[], keys: string[], opts?: { diagnostics?: unknown }) => {
    published = rows; candidates = rows; publishedKeys = keys; publishedDiagnostics = opts?.diagnostics;
    return { sent: 0, suppressed: 0 };
  });
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    let body: unknown = [];
    if (url.pathname.endsWith("/time")) body = { serverTime: now };
    if (url.pathname.endsWith("/premiumIndex")) body = { lastFundingRate: "0", markPrice: "200" };
    if (url.pathname.endsWith("/klines")) {
      const short = url.searchParams.get("symbol") === "ETHUSDT";
      const wait = url.searchParams.get("symbol") === "SOLUSDT";
      body = Array.from({ length: 100 }, (_, i) => {
        const close = wait ? 100 : short ? 200 - i : 100 + i;
        return [now - (100 - i) * 1_800_000, close - 0.1, close + 0.2, close - 0.3,
          close, i > 94 ? 10 : 1, now - (99 - i) * 1_800_000];
      });
    }
    return new Response(JSON.stringify(body));
  });
  try {
    delete process.env.SCREENER_REVERSE;
    const original = await scanMarket();
    const originalCandidates = candidates;
    assert.equal(publishedDiagnostics, original.diagnostics);
    assert.deepEqual(publishedKeys, original.history_write.addedKeys ?? []);
    assert.equal(original.engine, "ori");
    assert.ok(originalCandidates.some(r => r.sig === "LONG"));
    assert.ok(originalCandidates.some(r => r.sig === "SHORT"));
    for (const row of original.rows) assert.ok(!("ori_sig" in row));

    process.env.SCREENER_REVERSE = "1";
    const reversed = await scanMarket();
    assert.equal(publishedDiagnostics, reversed.diagnostics);
    assert.deepEqual(publishedKeys, reversed.history_write.addedKeys ?? []);
    assert.equal(reversed.engine, "reverse");
    for (let i = 0; i < reversed.rows.length; i++) {
      const row = reversed.rows[i];
      const ori = original.rows[i];
      assert.ok("sig" in row && "sig" in ori);
      const { engine, ori_sig, ...rest } = row;
      const { engine: originalEngine, ...baseline } = ori;
      assert.equal(engine, "reverse");
      assert.equal(originalEngine, "ori");
      assert.equal(ori_sig, ori.sig);
      const plan = ori.plan && ori.sig ? mirrorPlan(ori.plan, ori.sig === "LONG" ? ori.plan.entry_high : ori.plan.entry_low) : null;
      const expected = { ...baseline, plan,
        sig: ori.sig === "LONG" ? "SHORT" as const : ori.sig === "SHORT" ? "LONG" as const : null,
        mode: ori.mode === "TREND" ? "COUNTER" as const : ori.mode === "COUNTER" ? "TREND" as const : null,
        reasons: ori.sig ? [...ori.reasons, `REVERSE dari sinyal ${ori.sig}`] : ori.reasons };
      expected.status = liveStatus({ coin: expected.coin, score: expected.score, rsi: expected.rsi,
        trend_1h: expected.trend_1h, sig: expected.sig, plan: expected.plan,
        atr: expected.atr, age_min: expected.age_min, price: expected.mark ?? expected.price });
      assert.deepEqual(rest, expected);
    }
    assert.deepEqual(candidates, originalCandidates.map(r => ({ ...reverseRecord(r), reasons: [...r.reasons, `REVERSE dari sinyal ${r.sig}`] })));
    assert.deepEqual(published, candidates);

    process.env.SCREENER_REVERSE = "0";
    assert.deepEqual(await scanMarket(), original);
    process.env.SCREENER_REVERSE = "true";
    assert.deepEqual(await scanMarket(), original);
  } finally {
    resetHistoryCache();
    if (previous === undefined) delete process.env.SCREENER_REVERSE;
    else process.env.SCREENER_REVERSE = previous;
  }
});
