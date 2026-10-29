import type { Module, TestKind } from "./types";

/**
 * TOEIC Listening and Reading scores run 5–495 per section in steps of 5. ETS equates every form, so there is no
 * fixed raw-score table; the app estimates from the share correct with a curve close to the commonly cited ones
 * (Listening converts a little more generously than Reading). [percent correct, scaled score], interpolated.
 */
type Curve = [number, number][];

const LISTENING: Curve = [
  [0, 5], [10, 40], [20, 90], [30, 140], [40, 190], [50, 240], [60, 290], [70, 345], [80, 400], [90, 450], [96, 495], [100, 495],
];
const READING: Curve = [
  [0, 5], [10, 30], [20, 75], [30, 120], [40, 170], [50, 220], [60, 275], [70, 330], [80, 385], [90, 440], [97, 495], [100, 495],
];

/** Exposed for the guide's table. */
export const BAND_TABLES: { label: string; rows: [number, number][] }[] = [
  { label: "Listening", rows: LISTENING.filter(([p]) => p % 10 === 0).reverse() },
  { label: "Reading", rows: READING.filter(([p]) => p % 10 === 0).reverse() },
];

export interface BandResult {
  /** Estimated section score, 5–495. */
  band: number | null;
  /** Percent correct the score was read from. */
  scaled: number;
  /** Always true: an estimate, not an official conversion. */
  estimated: boolean;
}

function interpolate(curve: Curve, pct: number): number {
  for (let i = 1; i < curve.length; i++) {
    const [p1, s1] = curve[i];
    const [p0, s0] = curve[i - 1];
    if (pct <= p1) return s0 + ((s1 - s0) * (pct - p0)) / Math.max(1, p1 - p0);
  }
  return 495;
}

export function bandFor(kind: TestKind, _module: Module, correct: number, total: number): BandResult {
  const pct = total > 0 ? (correct * 100) / total : 0;
  const raw = interpolate(kind === "listening" ? LISTENING : READING, pct);
  const band = Math.min(495, Math.max(5, Math.round(raw / 5) * 5));
  return { band, scaled: Math.round(pct), estimated: true };
}

export function formatBand(r: BandResult): string {
  const value = r.band === null ? "–" : String(r.band);
  return r.estimated ? `${value} (추정)` : value;
}
