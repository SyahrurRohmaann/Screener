import test from "node:test";
import assert from "node:assert/strict";
import { chimeForSignal, chimeForStatus, clampVolume, toneDurationMs, toneSpec } from "./chime";

test("a new signal chime is a three-note run, long enough to notice", () => {
  for (const kind of ["NEW_LONG", "NEW_SHORT"] as const) {
    const tones = toneSpec(kind);
    assert.equal(tones.length, 3, `${kind} must repeat, a single ping is missable`);
    assert.ok(toneDurationMs(tones) >= 600, `${kind} lasts ${toneDurationMs(tones)}ms, too short to catch`);
    for (const tone of tones) {
      assert.ok(tone.hz >= 300 && tone.hz <= 2000, "stay inside the audible, cutting range");
      assert.ok(tone.ms > 0);
    }
  }
});

test("LONG rises and SHORT falls so direction is audible without looking", () => {
  const long = toneSpec("NEW_LONG").map((t) => t.hz);
  const short = toneSpec("NEW_SHORT").map((t) => t.hz);
  assert.deepEqual(long, [...short].reverse());
  assert.ok(long[0] < long[long.length - 1]);
  assert.ok(short[0] > short[short.length - 1]);
});

test("invalidation sounds lower and distinct from a routine status update", () => {
  const stop = toneSpec("INVALIDATED");
  const status = toneSpec("STATUS");
  assert.notDeepEqual(stop, status);
  const lowest = (t: typeof stop) => Math.min(...t.map((x) => x.hz));
  assert.ok(lowest(stop) < lowest(status), "a killed setup must not sound cheerful");
  assert.ok(lowest(stop) < lowest(toneSpec("NEW_LONG")));
});

test("chime selection maps side and status kind", () => {
  assert.equal(chimeForSignal("LONG"), "NEW_LONG");
  assert.equal(chimeForSignal("SHORT"), "NEW_SHORT");
  assert.equal(chimeForStatus("INVALIDATED"), "INVALIDATED");
  assert.equal(chimeForStatus("TP1"), "STATUS");
  assert.equal(chimeForStatus("ENTRY"), "STATUS");
});

test("duration sums note lengths and the silence between them", () => {
  assert.equal(toneDurationMs([{ hz: 500, ms: 100, gap_ms: 50 }, { hz: 500, ms: 200, gap_ms: 0 }]), 350);
  assert.equal(toneDurationMs([]), 0);
});

test("volume is clamped and a corrupt stored value falls back to audible", () => {
  assert.equal(clampVolume(0.5), 0.5);
  assert.equal(clampVolume(4), 1);
  assert.equal(clampVolume(-2), 0);
  assert.equal(clampVolume(Number.NaN), 0.7);
});
