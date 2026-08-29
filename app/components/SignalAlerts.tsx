"use client";

import { useEffect, useRef, useState } from "react";
import type { Row } from "../lib/format";
import {
  type AlertPrefs, type AlertState, type InboxItem, alertTransitions,
  defaultAlertPrefs, inboxUnread, markInboxRead, mergeInbox, mergeInboxBaseline,
  newSignals, notifiable, signalKey, summarize, trimSeen,
} from "../lib/notify";

const SEEN_STORE = "screener_seen_signals";
const INBOX_STORE = "screener_signal_inbox_v1";
const PREF = "screener_notify_on";
const ALERT_PREFS = "screener_status_alert_prefs_v1";
const ALERT_STATES = "screener_status_alert_states_v1";

type Toast = { key: string; text: string; sig: "LONG" | "SHORT" };

const when = (ts: number) => new Date(ts).toLocaleString("id-ID", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
});

export default function SignalAlerts({
  rows, onOpenSignal,
}: {
  rows: Row[];
  onOpenSignal: (coin: string) => void;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [alertPrefs, setAlertPrefs] = useState<AlertPrefs>(defaultAlertPrefs);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const hydrated = useRef(false);
  const statusStates = useRef<Map<string, AlertState>>(new Map());

  useEffect(() => {
    try {
      const storedSeen = localStorage.getItem(SEEN_STORE);
      if (storedSeen) seen.current = new Set(JSON.parse(storedSeen) as string[]);
      const storedInbox = localStorage.getItem(INBOX_STORE);
      if (storedInbox) setInbox(JSON.parse(storedInbox) as InboxItem[]);
      const storedPrefs = localStorage.getItem(ALERT_PREFS);
      if (storedPrefs) setAlertPrefs({ ...defaultAlertPrefs, ...JSON.parse(storedPrefs) });
      const storedStates = localStorage.getItem(ALERT_STATES);
      if (storedStates) statusStates.current = new Map(JSON.parse(storedStates));
      setEnabled(localStorage.getItem(PREF) === "1");
    } catch { /* private mode: fall back to in-memory only */ }
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try { localStorage.setItem(INBOX_STORE, JSON.stringify(inbox)); } catch {}
  }, [inbox]);

  useEffect(() => {
    const live = notifiable(rows);
    // Wait for the first real payload; the placeholder rows carry no signals.
    if (!live.length && !primed.current) return;

    const fresh = newSignals(rows, seen.current);
    for (const r of live) seen.current.add(signalKey(r));
    try {
      localStorage.setItem(SEEN_STORE, JSON.stringify(trimSeen(Array.from(seen.current))));
    } catch {}

    // Existing signals form the baseline: they go into the inbox as read, but do
    // not impersonate news with a badge/toast every time the page is opened.
    if (!primed.current) {
      primed.current = true;
      setInbox((cur) => mergeInboxBaseline(cur, live));
      return;
    }
    if (!fresh.length) return;

    setInbox((cur) => mergeInbox(cur, fresh));
    setToasts((cur) => [
      ...fresh.map((r) => ({ key: signalKey(r), text: summarize(r), sig: r.sig! })),
      ...cur,
    ].slice(0, 4));

    if (enabled && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const r of fresh) {
        try {
          new Notification(`Sinyal baru: ${r.coin} ${r.sig}`, {
            body: summarize(r), tag: signalKey(r), silent: false,
          });
        } catch {}
      }
    }
  }, [rows, enabled]);

  useEffect(() => {
    if (!hydrated.current) return;
    const transition = alertTransitions(rows, statusStates.current, alertPrefs);
    statusStates.current = transition.states;
    try {
      localStorage.setItem(ALERT_STATES, JSON.stringify(Array.from(transition.states).slice(-400)));
      localStorage.setItem(ALERT_PREFS, JSON.stringify(alertPrefs));
    } catch {}
    if (!transition.events.length) return;
    setToasts((cur) => [...transition.events.map((event) => ({
      key: `${event.key}-${event.kind}`, text: event.text, sig: event.sig,
    })), ...cur].slice(0, 4));
    if (enabled && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const event of transition.events) {
        try { new Notification(`Update ${event.coin}: ${event.kind}`, { body: event.text, tag: `${event.key}-${event.kind}` }); } catch {}
      }
    }
  }, [rows, enabled, alertPrefs]);

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

  const openItem = (item: InboxItem) => {
    setInbox((cur) => markInboxRead(cur, item.key));
    setInboxOpen(false);
    onOpenSignal(item.coin);
  };

  const label =
    permission === "unsupported" ? "NOTIF TIDAK DIDUKUNG"
    : permission === "denied" ? "NOTIF DIBLOKIR BROWSER"
    : enabled ? "🔔 NOTIF AKTIF" : "🔕 NOTIF MATI";
  const unread = inboxUnread(inbox);

  return <>
    <div className="notifBar">
      <button
        className={enabled ? "notifOn" : ""}
        onClick={toggle}
        disabled={permission === "unsupported" || permission === "denied"}
      >{label}</button>
      <button className={`inboxToggle ${inboxOpen ? "notifOn" : ""}`} onClick={() => setInboxOpen((v) => !v)}>
        ☰ INBOX {unread > 0 && <i>{unread > 99 ? "99+" : unread}</i>}
      </button>
      <button className={settingsOpen ? "notifOn" : ""} onClick={() => setSettingsOpen((v) => !v)}>⚙ ALERT STATUS</button>
      <small>
        {permission === "denied"
          ? "Notifikasi browser diblokir. Inbox sinyal dan kartu peringatan tetap bekerja."
          : "Inbox menyimpan 100 sinyal terbaru di browser ini. Sinyal baru ditandai belum dibaca."}
      </small>
    </div>

    {settingsOpen && <div className="alertSettings">
      <b>UPDATE STATUS YANG DINOTIFIKASIKAN</b>
      {([
        ["entry", "MASUK ZONA ENTRY"], ["invalidated", "INVALID / STOP"],
        ["tp1", "TP1 TERSENTUH"], ["tp2", "TP2 TERSENTUH"], ["timeout", "TIMEOUT 24 JAM"],
      ] as [keyof AlertPrefs, string][]).map(([key, text]) => (
        <label key={key}><input type="checkbox" checked={alertPrefs[key]}
          onChange={(e) => setAlertPrefs((cur) => ({ ...cur, [key]: e.target.checked }))} /> {text}</label>
      ))}
      <small>Toast tampil selama halaman aktif. Notifikasi OS mengikuti tombol NOTIF AKTIF. Event yang sama tidak diulang.</small>
    </div>}

    {inboxOpen && <aside className="signalInbox" aria-label="Inbox sinyal">
      <div className="inboxHead">
        <div><b>INBOX SINYAL</b><span>{unread} belum dibaca · {inbox.length} tersimpan</span></div>
        <div>
          {unread > 0 && <button onClick={() => setInbox((cur) => markInboxRead(cur))}>TANDAI SEMUA DIBACA</button>}
          <button onClick={() => setInboxOpen(false)}>✕</button>
        </div>
      </div>
      {inbox.length === 0
        ? <p className="inboxEmpty">Belum ada sinyal. Inbox mulai terisi saat setup pertama lahir.</p>
        : <div className="inboxList">{inbox.map((item) => (
          <button key={item.key} className={`inboxItem ${item.read ? "" : "unread"} ${item.sig === "LONG" ? "iLong" : "iShort"}`} onClick={() => openItem(item)}>
            <span className="inboxDot" />
            <span className="inboxMain"><b>{item.coin} {item.sig}</b><small>{item.text}</small></span>
            <span className="inboxMeta"><b>SKOR {item.score}</b><small>{when(item.signal_closed_at)}</small></span>
          </button>
        ))}</div>}
      <p className="inboxNote">Disimpan lokal di browser ini, bukan sinkron antarperangkat. Klik item untuk buka chart coin terkait.</p>
    </aside>}

    {toasts.length > 0 && <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.key} className={`toast ${t.sig === "LONG" ? "tLong" : "tShort"}`}>
          <b>SINYAL BARU</b><span>{t.text}</span>
          <button onClick={() => setToasts((cur) => cur.filter((x) => x.key !== t.key))}>✕</button>
        </div>
      ))}
      <p className="toastNote">Informasi teknikal, bukan anjuran masuk posisi.</p>
    </div>}
  </>;
}
