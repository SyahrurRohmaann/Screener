export const LOGIN_LIMIT = { windowMs: 15 * 60_000, maxPerIp: 8, retryAfterMs: 60 * 1000 };
export type Guard = {
  check(ip: string, now: number): { ok: boolean; retryAfterSec?: number };
  record(ip: string, ok: boolean, now: number): void;
};

export function createLoginGuard(limit = LOGIN_LIMIT): Guard {
  const entries = new Map<string, number[]>();

  function prune(now: number) {
    entries.forEach((failures, ip) => {
      const live = failures.filter((time) => now - time < limit.windowMs);
      if (live.length) entries.set(ip, live);
      else entries.delete(ip);
    });
  }

  return {
    check(ip, now) {
      prune(now);
      const failures = entries.get(ip);
      if (!failures || failures.length < limit.maxPerIp) return { ok: true };
      const expires = failures[failures.length - limit.maxPerIp] + limit.windowMs;
      return { ok: false, retryAfterSec: Math.ceil(Math.max(limit.retryAfterMs, expires - now) / 1000) };
    },
    record(ip, ok, now) {
      prune(now);
      const failures = entries.get(ip) ?? [];
      entries.delete(ip);
      if (ok) return;
      // Reinsert so the first key is always the least recently failed IP.
      entries.set(ip, [...failures, now].slice(-limit.maxPerIp));
      if (entries.size > 500) entries.delete(entries.keys().next().value!);
    },
  };
}
