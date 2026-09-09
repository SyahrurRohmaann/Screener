export async function register() {
  if (process.env.NEXT_PHASE === "phase-production-build" ||
      process.env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT || process.env.SCREENER_DISABLE_WORKER === "1" ||
      !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { workerAllowed, startScanLoop } = await import("./app/lib/scanWorker");
    if (!workerAllowed(process.env)) return;
    const state = globalThis as typeof globalThis & { screenerWorker?: () => void };
    if (state.screenerWorker) return;
    const { scanMarket } = await import("./app/lib/marketScan");
    state.screenerWorker = startScanLoop(scanMarket);
  }
}
