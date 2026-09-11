import test from "node:test";
import assert from "node:assert/strict";
import { parseSignalRef, signalHref } from "./deep-link";

test("signal references validate coin and timestamp and normalize lowercase coins", () => {
  assert.deepEqual(parseSignalRef("DOGE-1726012345"), { coin: "DOGE", closed_at: 1726012345 });
  assert.deepEqual(parseSignalRef("doge-1726012345"), { coin: "DOGE", closed_at: 1726012345 });
  assert.deepEqual(parseSignalRef("1A-1234567890123456"), { coin: "1A", closed_at: 1234567890123456 });
  for (const value of ["DOGE1726012345", "DOGE-notdigits", "ABCDEFGHIJKLMNOP-1726012345", "A-1726012345", "DOGE-123456789", "DOGE-12345678901234567", "", null, undefined]) {
    assert.equal(parseSignalRef(value), null);
  }
});

test("signal links encode query values and round-trip signal references", () => {
  assert.equal(signalHref("DOGE-1726012345"), "/?s=DOGE-1726012345");
  assert.equal(signalHref("DOGE &/?#"), "/?s=DOGE%20%26%2F%3F%23");
  const url = new URL(signalHref("doge-1726012345"), "https://screener.test");
  assert.deepEqual(parseSignalRef(url.searchParams.get("s")), { coin: "DOGE", closed_at: 1726012345 });
});
