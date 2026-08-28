"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("sending"); setMessage("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setPassword("");
      const next = params.get("next");
      router.replace(next && next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (error) {
      setState("error"); setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return <form className="loginCard" onSubmit={submit}>
    <p className="eyebrow">AKSES TERBATAS</p>
    <h1>SCREENER</h1>
    <p className="lead">Masuk untuk melihat sinyal teknikal dan forward lab.</p>
    <label htmlFor="password">Password</label>
    <input id="password" name="password" type="password" autoComplete="current-password"
      value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
    <button type="submit" disabled={state === "sending" || !password}>
      {state === "sending" ? "MEMERIKSA…" : "MASUK"}
    </button>
    <small role={state === "error" ? "alert" : undefined}>
      {message || "Sesi otomatis berakhir setelah 2 jam tanpa aktivitas."}
    </small>
  </form>;
}
