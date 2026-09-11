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
            setMessage(data.error === "push_not_configured" ? "Server belum siap." : response.status === 401 ? "Login kembali." : "Coba lagi.");
          }
        }
      } catch { if (!disposed) { onActive(false); setMessage("Coba lagi."); } }
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
      throw new Error(data.error === "push_not_configured" ? "Server belum siap." : response.status === 401 ? "Login kembali." : "Coba lagi.");
    }
  };

  const toggle = async () => {
    setBusy(true); setMessage("");
    try {
      // Request permission directly from the click, before any network await (iOS).
      if (!active) {
        const state = await Notification.requestPermission();
        setPermission(state);
        if (state !== "granted") { setMessage("Coba lagi."); return; }
      }
      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      let sub = await registration.pushManager.getSubscription();
      if (active) {
        if (sub) {
          await mutate("unsubscribe", { endpoint: sub.endpoint });
           if (!await sub.unsubscribe()) throw new Error("Coba lagi.");
        }
        setActive(false); onActive(false);
      } else {
        const response = await fetch("/api/push/subscribe", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error === "push_not_configured" ? "Server belum siap." : response.status === 401 ? "Login kembali." : "Coba lagi.");
        const key = Uint8Array.from(atob(data.publicKey.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
        const created = !sub;
        sub ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        try { await mutate("subscribe", sub.toJSON()); }
        catch (error) { if (created) await sub.unsubscribe(); throw error; }
        setActive(true); onActive(true);
      }
    } catch (error) { setMessage(error instanceof Error && ["Server belum siap.", "Login kembali."].includes(error.message) ? error.message : "Coba lagi."); }
    finally { setBusy(false); }
  };

  return <>
    <button className={active ? "notifOn" : ""} onClick={toggle} disabled={busy || !supported || (!active && permission === "denied")}>
      {busy ? "PUSH MEMUAT..." : !supported ? "PUSH TIDAK DIDUKUNG" : active ? "PUSH AKTIF" : permission === "denied" ? "PUSH DIBLOKIR" : "AKTIFKAN PUSH"}
    </button>
    {message && <small role="status">{message}</small>}
  </>;
}
