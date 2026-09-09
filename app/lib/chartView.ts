export const MAX_RIGHT_FRACTION = 0.25;
export const VISIBLE_BARS = 100;

export function clampOffset(offsetPx: number, bars: number, visibleBars: number, step: number, maxRightPx: number) {
  const min = Math.min(0, -(bars - visibleBars) * step);
  return Math.max(min, Math.min(maxRightPx, offsetPx));
}

export function indexToX(index: number, bars: number, visibleBars: number, step: number, left: number, offsetPx: number) {
  return left + (index - Math.max(0, bars - visibleBars) + 0.5) * step - offsetPx;
}

export function percentageLabel(price: number, lastClose: number): string | null {
  if (!Number.isFinite(price) || !Number.isFinite(lastClose) || lastClose <= 0) return null;
  const pct = (price - lastClose) / lastClose * 100;
  if (!Number.isFinite(pct)) return null;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}
