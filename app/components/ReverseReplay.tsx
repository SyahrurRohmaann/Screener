"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Evaluated, Stats } from "../lib/evaluate";
import { priceStr } from "../lib/format";

type Range = "30" | "60" | "90" | "all";
const labels = { original: "MESIN AKTIF (REVERSE)", reverse: "MESIN ORI (SEBELUM DIBALIK)" };
type Comparison = { stats: Stats; outcomes: { outcome: string; count: number }[] };
type Payload = {
  ts: number; range: Range; evidence: "RETROSPECTIVE_REPLAY";
  fee_pct: number; max_bars: number; total: number;
  original: Comparison; reverse: Comparison;
  rows: { original: Evaluated; reverse: Evaluated }[];
};

const number = (value: number | null | undefined, suffix = "", digits = 2) =>
  value == null || !Number.isFinite(value) ? "N/A" : `${value.toFixed(digits)}${suffix}`;
const when = (ts: number) => new Date(ts).toLocaleString("id-ID", { timeZone: "UTC" });
const price = (value: number) => Number.isFinite(value) && value > 0 ? priceStr(value) : "N/A";

const metrics: { label: string; key: keyof Stats; suffix?: string; digits?: number }[] = [
  { label: "Total record", key: "total", digits: 0 },
  { label: "Resolved", key: "resolved", digits: 0 },
  { label: "Win rate (net, resolved)", key: "win_rate", suffix: "%" },
  { label: "Total gross R", key: "gross_r", suffix: "R" },
  { label: "Total net R", key: "net_r", suffix: "R" },
  { label: "Expectancy gross", key: "expectancy_r", suffix: "R" },
  { label: "Expectancy net", key: "expectancy_net_r", suffix: "R" },
  { label: "Profit factor (net)", key: "profit_factor" },
  { label: "Max DD (signal-order)", key: "max_drawdown_r", suffix: "R" },
];

export default function ReverseReplay() {
  const [range, setRange] = useState<Range>("30");
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(null); setUnauthorized(false); setLoading(true);
    async function load() {
      try {
        const response = await fetch(`/api/reverse?range=${range}`, {
          cache: "no-store", signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setUnauthorized(true);
          throw new Error("Sesi berakhir (401). Login kembali untuk melihat replay.");
        }
        if (!response.ok) throw new Error(`Replay gagal dimuat (HTTP ${response.status}).`);
        const payload: Payload = await response.json();
        if (controller.signal.aborted) return;
        if (payload.evidence !== "RETROSPECTIVE_REPLAY" || payload.range !== range ||
            !payload.original?.stats || !payload.reverse?.stats || !Array.isArray(payload.rows) ||
            !Array.isArray(payload.original.outcomes) || !Array.isArray(payload.reverse.outcomes)) {
          throw new Error("Respons replay tidak sesuai format yang diharapkan.");
        }
        setData(payload);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Replay gagal dimuat. Periksa koneksi lalu coba lagi.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [range, attempt]);

  function reload(value: Range) {
    setData(null); setError(null); setUnauthorized(false); setLoading(true);
    setRange(value); setAttempt((current) => current + 1);
  }

  return <section className="reverseReplay" aria-labelledby="reverse-results">
    <div className="reverseToolbar">
      <h2 id="reverse-results">Mesin aktif vs mesin ori</h2>
      <div className="reverseControls" role="group" aria-label="Rentang replay">
        {(["30", "60", "90", "all"] as const).map((value) => <button type="button" key={value}
          aria-pressed={range === value} onClick={() => reload(value)}>
          {value === "all" ? "SEMUA" : `${value} HARI`}
        </button>)}
        <button type="button" disabled={loading} onClick={() => reload(range)}>MUAT ULANG</button>
      </div>
    </div>
    <div aria-busy={loading}>
      {loading && <p className="reversePanel reverseState" role="status">Memuat replay {range === "all" ? "seluruh history tersedia" : `${range} hari`}. Hasil sebelumnya disembunyikan.</p>}
      {error && <div className="reversePanel reverseError" role="alert"><p>{error}</p>
        {unauthorized ? <Link href="/login?next=%2Freverse">Login kembali</Link> : <button type="button" onClick={() => reload(range)}>COBA LAGI</button>}
      </div>}
      {!loading && !error && data && <>
        <p className="reverseMeta">{data.evidence} / {when(data.ts)} UTC<br />
          Fee round-trip {number(data.fee_pct, "%")} / batas replay {data.max_bars} bar / {data.total} record sumber dalam rentang ini.</p>
        {data.total === 0 && <p className="reversePanel reverseState">Belum ada record dalam rentang ini. Tidak ada hasil yang dapat disimpulkan.</p>}
        <div className="reversePanel">
          <div className="reverseScroll" role="region" aria-label="Perbandingan statistik" tabIndex={0}>
            <table className="reverseComparison"><caption>Statistik seluruh record dalam rentang, bukan hanya 120 pasangan di bawah.</caption>
              <thead><tr><th scope="col">Metrik</th><th scope="col">{labels.original}</th><th scope="col">{labels.reverse}</th></tr></thead>
              <tbody>{metrics.map(({ label, key, suffix, digits }) => <tr key={key}>
                <th scope="row">{label}</th>
                <td>{number(data.original.stats[key], suffix, digits)}</td>
                <td>{number(data.reverse.stats[key], suffix, digits)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="reverseMeta">N/A berarti tidak tersedia / tidak terdefinisi, bukan nol. PF menggunakan hasil net. OPEN dan UNKNOWN bukan resolved; TIMEOUT termasuk resolved. Nilai OPEN per record masih hipotetis sementara.</p>
          {(data.original.stats.resolved < 30 || data.reverse.stats.resolved < 30) && <p className="reverseCaution">Sampel resolved salah satu atau kedua sisi di bawah 30. Jangan anggap perbedaan ini sebagai edge.</p>}
        </div>
        <div className="reverseOutcomes">{(["original", "reverse"] as const).map((side) => <section className="reversePanel" key={side}>
          <h3>OUTCOMES / {labels[side]}</h3>
          {data[side].outcomes.length ? <dl>{data[side].outcomes.map((item) => <div key={item.outcome}><dt>{item.outcome}</dt><dd>{item.count}</dd></div>)}</dl> : <p className="reverseMeta">Tidak ada outcome.</p>}
        </section>)}</div>
        <section className="reversePanel">
          <h3>PER RECORD / {Math.min(data.rows.length, 120)} DARI {data.total} PASANGAN</h3>
          <p className="reverseMeta">Maksimal 120 pasangan ditampilkan. Level adalah rencana hipotetis, bukan order live. Harga dalam USDT; waktu UTC.</p>
          {data.rows.length ? <div className="reverseScroll" role="region" aria-label="Pasangan record mesin aktif dan mesin ori, geser untuk melihat semua kolom" tabIndex={0}>
            <table className="reverseRecords"><thead><tr>
              {["Waktu sinyal (UTC)", "Coin", "Replay", "Side", "Entry", "Stop", "TP1", "TP2", "Outcome", "Net R"].map((label) => <th scope="col" key={label}>{label}</th>)}
            </tr></thead>
              {data.rows.slice(0, 120).map((pair) => <tbody key={pair.original.key}>
                {(["original", "reverse"] as const).map((side, index) => {
                  const row = pair[side];
                  return <tr key={side}>
                    {index === 0 && <><td rowSpan={2}>{when(pair.original.signal_closed_at)}</td><th scope="rowgroup" rowSpan={2}>{pair.original.coin}</th></>}
                    <th scope="row">{labels[side]}</th><td>{row.sig}</td>
                    <td>{price(row.entry)}</td><td>{price(row.stop)}</td><td>{price(row.tp1)}</td><td>{price(row.tp2)}</td>
                    <td>{row.outcome}</td><td>{number(row.net_r, "R")}</td>
                  </tr>;
                })}
              </tbody>)}
            </table>
          </div> : <p className="reverseState">Tidak ada pasangan record untuk ditampilkan.</p>}
        </section>
      </>}
    </div>
  </section>;
}
