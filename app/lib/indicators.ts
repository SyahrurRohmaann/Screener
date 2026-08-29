export type Candle = [number, string, string, string, string, string, number];
export type Market = { o: number[]; h: number[]; l: number[]; c: number[]; v: number[]; t: number[] };

export const BINANCE = process.env.BINANCE_FAPI_URL ?? "https://fapi.binance.com";

/**
 * Optional tally so a route can report how many upstream calls actually
 * succeeded. Without it, a swallowed 429 is indistinguishable from real data.
 */
export type UpstreamCounter = { record(outcome: { ok: boolean; status: number | null }): void };

export async function getJson<T>(path: string, counter?: UpstreamCounter): Promise<T | null> {
  try {
    const response = await fetch(`${BINANCE}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json" },
    });
    counter?.record({ ok: response.ok, status: response.status });
    return response.ok ? await response.json() as T : null;
  } catch {
    // Timeout, DNS failure, or a body that is not JSON — all upstream failures.
    counter?.record({ ok: false, status: null });
    return null;
  }
}

export function ema(values: number[], period: number) {
  const out = Array<number>(values.length).fill(Number.NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  out[period - 1] = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k);
  return out;
}

export function sma(values: number[], period: number) {
  const out = Array<number>(values.length).fill(Number.NaN);
  for (let i = period - 1; i < values.length; i++) {
    out[i] = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  }
  return out;
}

export function rsi(close: number[], period = 14) {
  const out = Array<number>(close.length).fill(Number.NaN);
  const changes = close.slice(1).map((x, i) => x - close[i]);
  if (changes.length < period) return out;
  let gain = changes.slice(0, period).reduce((a, x) => a + Math.max(x, 0), 0) / period;
  let loss = changes.slice(0, period).reduce((a, x) => a + Math.max(-x, 0), 0) / period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < close.length; i++) {
    const change = changes[i - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function atr(data: Market, period = 14) {
  const tr: number[] = [];
  for (let i = 1; i < data.c.length; i++) {
    tr.push(Math.max(
      data.h[i] - data.l[i],
      Math.abs(data.h[i] - data.c[i - 1]),
      Math.abs(data.l[i] - data.c[i - 1]),
    ));
  }
  if (tr.length < period) return NaN;
  return tr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

/** Only closed candles: Binance returns the in-progress candle as the last element. */
export async function candles(symbol: string, interval: string, limit: number, counter?: UpstreamCounter): Promise<Market | null> {
  const data = await getJson<Candle[]>(`/fapi/v1/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`, counter);
  if (!data?.length) return null;
  const closed = data.filter((x) => Number(x[6]) <= Date.now());
  return {
    o: closed.map((x) => Number(x[1])), h: closed.map((x) => Number(x[2])),
    l: closed.map((x) => Number(x[3])), c: closed.map((x) => Number(x[4])),
    v: closed.map((x) => Number(x[5])), t: closed.map((x) => Number(x[6])),
  };
}
