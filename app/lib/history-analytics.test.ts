import test from "node:test";
import assert from "node:assert/strict";
import type { Evaluated } from "./evaluate";
import { analyzeHistory } from "./history-analytics";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 29);

function row(over: Partial<Evaluated> = {}): Evaluated {
  return {
    key: "x", coin: "BTC", sig: "LONG", score: 4, mode: "TREND",
    signal_closed_at: NOW - DAY, recorded_at: NOW - DAY, close: 100,
    entry: 100, stop: 99, tp1: 101, tp2: 102, risk_pct: 1,
    rsi: 50, trend_1h: "UP", atr_pct: 1.2, reasons: [], outcome: "TP1",
    r_multiple: 1, net_r: 0.9, bars_held: 2, exit_price: 101,
    resolved_at: NOW - DAY + 3_600_000, ...over,
  };
}

test("history analytics filters stored signals by inclusive date window and builds chronological net-R equity", () => {
  const rows = [
    row({ key: "new", signal_closed_at: NOW - DAY, net_r: -0.4 }),
    row({ key: "boundary", signal_closed_at: NOW - 30 * DAY, net_r: 0.7 }),
    row({ key: "old", signal_closed_at: NOW - 31 * DAY, net_r: 9 }),
    row({ key: "open", signal_closed_at: NOW - 2 * DAY, outcome: "OPEN", net_r: 0.3, resolved_at: null }),
  ];

  const result = analyzeHistory(rows, "30", NOW);

  assert.deepEqual(result.rows.map((r) => r.key), ["new", "open", "boundary"]);
  assert.deepEqual(result.equity_curve, [
    { key: "boundary", at: NOW - 30 * DAY, net_r: 0.7, equity_r: 0.7 },
    { key: "new", at: NOW - DAY, net_r: -0.4, equity_r: 0.3 },
  ]);
  assert.equal(result.range, "30");
  assert.equal(result.cutoff, NOW - 30 * DAY);
});

test("all range retains every stored signal and rejects unsupported ranges", () => {
  const rows = [row({ key: "old", signal_closed_at: NOW - 500 * DAY })];
  assert.equal(analyzeHistory(rows, "all", NOW).rows.length, 1);
  assert.throws(() => analyzeHistory(rows, "7" as never, NOW), /range/i);
});

test("analytics exposes deterministic ATR and 1h-trend breakdowns with a warning on every small bucket", () => {
  const rows = [
    row({ key: "low", atr_pct: 0.5, trend_1h: "UP" }),
    row({ key: "mid", atr_pct: 1.5, trend_1h: "DOWN", net_r: -1.1, outcome: "STOP" }),
    row({ key: "high", atr_pct: 2.5, trend_1h: "UP" }),
    row({ key: "unknown", atr_pct: null, trend_1h: "" }),
  ];
  const result = analyzeHistory(rows, "all", NOW);
  assert.deepEqual(result.by_atr.map((b) => b.bucket), ["<1%", "1–2%", "≥2%", "UNKNOWN"]);
  assert.deepEqual(result.by_trend_1h.map((b) => b.bucket), ["DOWN", "UNKNOWN", "UP"]);
  assert.ok(result.by_atr.every((b) => b.small_sample && b.warning.includes("30")));
  assert.ok(result.by_trend_1h.every((b) => b.small_sample && b.warning.includes("30")));
});

test("analytics reports outcome distribution and holding-time summary/distribution from resolved history only", () => {
  const rows = [
    row({ key: "a", outcome: "TP1", bars_held: 1 }),
    row({ key: "b", outcome: "TP2", bars_held: 3 }),
    row({ key: "c", outcome: "STOP", bars_held: 8, net_r: -1.1 }),
    row({ key: "d", outcome: "TIMEOUT", bars_held: 48, net_r: -0.1 }),
    row({ key: "e", outcome: "OPEN", bars_held: 20, net_r: null, resolved_at: null }),
  ];
  const result = analyzeHistory(rows, "all", NOW);
  assert.deepEqual(result.outcomes, [
    { outcome: "TP2", count: 1, pct: 20 },
    { outcome: "TP1", count: 1, pct: 20 },
    { outcome: "STOP", count: 1, pct: 20 },
    { outcome: "TIMEOUT", count: 1, pct: 20 },
    { outcome: "OPEN", count: 1, pct: 20 },
    { outcome: "UNKNOWN", count: 0, pct: 0 },
  ]);
  assert.deepEqual(result.holding, {
    count: 4, average_bars: 15, median_bars: 5.5, p90_bars: 48,
    average_hours: 7.5,
    distribution: [
      { bucket: "1–3", count: 2, pct: 50 },
      { bucket: "4–8", count: 1, pct: 25 },
      { bucket: "9–24", count: 0, pct: 0 },
      { bucket: "25–48", count: 1, pct: 25 },
      { bucket: ">48", count: 0, pct: 0 },
    ],
  });
});
