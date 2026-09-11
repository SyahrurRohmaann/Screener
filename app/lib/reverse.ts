import { candles, type Market } from "./indicators";
import { summarize, type Evaluated, type Outcome } from "./evaluate";
import type { SignalRecord } from "./store";
import type { HistoryRange } from "./history-analytics";
import type { Plan } from "./format";

export function reverseSide<T extends "LONG" | "SHORT" | "WAIT">(side: T): T extends "WAIT" ? "WAIT" : "LONG" | "SHORT";
export function reverseSide(side: "LONG" | "SHORT" | "WAIT"): "LONG" | "SHORT" | "WAIT" {
  return side === "LONG" ? "SHORT" : side === "SHORT" ? "LONG" : "WAIT";
}

export function mirrorPlan(plan: Plan, pivot: number): Plan {
  // Reflection reverses interval order. Entry stays at pivot, so
  // |(2E - stop) - E| = |stop - E| preserves risk_pct and reward/risk.
  return { ...plan, entry_low: 2 * pivot - plan.entry_high,
    entry_high: 2 * pivot - plan.entry_low, invalidation: 2 * pivot - plan.invalidation,
    tp1: 2 * pivot - plan.tp1, tp2: 2 * pivot - plan.tp2 };
}

export function reverseRecord(record: SignalRecord): SignalRecord {
  // Reflection preserves each original percentage distance from the same entry.
  return { ...record, sig: record.sig === "LONG" ? "SHORT" : "LONG",
    stop: 2 * record.entry - record.stop, tp1: 2 * record.entry - record.tp1,
    tp2: 2 * record.entry - record.tp2,
    mode: record.mode === "TREND" ? "COUNTER" : record.mode === "COUNTER" ? "TREND" : null };
}

export function replayPaper(record: SignalRecord, market: Market | null, feePct: number, maxBars: number): Evaluated {
  const base: Evaluated = { ...record, outcome: "UNKNOWN", r_multiple: null, net_r: null,
    bars_held: null, exit_price: null, resolved_at: null };
  const risk = Math.abs(record.entry - record.stop);
  const long = record.sig === "LONG";
  if (!market || !Number.isFinite(feePct) || feePct < 0 || !Number.isInteger(maxBars) || maxBars < 1
    || ![record.entry, record.stop, record.tp1, record.tp2, risk].every(v => Number.isFinite(v) && v > 0)
    || !(long ? record.stop < record.entry && record.tp1 > record.entry && record.tp2 > record.tp1
      : record.stop > record.entry && record.tp1 < record.entry && record.tp2 < record.tp1)) return base;
  const signalIndex = market.t.indexOf(record.signal_closed_at);
  if (signalIndex < 0) return base;
  const start = signalIndex + 1;
  const limit = Math.min(market.t.length, start + maxBars);
  const settle = (outcome: Outcome, price: number, i: number): Evaluated => {
    const gross = (long ? price - record.entry : record.entry - price) / risk;
    return { ...base, outcome, exit_price: price, bars_held: i - start + 1,
      r_multiple: gross, net_r: gross - record.entry * feePct / 100 / risk,
      resolved_at: outcome === "OPEN" ? null : market.t[i] };
  };
  for (let i = start; i < limit; i++) {
    if (market.t[i] !== market.t[i - 1] + 1_800_000
      || ![market.h[i], market.l[i], market.c[i]].every(v => Number.isFinite(v) && v > 0)
      || market.l[i] > market.h[i] || market.c[i] < market.l[i] || market.c[i] > market.h[i]) return base;
    if (long ? market.l[i] <= record.stop : market.h[i] >= record.stop) return settle("STOP", record.stop, i);
    if (long ? market.h[i] >= record.tp2 : market.l[i] <= record.tp2) return settle("TP2", record.tp2, i);
    if (long ? market.h[i] >= record.tp1 : market.l[i] <= record.tp1) return settle("TP1", record.tp1, i);
  }
  return limit === start ? { ...base, outcome: "OPEN", bars_held: 0 }
    : settle(limit - start >= maxBars ? "TIMEOUT" : "OPEN", market.c[limit - 1], limit - 1);
}

export async function compareReverse(records: SignalRecord[], range: HistoryRange, now = Date.now()) {
  const fee_pct = Number(process.env.SCREENER_FEE_PCT ?? 0.1);
  const max_bars = Number(process.env.SCREENER_EVAL_BARS ?? 48);
  const filtered = records.filter(r => range === "all" || r.signal_closed_at >= now - Number(range) * 86_400_000)
    .sort((a, b) => b.signal_closed_at - a.signal_closed_at || a.key.localeCompare(b.key));
  const markets = new Map<string, Market | null>();
  await Promise.all(Array.from(new Set(filtered.map(r => r.coin))).map(async coin => {
    try { markets.set(coin, await candles(coin, "30m", 500)); } catch { markets.set(coin, null); }
  }));
  const rows = filtered.map(record => {
    const market = markets.get(record.coin) ?? null;
    const original = replayPaper(record, market, fee_pct, max_bars);
    const reverse = replayPaper(reverseRecord(record), market, fee_pct, max_bars);
    // Incomplete coverage on either leg excludes both, keeping a paired sample.
    if (original.outcome === "UNKNOWN" || reverse.outcome === "UNKNOWN") {
      return { original: replayPaper(record, null, fee_pct, max_bars),
        reverse: replayPaper(reverseRecord(record), null, fee_pct, max_bars) };
    }
    return { original, reverse };
  });
  const aggregate = (side: "original" | "reverse") => {
    const evaluated = rows.map(row => row[side]);
    return { stats: summarize(evaluated), outcomes: (["TP2", "TP1", "STOP", "TIMEOUT", "OPEN", "UNKNOWN"] as Outcome[])
      .map(outcome => ({ outcome, count: evaluated.filter(row => row.outcome === outcome).length })) };
  };
  return { ts: now, range, evidence: "RETROSPECTIVE_REPLAY" as const, fee_pct, max_bars,
    total: rows.length, original: aggregate("original"), reverse: aggregate("reverse"), rows: rows.slice(0, 120) };
}

export async function compareOriginal(records: SignalRecord[], range: HistoryRange, now = Date.now()) {
  // The stored ledger is reversed. Restore ORI and reuse the same candle replay,
  // including its conservative paired-coverage checks, without changing that engine.
  const { reverse: _reverse, rows, ...result } = await compareReverse(records.map(reverseRecord), range, now);
  return { ...result, rows: rows.map(({ original }) => ({ original })) };
}
