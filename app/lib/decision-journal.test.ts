import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendDecision,
  mutationIsSameOrigin,
  readDecisions,
  type DecisionInput,
} from "./decision-journal";

const signal = {
  key: "BTC-1725000000000",
  coin: "BTC",
  sig: "LONG" as const,
  signal_closed_at: 1725000000000,
  score: 5,
  mode: "TREND" as const,
  close: 60000,
  entry_low: 59800,
  entry_high: 60000,
  invalidation: 59000,
  tp1: 61000,
  tp2: 62000,
  risk_pct: 1.67,
  rsi: 42,
  trend_1h: "BULL",
  atr_pct: 1.2,
  reasons: ["harga>EMA50"],
};

async function withDataDir(work: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "decision-journal-"));
  const previous = process.env.SCREENER_DATA_DIR;
  process.env.SCREENER_DATA_DIR = dir;
  try { await work(dir); }
  finally {
    if (previous === undefined) delete process.env.SCREENER_DATA_DIR;
    else process.env.SCREENER_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

const paper = (actual_entry: number, actual_risk_pct: number): DecisionInput => ({ signal, action: "PAPER", actual_entry, actual_risk_pct });
const watch = (): DecisionInput => ({ signal, action: "WATCH" });
const skip = (skip_reason: "RISK_TOO_HIGH" | "LATE" | "STRUCTURE_UNCLEAR" | "EVENT_RISK" | "OTHER", note?: string): DecisionInput => ({ signal, action: "SKIP", skip_reason, note });

test("PAPER records immutable signal evidence plus actual entry and risk", async () => {
  await withDataDir(async (dir) => {
    const saved = await appendDecision(paper(59950, 0.75), 1725001234567);
    assert.equal(saved.decided_at, 1725001234567);
    assert.equal(saved.action, "PAPER");
    assert.equal(saved.actual_entry, 59950);
    assert.equal(saved.actual_risk_pct, 0.75);
    assert.deepEqual(saved.signal, signal);

    const disk = await readFile(join(dir, "signal-decisions.jsonl"), "utf8");
    assert.deepEqual(JSON.parse(disk.trim()), saved);
    assert.deepEqual(await readDecisions(), [saved]);
  });
});

test("PANTAU records no invented fill or trade outcome", async () => {
  await withDataDir(async () => {
    const saved = await appendDecision(watch(), 1725001234567);
    assert.equal(saved.action, "WATCH");
    assert.equal("actual_entry" in saved, false);
    assert.equal("outcome" in saved, false);
  });
});

test("LEWATI requires a bounded reason choice and preserves a free note", async () => {
  await withDataDir(async () => {
    await assert.rejects(() => appendDecision({ signal, action: "SKIP" } as DecisionInput, 1), /alasan/i);
    const saved = await appendDecision(skip("RISK_TOO_HIGH", "Dekat resistance harian"), 2);
    assert.equal(saved.action, "SKIP");
    if (saved.action !== "SKIP") throw new Error("expected SKIP");
    assert.equal(saved.skip_reason, "RISK_TOO_HIGH");
    assert.equal(saved.note, "Dekat resistance harian");
  });
});

test("invalid or mutable signal identity and invalid PAPER values are rejected", async () => {
  await withDataDir(async () => {
    await assert.rejects(() => appendDecision({ ...watch(), signal: { ...signal, key: "ETH-wrong" } }, 1), /identitas/i);
    await assert.rejects(() => appendDecision(paper(0, -1), 1), /entry/i);
  });
});

test("a signal can only receive one initial decision", async () => {
  await withDataDir(async () => {
    await appendDecision(watch(), 1);
    await assert.rejects(() => appendDecision(skip("OTHER"), 2), /sudah/i);
  });
});

test("journal reads newest first and can filter by action and coin", async () => {
  await withDataDir(async () => {
    await appendDecision(watch(), 1);
    await appendDecision({ ...skip("LATE"), signal: { ...signal, key: "ETH-1725000000001", coin: "ETH", signal_closed_at: 1725000000001 } }, 2);
    assert.deepEqual((await readDecisions()).map((x) => x.signal.coin), ["ETH", "BTC"]);
    assert.deepEqual((await readDecisions({ action: "WATCH" })).map((x) => x.signal.coin), ["BTC"]);
    assert.deepEqual((await readDecisions({ coin: "eth" })).map((x) => x.signal.coin), ["ETH"]);
  });
});

test("mutation origin must exactly match the request host", () => {
  assert.equal(mutationIsSameOrigin(new Request("https://app.test/api/decisions", { headers: { origin: "https://app.test", host: "app.test" } })), true);
  assert.equal(mutationIsSameOrigin(new Request("https://app.test/api/decisions", { headers: { origin: "https://evil.test", host: "app.test" } })), false);
  assert.equal(mutationIsSameOrigin(new Request("https://app.test/api/decisions", { headers: { host: "app.test" } })), false);
});
