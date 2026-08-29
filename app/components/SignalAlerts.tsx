"use client";

import { useEffect, useRef, useState } from "react";
import type { Row } from "../lib/format";
import { newSignals, notifiable, signalKey, summarize, trimSeen } from "../lib/notify";

const STORE = "screener_seen_signals";
const PREF = "screener_notify_on";

type Toast = { key: string; text: string; sig: "LONG" | "SHORT" };

/**
 * Announces signals the operator has not seen before.
 *
 * Two deliberate choices:
 *  - The first load after opening the page is a BASELINE, not news. Existing
 *    signals are recorded silently; otherwise every visit would fire a burst of
 *    notifications for setups that may be hours old.
 *  - Seen keys live in localStorage, so a reload does not re-announce. They are
 *    capped so the entry can never grow without bound.
 *
 * Browser notifications only work over HTTPS (or localhost) and only after the
 * user grants permission — the toast is the fallback that always works.
 */
export default function SignalAlerts({ rows }: { rows: Row[] }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORE);
      if (stored) seen.current = new Set(JSON.parse(stored) as string[]);
      setEnabled(localStorage.getItem(PREF) === "1");
    } catch { /* private mode: fall back to in-memory only */ }
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  useEffect(() => {
    const live = notifiable(rows);
    // Wait for the first real payload; the placeholder rows carry no signals.
    if (!live.length && !primed.current) return;

    const fresh = newSignals(rows, seen.current);
    for (const r of live) seen.current.add(signalKey(r));
    try {
      localStorage.setItem(STORE, JSON.stringify(trimSeen(Array.from(seen.current))));
    } catch {}

    if (!primed.current) { primed.current = true; return; }
    if (!fresh.length) return;

    setToasts((cur) => [
      ...fresh.map((r) => ({ key: signalKey(r), text: summarize(r), sig: r.sig! })),
      ...cur,
    ].slice(0, 4));

    if (enabled && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const r of fresh) {
        try {
          new Notification(`Sinyal baru: ${r.coin} ${r.sig}`, {
            body: summarize(r),
            tag: signalKey(r),      // same signal never notifies twice
            silent: false,
          });
        } catch {}
      }
    }
  }, [rows, enabled]);

  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => setToasts((cur) => cur.slice(0, -1)), 12_000);
    return () => clearTimeout(timer);
  }, [toasts]);

  const toggle = async () => {
    if (enabled) {
      setEnabled(false);
      try { localStorage.setItem(PREF, "0"); } catch {}
      return;
    }
    if (typeof Notification === "undefined") { setPermission("unsupported"); return; }
    let state = Notification.permission;
    if (state === "default") state = await Notification.requestPermission();
    setPermission(state);
    if (state !== "granted") return;
    setEnabled(true);
    try { localStorage.setItem(PREF, "1"); } catch {}
  };

  const label =
    permission === "unsupported" ? "NOTIF TIDAK DIDUKUNG"
    : permission === "denied" ? "NOTIF DIBLOKIR BROWSER"
    : enabled ? "🔔 NOTIF AKTIF" : "🔕 NOTIF MATI";

  return <>
    <div className="notifBar">
      <button
        className={enabled ? "notifOn" : ""}
        onClick={toggle}
        disabled={permission === "unsupported" || permission === "denied"}
      >{label}</button>
      <small>
        {permission === "denied"
          ? "Izin notifikasi diblokir di setelan browser untuk situs ini. Kartu peringatan di layar tetap muncul."
          : "Sinyal baru muncul sebagai kartu di layar. Aktifkan untuk notifikasi browser juga, termasuk saat tab tidak aktif."}
      </small>
    </div>

    {toasts.length > 0 && <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.key} className={`toast ${t.sig === "LONG" ? "tLong" : "tShort"}`}>
          <b>SINYAL BARU</b>
          <span>{t.text}</span>
          <button onClick={() => setToasts((cur) => cur.filter((x) => x.key !== t.key))}>✕</button>
        </div>
      ))}
      <p className="toastNote">Informasi teknikal, bukan anjuran masuk posisi.</p>
    </div>}
  </>;
}
