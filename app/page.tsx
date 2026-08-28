import { redirect } from "next/navigation";
import Dashboard from "./components/Dashboard";
import { currentSession } from "./lib/session";

export const dynamic = "force-dynamic";

/**
 * Server gate: the middleware only proves a cookie exists, so validity and the two-hour
 * idle expiry are enforced here before any market data is rendered.
 */
export default async function Home() {
  if (!(await currentSession())) redirect("/login");
  return <Dashboard />;
}
