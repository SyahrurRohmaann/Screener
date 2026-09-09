import assert from "node:assert/strict";
import test from "node:test";
import { clampOffset, indexToX, percentageLabel, MAX_RIGHT_FRACTION, VISIBLE_BARS } from "../lib/chartView";

test("pan bounds expose a quarter viewport and 100 visible bars", () => {
  assert.equal(MAX_RIGHT_FRACTION, 0.25);
  assert.equal(VISIBLE_BARS, 100);
});

test("pan clamps to all fetched history and the right empty area", () => {
  assert.equal(clampOffset(-9999, 200, 100, 7, 175), -700);
  assert.equal(clampOffset(9999, 200, 100, 7, 175), 175);
  assert.equal(clampOffset(-350, 200, 100, 7, 175), -350);
  assert.equal(clampOffset(0, 200, 100, 7, 175), 0);
  assert.equal(clampOffset(-9999, 400, 100, 7, 175), -2100);
});

test("short and empty data have no history overscroll", () => {
  assert.equal(clampOffset(-10, 20, 100, 7, 175), 0);
  assert.equal(clampOffset(-10, 0, 100, 7, 175), 0);
});

test("index coordinates start at latest window and share pan direction", () => {
  assert.equal(indexToX(100, 200, 100, 7, 8, 0), 11.5);
  assert.equal(indexToX(0, 200, 100, 7, 8, -700), 11.5);
  assert.equal(indexToX(199, 200, 100, 7, 8, 175), 529.5);
  assert.equal(indexToX(0, 20, 100, 7, 8, 0), 11.5);
});

test("percentage labels are signed relative to latest close", () => {
  assert.equal(percentageLabel(110, 100), "+10.00%");
  assert.equal(percentageLabel(90, 100), "-10.00%");
  assert.equal(percentageLabel(100, 100), "+0.00%");
});

test("invalid prices omit percentage labels without crashing", () => {
  for (const close of [0, NaN, Infinity, -1]) assert.equal(percentageLabel(100, close), null);
  for (const price of [NaN, Infinity]) assert.equal(percentageLabel(price, 100), null);
});
