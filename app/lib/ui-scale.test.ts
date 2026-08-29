import test from "node:test";
import assert from "node:assert/strict";
import {
  clampScale, DEFAULT_SCALE, isLargest, isSmallest, nextScale,
  SCALE_BOOTSTRAP, SCALE_KEY, SCALE_STEPS, scaleLabel,
} from "./ui-scale";

test("a corrupt or foreign stored value falls back to 100% instead of breaking layout", () => {
  for (const bad of ["abis", "", null, undefined, NaN, Infinity, -Infinity, {}, [], true]) {
    assert.equal(clampScale(bad), DEFAULT_SCALE, String(bad));
  }
});

test("stored strings are accepted, since localStorage only holds strings", () => {
  assert.equal(clampScale("1.25"), 1.25);
  assert.equal(clampScale("0.85"), 0.85);
});

test("an off-grid value snaps to the nearest legal step rather than being used raw", () => {
  assert.equal(clampScale(1.19), 1.25);
  assert.equal(clampScale(1.04), 1);
  // Out of range in both directions clamps to the ends, never past them.
  assert.equal(clampScale(9), 1.6);
  assert.equal(clampScale(0.1), 0.85);
});

test("stepping stops at both ends instead of wrapping around", () => {
  assert.equal(nextScale(SCALE_STEPS[0], -1), SCALE_STEPS[0]);
  assert.equal(nextScale(SCALE_STEPS[SCALE_STEPS.length - 1], 1), SCALE_STEPS[SCALE_STEPS.length - 1]);
  assert.equal(nextScale(1, 1), 1.1);
  assert.equal(nextScale(1, -1), 0.925);
  // Stepping from a corrupt value still produces a legal neighbour.
  assert.equal(nextScale(NaN, 1), 1.1);
});

test("every step is reachable by stepping up from the smallest", () => {
  let current: number = SCALE_STEPS[0];
  const seen = [current];
  for (let i = 0; i < SCALE_STEPS.length * 2; i++) {
    const next = nextScale(current, 1);
    if (next === current) break;
    current = next; seen.push(current);
  }
  assert.deepEqual(seen, [...SCALE_STEPS]);
});

test("labels are whole percentages, so 92.5% never leaks into the UI", () => {
  assert.equal(scaleLabel(0.925), "93%");
  assert.equal(scaleLabel(1), "100%");
  assert.equal(scaleLabel(1.6), "160%");
});

test("end detection matches the actual step list", () => {
  assert.ok(isSmallest(0.85) && !isSmallest(1));
  assert.ok(isLargest(1.6) && !isLargest(1.4));
});

test("the pre-paint script reads the same key and cannot throw on a blocked localStorage", () => {
  assert.ok(SCALE_BOOTSTRAP.includes(JSON.stringify(SCALE_KEY)));
  assert.ok(SCALE_BOOTSTRAP.includes("--ui-scale"));
  // Must be wrapped in try/catch: localStorage throws in some privacy modes.
  assert.match(SCALE_BOOTSTRAP, /try\{/);
  assert.match(SCALE_BOOTSTRAP, /catch\(e\)\{\}/);

  // Execute it against a fake DOM to prove it applies a legal step, not the raw value.
  const applied: Record<string, string> = {};
  const sandbox = {
    localStorage: { getItem: (k: string) => (k === SCALE_KEY ? "1.19" : null) },
    document: { documentElement: { style: { setProperty: (k: string, v: string) => { applied[k] = v; } } } },
  };
  new Function("localStorage", "document", SCALE_BOOTSTRAP)(sandbox.localStorage, sandbox.document);
  assert.equal(applied["--ui-scale"], "1.25");
});

test("the pre-paint script leaves the default alone when nothing is stored", () => {
  const applied: Record<string, string> = {};
  new Function("localStorage", "document", SCALE_BOOTSTRAP)(
    { getItem: () => null },
    { documentElement: { style: { setProperty: (k: string, v: string) => { applied[k] = v; } } } },
  );
  assert.deepEqual(applied, {});
});
