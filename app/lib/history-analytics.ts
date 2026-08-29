import { groupBy, summarize, type Evaluated, type Stats } from "./evaluate";

export type HistoryRange = "30" | "60" | "90" | "all";
export type EquityPoint = { key: string; at: number; net_r: number; equity_r: number };
export type HistoryBucket = {
  bucket: string | number; stats: Stats; small_sample: boolean; warning: string;
};
export type OutcomeCount = { outcome: string; count: number; pct: number };
export type HoldingStats = {
  count: number; average_bars: number | null; median_bars: number | null;
  p90_bars: number | null; average_hours: number | null;
  distribution: { bucket: string; count: number; pct: number }[];
};

export type HistoryAnalytics = {
  range: HistoryRange; cutoff: number | null; rows: Evaluated[]; stats: Stats;
  equity_curve: EquityPoint[]; by_atr: HistoryBucket[]; by_trend_1h: HistoryBucket[];
  outcomes: OutcomeCount[]; holding: HoldingStats;
};

const DAY_MS = 86_400_000;
const RESOLVED = new Set(["TP1", "TP2", "STOP", "TIMEOUT"]);
const OUTCOMES = ["TP2", "TP1", "STOP", "TIMEOUT", "OPEN", "UNKNOWN"] as const;
const SMALL_SAMPLE_MIN = 30;

const pct = (count: number, total: number) => total ? Number(((count / total) * 100).toFixed(2)) : 0;
const atrBucket = (row: Evaluated) => row.atr_pct == null || !Number.isFinite(row.atr_pct)
  ? "UNKNOWN" : row.atr_pct < 1 ? "<1%" : row.atr_pct < 2 ? "1–2%" : "≥2%";
const withWarning = (bucket: string | number, stats: Stats): HistoryBucket => ({
  bucket, stats, small_sample: stats.resolved < SMALL_SAMPLE_MIN,
  warning: stats.resolved < SMALL_SAMPLE_MIN
    ? `Sampel kecil: ${stats.resolved}/${SMALL_SAMPLE_MIN} trade selesai; jangan tarik kesimpulan.` : "",
});

function bucketStats(rows: Evaluated[], key: (row: Evaluated) => string, order?: string[]) {
  const buckets = groupBy(rows, key).map(({ bucket, stats }) => withWarning(bucket, stats));
  return buckets.sort((a, b) => order
    ? order.indexOf(String(a.bucket)) - order.indexOf(String(b.bucket))
    : String(a.bucket).localeCompare(String(b.bucket)));
}

function holdingStats(rows: Evaluated[]): HoldingStats {
  const bars = rows.filter((row) => RESOLVED.has(row.outcome) && row.bars_held != null)
    .map((row) => row.bars_held!).sort((a, b) => a - b);
  const count = bars.length;
  const average = count ? bars.reduce((a, b) => a + b, 0) / count : null;
  const median = !count ? null : count % 2 ? bars[(count - 1) / 2] : (bars[count / 2 - 1] + bars[count / 2]) / 2;
  const p90 = count ? bars[Math.ceil(count * 0.9) - 1] : null;
  const defs: [string, (v: number) => boolean][] = [
    ["1–3", (v) => v <= 3], ["4–8", (v) => v >= 4 && v <= 8],
    ["9–24", (v) => v >= 9 && v <= 24], ["25–48", (v) => v >= 25 && v <= 48],
    [">48", (v) => v > 48],
  ];
  return {
    count, average_bars: average, median_bars: median, p90_bars: p90,
    average_hours: average == null ? null : average / 2,
    distribution: defs.map(([bucket, matches]) => {
      const n = bars.filter(matches).length;
      return { bucket, count: n, pct: pct(n, count) };
    }),
  };
}

export function analyzeHistory(rows: Evaluated[], range: HistoryRange, now = Date.now()): HistoryAnalytics {
  if (!["30", "60", "90", "all"].includes(range)) throw new Error(`Invalid history range: ${range}`);
  const cutoff = range === "all" ? null : now - Number(range) * DAY_MS;
  const filtered = rows.filter((row) => cutoff == null || row.signal_closed_at >= cutoff)
    .slice().sort((a, b) => b.signal_closed_at - a.signal_closed_at || a.key.localeCompare(b.key));
  let equity = 0;
  const equity_curve = filtered.filter((row) => row.net_r != null && RESOLVED.has(row.outcome))
    .slice().sort((a, b) => a.signal_closed_at - b.signal_closed_at || a.key.localeCompare(b.key))
    .map((row) => {
      equity = Number((equity + (row.net_r ?? 0)).toFixed(12));
      return { key: row.key, at: row.signal_closed_at, net_r: row.net_r!, equity_r: equity };
    });
  const outcomes = OUTCOMES.map((outcome) => {
    const count = filtered.filter((row) => row.outcome === outcome).length;
    return { outcome, count, pct: pct(count, filtered.length) };
  });
  return {
    range, cutoff, rows: filtered, stats: summarize(filtered), equity_curve,
    by_atr: bucketStats(filtered, atrBucket, ["<1%", "1–2%", "≥2%", "UNKNOWN"]),
    by_trend_1h: bucketStats(filtered, (row) => row.trend_1h?.trim() || "UNKNOWN"),
    outcomes, holding: holdingStats(filtered),
  };
}

export { groupBy };
