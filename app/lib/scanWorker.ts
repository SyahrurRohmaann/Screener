export function workerAllowed(env: Record<string, string | undefined>) {
  return env.NEXT_RUNTIME === "nodejs" && env.NODE_ENV !== "test" && !env.NODE_TEST_CONTEXT &&
    env.NEXT_PHASE !== "phase-production-build" && env.SCREENER_DISABLE_WORKER !== "1" &&
    Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export function singleFlight<T>(state: { pending?: Promise<T> }, run: () => Promise<T>): Promise<T> {
  return state.pending ??= Promise.resolve().then(run).finally(() => { state.pending = undefined; });
}

export function startScanLoop(scan: () => Promise<unknown>, schedule = (tick: () => void, ms: number) => {
  const timer = setInterval(tick, ms);
  timer.unref();
  return () => clearInterval(timer);
}) {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try { await scan(); } catch { console.warn("Background market scan failed"); }
    finally { running = false; }
  };
  void tick();
  const cancel = schedule(() => { void tick(); }, 30_000);
  return () => { stopped = true; cancel(); };
}
