"use client";

import { useEffect, useState } from "react";
import {
  clampScale, DEFAULT_SCALE, isLargest, isSmallest,
  nextScale, SCALE_KEY, scaleLabel,
} from "../lib/ui-scale";

/**
 * A− / A+ control over the root font size. This is deliberately separate from the
 * browser's own zoom: zoom scales the whole layout, this scales only text, so tables
 * and charts keep their proportions while labels get readable.
 */
export default function ScaleControl() {
  const [scale, setScale] = useState<number>(DEFAULT_SCALE);
  const [ready, setReady] = useState(false);

  // Read the stored preference after mount. The pre-paint script in <head> has already
  // applied it to the DOM, so this only syncs React's copy — no visible jump.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SCALE_KEY);
      if (stored != null) setScale(clampScale(stored));
    } catch { /* localStorage can throw in privacy modes; default stands */ }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.style.setProperty("--ui-scale", String(scale));
    try { localStorage.setItem(SCALE_KEY, String(scale)); } catch { /* not fatal */ }
  }, [scale, ready]);

  const step = (direction: 1 | -1) => setScale((current) => nextScale(current, direction));

  return <div className="scaleCtl" role="group" aria-label="Ukuran huruf">
    <span aria-hidden="true">HURUF</span>
    <button
      onClick={() => step(-1)}
      disabled={isSmallest(scale)}
      aria-label="Perkecil huruf"
      title="Perkecil huruf"
    >A−</button>
    <b aria-live="polite">{scaleLabel(scale)}</b>
    <button
      onClick={() => step(1)}
      disabled={isLargest(scale)}
      aria-label="Perbesar huruf"
      title="Perbesar huruf"
    >A+</button>
    {scale !== DEFAULT_SCALE && <button
      onClick={() => setScale(DEFAULT_SCALE)}
      aria-label="Kembalikan ukuran huruf ke 100 persen"
      title="Kembali ke 100%"
    >RESET</button>}
  </div>;
}
