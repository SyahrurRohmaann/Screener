"use client";
import { useState } from "react";

export default function SnapshotAction({ complete }: { complete: boolean }) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  async function save() {
    setState("saving"); setMessage("");
    try {
      const response = await fetch("/api/ranking/snapshot", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setState("done"); setMessage(data.created ? "Snapshot minggu ini dibekukan." : "Snapshot minggu ini sudah ada.");
      window.location.reload();
    } catch (error) {
      setState("error"); setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  return <div className="snapshotAction">
    <button onClick={save} disabled={!complete || state === "saving"}>
      {state === "saving" ? "MENYIMPAN…" : "BEKUKAN SNAPSHOT MINGGU INI"}
    </button>
    <small>{message || (complete ? "Hanya aktif Senin 08:00–08:30 UTC; tidak bisa backfill." : "Data harus lengkap 16/16.")}</small>
  </div>;
}
