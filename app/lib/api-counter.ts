import type { ApiCounts } from "./health";

export type ApiOutcome = { ok: boolean; status: number | null };

/**
 * Upstream call tally for one request handler. Health must never be inferred from
 * the shape of parsed data alone: a route that silently swallowed three 429s and
 * returned nulls looks identical to a genuinely empty market unless the failures
 * are counted where they happen.
 */
export function createApiCounter() {
  const counts: ApiCounts = { requests: 0, succeeded: 0, failed: 0, rateLimited: 0 };
  return {
    record(outcome: ApiOutcome) {
      counts.requests += 1;
      if (outcome.ok) { counts.succeeded += 1; return; }
      counts.failed += 1;
      // Binance answers 429 for rate limits and 418 once an IP is banned for ignoring them.
      if (outcome.status === 429 || outcome.status === 418) counts.rateLimited += 1;
    },
    counts(): ApiCounts { return { ...counts }; },
  };
}

export type ApiCounter = ReturnType<typeof createApiCounter>;
