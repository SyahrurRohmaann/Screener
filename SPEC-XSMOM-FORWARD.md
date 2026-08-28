# Frozen Specification — XSMOM Forward Experiment

Canonical specification (everything between `BEGIN CANONICAL` and `END CANONICAL`) is frozen before the first snapshot.

<!-- BEGIN CANONICAL -->
- Universe (fixed): BTC, ETH, SOL, XRP, BNB, DOGE, ADA, AVAX, LINK, DOT, LTC, TRX, ATOM, NEAR, FIL, ETC.
- Data: Binance USD-M; exactly 1,000 closed 4h candles per asset; all 16 timestamps aligned.
- Formation: Monday 08:00 UTC (default; `RANKING_WEEKDAY=1`, `RANKING_HOUR_UTC=8` are documented configuration but MUST be frozen here before the first snapshot). Formation window is 30 minutes.
- Lookback: close-to-close 14 days, index i versus i-84, using closed candles only.
- Selection: deterministic top-4 LONG, equal-weight 25% each; alphabetical tie-break.
- Paper execution: entry at next 4h open; exit/rebalance at next Monday 08:00 UTC open; 100% gross, 1x, no leverage.
- Baseline: no price stop. Operational/data kill switch only. No real-money permission.
- Breadth: percent of 16 closes above EMA200, descriptive context only; never a gate.
- Benchmark: equal-weight all 16 with the same execution timestamps.
- Primary metric: one weekly portfolio excess return, top-4 minus benchmark.
- Technical 30m/1h confluence remains independent: no filtering, timing, weighting, closing, or blended score.
- Snapshot: append-only immutable JSONL; no backfill. A missed formation is MISSED; incomplete input is INVALID/INCOMPLETE and never OPEN.
- Checkpoints: 12 operational audit; 26 direction/data quality only; 52 initial evaluation; 104 advanced evaluation, never a guarantee.
- No tuning of universe, lookback, selection, breadth thresholds, schedule, or accounting after first snapshot. A new hypothesis requires a new spec hash and experiment.
- Product status remains `EKSPERIMEN FORWARD — BELUM CUKUP DATA` until future criteria are met.
<!-- END CANONICAL -->

Risks shown in product: fixed-current-universe survivorship bias; all history was viewed; late 63 weeks lost 33.9%; historical max drawdown approximately 70%; breadth gate unvalidated; one observation per week; paper fills differ from real fills; past performance is no guarantee.

Canonical SHA-256: `02abfad675d23211de4af3f39c5bc011f465e5926a1337f635d178539d6ef48a`
