"use client";

import { useCallback, useEffect, useState } from "react";
import { money, num } from "../lib/format";

type Stats = {
  total: number; resolved: number; open: number; wins: number; losses: number;
  win_rate: number | null; avg_win_r: number | null; avg_loss_r: number | null;
  expectancy_r: number | null; expectancy_net_r: number | null;
  profit_factor: number | null; gross_r: number; net_r: number;
  max_drawdown_r: number | null; fee_r_per_trade: number | null;
};
type Bucket = { bucket: string | number; stats: Stats };
type EvalRow = {
  key: string; coin: string; sig: "LONG" | "SHORT"; score: number;
  mode: string | null; signal_closed_at: number; entry: number; stop: number;
  outcome: string; r_multiple: number | null; net_r: number | null; bars_held: number | null;
};
type Payload = {
  empty: boolean; note?: string; stats: Stats | null;
  by_score: Bucket[]; by_side: Bucket[]; by_mode: Bucket[]; by_coin: Bucket[];
  rows: EvalRow[];
};

const when = (ts: number) =>
  new Date(ts).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const r = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}R`;

function StatRow({ label, buckets }: { label: string; buckets: Bucket[] }) {
  if (!buckets.length) return null;
  return <div className="statBlock">
    <h3>{label}</h3>
    <table className="statTable">
      <thead><tr><th>{label}</th><th>N</th><th>SELESAI</th><th>WR</th><th>EXP NET</th><th>PF</th><th>NET</th></tr></thead>
      <tbody>{buckets.map((b) => (
        <tr key={String(b.bucket)}>
          <td><b>{String(b.bucket)}</b></td>
          <td>{b.stats.total}</td>
          <td>{b.stats.resolved}</td>
          <td>{b.stats.win_rate == null ? "—" : `${num(b.stats.win_rate, 1)}%`}</td>
          <td className={(b.stats.expectancy_net_r ?? 0) > 0 ? "green" : "red"}>{r(b.stats.expectancy_net_r)}</td>
          <td>{b.stats.profit_factor == null ? "—" : num(b.stats.profit_factor)}</td>
          <td className={(b.stats.net_r ?? 0) > 0 ? "green" : "red"}>{r(b.stats.net_r, 1)}</td>
        </tr>
      ))}</tbody>
    </table>
  </div>;
}

export default function History() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/history", { cache: "no-store" });
      setData(await response.json());
    } catch { /* keep previous view */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open && !data) load(); }, [open, data, load]);

  const s = data?.stats;

  return <section className="history">
    <div className="histHead">
      <div>
        <h2>SIGNAL HISTORY &amp; EVALUASI</h2>
        <span>Setiap sinyal direplay ke candle 30m berikutnya. Stop dianggap kena lebih dulu bila satu candle menyentuh stop dan target — hasilnya konservatif, bukan dilebihkan.</span>
      </div>
      <div className="histBtns">
        <button onClick={() => setOpen((v) => !v)}>{open ? "▲ TUTUP" : "▼ BUKA"}</button>
        {open && <button onClick={load}>{loading ? "MENGHITUNG…" : "↻ HITUNG ULANG"}</button>}
      </div>
    </div>

    {open && <>
      {!data && loading && <p className="calcEmpty">Mengevaluasi riwayat…</p>}
      {data?.empty && <p className="calcEmpty">{data.note}</p>}

      {s && <>
        <div className="statGrid">
          <div><span>SINYAL TERCATAT</span><b>{s.total}</b></div>
          <div><span>SELESAI</span><b>{s.resolved}</b></div>
          <div><span>MASIH BERJALAN</span><b>{s.open}</b></div>
          <div><span>WIN RATE (NET)</span><b>{s.win_rate == null ? "—" : `${num(s.win_rate, 1)}%`}</b></div>
          <div><span>WIN / LOSS</span><b>{s.wins} / {s.losses}</b></div>
          <div><span>AVG WIN</span><b className="green">{r(s.avg_win_r)}</b></div>
          <div><span>AVG LOSS</span><b className="red">{r(s.avg_loss_r)}</b></div>
          <div><span>EXPECTANCY GROSS</span><b className={(s.expectancy_r ?? 0) > 0 ? "green" : "red"}>{r(s.expectancy_r)}</b></div>
          <div><span>EXPECTANCY NET</span><b className={(s.expectancy_net_r ?? 0) > 0 ? "green" : "red"}>{r(s.expectancy_net_r)}</b></div>
          <div><span>PROFIT FACTOR</span><b>{s.profit_factor == null ? "—" : num(s.profit_factor)}</b></div>
          <div><span>TOTAL NET</span><b className={s.net_r > 0 ? "green" : "red"}>{r(s.net_r, 1)}</b></div>
          <div><span>MAX DRAWDOWN</span><b className="red">{s.max_drawdown_r == null ? "—" : `−${num(s.max_drawdown_r, 1)}R`}</b></div>
        </div>

        <p className="calcNote">
          Biaya taker bolak-balik memakan {r(s.fee_r_per_trade)} per trade dari hasil gross.
          {s.expectancy_net_r != null && s.expectancy_r != null && s.expectancy_r > 0 && s.expectancy_net_r <= 0
            ? " Gross positif tapi net negatif — edge-nya habis di fee, jadi setup ini belum layak ditradingkan."
            : ""}
          {s.resolved < 30 ? ` Sampel baru ${s.resolved} trade selesai; di bawah ~30 trade angka ini belum bisa dipercaya.` : ""}
        </p>

        <StatRow label="SCORE" buckets={data!.by_score} />
        <StatRow label="SIDE" buckets={data!.by_side} />
        <StatRow label="MODE" buckets={data!.by_mode} />
        <StatRow label="COIN" buckets={data!.by_coin} />

        <div className="statBlock">
          <h3>RIWAYAT SINYAL</h3>
          <table className="statTable">
            <thead><tr><th>WAKTU</th><th>COIN</th><th>SIDE</th><th>SCORE</th><th>ENTRY</th><th>STOP</th><th>HASIL</th><th>NET</th><th>BAR</th></tr></thead>
            <tbody>{data!.rows.map((row) => (
              <tr key={row.key}>
                <td>{when(row.signal_closed_at)}</td>
                <td><b>{row.coin}</b></td>
                <td className={row.sig === "LONG" ? "green" : "red"}>{row.sig}</td>
                <td>{row.score}</td>
                <td>{money(row.entry)}</td>
                <td>{money(row.stop)}</td>
                <td><span className={`oc oc-${row.outcome.toLowerCase()}`}>{row.outcome}</span></td>
                <td className={(row.net_r ?? 0) > 0 ? "green" : "red"}>{r(row.net_r)}</td>
                <td>{row.bars_held ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </>}
    </>}
  </section>;
}
