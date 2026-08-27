"use client";

import { useMemo, useState } from "react";
import type { Row } from "../lib/format";
import { money, num } from "../lib/format";

type Props = { rows: Row[] };

/** Position sizing from account risk — never from a leverage target. */
export default function RiskCalculator({ rows }: Props) {
  const withPlan = useMemo(() => rows.filter((r) => r.sig && r.plan), [rows]);
  const [coin, setCoin] = useState("");
  const [equity, setEquity] = useState("1000");
  const [riskPct, setRiskPct] = useState("1");

  const selected = withPlan.find((r) => r.coin === coin) ?? withPlan[0] ?? null;
  const eq = Number(equity), rp = Number(riskPct);

  const result = useMemo(() => {
    if (!selected?.plan || !Number.isFinite(eq) || !Number.isFinite(rp) || eq <= 0 || rp <= 0) return null;
    const entry = selected.sig === "LONG" ? selected.plan.entry_high : selected.plan.entry_low;
    const stop = selected.plan.invalidation;
    const perUnit = Math.abs(entry - stop);
    if (perUnit <= 0) return null;
    const riskAmount = eq * (rp / 100);
    const size = riskAmount / perUnit;
    const notional = size * entry;
    return {
      entry, stop, perUnit, riskAmount, size, notional,
      marginAt3x: notional / 3,
      lossAtStop: riskAmount,
      gainAtTp1: size * Math.abs(selected.plan.tp1 - entry),
      gainAtTp2: size * Math.abs(selected.plan.tp2 - entry),
    };
  }, [selected, eq, rp]);

  return <section className="calc">
    <div className="calcHead">
      <h2>RISK CALCULATOR</h2>
      <span>Ukuran posisi dihitung dari risiko akun, bukan dari target leverage.</span>
    </div>

    {!withPlan.length ? (
      <p className="calcEmpty">Belum ada setup dengan rencana entry. Kalkulator aktif saat ada sinyal.</p>
    ) : <>
      <div className="calcGrid">
        <label>
          <span>SETUP</span>
          <select value={selected?.coin ?? ""} onChange={(e) => setCoin(e.target.value)}>
            {withPlan.map((r) => (
              <option value={r.coin} key={r.coin}>{r.coin} · {r.sig} · {r.score}/6</option>
            ))}
          </select>
        </label>
        <label>
          <span>EQUITY (USDT)</span>
          <input inputMode="decimal" value={equity} onChange={(e) => setEquity(e.target.value)} />
        </label>
        <label>
          <span>RISK / TRADE (%)</span>
          <input inputMode="decimal" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
        </label>
      </div>

      {result ? <div className="calcOut">
        <div><span>ENTRY</span><b>{money(result.entry)}</b></div>
        <div><span>STOP</span><b className="red">{money(result.stop)}</b></div>
        <div><span>RISK / UNIT</span><b>{money(result.perUnit)}</b></div>
        <div><span>RISK AMOUNT</span><b className="red">{money(result.riskAmount)}</b></div>
        <div><span>POSITION SIZE</span><b>{num(result.size, result.size < 1 ? 6 : 3)} {selected!.coin}</b></div>
        <div><span>NOTIONAL</span><b>{money(result.notional)}</b></div>
        <div><span>LOSS @ STOP</span><b className="red">−{money(result.lossAtStop)}</b></div>
        <div><span>GAIN @ TP1</span><b className="green">+{money(result.gainAtTp1)}</b></div>
        <div><span>GAIN @ TP2</span><b className="green">+{money(result.gainAtTp2)}</b></div>
      </div> : <p className="calcEmpty">Masukkan equity dan risk yang valid.</p>}

      {result && <p className="calcNote">
        Notional {money(result.notional)} dari equity {money(eq)}
        {result.notional > eq ? ` berarti butuh leverage ±${num(result.notional / eq, 1)}x — margin naik, jarak likuidasi mengecil.` : " masih di bawah equity, jadi tidak butuh leverage."}
        {" "}Stop harus tetap {money(result.stop)}; memperbesar posisi tanpa memperlebar stop tidak menambah edge, hanya menambah risiko likuidasi.
      </p>}
    </>}
  </section>;
}
