import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Screener — Futures Intelligence",
  description: "Realtime crypto futures market screener",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
