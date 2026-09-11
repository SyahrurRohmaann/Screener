import type { Decision } from "./decision-journal";
import { summarize, type Evaluated } from "./evaluate";
import { analyzeHistory } from "./history-analytics";

export type WeeklyAction = { title: string; why: string; check: string };
export type WeeklyReview = {
  period_start: number; period_end: number;
  metrics: {
    closed: number; wr_pct: number | null; net_r: number; prev_net_r: number | null;
    avg_hold_bars: number | null;
    by_dir: { dir: "LONG" | "SHORT"; n: number; wr_pct: number | null; net_r: number }[];
    worst_bucket: { label: string; n: number; net_r: number } | null;
    top_skip_reason: { reason: string; n: number } | null;
    journal: { paper: number; watch: number; skip: number };
  };
  actions: WeeklyAction[];
};

const WEEK = 7 * 86_400_000;
// Match equity accumulation precision without using display rounding for rule thresholds.
const precise = (value: number) => Number(value.toFixed(12));
const round = (value: number) => Number(value.toFixed(1)) || 0;
const nullableRound = (value: number | null) => value == null ? null : round(value);
const closed = (row: Evaluated) => row.resolved_at != null && row.net_r != null &&
  ["TP1", "TP2", "STOP", "TIMEOUT"].includes(row.outcome);

export function buildWeeklyReview({ rows, decisions, now }: {
  rows: Evaluated[]; decisions: Decision[]; now: number;
}): WeeklyReview {
  const start = now - WEEK;
  // Adjacent windows do not overlap; signal creation time does not determine the review period.
  const current = rows.filter((row) => closed(row) && row.resolved_at! >= start && row.resolved_at! <= now);
  const previous = rows.filter((row) => closed(row) && row.resolved_at! >= start - WEEK && row.resolved_at! < start);
  const analytics = analyzeHistory(current, "all", now);
  const stats = analytics.stats;
  const directions = (["LONG", "SHORT"] as const).map((dir) => ({
    dir, stats: summarize(current.filter((row) => row.sig === dir)),
  }));
  const worst = [...analytics.by_atr, ...analytics.by_trend_1h]
    .sort((a, b) => precise(a.stats.net_r) - precise(b.stats.net_r) || String(a.bucket).localeCompare(String(b.bucket)))[0];
  const journalRows = decisions.filter((decision) => decision.decided_at >= start && decision.decided_at <= now);
  const journal = { paper: 0, watch: 0, skip: 0 };
  const reasons = new Map<string, number>();
  for (const decision of journalRows) {
    if (decision.action === "PAPER") journal.paper++;
    if (decision.action === "WATCH") journal.watch++;
    if (decision.action === "SKIP") {
      journal.skip++;
      reasons.set(decision.skip_reason, (reasons.get(decision.skip_reason) ?? 0) + 1);
    }
  }
  const top = Array.from(reasons).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const actions: WeeklyAction[] = [];
  if (stats.resolved < 5) actions.push({
    title: "KUMPULKAN SAMPEL, JANGAN SIMPULKAN",
    why: `Baru ${stats.resolved} trade selesai dalam 7 hari terakhir.`,
    check: "Minggu depan lanjutkan pencatatan PAPER/WATCH/SKIP; jangan menaikkan risiko dari sampel kecil.",
  });
  if (worst && precise(worst.stats.net_r) < 0 && worst.stats.resolved >= 5) actions.push({
    title: "PANTAU DAN TURUNKAN RISIKO BUCKET",
    why: `Bucket ${worst.bucket}: ${worst.stats.resolved} trade selesai, net ${worst.stats.net_r.toFixed(1)}R.`,
    check: `Minggu depan catat risiko dan hasil bucket ${worst.bucket}; uji risiko lebih kecil tanpa mengubah engine.`,
  });
  const positive = directions.find((item) => item.stats.resolved >= 5 && precise(item.stats.net_r) >= 3);
  const negative = directions.find((item) => item.stats.resolved >= 5 && precise(item.stats.net_r) <= -3);
  if (positive && negative) actions.push({
    title: "EKSEKUSI SELEKTIF PER ARAH",
    why: `${positive.dir}: ${positive.stats.net_r.toFixed(1)}R (${positive.stats.resolved} trade); ${negative.dir}: ${negative.stats.net_r.toFixed(1)}R (${negative.stats.resolved} trade).`,
    check: "Minggu depan catat alasan eksekusi dan risiko per arah di journal; jangan mengubah engine.",
  });
  const stopped = analytics.outcomes.filter((item) => item.outcome === "TIMEOUT" || item.outcome === "STOP")
    .reduce((sum, item) => sum + item.count, 0);
  if (stats.resolved >= 5 && stopped / stats.resolved >= 0.6) actions.push({
    title: "EVALUASI WAKTU ENTRY",
    why: `TIMEOUT/STOP ${stopped}/${stats.resolved} trade (${(stopped / stats.resolved * 100).toFixed(1)}%).`,
    check: "Minggu depan gunakan kartu keputusan dan catat verdict JANGAN KEJAR beserta outcome untuk menguji kualitas waktu entry.",
  });
  if (top && journal.skip >= 3) {
    const skippedKeys = new Set(journalRows.filter((decision) => decision.action === "SKIP" && decision.skip_reason === top[0])
      .map((decision) => decision.signal_key));
    const skipped = summarize(rows.filter((row) => skippedKeys.has(row.key) && closed(row) && row.resolved_at! <= now));
    actions.push({
      title: "UJI BUKTI ALASAN SKIP",
      why: `Alasan terbanyak ${top[0]}: ${top[1]} dari ${journal.skip} SKIP. ${skipped.resolved ? `Outcome tersedia: ${skipped.resolved} trade, net ${skipped.net_r.toFixed(1)}R.` : "Belum ada outcome selesai yang cocok."}`,
      check: `Minggu depan bandingkan outcome sinyal yang di-skip karena ${top[0]} dengan alasan awal; catat apakah alasan itu terbukti benar.`,
    });
  }
  if (!actions.length) actions.push({
    title: "PERTAHANKAN DISIPLIN CATAT JOURNAL",
    why: `Net ${stats.net_r.toFixed(1)}R dari ${stats.resolved} trade selesai; tidak ada temuan yang memenuhi ambang review.`,
    check: "Minggu depan lanjut catat keputusan dan outcome; pertahankan disiplin risiko tanpa menambah filter engine.",
  });
  return {
    period_start: start, period_end: now,
    metrics: {
      closed: stats.resolved, wr_pct: nullableRound(stats.win_rate), net_r: round(stats.net_r),
      prev_net_r: previous.length ? round(summarize(previous).net_r) : null,
      avg_hold_bars: nullableRound(analytics.holding.average_bars),
      by_dir: directions.map(({ dir, stats: side }) => ({ dir, n: side.resolved, wr_pct: nullableRound(side.win_rate), net_r: round(side.net_r) })),
      worst_bucket: worst ? { label: String(worst.bucket), n: worst.stats.resolved, net_r: round(worst.stats.net_r) } : null,
      top_skip_reason: top ? { reason: top[0], n: top[1] } : null,
      journal,
    },
    actions: actions.slice(0, 3),
  };
}
