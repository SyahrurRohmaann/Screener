import type { MetadataRoute } from "next";

/**
 * Served at /manifest.webmanifest. Kept as a route rather than a static JSON file so
 * the shape is type-checked at build time.
 *
 * `display: standalone` is what makes the installed app drop the browser address bar.
 * Note that installing does NOT grant background notifications — that needs Web Push,
 * which is not implemented yet.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Screener — Futures Intelligence",
    short_name: "Screener",
    description: "Alat bantu keputusan manual berbasis data Binance Futures. Bukan rekomendasi trading.",
    lang: "id",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#080a0e",
    theme_color: "#080a0e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Padded so Android can crop it to any shape without eating the mark.
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
