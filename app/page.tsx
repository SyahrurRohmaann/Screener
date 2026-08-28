"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Chart from "./components/Chart";
import History from "./components/History";
import RiskCalculator from "./components/RiskCalculator";
import type { Row } from "./lib/format";
import { age, liveStatus, money, num, pct } from "./lib/format";

const COINS = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "AVAX", "LINK", "DOT"];
const demo: Row[] = COINS.slice(0, 3).map((coin) => ({
  coin, price: 0, score: 0, rsi: 50, trend_1h: "BULL", status: "NONE",
}));

const SIDES = ["ALL", "LONG", "SHORT"] as const;
const MODES = ["ALL", "TREND", "COUNTER"] as const;

export default function Home() {
  const [rows, setRows] = useState<Row[]>(demo);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [side, setSide] = useState<(typeof SIDES)[number]>("ALL");
  const [mode, setMode] = useState<(typeof MODES)[number]>("ALL");
  const [minScore, setMinScore] = useState(0);
  const [hideStale, setHideStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const [chartCoin, setChartCoin] = useState<string | null>(null);
  // "WS" once a frame actually arrives; "POLL" while the REST fallback drives prices.
  const [feed, setFeed] = useState<"WS" | "POLL" | "OFF">("OFF");
  const [tick, setTick] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/market", { cache: "no-store" });
      const data = await response.json();
      setRows(data.rows ?? demo);
      setUpdated(new Date());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const indicators = setInterval(load, 60000);
    const context = setInterval(async () => {
      try {
        const response = await fetch("/api/context", { cache: "no-store" });
        const data = await response.json();
        setRows((cur) => cur.map((r) => ({ ...r, ...(data[r.coin] ?? {}) })));
      } catch {}
    }, 20000);

    // Mark price: prefer the websocket, but never depend on it. Some networks and
    // browsers complete the upgrade to fstream and then deliver zero frames, which
    // silently freezes the price. Polling starts immediately and only stops once a
    // real frame lands; if the socket goes quiet again, polling resumes.
    let lastFrame = 0;
    let closed = false;
    let socket: WebSocket | null = null;

    const applyPrices = (prices: Record<string, number>) => {
      setRows((cur) => cur.map((r) => (prices[r.coin] ? { ...r, price: prices[r.coin] } : r)));
      setTick(new Date());
    };

    const poll = async () => {
      if (closed || Date.now() - lastFrame < 5000) return;
      try {
        const response = await fetch("/api/price", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (closed || Date.now() - lastFrame < 5000) return;
        applyPrices(data.prices ?? {});
        setFeed("POLL");
      } catch {}
    };

    poll();
    const prices = setInterval(poll, 3000);

    try {
      const streams = COINS.map((c) => `${c.toLowerCase()}usdt@markPrice@1s`).join("/");
      socket = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams}`);
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const price = Number(msg.data?.p);
          const coin = msg.data?.s?.replace("USDT", "");
          if (!coin || !Number.isFinite(price)) return;
          lastFrame = Date.now();
          setFeed("WS");
          setRows((cur) => cur.map((r) => (r.coin === coin ? { ...r, price } : r)));
          setTick(new Date());
        } catch {}
      };
    } catch { /* fallback polling already running */ }

    return () => {
      closed = true;
      clearInterval(indicators); clearInterval(context); clearInterval(prices);
      try { socket?.close(); } catch {}
    };
  }, [load]);

  const shown = useMemo(() => rows.filter((r) => {
    if (side !== "ALL" && r.sig !== side) return false;
    if (mode !== "ALL" && r.mode !== mode) return false;
    if (minScore > 0 && (r.score ?? 0) < minScore) return false;
    if (hideStale) {
      const state = liveStatus(r);
      if (state === "EXPIRED" || state === "INVALIDATED") return false;
    }
    return true;
  }), [rows, side, mode, minScore, hideStale]);

  const setups = rows.filter((r) => r.sig).length;
  const chartRow = chartCoin ? rows.find((r) => r.coin === chartCoin) ?? null : null;

  return <main>
    <header className="topbar">
      <div className="brand"><span className="mark">◎</span><div><b>SCREENER</b><small>FUTURES INTELLIGENCE</small></div></div>
      <div className="status">
        <span className={`pulse ${feed === "OFF" ? "dead" : ""}`} />
        {feed === "WS" ? "LIVE · WEBSOCKET" : feed === "POLL" ? "LIVE · POLLING 3S" : "MENGHUBUNGKAN…"}
        {tick && <em className="tick">{tick.toLocaleTimeString("id-ID")}</em>}
        <button onClick={load}>{loading ? "SYNCING…" : "↻ REFRESH"}</button>
      </div>
    </header>

    <section className="hero">
      <div>
        <p className="eyebrow">MANUAL TRADING TERMINAL / 30M + 1H</p>
        <h1>Read the market.<br /><em>Trade with context.</em></h1>
        <p className="sub">Confluence signals for disciplined decisions — not blind automation.</p>
      </div>
      <div className="heroStats">
        <div><strong>{setups.toString().padStart(2, "0")}</strong><span>ACTIVE SETUPS</span></div>
        <div><strong>{rows.length.toString().padStart(2, "0")}</strong><span>MARKETS TRACKED</span></div>
      </div>
    </section>

    <nav className="filters">
      <span>MARKET SCAN</span>
      {SIDES.map((f) => (
        <button className={side === f ? "active" : ""} onClick={() => setSide(f)} key={f}>{f}</button>
      ))}
      <span className="sep" />
      {MODES.map((m) => (
        <button className={mode === m ? "active" : ""} onClick={() => setMode(m)} key={m}>
          {m === "ALL" ? "ANY MODE" : m}
        </button>
      ))}
      <span className="sep" />
      {[0, 3, 4, 5].map((s) => (
        <button className={minScore === s ? "active" : ""} onClick={() => setMinScore(s)} key={s}>
          {s === 0 ? "ANY SCORE" : `≥${s}`}
        </button>
      ))}
      <button className={hideStale ? "active" : ""} onClick={() => setHideStale((v) => !v)}>FRESH ONLY</button>
      <span className="updated">Last sync: {updated ? updated.toLocaleTimeString("id-ID") : "—"}</span>
    </nav>

    <section className="grid">{shown.length ? shown.map((r) => {
      const state = liveStatus(r);
      const dead = state === "EXPIRED" || state === "INVALIDATED";
      return <article className={`card ${r.sig?.toLowerCase() ?? "neutral"}${dead ? " stale" : ""}`} key={r.coin}>
        <div className="cardHead">
          <div>
            <span className="coin">{r.coin}<small>/USDT</small></span>
            <span className="contract">PERPETUAL · 30M</span>
          </div>
          <span className={`badge ${r.sig?.toLowerCase() ?? "wait"}`}>{r.sig ?? "WAIT"}</span>
        </div>

        <div className="price">{money(r.price)}<span>MARK PRICE · {feed === "WS" ? "WEBSOCKET" : feed === "POLL" ? "POLLING 3S" : "MENUNGGU"}</span></div>

        <div className="tags">
          <span className={`tag st-${state.toLowerCase()}`}>{state}</span>
          {r.mode && <span className="tag">{r.mode === "TREND" ? "SEARAH TREN" : "COUNTER-TREND"}</span>}
          <span className="tag muted">{r.sig ? age(r.age_min) : "no setup"}</span>
        </div>

        <div className="score">
          <span>CONFLUENCE SCORE · 30M</span>
          <b>{r.score}<i>/6</i></b>
          <div className="dots">{[1, 2, 3, 4, 5, 6].map((n) => <i className={n <= r.score ? "on" : ""} key={n} />)}</div>
        </div>

        {r.plan ? <div className="plan">
          <div className="planRow"><span>ENTRY ZONE</span><b>{money(r.plan.entry_low)} — {money(r.plan.entry_high)}</b></div>
          <div className="planRow"><span>INVALIDATION</span><b className="red">{money(r.plan.invalidation)} <i>({num(r.plan.risk_pct)}%)</i></b></div>
          <div className="planRow"><span>TP1 · 1R</span><b className="green">{money(r.plan.tp1)}</b></div>
          <div className="planRow"><span>TP2 · 2R</span><b className="green">{money(r.plan.tp2)}</b></div>
        </div> : <div className="plan empty">Belum ada rencana — tunggu candle 30m yang memenuhi skor.</div>}

        {r.reasons?.length ? <ul className="reasons">
          {r.reasons.map((why) => <li key={why}>{why}</li>)}
        </ul> : null}

        <div className="metrics">
          <div><span>RSI 30M</span><b>{num(r.rsi, 0)}</b></div>
          <div><span>TREND 1H</span><b className={r.trend_1h === "BULL" ? "green" : "red"}>{r.trend_1h}</b></div>
          <div><span>ATR 30M</span><b>{r.atr_pct == null ? "—" : `${num(r.atr_pct)}%`}</b></div>
          <div><span>FUNDING</span><b>{pct(r.funding)}</b></div>
          <div><span>OI / 15M</span><b>{pct(r.oi_chg)}</b></div>
          <div><span>LONG / SHORT</span><b>{num(r.ls_ratio)}</b></div>
          <div><span>TAKER RATIO</span><b>{num(r.taker)}</b></div>
        </div>

        <div className="cardFoot">
          <span>Signal is informational. Validate structure before entry.</span>
          <button className="chartBtn" onClick={() => setChartCoin(r.coin)}>CHART ↗</button>
        </div>
      </article>;
    }) : <p className="emptyState">Tidak ada market yang lolos filter ini.</p>}</section>

    <RiskCalculator rows={rows} />

    <History />

    {chartRow && <Chart row={chartRow} onClose={() => setChartCoin(null)} />}

    <footer>
      <span>SCREENER v1.3</span>
      <span>EDGE: THIN / MANUAL VALIDATION REQUIRED</span>
      <span>BINANCE USDT-M · 30M / 1H</span>
    </footer>
  </main>;
}
