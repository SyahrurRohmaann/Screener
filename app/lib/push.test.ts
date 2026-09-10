import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPushService, parseSubscription, readPushBody, sameOriginMutation, pushPayload } from "./push";

const subscription = (id = "one") => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") },
});
const signal = (key: string) => ({ key, coin: "BTC", sig: "LONG" as const, score: 4 });

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

test("push payload contains only a bounded signal summary and a fixed safe destination", () => {
  assert.deepEqual(pushPayload(signal("BTC-123")), { title: "Sinyal baru: BTC LONG", body: "BTC LONG | skor 4", tag: "BTC-123", url: "/" });
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
