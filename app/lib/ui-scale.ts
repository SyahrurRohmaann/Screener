/**
 * Reader-controlled text size.
 *
 * The base is `calc(100% * var(--ui-scale))`, never a fixed pixel value: 100% already
 * honours the font size the reader set in Android/Chrome, and --ui-scale is an extra
 * in-app multiplier on top of it. Pinning the base to 16px would silently discard the
 * OS setting and just move the problem.
 */

export const SCALE_STEPS = [0.85, 0.925, 1, 1.1, 1.25, 1.4, 1.6] as const;
export const DEFAULT_SCALE = 1;
export const SCALE_KEY = "screener_ui_scale_v1";

/** Nearest legal step. Anything unparseable falls back to 100% rather than throwing. */
export function clampScale(value: unknown): number {
  // An empty string coerces to 0, which would otherwise snap to the smallest step and
  // shrink the whole UI on a cleared localStorage entry.
  const n = typeof value === "string" ? (value.trim() === "" ? NaN : Number(value)) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_SCALE;
  let best = SCALE_STEPS[0] as number;
  for (const step of SCALE_STEPS) {
    if (Math.abs(step - n) < Math.abs(best - n)) best = step;
  }
  return best;
}

/** One step up (1) or down (-1); stops at the ends instead of wrapping around. */
export function nextScale(current: number, direction: 1 | -1): number {
  const index = SCALE_STEPS.indexOf(clampScale(current) as (typeof SCALE_STEPS)[number]);
  const target = index + direction;
  if (target < 0 || target >= SCALE_STEPS.length) return SCALE_STEPS[index];
  return SCALE_STEPS[target];
}

export function scaleLabel(value: number): string {
  return `${Math.round(clampScale(value) * 100)}%`;
}

export function isSmallest(value: number): boolean {
  return clampScale(value) === SCALE_STEPS[0];
}
export function isLargest(value: number): boolean {
  return clampScale(value) === SCALE_STEPS[SCALE_STEPS.length - 1];
}

/**
 * The inline script that applies the stored scale before first paint. Without it the
 * page renders at 100% and then jumps, because localStorage cannot be read on the
 * server. Kept as a string so it can be injected and unit-tested as data.
 */
export const SCALE_BOOTSTRAP = `(function(){try{var v=localStorage.getItem(${JSON.stringify(SCALE_KEY)});var n=parseFloat(v);var s=[${SCALE_STEPS.join(",")}];if(!isFinite(n))return;var b=s[0];for(var i=0;i<s.length;i++){if(Math.abs(s[i]-n)<Math.abs(b-n))b=s[i];}document.documentElement.style.setProperty("--ui-scale",String(b));}catch(e){}})();`;
