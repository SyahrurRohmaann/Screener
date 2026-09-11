export type SignalRef = { coin: string; closed_at: number };

export function parseSignalRef(value: string | null | undefined): SignalRef | null {
  const match = value?.match(/^([A-Z0-9]{2,15})-(\d{10,16})$/i);
  return match ? { coin: match[1].toUpperCase(), closed_at: Number(match[2]) } : null;
}

export function signalHref(key: string): string {
  return `/?s=${encodeURIComponent(key)}`;
}
