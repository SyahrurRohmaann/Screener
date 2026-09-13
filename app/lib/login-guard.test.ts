import test from "node:test";
import assert from "node:assert/strict";
import { createLoginGuard, LOGIN_LIMIT } from "./login-guard";

test("allows eight failures per IP and keeps other IPs independent", () => {
  const guard = createLoginGuard();
  for (let i = 0; i < LOGIN_LIMIT.maxPerIp; i++) {
    assert.deepEqual(guard.check("192.0.2.1", 0), { ok: true });
    guard.record("192.0.2.1", false, 0);
  }
  assert.deepEqual(guard.check("192.0.2.1", 0), { ok: false, retryAfterSec: 900 });
  assert.deepEqual(guard.check("192.0.2.2", 0), { ok: true });
});

test("failures lapse individually at the sliding window boundary", () => {
  const guard = createLoginGuard({ windowMs: 10_000, maxPerIp: 2, retryAfterMs: 1000 });
  guard.record("ip", false, 0);
  guard.record("ip", false, 5000);
  assert.equal(guard.check("ip", 9999).ok, false);
  assert.deepEqual(guard.check("ip", 10_000), { ok: true });
  guard.record("ip", false, 10_000);
  assert.equal(guard.check("ip", 10_000).ok, false);
  assert.deepEqual(guard.check("ip", 15_000), { ok: true });
  assert.deepEqual(guard.check("ip", 20_000), { ok: true });
});

test("success resets only the successful IP", () => {
  const guard = createLoginGuard({ ...LOGIN_LIMIT, maxPerIp: 1 });
  guard.record("a", false, 0);
  guard.record("b", false, 0);
  guard.record("a", true, 1);
  assert.deepEqual(guard.check("a", 1), { ok: true });
  assert.equal(guard.check("b", 1).ok, false);
});

test("retryAfter rounds up remaining seconds and respects the retry floor", () => {
  const guard = createLoginGuard({ ...LOGIN_LIMIT, maxPerIp: 1 });
  guard.record("ip", false, 0);
  assert.deepEqual(guard.check("ip", 1001), { ok: false, retryAfterSec: 899 });
  assert.deepEqual(guard.check("ip", LOGIN_LIMIT.windowMs - 1), { ok: false, retryAfterSec: 60 });
  assert.deepEqual(guard.check("ip", LOGIN_LIMIT.windowMs), { ok: true });
});

test("unknown IP uses the same quota and reset behavior", () => {
  const guard = createLoginGuard({ ...LOGIN_LIMIT, maxPerIp: 1 });
  guard.record("unknown", false, 0);
  assert.equal(guard.check("unknown", 0).ok, false);
  guard.record("unknown", true, 1);
  assert.deepEqual(guard.check("unknown", 1), { ok: true });
});

test("the 500 IP cap evicts the least recently failed entry", () => {
  const guard = createLoginGuard({ ...LOGIN_LIMIT, maxPerIp: 1 });
  for (let i = 0; i < 500; i++) guard.record(`ip-${i}`, false, i);
  guard.record("ip-0", false, 500);
  guard.record("ip-500", false, 501);
  assert.equal(guard.check("ip-0", 501).ok, false);
  assert.equal(guard.check("ip-1", 501).ok, true);
  assert.equal(guard.check("ip-2", 501).ok, false);
  assert.equal(guard.check("ip-500", 501).ok, false);
});

test("expired entries are pruned before cap eviction", () => {
  const guard = createLoginGuard({ windowMs: 1000, maxPerIp: 1, retryAfterMs: 100 });
  for (let i = 0; i < 500; i++) guard.record(`ip-${i}`, false, i);
  guard.record("new", false, 1000);
  assert.equal(guard.check("ip-0", 1000).ok, true);
  assert.equal(guard.check("ip-1", 1000).ok, false);
  assert.equal(guard.check("new", 1000).ok, false);
});
