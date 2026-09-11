import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("service worker forwards deep-links, activates immediately, and opens only same-origin root", async () => {
  const source = await readFile("public/sw.js", "utf8");
  const handlers: Record<string, (event: any) => void> = {};
  const notifications: any[] = [];
  const opened: string[] = [];
  let focused = 0;
  let skipped = 0;
  let claimed = 0;
  const messages: any[] = [];
  let windows: any[] = [];
  const clients = { claim: async () => { claimed++; }, matchAll: async () => windows, openWindow: async (url: string) => { opened.push(url); } };
  vm.runInNewContext(source, { URL, self: { skipWaiting: async () => { skipped++; }, location: { origin: "https://screener.test" }, clients, addEventListener: (name: string, handler: any) => { handlers[name] = handler; }, registration: { showNotification: async (...args: any[]) => { notifications.push(args); } } } });
  let pending!: Promise<unknown>;
  const waitUntil = (promise: Promise<unknown>) => { pending = promise; };
  handlers.install({ waitUntil }); await pending;
  handlers.activate({ waitUntil }); await pending;
  assert.equal(skipped, 1);
  assert.equal(claimed, 1);
  const url = "/?s=BTC-1726012345";
  handlers.push({ data: { json: () => ({ title: "BTC", body: "LONG", tag: "BTC-1726012345", url }) }, waitUntil });
  await pending;
  assert.equal(notifications[0][1].data.url, url);
  handlers.push({ data: { json: () => { throw new Error("bad JSON"); } }, waitUntil });
  await pending;
  assert.equal(notifications.length, 2);
  assert.equal(notifications[1][1].data.url, "/");
  const click = { notification: { close() {}, data: { url } }, waitUntil };
  windows = [{ url: "https://evil.test/", focus: async () => { assert.fail("foreign window"); } }, { url: "https://screener.test/", focus: async () => { focused++; }, postMessage: (message: any) => { assert.equal(focused, 1); messages.push(message); } }];
  handlers.notificationclick(click); await pending;
  assert.equal(focused, 1);
  assert.equal(messages[0].type, "open-signal");
  assert.equal(messages[0].url, url);
  assert.deepEqual(opened, []);
  windows = [{ url: "https://screener.test/history", focus: async () => { assert.fail("not root"); } }];
  handlers.notificationclick(click); await pending;
  assert.deepEqual(opened, [url]);
  for (const invalid of ["", "https://evil.test", "/history", "http://["]) {
    click.notification.data.url = invalid;
    handlers.notificationclick(click); await pending;
    assert.equal(opened.at(-1), "/");
  }
});
