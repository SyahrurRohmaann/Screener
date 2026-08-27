"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Row = { coin: string; price: number; sig?: "LONG" | "SHORT" | null; score: number; rsi: number; trend_1h: string; funding?: number; oi_chg?: number; ls_ratio?: number; taker?: number };
const demo: Row[] = [
  { coin: "BTC", price: 0, score: 0, rsi: 50, trend_1h: "BULL", funding: 0, oi_chg: 0, ls_ratio: 1, taker: 1 },
  { coin: "ETH", price: 0, score: 0, rsi: 50, trend_1h: "BULL", funding: 0, oi_chg: 0, ls_ratio: 1, taker: 1 },
  { coin: "SOL", price: 0, score: 0, rsi: 50, trend_1h: "BEAR", funding: 0, oi_chg: 0, ls_ratio: 1, taker: 1 },
];

const money = (n: number) => n ? `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 2 })}` : "—";
const pct = (n?: number) => n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(3)}%`;

export default function Home() {
  const [rows, setRows] = useState<Row[]>(demo);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const r = await fetch("/api/market", { cache: "no-store" }); const d = await r.json(); setRows(d.rows ?? demo); setUpdated(new Date()); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  const shown = useMemo(() => rows.filter(r => filter === "ALL" || r.sig === filter), [rows, filter]);
  const setups = rows.filter(r => r.sig).length;
  return <main>
    <header className="topbar"><div className="brand"><span className="mark">◎</span><div><b>SCREENER</b><small>FUTURES INTELLIGENCE</small></div></div><div className="status"><span className="pulse" /> LIVE MARKET DATA <button onClick={load}>{loading ? "SYNCING…" : "↻ REFRESH"}</button></div></header>
    <section className="hero"><div><p className="eyebrow">MANUAL TRADING TERMINAL / 15M + 1H</p><h1>Read the market.<br /><em>Trade with context.</em></h1><p className="sub">Confluence signals for disciplined decisions — not blind automation.</p></div><div className="heroStats"><div><strong>{setups.toString().padStart(2, "0")}</strong><span>ACTIVE SETUPS</span></div><div><strong>{rows.length.toString().padStart(2, "0")}</strong><span>MARKETS TRACKED</span></div></div></section>
    <nav className="filters"><span>MARKET SCAN</span>{["ALL", "LONG", "SHORT"].map(f => <button className={filter === f ? "active" : ""} onClick={() => setFilter(f)} key={f}>{f}</button>)}<span className="updated">Last sync: {updated ? updated.toLocaleTimeString("id-ID") : "—"}</span></nav>
    <section className="grid">{shown.map(r => <article className={`card ${r.sig?.toLowerCase() ?? "neutral"}`} key={r.coin}><div className="cardHead"><div><span className="coin">{r.coin}<small>/USDT</small></span><span className="contract">PERPETUAL</span></div><span className={`badge ${r.sig?.toLowerCase() ?? "wait"}`}>{r.sig ?? "WAIT"}</span></div><div className="price">{money(r.price)}<span>MARK PRICE</span></div><div className="score"><span>CONFLUENCE SCORE</span><b>{r.score}<i>/6</i></b><div className="dots">{[1,2,3,4,5,6].map(n => <i className={n <= r.score ? "on" : ""} key={n} />)}</div></div><div className="metrics"><div><span>RSI 15M</span><b>{r.rsi?.toFixed(0) ?? "—"}</b></div><div><span>TREND 1H</span><b className={r.trend_1h === "BULL" ? "green" : "red"}>{r.trend_1h}</b></div><div><span>FUNDING</span><b>{pct(r.funding)}</b></div><div><span>OI / 15M</span><b>{pct(r.oi_chg)}</b></div><div><span>LONG / SHORT</span><b>{r.ls_ratio?.toFixed(2) ?? "—"}</b></div><div><span>TAKER RATIO</span><b>{r.taker?.toFixed(2) ?? "—"}</b></div></div><div className="cardFoot"><span>Signal is informational. Validate structure before entry.</span><span>→</span></div></article>)}</section>
    <footer><span>SCREENER v1.0</span><span>EDGE: THIN / MANUAL VALIDATION REQUIRED</span><span>BINANCE USDT-M · 15M / 1H</span></footer>
  </main>;
}
