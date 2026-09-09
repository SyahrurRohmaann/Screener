"use client";

import { useEffect, useState } from "react";

export default function PushOptIn({ onActive }: { onActive: (active: boolean | null) => void }) {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    const available = window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(available);
    if (!available) { onActive(false); setBusy(false); return; }
    const refresh = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        const sub = await registration.pushManager.getSubscription();
        if (!disposed) { setActive(Boolean(sub)); onActive(Boolean(sub)); setPermission(Notification.permission); }
        if (sub) {
          const response = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
          if (!disposed && !response.ok) {
            const data = await response.json();
            setMessage(data.error === "push_not_configured" ? "Notifikasi server belum dikonfigurasi." : "Subscription browser aktif, tetapi sinkronisasi server gagal. Login kembali atau coba lagi.");
          }
        }
      } catch { if (!disposed) { onActive(false); setMessage("Tidak dapat memuat notifikasi server."); } }
      finally { if (!disposed) setBusy(false); }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { disposed = true; window.removeEventListener("focus", refresh); };
  }, [onActive]);

  const mutate = async (path: string, body: unknown) => {
    const response = await fetch(`/api/push/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error === "push_not_configured" ? "Notifikasi server belum dikonfigurasi." : response.status === 401 ? "Silakan login kembali." : "Tidak dapat menyimpan notifikasi server. Coba lagi.");
    }
  };

  const toggle = async () => {
    setBusy(true); setMessage("");
    try {
      // Request permission directly from the click, before any network await (iOS).
      if (!active) {
        const state = await Notification.requestPermission();
        setPermission(state);
        if (state !== "granted") { setMessage("Izinkan notifikasi di pengaturan browser."); return; }
      }
      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      let sub = await registration.pushManager.getSubscription();
      if (active) {
        if (sub) {
          await mutate("unsubscribe", { endpoint: sub.endpoint });
          if (!await sub.unsubscribe()) throw new Error("Gagal menonaktifkan subscription browser. Coba lagi.");
        }
        setActive(false); onActive(false);
        setMessage("Notifikasi server nonaktif di browser ini.");
      } else {
        const response = await fetch("/api/push/subscribe", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error === "push_not_configured" ? "Notifikasi server belum dikonfigurasi." : "Silakan login kembali atau coba lagi.");
        const key = Uint8Array.from(atob(data.publicKey.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
        const created = !sub;
        sub ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        try { await mutate("subscribe", sub.toJSON()); }
        catch (error) { if (created) await sub.unsubscribe(); throw error; }
        setActive(true); onActive(true);
        setMessage("Notifikasi server aktif, termasuk saat tab ditutup. Pengiriman mengikuti dukungan OS.");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Notifikasi server gagal."); }
    finally { setBusy(false); }
  };

  return <>
    <button className={active ? "notifOn" : ""} onClick={toggle} disabled={busy || !supported || (!active && permission === "denied")}>
      {!supported ? "PUSH TIDAK DIDUKUNG" : busy ? "PUSH MEMUAT..." : active ? "PUSH SERVER AKTIF: MATIKAN" : permission === "denied" ? "PUSH DIBLOKIR BROWSER" : "AKTIFKAN PUSH SERVER"}
    </button>
    {message && <small role="status">{message}</small>}
  </>;
}
