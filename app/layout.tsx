import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { SCALE_BOOTSTRAP } from "./lib/ui-scale";

export const metadata: Metadata = {
  title: "Screener — Futures Intelligence",
  description: "Realtime crypto futures market screener",
  applicationName: "Screener",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "Screener", statusBarStyle: "black-translucent" },
};

/**
 * `width=device-width` is what stops Android rendering the page at ~980px and shrinking
 * it, which is why every label used to look microscopic on a phone.
 *
 * maximumScale / userScalable are deliberately NOT set: locking zoom to make a PWA feel
 * "native" would remove the reader's own ability to enlarge text.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080a0e",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id">
    <head>
      {/* Applies the stored text size before first paint, so the page does not render
          at 100% and then visibly jump. localStorage is unreachable on the server. */}
      <Script id="ui-scale-bootstrap" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: SCALE_BOOTSTRAP }} />
    </head>
    <body>{children}</body>
  </html>;
}
