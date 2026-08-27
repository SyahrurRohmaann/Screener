import { candles, type Market } from "./indicators";
import type { SignalRecord } from "./store";

export type Outcome = "TP2" | "TP1" | "STOP" | "OPEN" | "TIMEOUT" | "UNKNOWN";

export type Evaluated = SignalRecord & {
  outcome: Outcome;
  r_multiple: number | null;   // gross, in units of risk
  net_r: number | null;        // after round-trip taker fee
  bars_held: number | null;
  exit_price: number | null;
  resolved_at: number | null;
};

/** Binance USDT-M taker fee, both sides. Overridable for VIP tiers. */
const FEE_ROUNDTRIP_PCT = Number(process.env.SCREENER_FEE_PCT ?? 0.1);
/** A 30m setup that resolves nothing within this many bars is treated as stale. */
const MAX_BARS = Number(process.env.SCREENER_EVAL_BARS ?? 48);

/**
 * Replays closed 30m candles after the signal candle.
 * Conservative on ambiguity: if a single candle touches both stop and target,
 * the stop is assumed to hit first. Intrabar sequence is unknowable from OHLC,
 * so this floors the result rather than flattering it.
 */
function replay(record: SignalRecord, market: Market): Evaluated {
  const start = market.t.findIndex((t) => t > record.signal_closed_at);
  const base: Evaluated = {
    ...record, outcome: "UNKNOWN", r_multiple: null, net_r: null,
    bars_held: null, exit_price: null, resolved_at: null,
  };
  if (start < 0) return { ...base, outcome: "OPEN", bars_held: 0 };

  const long = record.sig === "LONG";
  const risk = Math.abs(record.entry - record.stop);
  if (!(risk > 0)) return base;
  const feeR = (record.entry * (FEE_ROUNDTRIP_PCT / 100)) / risk;

  const settle = (outcome: Outcome, exit: number, i: number): Evaluated => {
    const gross = (long ? exit - record.entry : record.entry - exit) / risk;
    return {
      ...base, outcome, exit_price: exit, bars_held: i - start + 1,
      r_multiple: gross, net_r: gross - feeR, resolved_at: market.t[i],
    };
  };

  const limit = Math.min(market.t.length, start + MAX_BARS);
  for (let i = start; i < limit; i++) {
    const hitStop = long ? market.l[i] <= record.stop : market.h[i] >= record.stop;
    const hitTp2 = long ? market.h[i] >= record.tp2 : market.l[i] <= record.tp2;
    const hitTp1 = long ? market.h[i] >= record.tp1 : market.l[i] <= record.tp1;
    if (hitStop) return settle("STOP", record.stop, i);
    if (hitTp2) return settle("TP2", record.tp2, i);
    if (hitTp1) return settle("TP1", record.tp1, i);
  }

  const lastIndex = limit - 1;
  if (lastIndex < start) return { ...base, outcome: "OPEN", bars_held: 0 };
  const unresolved: Outcome = limit - start >= MAX_BARS ? "TIMEOUT" : "OPEN";
  const last = market.c[lastIndex];
  const gross = (long ? last - record.entry : record.entry - last) / risk;
  return {
    ...base, outcome: unresolved, exit_price: last, bars_held: lastIndex - start + 1,
    r_multiple: gross, net_r: gross - feeR,
    resolved_at: unresolved === "TIMEOUT" ? market.t[lastIndex] : null,
  };
}

export async function evaluate(records: SignalRecord[]): Promise<Evaluated[]> {
  const coins = Array.from(new Set(records.map((r) => r.coin)));
  const markets = new Map<string, Market | null>();
  await Promise.all(coins.map(async (coin) => {
    markets.set(coin, await candles(coin, "30m", 500));
  }));
  return records.map((record) => {
    const market = markets.get(record.coin);
    return market ? replay(record, market) : { ...record, outcome: "UNKNOWN" as Outcome, r_multiple: null, net_r: null, bars_held: null, exit_price: null, resolved_at: null };
  });
}

export type Stats = {
  total: number; resolved: number; open: number;
  wins: number; losses: number;
  win_rate: number | null;
  avg_win_r: number | null; avg_loss_r: number | null;
  expectancy_r: number | null; expectancy_net_r: number | null;
  profit_factor: number | null;
  gross_r: number; net_r: number;
  max_drawdown_r: number | null;
  fee_r_per_trade: number | null;
};

/** TIMEOUT counts as resolved: capital was committed and the setup ended flat-ish. */
export function summarize(rows: Evaluated[]): Stats {
  const resolved = rows.filter((r) => r.net_r != null && (r.outcome === "TP1" || r.outcome === "TP2" || r.outcome === "STOP" || r.outcome === "TIMEOUT"));
  const open = rows.filter((r) => r.outcome === "OPEN").length;
  const wins = resolved.filter((r) => (r.net_r ?? 0) > 0);
  const losses = resolved.filter((r) => (r.net_r ?? 0) <= 0);
  const grossR = resolved.reduce((a, r) => a + (r.r_multiple ?? 0), 0);
  const netR = resolved.reduce((a, r) => a + (r.net_r ?? 0), 0);
  const sumWin = wins.reduce((a, r) => a + (r.net_r ?? 0), 0);
  const sumLoss = Math.abs(losses.reduce((a, r) => a + (r.net_r ?? 0), 0));

  // Equity curve in chronological order for drawdown.
  const chrono = resolved.slice().sort((a, b) => a.signal_closed_at - b.signal_closed_at);
  let equity = 0, peak = 0, maxDd = 0;
  for (const r of chrono) {
    equity += r.net_r ?? 0;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  const feePerTrade = resolved.length
    ? resolved.reduce((a, r) => a + ((r.r_multiple ?? 0) - (r.net_r ?? 0)), 0) / resolved.length
    : null;

  return {
    total: rows.length, resolved: resolved.length, open,
    wins: wins.length, losses: losses.length,
    win_rate: resolved.length ? (wins.length / resolved.length) * 100 : null,
    avg_win_r: wins.length ? sumWin / wins.length : null,
    avg_loss_r: losses.length ? -sumLoss / losses.length : null,
    expectancy_r: resolved.length ? grossR / resolved.length : null,
    expectancy_net_r: resolved.length ? netR / resolved.length : null,
    profit_factor: sumLoss > 0 ? sumWin / sumLoss : null,
    gross_r: grossR, net_r: netR,
    max_drawdown_r: resolved.length ? maxDd : null,
    fee_r_per_trade: feePerTrade,
  };
}

export function groupBy<K extends string | number>(rows: Evaluated[], key: (r: Evaluated) => K) {
  const buckets = new Map<K, Evaluated[]>();
  for (const row of rows) {
    const k = key(row);
    const list = buckets.get(k);
    if (list) list.push(row); else buckets.set(k, [row]);
  }
  return Array.from(buckets.entries()).map(([bucket, list]) => ({ bucket, stats: summarize(list) }));
}
