"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Plan = {
  entry_low: number; entry_high: number; invalidation: number;
  risk_pct: number; tp1: number; tp2: number; rr1: number; rr2: number;
};
type Row = {
  coin: string; price: number; sig?: "LONG" | "SHORT" | null; score: number; rsi: number;
  trend_1h: string; timeframe?: string; mode?: "TREND" | "COUNTER" | null; status?: string;
  age_min?: number; atr_pct?: number | null; plan?: Plan | null; reasons?: string[];
  funding?: number; oi_chg?: number; ls_ratio?: number; taker?: number;
};

const COINS = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "AVAX", "LINK", "DOT"];
const demo: Row[] = COINS.slice(0, 3).map((coin) => ({
  coin, price: 0, score: 0, rsi: 50, trend_1h: "BULL", status: "NONE",
}));

const money = (n?: number | null) =>
  n == null || !Number.isFinite(n) || n === 0
    ? "—"
    : `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 2 })}`;
const pct = (n?: number | null) =>
  n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(3)}%`;
const num = (n?: number | null, d = 2) =>
  n == null || !Number.isFinite(n) ? "—" : n.toFixed(d);
const age = (m?: number) =>
  m == null ? "—" : m < 60 ? `${m}m lalu` : `${Math.floor(m / 60)}j ${m % 60}m lalu`;

// Harga realtime bisa membatalkan rencana sebelum refresh indikator 60s berikutnya.
function liveStatus(r: Row) {
  if (!r.sig || !r.plan) return r.status ?? "NONE";
  const hit = r.sig === "LONG" ? r.price <= r.plan.invalidation : r.price >= r.plan.invalidation;
  return hit ? "INVALIDATED" : r.status ?? "NONE";
}

export default function Home() {
  const [rows, setRows] = useState<Row[]>(demo);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [loading, setLoading] = useState(false);

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
    const streams = COINS.map((c) => `${c.toLowerCase()}usdt@markPrice@1s`).join("/");
    const ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams}`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const price = Number(msg.data?.p);
        const coin = msg.data?.s?.replace("USDT", "");
        if (coin && price) setRows((cur) => cur.map((r) => (r.coin === coin ? { ...r, price } : r)));
      } catch {}
    };
    const context = setInterval(async () => {
      try {
        const response = await fetch("/api/context", { cache: "no-store" });
        const data = await response.json();
        setRows((cur) => cur.map((r) => ({ ...r, ...(data[r.coin] ?? {}) })));
      } catch {}
    }, 20000);
    return () => { clearInterval(indicators); clearInterval(context); ws.close(); };
  }, [load]);

  const shown = useMemo(
    () => rows.filter((r) => filter === "ALL" || r.sig === filter),
    [rows, filter],
  );
  const setups = rows.filter((r) => r.sig).length;

  return <main>
    <header className="topbar">
      <div className="brand"><span className="mark">◎</span><div><b>SCREENER</b><small>FUTURES INTELLIGENCE</small></div></div>
      <div className="status"><span className="pulse" /> LIVE MARKET DATA <button onClick={load}>{loading ? "SYNCING…" : "↻ REFRESH"}</button></div>
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
      {["ALL", "LONG", "SHORT"].map((f) => (
        <button className={filter === f ? "active" : ""} onClick={() => setFilter(f)} key={f}>{f}</button>
      ))}
      <span className="updated">Last sync: {updated ? updated.toLocaleTimeString("id-ID") : "—"}</span>
    </nav>

    <section className="grid">{shown.map((r) => {
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

        <div className="price">{money(r.price)}<span>REALTIME MARK PRICE</span></div>

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
          <span>→</span>
        </div>
      </article>;
    })}</section>

    <footer>
      <span>SCREENER v1.1</span>
      <span>EDGE: THIN / MANUAL VALIDATION REQUIRED</span>
      <span>BINANCE USDT-M · 30M / 1H</span>
    </footer>
  </main>;
}
