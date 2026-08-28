"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import "./account.css";

export default function AccountPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (next !== confirm) { setState("error"); setMessage("Konfirmasi password baru tidak sama."); return; }
    setState("saving"); setMessage("");
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setCurrent(""); setNext(""); setConfirm("");
      setState("done"); setMessage("Password diganti. Perangkat lain sudah dikeluarkan.");
    } catch (error) {
      setState("error"); setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return <div className="accountPanel">
    <button type="button" className="accountToggle" onClick={() => setOpen(!open)}>
      {open ? "TUTUP AKUN" : "AKUN"}
    </button>
    <button type="button" className="accountToggle" onClick={signOut}>KELUAR</button>
    {open && <form className="accountForm" onSubmit={submit}>
      <label htmlFor="current">Password sekarang</label>
      <input id="current" type="password" autoComplete="current-password" value={current}
        onChange={(e) => setCurrent(e.target.value)} required />
      <label htmlFor="next">Password baru (min. 8 karakter)</label>
      <input id="next" type="password" autoComplete="new-password" minLength={8} value={next}
        onChange={(e) => setNext(e.target.value)} required />
      <label htmlFor="confirm">Ulangi password baru</label>
      <input id="confirm" type="password" autoComplete="new-password" minLength={8} value={confirm}
        onChange={(e) => setConfirm(e.target.value)} required />
      <button type="submit" disabled={state === "saving"}>
        {state === "saving" ? "MENYIMPAN…" : "GANTI PASSWORD"}
      </button>
      <small role={state === "error" ? "alert" : undefined}>{message || "Sesi lain akan otomatis keluar."}</small>
    </form>}
  </div>;
}
