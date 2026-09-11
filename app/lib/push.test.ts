import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import Module from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPushService, parseSubscription, readPushBody, sameOriginMutation, pushPayload } from "./push";

const subscription = (id = "one") => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") },
});
const signal = (key: string) => ({ key, coin: "BTC", sig: "LONG" as const, score: 4 });

test("push settings default safely, persist booleans and reject invalid writes", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".push-settings-test-"));
  const options = { dir, configured: () => false, send: async () => assert.fail("send forbidden") };
  try {
    const service = createPushService(options);
    assert.deepEqual(await service.getPushSettings(), { gateEnabled: true });
    for (const raw of ["{", "null", "{}", '{"gateEnabled":"false"}', '{"gateEnabled":0}']) {
      await writeFile(join(dir, "push-settings.json"), raw);
      assert.deepEqual(await service.getPushSettings(), { gateEnabled: true });
    }
    assert.deepEqual(await service.setPushSettings({ gateEnabled: false }), { gateEnabled: false });
    assert.deepEqual(await createPushService(options).getPushSettings(), { gateEnabled: false });
    for (const invalid of [null, undefined, {}, false, { gateEnabled: "false" }, { gateEnabled: 0 }]) {
      await assert.rejects(service.setPushSettings(invalid), /invalid_settings/);
      assert.deepEqual(await service.getPushSettings(), { gateEnabled: false });
    }
    assert.deepEqual(await service.setPushSettings({ gateEnabled: true }), { gateEnabled: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("push settings routes guard sessions, validate mutations and disable caching", async () => {
  const loader = Module as typeof Module & { _load: (id: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
  const filename = require.resolve("../api/push/settings/route");
  const cached = require.cache[filename];
  const originalLoad = loader._load;
  let authenticated = false;
  let settings = { gateEnabled: true };
  let reads = 0;
  let writes = 0;
  delete require.cache[filename];
  loader._load = function (id, parent, isMain) {
    if (parent?.filename === filename && id === "../../../lib/session") return {
      guard: async () => authenticated ? null : Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
    if (parent?.filename === filename && id === "../../../lib/push") return {
      readPushBody, sameOriginMutation,
      getPushSettings: async () => { reads++; return settings; },
      setPushSettings: async (next: typeof settings) => {
        if (typeof next?.gateEnabled !== "boolean") throw new Error("invalid_settings");
        writes++; settings = next; return settings;
      },
    };
    return originalLoad.call(this, id, parent, isMain);
  };
  try {
    const { GET, POST } = require(filename);
    const request = (body: string, origin = "https://screener.test") => new Request("https://screener.test/api/push/settings", {
      method: "POST", headers: { host: "screener.test", origin }, body,
    });
    for (const response of [await GET(), await POST(request('{"gateEnabled":false}'))]) {
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
    assert.equal(reads + writes, 0);
    authenticated = true;
    assert.deepEqual(await (await GET()).json(), { gateEnabled: true });
    const response = await POST(request('{"gateEnabled":false}'));
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { gateEnabled: false });
    assert.deepEqual(await (await GET()).json(), { gateEnabled: false });
    for (const [body, status] of [["{}", 400], ["{", 400], ['{"gateEnabled":"false"}', 400], ["x".repeat(4097), 413]] as const) {
      const rejected = await POST(request(body));
      assert.equal(rejected.status, status);
      assert.equal(rejected.headers.get("Cache-Control"), "no-store");
    }
    assert.equal((await POST(request('{"gateEnabled":true}', "https://evil.test"))).status, 403);
    assert.equal(writes, 1);
  } finally {
    loader._load = originalLoad;
    delete require.cache[filename];
    if (cached) require.cache[filename] = cached;
  }
});

test("gate off bypasses score and cooldown but retains health halt and durable dedup", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".push-gate-test-"));
  const delivered: string[] = [];
  const options = { dir, configured: () => true, send: async (_sub: unknown, payload: string) => { delivered.push(JSON.parse(payload).tag); } };
  const healthy = { diagnostics: { overall: "OK" }, gateEnabled: false };
  try {
    const service = createPushService(options);
    await service.subscribe(subscription());
    await service.publish([signal("baseline")], ["baseline"], healthy);
    assert.deepEqual(await service.publish([signal("one"), signal("two")], ["one", "two"], healthy), { sent: 2, suppressed: 0 });
    await assert.rejects(readFile(join(dir, "push-suppressed.json")), { code: "ENOENT" });
    assert.deepEqual(await service.publish([signal("halt")], ["halt"], { gateEnabled: false, diagnostics: { overall: "DEGRADED" } }), { sent: 0, suppressed: 1 });
    assert.equal(JSON.parse(await readFile(join(dir, "push-suppressed.json"), "utf8"))[0].reason, "DATA_UNHEALTHY");
    const restarted = createPushService(options);
    await restarted.publish([], [], healthy);
    await restarted.publish([signal("one"), signal("two"), signal("halt")], ["one", "two", "halt"], healthy);
    assert.deepEqual(delivered, ["one", "two"]);
    assert.deepEqual(await restarted.publish([{ ...signal("cooldown"), score: 6 }], ["cooldown"], { ...healthy, gateEnabled: true }), { sent: 0, suppressed: 1 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("subscription validation restricts push hosts, HTTPS, credentials, ports and key lengths", () => {
  assert.deepEqual(parseSubscription(subscription()), subscription());
  for (const endpoint of ["http://fcm.googleapis.com/a", "https://127.0.0.1/a", "https://[::1]/a", "https://localhost/a", "https://fcm.googleapis.com.evil.test/a", "https://evil.test/a", "https://user@fcm.googleapis.com/a", "https://fcm.googleapis.com:444/a", "https://fcm.googleapis.com/a#x"]) {
    assert.throws(() => parseSubscription({ ...subscription(), endpoint }));
  }
  for (const host of ["updates.push.services.mozilla.com", "web.push.apple.com", "wns2-par02p.notify.windows.com"]) {
    assert.equal(parseSubscription({ ...subscription(), endpoint: `https://${host}/a` }).endpoint, `https://${host}/a`);
  }
  for (const keys of [{ auth: "bad", p256dh: subscription().keys.p256dh }, { ...subscription().keys, p256dh: "!".repeat(87) }, { ...subscription().keys, p256dh: Buffer.alloc(65).toString("base64url") }]) {
    assert.throws(() => parseSubscription({ ...subscription(), keys }));
  }
});

test("bounded streaming JSON rejects oversized bodies without trusting content-length", async () => {
  assert.deepEqual(await readPushBody(new Request("https://screener.test", { method: "POST", body: JSON.stringify(subscription()) })), subscription());
  await assert.rejects(readPushBody(new Request("https://screener.test", { method: "POST", body: "x".repeat(4097), headers: { "content-length": "1" } })), /payload_too_large/);
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; } });
  await assert.rejects(readPushBody(new Request("https://screener.test", { method: "POST", body: stream, duplex: "half" } as RequestInit)), /payload_too_large/);
  assert.equal(cancelled, true);
  await assert.rejects(readPushBody(new Request("https://screener.test", { method: "POST", body: "{" })), /invalid_payload/);
});

test("mutations require explicit matching Origin and reject cross-site fetches", () => {
  const req = (headers: Record<string, string>) => new Request("https://screener.test/api/push/subscribe", { method: "POST", headers: { host: "screener.test", ...headers } });
  assert.equal(sameOriginMutation(req({ origin: "https://screener.test" })), true);
  const invalid: Record<string, string>[] = [{}, { origin: "null" }, { origin: "https://evil.test" }, { origin: "https://screener.test", "sec-fetch-site": "cross-site" }, { origin: "https://screener.test", "sec-fetch-site": "same-site" }];
  for (const headers of invalid) assert.equal(sameOriginMutation(req(headers)), false);
});

test("mutations compare the public proxy headers rather than the standalone URL", () => {
  const req = (headers: Record<string, string>) => new Request("https://container:3000/api/push/subscribe", { method: "POST", headers });
  assert.equal(sameOriginMutation(req({ origin: "https://scansignal.my.id", host: "scansignal.my.id", "x-forwarded-proto": "https" })), true);
  assert.equal(sameOriginMutation(req({ origin: "https://scansignal.my.id:8443", host: "container:3000", "x-forwarded-host": " scansignal.my.id:8443, internal.test", "x-forwarded-proto": " https, http" })), true);
  assert.equal(sameOriginMutation(req({ origin: "https://container:3000", host: "container:3000", "x-forwarded-host": "scansignal.my.id", "x-forwarded-proto": "https" })), false);
  assert.equal(sameOriginMutation(req({ origin: "https://scansignal.my.id", host: "scansignal.my.id" })), true);
  assert.equal(sameOriginMutation(req({ origin: "http://localhost:3000", host: "localhost:3000" })), true);
  assert.equal(sameOriginMutation(req({ origin: "http://localhost", host: "localhost" })), true);
  assert.equal(sameOriginMutation(req({ origin: "https://localhost:3000", host: "localhost:3000", "x-forwarded-proto": "https" })), true);
  assert.equal(sameOriginMutation(req({ origin: "https://container:3000" })), false);
  assert.equal(sameOriginMutation(req({ origin: "http://scansignal.my.id", host: "scansignal.my.id" })), false);
  assert.equal(sameOriginMutation(req({ origin: "https://scansignal.my.id/", host: "scansignal.my.id" })), false);
});

test("push payload contains a bounded signal summary and a signal deep-link", () => {
  assert.deepEqual(pushPayload(signal("BTC-1726012345")), { title: "Sinyal baru: BTC LONG", body: "BTC LONG | skor 4", tag: "BTC-1726012345", url: "/?s=BTC-1726012345" });
});

test("durable subscription upsert/removal, silent baseline, actual-added filtering and restart dedupe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screener-push-"));
  const sent: string[] = [];
  const options = { dir, configured: () => true, send: async (_sub: unknown, payload: string) => { sent.push(JSON.parse(payload).tag); } };
  try {
    const service = createPushService(options);
    await Promise.all([service.subscribe(subscription()), service.subscribe(subscription())]);
    assert.equal(JSON.parse(await readFile(join(dir, "push-subscriptions.json"), "utf8")).length, 1);
    await service.publish([signal("baseline")], ["baseline"]);
    assert.deepEqual(sent, []);
    await Promise.all([service.publish([signal("old"), signal("fresh")], ["fresh"]), service.publish([signal("fresh")], ["fresh"])]);
    assert.deepEqual(sent, ["fresh"]);
    const restarted = createPushService(options);
    await restarted.publish([], []);
    await restarted.publish([signal("fresh")], ["fresh"]);
    assert.deepEqual(sent, ["fresh"]);
    await restarted.unsubscribe(subscription().endpoint);
    assert.deepEqual(JSON.parse(await readFile(join(dir, "push-subscriptions.json"), "utf8")), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("missing config is a no-write no-send path; failures are isolated, expired subscriptions removed, sends time out", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screener-push-"));
  try {
    const disabled = createPushService({ dir, configured: () => false, send: async () => { assert.fail("real send forbidden"); } });
    await assert.rejects(disabled.subscribe(subscription()), /push_not_configured/);
    await disabled.publish([signal("x")], ["x"]);
    await assert.rejects(readFile(join(dir, "push-sent.json")));
    const delivered: string[] = [];
    const service = createPushService({ dir, configured: () => true, timeoutMs: 20, send: async (sub) => {
      const id = sub.endpoint.split("/").at(-1)!;
      if (id === "gone" || id === "missing") throw { statusCode: id === "gone" ? 410 : 404 };
      if (id === "broken") throw { statusCode: 500 };
      if (id === "slow") await new Promise(() => {});
      delivered.push(id);
    } });
    for (const id of ["gone", "missing", "broken", "slow", "good"]) await service.subscribe(subscription(id));
    await service.publish([], []);
    await service.publish([signal("new")], ["new"]);
    assert.deepEqual(delivered, ["good"]);
    const remaining = JSON.parse(await readFile(join(dir, "push-subscriptions.json"), "utf8"));
    assert.equal(remaining.length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("gated publish persists cooldown across calls and restarts, audits suppression and retains legacy delivery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screener-push-gate-"));
  const delivered: string[] = [];
  const options = { dir, configured: () => true, send: async (_sub: unknown, payload: string) => { delivered.push(JSON.parse(payload).tag); } };
  const healthy = { diagnostics: { overall: "OK" } };
  const top = (key: string, coin = "BTC") => ({ ...signal(key), coin, score: 6, atr_pct: 1 });
  try {
    const service = createPushService(options);
    await service.subscribe(subscription());
    assert.deepEqual(await service.publish([top("baseline")], ["baseline"], healthy), { sent: 0, suppressed: 0 });
    await assert.rejects(readFile(join(dir, "push-last-sent.json")), { code: "ENOENT" });
    const before = Date.now();
    assert.deepEqual(await service.publish([signal("low"), top("first"), top("same-batch")], ["low", "first", "same-batch"], healthy), { sent: 1, suppressed: 2 });
    const lastSentAt = JSON.parse(await readFile(join(dir, "push-last-sent.json"), "utf8"));
    assert.ok(lastSentAt.BTC >= before && lastSentAt.BTC <= Date.now());
    assert.deepEqual(await service.publish([top("second"), top("eth", "ETH")], ["second", "eth"], healthy), { sent: 1, suppressed: 1 });
    const restarted = createPushService(options);
    await restarted.publish([], [], healthy);
    assert.deepEqual(await restarted.publish([top("restart")], ["restart"], healthy), { sent: 0, suppressed: 1 });
    assert.deepEqual(await restarted.publish([signal("legacy-1"), signal("legacy-2")], ["legacy-1", "legacy-2"]), { sent: 2, suppressed: 0 });
    assert.deepEqual(delivered, ["first", "eth", "legacy-1", "legacy-2"]);
    const audit = JSON.parse(await readFile(join(dir, "push-suppressed.json"), "utf8"));
    assert.deepEqual(audit.map((item: { key: string; reason: string }) => [item.key, item.reason]), [
      ["low", "LOW_SCORE"], ["same-batch", "COOLDOWN"], ["second", "COOLDOWN"], ["restart", "COOLDOWN"],
    ]);
    assert.equal(audit[0].coin, "BTC");
    assert.equal(audit[0].ts, lastSentAt.BTC);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("unhealthy publish sends nothing, bounds the persisted audit to 500 and never replays suppressed keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screener-push-gate-"));
  try {
    const service = createPushService({ dir, configured: () => true, send: async () => { assert.fail("send forbidden"); } });
    await service.subscribe(subscription());
    await service.publish([], []);
    const signals = Array.from({ length: 501 }, (_, i) => ({ ...signal(`halt-${i}`), score: 6 }));
    assert.deepEqual(await service.publish(signals, signals.map((s) => s.key), { diagnostics: { overall: "OK", candle: { missingCoins: ["ETH"] } } }), { sent: 0, suppressed: 501 });
    const audit = JSON.parse(await readFile(join(dir, "push-suppressed.json"), "utf8"));
    assert.equal(audit.length, 500);
    assert.equal(audit[0].key, "halt-1");
    assert.equal(audit[499].reason, "DATA_UNHEALTHY");
    assert.deepEqual(await service.publish(signals, signals.map((s) => s.key), { diagnostics: { overall: "OK" } }), { sent: 0, suppressed: 0 });
    await assert.rejects(readFile(join(dir, "push-last-sent.json")), { code: "ENOENT" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("failed delivery and no subscribers do not start cooldown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screener-push-gate-"));
  let attempts = 0;
  try {
    const service = createPushService({ dir, configured: () => true, send: async () => { attempts++; throw new Error("offline"); } });
    const healthy = { diagnostics: { overall: "OK" } };
    await service.publish([], []);
    assert.deepEqual(await service.publish([{ ...signal("no-subs"), score: 6 }], ["no-subs"], healthy), { sent: 0, suppressed: 0 });
    await service.subscribe(subscription());
    for (const key of ["failed-1", "failed-2"]) {
      assert.deepEqual(await service.publish([{ ...signal(key), score: 6 }], [key], healthy), { sent: 0, suppressed: 0 });
    }
    assert.equal(attempts, 2);
    await assert.rejects(readFile(join(dir, "push-last-sent.json")), { code: "ENOENT" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
