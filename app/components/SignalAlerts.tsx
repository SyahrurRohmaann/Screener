"use client";

import { useEffect, useRef, useState } from "react";
import type { Row } from "../lib/format";
import {
  type AlertPrefs, type AlertState, type InboxItem, alertTransitions,
  defaultAlertPrefs, inboxUnread, markInboxRead, mergeInbox, mergeInboxBaseline,
  newSignals, notifiable, signalKey, summarize, trimSeen,
} from "../lib/notify";
import { audioSupported, chimeForSignal, chimeForStatus, clampVolume, playChime, unlockAudio } from "../lib/chime";

const SEEN_STORE = "screener_seen_signals";
const INBOX_STORE = "screener_signal_inbox_v1";
const PREF = "screener_notify_on";
const ALERT_PREFS = "screener_status_alert_prefs_v1";
// v2 stores an array of reached milestones per signal; v1 stored a single state
// string and is intentionally ignored rather than migrated.
const ALERT_STATES = "screener_status_alert_states_v2";
const SOUND_PREF = "screener_alert_sound_v1";
const VOLUME_PREF = "screener_alert_volume_v1";

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
  const [sound, setSound] = useState(false);
  const [volume, setVolume] = useState(0.7);
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
      if (storedStates) {
        // Drop anything that is not a milestone array, so a corrupt or foreign
        // value cannot make every level look already-fired (or re-fire).
        const parsed = JSON.parse(storedStates) as [string, unknown][];
        statusStates.current = new Map(
          (Array.isArray(parsed) ? parsed : [])
            .filter(([key, value]) => typeof key === "string" && Array.isArray(value))
            .map(([key, value]) => [key, (value as string[]).filter(
              (k) => ["ENTRY", "INVALIDATED", "TP1", "TP2"].includes(k)) as AlertState]),
        );
      }
      const storedVolume = localStorage.getItem(VOLUME_PREF);
      if (storedVolume != null) setVolume(clampVolume(Number(storedVolume)));
      // Audio cannot be resumed without a gesture, so a stored preference only
      // arms a one-shot unlock on the first click anywhere on the page.
      if (localStorage.getItem(SOUND_PREF) === "1") {
        const arm = () => {
          if (unlockAudio()) setSound(true);
          window.removeEventListener("pointerdown", arm);
          window.removeEventListener("keydown", arm);
        };
        window.addEventListener("pointerdown", arm, { once: true });
        window.addEventListener("keydown", arm, { once: true });
      }
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

    // Sound first: it is the part that reaches you when you are not looking.
    if (sound) for (const r of fresh) playChime(chimeForSignal(r.sig!), volume);

    if (enabled && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const r of fresh) {
        try {
          new Notification(`Sinyal baru: ${r.coin} ${r.sig}`, {
            body: summarize(r), tag: signalKey(r), silent: false,
          });
        } catch {}
      }
    }
  }, [rows, enabled, sound, volume]);

  useEffect(() => {
    if (!hydrated.current) return;
    const transition = alertTransitions(rows, statusStates.current, alertPrefs);
    statusStates.current = transition.states;
    try {
      localStorage.setItem(ALERT_STATES, JSON.stringify(Array.from(transition.states).slice(-400)));
      localStorage.setItem(ALERT_PREFS, JSON.stringify(alertPrefs));
    } catch {}
    if (!transition.events.length) return;
    if (sound) playChime(chimeForStatus(transition.events[0].kind), volume);
    setToasts((cur) => [...transition.events.map((event) => ({
      key: `${event.key}-${event.kind}`, text: event.text, sig: event.sig,
    })), ...cur].slice(0, 4));
    if (enabled && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const event of transition.events) {
        try { new Notification(`Update ${event.coin}: ${event.kind}`, { body: event.text, tag: `${event.key}-${event.kind}` }); } catch {}
      }
    }
  }, [rows, enabled, alertPrefs, sound, volume]);

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

  /**
   * Browsers only allow audio to start from a user gesture, so the toggle both
   * unlocks the AudioContext and plays a sample: you hear exactly what will fire.
   */
  const toggleSound = () => {
    if (sound) {
      setSound(false);
      try { localStorage.setItem(SOUND_PREF, "0"); } catch {}
      return;
    }
    if (!unlockAudio()) return;
    setSound(true);
    try { localStorage.setItem(SOUND_PREF, "1"); } catch {}
    playChime("NEW_LONG", volume);
  };

  const changeVolume = (next: number) => {
    const safe = clampVolume(next);
    setVolume(safe);
    try { localStorage.setItem(VOLUME_PREF, String(safe)); } catch {}
    if (sound) playChime("STATUS", safe);
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
      <button className={sound ? "notifOn" : ""} onClick={toggleSound} disabled={!audioSupported()}>
        {!audioSupported() ? "SUARA TIDAK DIDUKUNG" : sound ? "🔊 SUARA AKTIF" : "🔈 SUARA MATI"}
      </button>
      {sound && <label className="volCtl">KERAS
        <input type="range" min={0.2} max={1} step={0.1} value={volume}
          onChange={(e) => changeVolume(Number(e.target.value))} />
        <b>{Math.round(volume * 100)}%</b>
      </label>}
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
        ["tp1", "TP1 TERSENTUH"], ["tp2", "TP2 TERSENTUH"],
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
