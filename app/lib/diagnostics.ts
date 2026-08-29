import {
  classifyAge,
  classifyAlignment,
  classifyApi,
  classifyClockDrift,
  overallHealth,
  type ApiCounts,
} from "./health";

export type HistoryWriteOutcome = {
  status: "OK" | "SKIPPED" | "ERROR";
  added: number;
  error?: "write_failed";
};

type MarketInput = {
  now: number;
  expectedCoins: string[];
  rows: Array<{ coin: string; candleClosedAt: number }>;
  api: ApiCounts;
  historyWrite: HistoryWriteOutcome;
  serverTimeMs: number | null;
};

export function buildMarketDiagnostics(input: MarketInput) {
  const closeTimes = input.rows.map((row) => row.candleClosedAt).filter(Number.isFinite);
  const latestClosedAt = closeTimes.length ? Math.max(...closeTimes) : null;
  const ageMs = latestClosedAt == null ? null : Math.max(0, input.now - latestClosedAt);
  const available = new Set(input.rows.map((row) => row.coin));
  const missingCoins = input.expectedCoins.filter((coin) => !available.has(coin));
  const alignment = classifyAlignment(closeTimes, input.expectedCoins.length);
  const candleStatus = classifyAge(ageMs, "candle");
  const apiStatus = classifyApi(input.api);
  const driftMs = input.serverTimeMs == null ? null : input.now - input.serverTimeMs;
  const clockStatus = classifyClockDrift(driftMs);
  const historyStatus = input.historyWrite.status === "ERROR" ? "DEGRADED" : input.historyWrite.status === "SKIPPED" ? "UNKNOWN" : "OK";
  return {
    overall: overallHealth([candleStatus, alignment, apiStatus, historyStatus, clockStatus]),
    generatedAt: input.now,
    candle: {
      status: candleStatus,
      latestClosedAt,
      ageMs,
      interval: "30m" as const,
      alignment,
      availableCoins: input.rows.length,
      expectedCoins: input.expectedCoins.length,
      ...(missingCoins.length ? { missingCoins } : {}),
    },
    api: { status: apiStatus, ...input.api },
    historyWrite: input.historyWrite,
    clock: { status: clockStatus, driftMs, source: input.serverTimeMs == null ? null : "binance-time" as const },
  };
}

type ContextValue = { coin: string; funding: number | null; oi_chg: number | null; ls_ratio: number | null; taker: number | null };
export function buildContextDiagnostics(input: { now: number; expectedCoins: string[]; values: ContextValue[]; api: ApiCounts }) {
  const expectedFields = input.expectedCoins.length * 4;
  const availableFields = input.values.reduce((sum, row) => sum + [row.funding, row.oi_chg, row.ls_ratio, row.taker].filter((x) => x != null && Number.isFinite(x)).length, 0);
  const availableCoins = input.values.filter((row) => [row.funding, row.oi_chg, row.ls_ratio, row.taker].some((x) => x != null && Number.isFinite(x))).length;
  const apiStatus = classifyApi(input.api);
  const coverageStatus = availableFields === expectedFields ? "OK" : availableFields > 0 ? "DEGRADED" : "DOWN";
  return {
    status: overallHealth([apiStatus, coverageStatus]),
    observedAt: input.now,
    ageMs: 0,
    api: { status: apiStatus, ...input.api },
    coverage: { availableFields, expectedFields, availableCoins, expectedCoins: input.expectedCoins.length },
  };
}

export type MarketDiagnostics = ReturnType<typeof buildMarketDiagnostics>;
export type ContextDiagnostics = ReturnType<typeof buildContextDiagnostics>;

type PriceInput = {
  now: number;
  expectedCoins: string[];
  prices: Record<string, number>;
  sourceTs: number | null;
  api: ApiCounts;
};

/**
 * Mark-price freshness is measured against the exchange's own stamp, not against
 * the moment the response arrived: a cached or frozen premiumIndex answer arrives
 * instantly while carrying a timestamp minutes old.
 */
export function buildPriceDiagnostics(input: PriceInput) {
  const available = Object.keys(input.prices).filter((coin) => Number.isFinite(input.prices[coin]));
  const missingCoins = input.expectedCoins.filter((coin) => !available.includes(coin));
  const ageMs = input.sourceTs == null || !Number.isFinite(input.sourceTs)
    ? null
    : Math.max(0, input.now - input.sourceTs);
  const feedStatus = classifyAge(ageMs, "feed");
  const apiStatus = classifyApi(input.api);
  const coverageStatus = !input.expectedCoins.length
    ? "UNKNOWN"
    : missingCoins.length === 0 ? "OK" : available.length ? "PARTIAL" : "DOWN";
  return {
    status: overallHealth([feedStatus, apiStatus, coverageStatus]),
    observedAt: input.now,
    feed: { status: feedStatus, sourceTs: input.sourceTs, ageMs, transport: "rest-poll" as const },
    api: { status: apiStatus, ...input.api },
    coverage: {
      availableCoins: available.length,
      expectedCoins: input.expectedCoins.length,
      ...(missingCoins.length ? { missingCoins } : {}),
    },
  };
}

export type PriceDiagnostics = ReturnType<typeof buildPriceDiagnostics>;

export type DataHealthItem = {
  key: "candle" | "api" | "context" | "price" | "history" | "clock";
  label: string;
  status: string;
  detail: string;
};

function ageText(ageMs: number | null): string {
  if (ageMs == null) return "umur tidak diketahui";
  if (ageMs < 1_000) return "baru saja";
  if (ageMs < 90_000) return `${Math.round(ageMs / 1_000)}s lalu`;
  return `${Math.round(ageMs / 60_000)}m lalu`;
}

/**
 * Collapses the three route payloads into one fixed list of six rows. The rows are
 * always present in the same order even when a payload has not arrived yet, so a
 * missing source shows as UNKNOWN instead of quietly disappearing from the panel.
 */
export function summarizeDataHealth(input: {
  market: MarketDiagnostics | null;
  context: ContextDiagnostics | null;
  price: PriceDiagnostics | null;
}) {
  const { market, context, price } = input;
  const items: DataHealthItem[] = [
    {
      key: "candle", label: "CANDLE 30M",
      status: market?.candle.status ?? "UNKNOWN",
      detail: market
        ? `${market.candle.availableCoins}/${market.candle.expectedCoins} coin · ${ageText(market.candle.ageMs)} · align ${market.candle.alignment}${market.candle.missingCoins?.length ? ` · hilang ${market.candle.missingCoins.join(", ")}` : ""}`
        : "menunggu /api/market",
    },
    {
      key: "api", label: "BINANCE API",
      status: market?.api.status ?? "UNKNOWN",
      detail: market
        ? `${market.api.succeeded}/${market.api.requests} sukses · gagal ${market.api.failed} · rate-limit ${market.api.rateLimited}`
        : "menunggu /api/market",
    },
    {
      key: "context", label: "KONTEKS DERIVATIF",
      status: context?.status ?? "UNKNOWN",
      detail: context
        ? `${context.coverage.availableFields}/${context.coverage.expectedFields} field · ${context.coverage.availableCoins}/${context.coverage.expectedCoins} coin`
        : "menunggu /api/context",
    },
    {
      key: "price", label: "MARK PRICE",
      status: price?.feed.status ?? "UNKNOWN",
      detail: price
        ? `${price.coverage.availableCoins}/${price.coverage.expectedCoins} coin · stamp ${ageText(price.feed.ageMs)}`
        : "menunggu /api/price",
    },
    {
      key: "history", label: "TULIS HISTORY",
      status: market ? (market.historyWrite.status === "ERROR" ? "BAD" : market.historyWrite.status === "SKIPPED" ? "UNKNOWN" : "OK") : "UNKNOWN",
      detail: market
        ? market.historyWrite.status === "ERROR"
          ? "gagal menulis signals.jsonl — volume read-only atau penuh"
          : market.historyWrite.status === "SKIPPED"
            ? "tidak ada sinyal baru untuk dicatat"
            : `${market.historyWrite.added} sinyal dicatat`
        : "menunggu /api/market",
    },
    {
      key: "clock", label: "CLOCK DRIFT",
      status: market?.clock.status ?? "UNKNOWN",
      detail: market && market.clock.driftMs != null
        ? `${market.clock.driftMs > 0 ? "+" : ""}${Math.round(market.clock.driftMs)}ms vs ${market.clock.source ?? "upstream"}`
        : "waktu server upstream tidak terbaca",
    },
  ];
  return { overall: overallHealth(items.map((item) => item.status)), items };
}
