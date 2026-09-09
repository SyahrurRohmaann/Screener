export function signalStatus(ageMin: number, conditionsHold: boolean, invalidated = false, displaced = false) {
  if (invalidated) return "INVALIDATED";
  if (!Number.isFinite(ageMin) || ageMin > 30) return "EXPIRED";
  if (!conditionsHold || displaced) return "WEAKENING";
  return ageMin <= 5 ? "NEW" : ageMin <= 15 ? "VALID" : "WEAKENING";
}

export function isMarketStale(ts: number | null, now: number) {
  return ts == null || !Number.isFinite(ts) || now - ts > 300_000;
}
