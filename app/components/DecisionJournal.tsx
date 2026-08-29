"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Row } from "../lib/format";
import type { Decision, DecisionAction, SkipReason } from "../lib/decision-journal";
import { money } from "../lib/format";

const LABEL: Record<DecisionAction, string> = { PAPER: "AMBIL PAPER", WATCH: "PANTAU", SKIP: "LEWATI" };
const SKIP_OPTIONS: Array<[SkipReason, string]> = [
  ["RISK_TOO_HIGH", "Risk terlalu besar"], ["LATE", "Sudah terlambat"],
  ["STRUCTURE_UNCLEAR", "Struktur tidak jelas"], ["EVENT_RISK", "Ada event risk"], ["OTHER", "Lainnya"],
];

const OPEN_EVENT = "screener:decision";
export function openSignalDecision(row: Row, action: DecisionAction) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { row, action } }));
}

/**
 * Only the signal key travels to the server; the evidence itself is looked up
 * server-side from the recorded closed candle, so the journal cannot be forged.
 */
function signalKeyOf(row: Row): string {
  if (!row.sig || !row.plan || row.signal_closed_at == null) throw new Error("Identitas sinyal belum lengkap.");
  return `${row.coin}-${row.signal_closed_at}`;
}

export default function DecisionJournal({ rows }: { rows: Row[] }) {
  const [journal, setJournal] = useState<Decision[]>([]);
  const [active, setActive] = useState<{ row: Row; action: DecisionAction } | null>(null);
  const [entry, setEntry] = useState("");
  const [risk, setRisk] = useState("");
  const [reason, setReason] = useState<SkipReason>("RISK_TOO_HIGH");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<"ALL" | DecisionAction>("ALL");
  const [coin, setCoin] = useState("ALL");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/decisions", { cache: "no-store" });
      if (response.ok) setJournal((await response.json()).rows ?? []);
    } catch { setMessage("Journal gagal dimuat."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const decided = useMemo(() => new Set(journal.map((x) => x.signal.key)), [journal]);
  const shown = journal.filter((x) => (filter === "ALL" || x.action === filter) && (coin === "ALL" || x.signal.coin === coin));
  const coins = Array.from(new Set(journal.map((x) => x.signal.coin))).sort();

  function choose(row: Row, action: DecisionAction) {
    setMessage(""); setNote(""); setReason("RISK_TOO_HIGH");
    setEntry(action === "PAPER" ? String(row.sig === "LONG" ? row.plan?.entry_high ?? "" : row.plan?.entry_low ?? "") : "");
    setRisk(action === "PAPER" ? String(row.plan?.risk_pct ?? "") : "");
    setActive({ row, action });
  }

  async function save() {
    if (!active) return;
    setSaving(true); setMessage("");
    try {
      const base = { signal_key: signalKeyOf(active.row), action: active.action, note: note.trim() || undefined };
      const body = active.action === "PAPER" ? { ...base, actual_entry: Number(entry), actual_risk_pct: Number(risk) }
        : active.action === "SKIP" ? { ...base, skip_reason: reason } : base;
      const response = await fetch("/api/decisions", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Gagal menyimpan keputusan.");
      setJournal((current) => [data, ...current]); setActive(null); setMessage("Keputusan tersimpan sebagai bukti manual.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Gagal menyimpan keputusan."); }
    finally { setSaving(false); }
  }

  return <>
    <section className="decisionActions" aria-label="Keputusan manual sinyal">
      <div className="decisionHead"><div><h2>KEPUTUSAN MANUAL</h2><span>Pilih sendiri dari kartu aktif. Ini jurnal bukti, bukan order dan bukan hasil trade otomatis.</span></div></div>
      <div className="decisionCards">{rows.filter((r) => r.sig && r.plan && r.signal_closed_at != null).map((row) => {
        const key = `${row.coin}-${row.signal_closed_at}`;
        const isDone = decided.has(key);
        return <div className="decisionSignal" key={key}>
          <b>{row.coin} · {row.sig} · {row.score}/6</b>
          {isDone ? <span className="decisionDone">SUDAH DICATAT</span> : <div>
            <button onClick={() => choose(row, "PAPER")}>AMBIL PAPER</button>
            <button onClick={() => choose(row, "WATCH")}>PANTAU</button>
            <button onClick={() => choose(row, "SKIP")}>LEWATI</button>
          </div>}
        </div>;
      })}</div>
      {message && <p className="decisionMessage">{message}</p>}
    </section>

    <section className="journal">
      <div className="decisionHead"><div><h2>JOURNAL KEPUTUSAN</h2><span>Tersimpan server-side di SCREENER_DATA_DIR dan ikut terbuka di perangkat lain setelah login.</span></div>
        <div className="journalFilters"><select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="ALL">SEMUA AKSI</option><option value="PAPER">AMBIL PAPER</option><option value="WATCH">PANTAU</option><option value="SKIP">LEWATI</option></select><select value={coin} onChange={(e) => setCoin(e.target.value)}><option value="ALL">SEMUA COIN</option>{coins.map((x) => <option key={x}>{x}</option>)}</select><button onClick={load}>↻ MUAT ULANG</button></div>
      </div>
      {shown.length ? <div className="journalTableWrap"><table className="statTable"><thead><tr><th>WAKTU</th><th>SINYAL</th><th>AKSI</th><th>ACTUAL PAPER</th><th>ALASAN / CATATAN</th></tr></thead><tbody>{shown.map((x) => <tr key={x.id}><td>{new Date(x.decided_at).toLocaleString("id-ID")}</td><td>{x.signal.coin} · {x.signal.sig} · {x.signal.score}/6<br /><small>candle {new Date(x.signal.signal_closed_at).toLocaleString("id-ID")}</small></td><td>{LABEL[x.action]}</td><td>{x.action === "PAPER" ? `${money(x.actual_entry)} · risk ${x.actual_risk_pct}%` : "—"}</td><td>{x.action === "SKIP" ? x.skip_reason : "—"}{x.note ? <><br /><small>{x.note}</small></> : null}</td></tr>)}</tbody></table></div> : <p className="journalEmpty">Belum ada keputusan untuk filter ini.</p>}
    </section>

    {active && <div className="modalWrap"><button className="modalBack" aria-label="Tutup" onClick={() => setActive(null)} /><div className="modal decisionModal"><div className="modalHead"><div><b>{LABEL[active.action]} · {active.row.coin} {active.row.sig}</b><small>Sinyal candle {new Date(active.row.signal_closed_at!).toLocaleString("id-ID")} akan dibekukan bersama keputusan.</small></div><button onClick={() => setActive(null)}>✕</button></div>
      {active.action === "PAPER" && <div className="decisionFields"><label><span>ACTUAL ENTRY PAPER</span><input type="number" min="0" step="any" value={entry} onChange={(e) => setEntry(e.target.value)} /></label><label><span>ACTUAL RISK (%)</span><input type="number" min="0" max="100" step="any" value={risk} onChange={(e) => setRisk(e.target.value)} /></label></div>}
      {active.action === "SKIP" && <label className="decisionField"><span>ALASAN LEWATI</span><select value={reason} onChange={(e) => setReason(e.target.value as SkipReason)}>{SKIP_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
      <label className="decisionField"><span>CATATAN BEBAS (OPSIONAL)</span><textarea maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <p className="decisionWarning">Tidak ada order yang dieksekusi dan tidak ada outcome yang dibuat. Simpan hanya keputusan yang benar-benar lo ambil.</p>
      <button className="decisionSave" disabled={saving} onClick={save}>{saving ? "MENYIMPAN…" : "SIMPAN KEPUTUSAN"}</button>
    </div></div>}
  </>;
}
