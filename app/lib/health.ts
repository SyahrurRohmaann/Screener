export const HEALTH_THRESHOLDS = {
  feedFreshMs: 5_000,
  feedStaleMs: 15_000,
  candleFreshMs: 35 * 60_000,
  candleStaleMs: 65 * 60_000,
  contextFreshMs: 90_000,
  contextStaleMs: 5 * 60_000,
  clockDriftWarnMs: 2_000,
  clockDriftBadMs: 10_000,
} as const;

export type HealthLevel = "OK" | "DEGRADED" | "STALE" | "BAD" | "UNKNOWN";
export type AgeKind = "feed" | "candle" | "context";
export type ApiCounts = { requests: number; succeeded: number; failed: number; rateLimited: number };

export function classifyAge(ageMs: number | null, kind: AgeKind): HealthLevel {
  if (ageMs == null || !Number.isFinite(ageMs) || ageMs < 0) return "UNKNOWN";
  const thresholds = kind === "feed"
    ? [HEALTH_THRESHOLDS.feedFreshMs, HEALTH_THRESHOLDS.feedStaleMs]
    : kind === "candle"
      ? [HEALTH_THRESHOLDS.candleFreshMs, HEALTH_THRESHOLDS.candleStaleMs]
      : [HEALTH_THRESHOLDS.contextFreshMs, HEALTH_THRESHOLDS.contextStaleMs];
  if (ageMs <= thresholds[0]) return "OK";
  if (ageMs <= thresholds[1]) return "DEGRADED";
  return "STALE";
}

export type ApiHealth = "OK" | "DEGRADED" | "RATE_LIMITED" | "DOWN" | "UNKNOWN";
export function classifyApi(counts: ApiCounts): ApiHealth {
  if (counts.requests <= 0) return "UNKNOWN";
  if (counts.rateLimited > 0) return "RATE_LIMITED";
  if (counts.succeeded <= 0) return "DOWN";
  if (counts.failed > 0 || counts.succeeded < counts.requests) return "DEGRADED";
  return "OK";
}

export type AlignmentHealth = "OK" | "PARTIAL" | "MISALIGNED" | "UNKNOWN";
export function classifyAlignment(closeTimes: number[], expected: number): AlignmentHealth {
  if (!closeTimes.length || expected <= 0) return "UNKNOWN";
  if (closeTimes.length < expected) return "PARTIAL";
  return new Set(closeTimes).size === 1 ? "OK" : "MISALIGNED";
}

export type ClockHealth = "OK" | "DEGRADED" | "BAD" | "UNKNOWN";
export function classifyClockDrift(driftMs: number | null): ClockHealth {
  if (driftMs == null || !Number.isFinite(driftMs)) return "UNKNOWN";
  const drift = Math.abs(driftMs);
  if (drift <= HEALTH_THRESHOLDS.clockDriftWarnMs) return "OK";
  if (drift <= HEALTH_THRESHOLDS.clockDriftBadMs) return "DEGRADED";
  return "BAD";
}

export function overallHealth(levels: string[]): "OK" | "DEGRADED" | "BAD" | "UNKNOWN" {
  if (levels.some((x) => ["BAD", "STALE", "DOWN", "RATE_LIMITED", "MISALIGNED"].includes(x))) return "BAD";
  if (levels.some((x) => ["DEGRADED", "PARTIAL"].includes(x))) return "DEGRADED";
  if (levels.some((x) => x === "UNKNOWN")) return "UNKNOWN";
  return levels.length && levels.every((x) => x === "OK") ? "OK" : "UNKNOWN";
}
