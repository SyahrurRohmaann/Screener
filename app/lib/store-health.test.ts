import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordSignals, resetHistoryCache } from "./store";

function record(key: string) {
  return {
    key, coin: "BTC", sig: "LONG" as const, score: 5, mode: "TREND" as const,
    signal_closed_at: 1_800_000_000_000, recorded_at: 1_800_000_001_000,
    close: 60_000, entry: 60_000, stop: 59_000, tp1: 61_000, tp2: 62_000,
    risk_pct: 1.6, rsi: 55, trend_1h: "BULL", atr_pct: 0.8, reasons: ["candle bullish"],
  };
}

test("a successful append reports OK with the number of new records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screener-store-"));
  process.env.SCREENER_DATA_DIR = dir;
  resetHistoryCache();

  const first = await recordSignals([record("BTC-1"), record("BTC-2")]);
  assert.deepEqual(first, { status: "OK", added: 2 });

  const again = await recordSignals([record("BTC-1")]);
  assert.deepEqual(again, { status: "SKIPPED", added: 0 });

  const raw = await readFile(join(dir, "signals.jsonl"), "utf8");
  assert.equal(raw.trim().split("\n").length, 2);
});

test("nothing to write is SKIPPED, not a silent success", async () => {
  assert.deepEqual(await recordSignals([]), { status: "SKIPPED", added: 0 });
});

test("an unwritable data dir surfaces ERROR instead of pretending it wrote", async () => {
  // /dev/null is a file, so mkdir of a child fails with ENOTDIR — a stand-in for a
  // read-only or missing volume mount.
  process.env.SCREENER_DATA_DIR = "/dev/null/screener-cannot-write";
  resetHistoryCache();
  assert.deepEqual(await recordSignals([record("BTC-3")]), { status: "ERROR", added: 0, error: "write_failed" });
});
