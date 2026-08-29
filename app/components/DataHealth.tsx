"use client";

import { useMemo, useState } from "react";
import type { ContextDiagnostics, MarketDiagnostics, PriceDiagnostics } from "../lib/diagnostics";
import { summarizeDataHealth } from "../lib/diagnostics";

const TONE: Record<string, string> = {
  OK: "hOk", DEGRADED: "hWarn", PARTIAL: "hWarn", STALE: "hBad",
  BAD: "hBad", DOWN: "hBad", RATE_LIMITED: "hBad", MISALIGNED: "hBad", UNKNOWN: "hUnknown",
};

const HEADLINE: Record<string, string> = {
  OK: "SEMUA SUMBER DATA SEHAT",
  DEGRADED: "DATA TIDAK LENGKAP — BACA ANGKA DENGAN HATI-HATI",
  BAD: "DATA BASI ATAU GAGAL — JANGAN DIPAKAI UNTUK KEPUTUSAN",
  UNKNOWN: "STATUS DATA BELUM DIKETAHUI",
};

/**
 * Data health panel. The point is not decoration: every number on this dashboard is
 * derived from upstream calls that can partially fail, and a silent partial failure
 * looks exactly like a calm market. This panel makes the difference visible.
 */
export default function DataHealth({ market, context, price }: {
  market: MarketDiagnostics | null;
  context: ContextDiagnostics | null;
  price: PriceDiagnostics | null;
}) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => summarizeDataHealth({ market, context, price }), [market, context, price]);
  const tone = TONE[summary.overall] ?? "hUnknown";

  return <section className={`health ${tone}`} aria-label="Kesehatan data">
    <button className="healthHead" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
      <span className={`healthDot ${tone}`} aria-hidden="true" />
      <b>DATA HEALTH · {summary.overall}</b>
      <small>{HEADLINE[summary.overall] ?? HEADLINE.UNKNOWN}</small>
      <i aria-hidden="true">{open ? "TUTUP ▲" : "RINCIAN ▼"}</i>
    </button>

    {open && <div className="healthBody">
      <ul className="healthList">
        {summary.items.map((item) => (
          <li key={item.key} className={TONE[item.status] ?? "hUnknown"}>
            <span className="hLabel">{item.label}</span>
            <span className="hStatus">{item.status}</span>
            <span className="hDetail">{item.detail}</span>
          </li>
        ))}
      </ul>
      <p className="healthNote">
        UNKNOWN berarti sumbernya belum menjawab, bukan berarti aman. DEGRADED berarti
        sebagian panggilan upstream gagal, jadi skor dan konteks dihitung dari data yang
        tidak lengkap. Ambang: mark price basi &gt;15s, candle 30m basi &gt;65m, drift jam &gt;10s.
      </p>
    </div>}
  </section>;
}
