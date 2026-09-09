import assert from "node:assert/strict";
import test from "node:test";
import { paginate } from "./history-paging";

test("pagination defaults to page 1 and 50 rows", () => {
  assert.deepEqual(paginate(123), { page: 1, pageSize: 50, total: 123, total_pages: 3, start: 0, end: 50 });
});

test("all supported page sizes work", () => {
  for (const size of [25, 50, 100, 200]) {
    assert.deepEqual(paginate(451, "2", String(size)), {
      page: 2, pageSize: size, total: 451, total_pages: Math.ceil(451 / size), start: size, end: size * 2,
    });
  }
});

test("invalid page sizes use 50", () => {
  for (const size of [null, "", "abc", 0, -25, 26, 50.5, Infinity, "50x"]) {
    assert.equal(paginate(123, 1, size).pageSize, 50);
  }
});

test("invalid pages use 1 without partial parsing", () => {
  for (const page of [null, "", "abc", 0, -1, 1.5, Infinity, "2x", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(paginate(123, page).page, 1);
  }
});

test("last page ends at the total", () => {
  assert.deepEqual(paginate(123, 3), { page: 3, pageSize: 50, total: 123, total_pages: 3, start: 100, end: 123 });
});

test("out of range preserves requested page and slices to empty", () => {
  const rows = Array.from({ length: 123 }, (_, i) => i);
  for (const page of [4, Number.MAX_SAFE_INTEGER]) {
    const result = paginate(rows.length, page);
    assert.equal(result.page, page);
    assert.equal(result.total_pages, 3);
    assert.equal(result.total, 123);
    assert.deepEqual(rows.slice(result.start, result.end), []);
  }
});

test("empty history has zero total pages and empty bounds", () => {
  assert.deepEqual(paginate(0, 7, 25), { page: 7, pageSize: 25, total: 0, total_pages: 0, start: 0, end: 0 });
});

test("paging neither mutates nor truncates the full range", () => {
  const rows = Array.from({ length: 251 }, (_, i) => i);
  const result = paginate(rows.length, 6);
  assert.deepEqual(rows.slice(result.start, result.end), [250]);
  assert.equal(rows.length, 251);
  assert.equal(result.total, 251);
  assert.equal(result.total_pages, 6);
});
