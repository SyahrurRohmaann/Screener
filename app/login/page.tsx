import { Suspense } from "react";
import { redirect } from "next/navigation";
import LoginForm from "../components/auth/LoginForm";
import { currentSession } from "../lib/session";
import "./login.css";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentSession()) redirect("/");
  return <main className="loginPage">
    <Suspense fallback={null}><LoginForm /></Suspense>
    <footer>SESI IDLE 2 JAM · HANYA UNTUK PEMILIK</footer>
  </main>;
}
