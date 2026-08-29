/**
 * Audible alert tones, synthesised with WebAudio so no audio asset ships and
 * nothing is fetched at runtime. Tone specs are pure data so they can be tested
 * without an AudioContext, which does not exist in Node.
 */

export type Tone = { hz: number; ms: number; gap_ms: number };
export type ChimeKind = "NEW_LONG" | "NEW_SHORT" | "STATUS" | "INVALIDATED";

/**
 * Deliberately loud and repetitive: a single soft ping is easy to miss, so a new
 * signal gets three notes. LONG rises, SHORT falls, so direction is audible
 * without looking at the screen.
 */
export function toneSpec(kind: ChimeKind): Tone[] {
  switch (kind) {
    case "NEW_LONG":
      return [
        { hz: 784, ms: 130, gap_ms: 60 },
        { hz: 1046, ms: 130, gap_ms: 60 },
        { hz: 1318, ms: 260, gap_ms: 0 },
      ];
    case "NEW_SHORT":
      return [
        { hz: 1318, ms: 130, gap_ms: 60 },
        { hz: 1046, ms: 130, gap_ms: 60 },
        { hz: 784, ms: 260, gap_ms: 0 },
      ];
    case "INVALIDATED":
      return [
        { hz: 440, ms: 200, gap_ms: 70 },
        { hz: 330, ms: 320, gap_ms: 0 },
      ];
    default:
      return [
        { hz: 988, ms: 110, gap_ms: 70 },
        { hz: 988, ms: 110, gap_ms: 0 },
      ];
  }
}

/** Total wall time of a tone sequence, used for scheduling and tests. */
export const toneDurationMs = (tones: Tone[]) =>
  tones.reduce((total, tone) => total + tone.ms + tone.gap_ms, 0);

export const chimeForSignal = (sig: "LONG" | "SHORT"): ChimeKind =>
  sig === "LONG" ? "NEW_LONG" : "NEW_SHORT";

export const chimeForStatus = (kind: string): ChimeKind =>
  kind === "INVALIDATED" ? "INVALIDATED" : "STATUS";

/** Clamped so a stored preference can never blow out the user's speakers. */
export const clampVolume = (value: number) =>
  !Number.isFinite(value) ? 0.7 : Math.min(1, Math.max(0, value));

type Ctx = AudioContext & { resume: () => Promise<void> };
let ctx: Ctx | null = null;

/**
 * Must be called from a real user gesture: browsers refuse to start audio
 * otherwise, which is why the sound toggle is a button and not an auto-enable.
 */
export function unlockAudio(): boolean {
  if (typeof window === "undefined") return false;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return false;
  try {
    ctx = ctx ?? (new Ctor() as Ctx);
    if (ctx.state === "suspended") void ctx.resume();
    return true;
  } catch { return false; }
}

export const audioSupported = () =>
  typeof window !== "undefined" &&
  !!(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);

/** Square wave: harsher than a sine on purpose, so it cuts through other audio. */
export function playChime(kind: ChimeKind, volume = 0.7) {
  if (!ctx || ctx.state !== "running") return false;
  const gain = clampVolume(volume);
  if (gain === 0) return false;
  let at = ctx.currentTime + 0.01;
  for (const tone of toneSpec(kind)) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = tone.hz;
    // Short attack/decay ramps avoid the click a raw gate would produce.
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(gain * 0.35, at + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + tone.ms / 1000);
    osc.connect(amp).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + tone.ms / 1000 + 0.02);
    at += (tone.ms + tone.gap_ms) / 1000;
  }
  return true;
}
