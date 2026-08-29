import test from "node:test";
import assert from "node:assert/strict";
import { createApiCounter } from "./api-counter";

test("counter separates successes, failures, and rate limits", () => {
  const counter = createApiCounter();
  counter.record({ ok: true, status: 200 });
  counter.record({ ok: false, status: 500 });
  counter.record({ ok: false, status: 429 });
  counter.record({ ok: false, status: 418 });
  counter.record({ ok: false, status: null });

  assert.deepEqual(counter.counts(), { requests: 5, succeeded: 1, failed: 4, rateLimited: 2 });
});

test("a fresh counter reports zero requests so health stays UNKNOWN", () => {
  assert.deepEqual(createApiCounter().counts(), { requests: 0, succeeded: 0, failed: 0, rateLimited: 0 });
});

test("counts() returns a snapshot that later requests cannot mutate", () => {
  const counter = createApiCounter();
  counter.record({ ok: true, status: 200 });
  const snapshot = counter.counts();
  counter.record({ ok: true, status: 200 });
  assert.equal(snapshot.requests, 1);
  assert.equal(counter.counts().requests, 2);
});
