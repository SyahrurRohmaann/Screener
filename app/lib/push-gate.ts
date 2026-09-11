export type GateSignal = { key: string; coin: string; score: number; atr_pct: number | null | undefined };
export type GateDiagnostics = { overall: string; missingCoins?: string[]; candle?: { status?: string } };
export const PUSH_GATE = { minScore: 6, cooldownMs: 4 * 60 * 60 * 1000 };
export type GateResult = {
  allowed: GateSignal[];
  suppressed: { signal: GateSignal; reason: "LOW_SCORE" | "COOLDOWN" | "DATA_UNHEALTHY" }[];
};

export function toGateDiagnostics(value: unknown): GateDiagnostics | null {
  if (value == null) return null;
  const data = value as { overall?: unknown; missingCoins?: unknown; candle?: { status?: unknown; missingCoins?: unknown } };
  const missingCoins = [data.missingCoins, data.candle?.missingCoins]
    .flatMap((coins) => Array.isArray(coins) ? coins.filter((coin): coin is string => typeof coin === "string") : []);
  return {
    overall: typeof data.overall === "string" ? data.overall : "UNKNOWN",
    missingCoins,
    candle: { status: data.candle?.status === undefined ? undefined : String(data.candle.status) },
  };
}

export function gatePushSignals(input: {
  signals: GateSignal[]; diagnostics: GateDiagnostics | null | undefined;
  now: number; lastSentAt: Record<string, number>;
}): GateResult {
  const { signals, diagnostics, now, lastSentAt } = input;
  const unhealthy = diagnostics && (diagnostics.overall !== "OK" || diagnostics.missingCoins?.length ||
    (diagnostics.candle?.status !== undefined && diagnostics.candle.status !== "OK"));
  const result: GateResult = { allowed: [], suppressed: [] };
  for (const signal of signals) {
    const reason = unhealthy ? "DATA_UNHEALTHY"
      : signal.score < PUSH_GATE.minScore ? "LOW_SCORE"
      : now - (lastSentAt[signal.coin] ?? -Infinity) < PUSH_GATE.cooldownMs ? "COOLDOWN" : null;
    if (reason) result.suppressed.push({ signal, reason });
    else result.allowed.push(signal);
  }
  return result;
}
