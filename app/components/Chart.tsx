"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { clampOffset, indexToX, percentageLabel, MAX_RIGHT_FRACTION, VISIBLE_BARS } from "../lib/chartView";
import type { Bar, Plan, Row } from "../lib/format";
import { levelPct, money, num, planEntry } from "../lib/format";

const W = 760, PRICE_H = 260, VOL_H = 60, RSI_H = 70, GAP = 14, PAD_L = 8, PAD_R = 62;

type Props = { row: Row; onClose: () => void };

function scale(v: number, min: number, max: number, top: number, height: number) {
  if (!Number.isFinite(v) || max === min) return top + height;
  return top + height - ((v - min) / (max - min)) * height;
}

function polyline(bars: Bar[], pick: (b: Bar) => number | null, x: (i: number) => number, y: (v: number) => number) {
  const points: string[] = [];
  bars.forEach((b, i) => {
    const v = pick(b);
    if (v != null && Number.isFinite(v)) points.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  return points.join(" ");
}

export default function Chart({ row, onClose }: Props) {
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offsetPx, setOffsetPx] = useState(0);
  const [pointerY, setPointerY] = useState<number | null>(null);
  const drag = useRef<{ id: number; x: number } | null>(null);
  const clipId = useId();

  useEffect(() => {
    let alive = true;
    setBars(null); setError(null);
    setOffsetPx(0); setPointerY(null); drag.current = null;
    (async () => {
      try {
        const response = await fetch(`/api/candles?coin=${row.coin}`, { cache: "no-store" });
        const data = await response.json();
        if (!alive) return;
        if (!response.ok || !data.bars?.length) setError(data.error ?? "chart data unavailable");
        else setBars(data.bars as Bar[]);
      } catch { if (alive) setError("chart request failed"); }
    })();
    return () => { alive = false; };
  }, [row.coin]);

  const view = useMemo(() => {
    if (!bars?.length) return null;
    const plan = row.plan ?? null;
    const levels = plan ? [plan.entry_low, plan.entry_high, plan.invalidation, plan.tp1, plan.tp2] : [];
    const emas = bars.map((b) => b.ema50).filter((x): x is number => x != null);

    // The candles set the scale. Plan levels only widen it, never shrink it, so a
    // far-away level cannot flatten the candles into a straight line.
    const barMax = Math.max(...bars.map((b) => b.h), ...emas);
    const barMin = Math.min(...bars.map((b) => b.l), ...emas);
    const barRange = barMax - barMin || barMax * 0.01;
    // Allow the axis to grow by at most 60% of the candle range in each direction.
    const roomMax = barMax + barRange * 0.6, roomMin = barMin - barRange * 0.6;
    const wanted = [...levels, row.price].filter((v) => Number.isFinite(v) && v > 0) as number[];
    const rawMax = Math.min(Math.max(barMax, ...wanted), roomMax);
    const rawMin = Math.max(Math.min(barMin, ...wanted), roomMin);
    const pad = (rawMax - rawMin) * 0.06 || rawMax * 0.01;
    const pMax = rawMax + pad, pMin = rawMin - pad;
    const vMax = Math.max(...bars.map((b) => b.v), ...bars.map((b) => b.mavol14 ?? 0));

    const inner = W - PAD_L - PAD_R;
    const visibleBars = Math.min(VISIBLE_BARS, bars.length);
    const step = inner / visibleBars;
    const bodyW = Math.max(1.6, step * 0.62);
    const offset = clampOffset(offsetPx, bars.length, visibleBars, step, inner * MAX_RIGHT_FRACTION);
    const x = (i: number) => indexToX(i, bars.length, visibleBars, step, PAD_L, offset);
    const volTop = PRICE_H + GAP;
    const rsiTop = volTop + VOL_H + GAP;

    return {
      plan, entry: planEntry(row), bodyW, x, pMin, pMax, vMax, volTop, rsiTop, step, visibleBars, offset,
      yPrice: (v: number) => scale(v, pMin, pMax, 0, PRICE_H),
      yVol: (v: number) => scale(v, 0, vMax, volTop, VOL_H),
      yRsi: (v: number) => scale(v, 0, 100, rsiTop, RSI_H),
      height: rsiTop + RSI_H + 4,
    };
  }, [bars, row, offsetPx]);

  const last = bars?.at(-1);
  const crossPrice = view && pointerY != null ? view.pMax - pointerY / PRICE_H * (view.pMax - view.pMin) : null;
  const crossPct = crossPrice == null ? null : percentageLabel(crossPrice, last?.c ?? row.price);
  const pan = (delta: number) => {
    if (view && bars) setOffsetPx((offset) => clampOffset(offset + delta, bars.length, view.visibleBars, view.step, (W - PAD_L - PAD_R) * MAX_RIGHT_FRACTION));
  };

  return <div className="modalWrap" role="dialog" aria-label={`Chart ${row.coin}`}>
    <div className="modalBack" onClick={onClose} />
    <div className="modal">
      <div className="modalHead">
        <div>
          <b>{row.coin}/USDT</b>
          <small>30M CLOSED CANDLES · EMA50 · MAVOL5/14 · RSI14</small>
        </div>
        <button onClick={onClose}>✕ CLOSE</button>
      </div>

      {error && <p className="chartMsg red">{error}</p>}
      {!bars && !error && <p className="chartMsg">Loading chart…</p>}

      {bars && view && <>
        <div role="application" aria-label={`${row.coin} chart. Drag to pan; Left and Right arrows pan; Home resets.`} tabIndex={0}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
            event.preventDefault();
            if (event.key === "Home") setOffsetPx(0);
            else pan((event.key === "ArrowLeft" ? -1 : 1) * view.step * 5);
          }}>
        <svg className="chart" viewBox={`0 0 ${W} ${view.height}`} preserveAspectRatio="xMidYMid meet"
          style={{ touchAction: "pan-y", cursor: "crosshair", transition: "none" }}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
            event.currentTarget.parentElement?.focus();
            const matrix = event.currentTarget.getScreenCTM();
            if (!matrix) return;
            const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
            drag.current = { id: event.pointerId, x: point.x };
            event.currentTarget.setPointerCapture(event.pointerId);
            setPointerY(point.y >= 0 && point.y <= PRICE_H ? point.y : null);
          }}
          onPointerMove={(event) => {
            const matrix = event.currentTarget.getScreenCTM();
            if (!matrix) return;
            const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
            setPointerY(point.y >= 0 && point.y <= PRICE_H ? point.y : null);
            if (drag.current?.id === event.pointerId) {
              pan(drag.current.x - point.x);
              drag.current.x = point.x;
            }
          }}
          onPointerUp={(event) => {
            if (drag.current?.id !== event.pointerId) return;
            drag.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
            if (event.pointerType !== "mouse") setPointerY(null);
          }}
          onPointerCancel={() => { drag.current = null; setPointerY(null); }}
          onLostPointerCapture={() => { drag.current = null; }}
          onPointerLeave={() => setPointerY(null)}>
          <defs><clipPath id={clipId}><rect x={PAD_L} y={0} width={W - PAD_L - PAD_R} height={view.height} /></clipPath></defs>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const price = view.pMin + (view.pMax - view.pMin) * (1 - f);
            const y = f * PRICE_H;
            return <g key={f}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} className="gridLine" />
              <text x={W - PAD_R + 6} y={y + 3} className="axis">{money(price)}</text>
            </g>;
          })}

          {view.plan && view.entry != null && ([
            ["entry", view.entry, "ENTRY", null],
            ["stop", view.plan.invalidation, "STOP", "−"],
            ["tp", view.plan.tp1, "TP1", "+"],
            ["tp", view.plan.tp2, "TP2", "+"],
          ] as const).map(([kind, value, name, sign], k) => {
            const distance = sign ? levelPct(row, value) : null;
            const label = `${name} ${money(value)}${distance == null ? "" : ` (${sign}${num(distance)}%)`}`;
            const rawY = view.yPrice(value);
            // Clamp instead of dropping: a hidden STOP line reads as "no stop".
            const clamped = rawY < 0 || rawY > PRICE_H;
            const y = Math.min(Math.max(rawY, 7), PRICE_H - 2);
            return <g key={`${kind}${k}`} className={clamped ? "lvlOff" : undefined}>
              <line
                x1={PAD_L} x2={W - PAD_R} y1={y} y2={y}
                className={`lvl lvl-${kind}${clamped ? " lvlClamped" : ""}`}
              />
              <text x={PAD_L + 4} y={y - 4} className={`lvlText lvl-${kind}`}>
                {clamped ? `${label} ${rawY < 0 ? "↑ di luar layar" : "↓ di luar layar"}` : label}
              </text>
            </g>;
          })}

          <g clipPath={`url(#${clipId})`}>
          {bars.map((b, i) => {
            const up = b.c >= b.o;
            const cx = view.x(i);
            const yO = view.yPrice(b.o), yC = view.yPrice(b.c);
            const top = Math.min(yO, yC);
            const h = Math.max(1, Math.abs(yC - yO));
            return <g key={b.t} className={up ? "up" : "down"}>
              <line x1={cx} x2={cx} y1={view.yPrice(b.h)} y2={view.yPrice(b.l)} className="wick" />
              <rect x={cx - view.bodyW / 2} y={top} width={view.bodyW} height={h} className="body" />
              <rect
                x={cx - view.bodyW / 2}
                y={view.yVol(b.v)}
                width={view.bodyW}
                height={Math.max(0.6, view.volTop + VOL_H - view.yVol(b.v))}
                className="volBar"
              />
            </g>;
          })}

          <polyline className="lineEma" points={polyline(bars, (b) => b.ema50, view.x, view.yPrice)} />
          <polyline className="lineMv5" points={polyline(bars, (b) => b.mavol5, view.x, view.yVol)} />
          <polyline className="lineMv14" points={polyline(bars, (b) => b.mavol14, view.x, view.yVol)} />
          </g>

          <text x={PAD_L + 2} y={view.volTop + 10} className="panelTag">VOLUME · MAVOL5/14</text>

          {[30, 50, 70].map((level) => {
            const y = view.yRsi(level);
            return <g key={level}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} className={level === 50 ? "gridLine" : "rsiBand"} />
              <text x={W - PAD_R + 6} y={y + 3} className="axis">{level}</text>
            </g>;
          })}
          <g clipPath={`url(#${clipId})`}>
            <polyline className="lineRsi" points={polyline(bars, (b) => b.rsi, view.x, view.yRsi)} />
          </g>
          <text x={PAD_L + 2} y={view.rsiTop + 10} className="panelTag">RSI14 · 30M</text>
          {view.offset > 0 && <g pointerEvents="none">
            <rect x={W - PAD_R - view.offset} y={0} width={view.offset} height={view.height} fill="currentColor" opacity={0.04} />
            <text x={W - PAD_R - 4} y={PRICE_H - 8} textAnchor="end" className="axis">No candles yet</text>
          </g>}
          {pointerY != null && crossPrice != null && <g pointerEvents="none">
            <line x1={PAD_L} x2={W - PAD_R} y1={pointerY} y2={pointerY} stroke={crossPct?.startsWith("-") ? "#ef4444" : "#22c55e"} strokeDasharray="4 3" />
            <g transform={`translate(${W - PAD_R}, ${Math.max(0, Math.min(PRICE_H - 32, pointerY - 16))})`}>
              <rect width={PAD_R} height={32} rx={3} fill="#111827" />
              <text x={3} y={12} fontSize={10} fill={crossPct?.startsWith("-") ? "#ef4444" : "#22c55e"}>
                <tspan>{money(crossPrice)}</tspan>
                {crossPct && <tspan x={3} dy={13}>{crossPct}</tspan>}
              </text>
            </g>
          </g>}
        </svg>
        </div>

        <div className="legend">
          <span className="lg lg-ema">EMA50</span>
          <span className="lg lg-mv5">MAVOL5</span>
          <span className="lg lg-mv14">MAVOL14</span>
          <span className="lg lg-rsi">RSI14</span>
          {row.plan && <><span className="lg lg-entry">ENTRY</span><span className="lg lg-stop">STOP</span><span className="lg lg-tp">TP1/TP2</span></>}
          <span className="lg muted">{bars.length} bars · close {money(last?.c)} · RSI {num(last?.rsi, 0)}</span>
        </div>
      </>}
    </div>
  </div>;
}

export type { Plan };
