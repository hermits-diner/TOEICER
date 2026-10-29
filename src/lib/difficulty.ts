/**
 * How hard the items of an AI-written set are, shaped like a real paper: difficulty is mixed within every text or
 * part, and rises from the first to the last. The target band sets the centre of the mix; a text's position tilts it.
 *
 * Real papers are equated so that each sitting is as hard as the last, and a band comes from the raw score against a
 * table built for that mix. Items pitched at one level only would make the app's estimated band too generous on an easy
 * set and too harsh on a hard one; a mix keeps the conversion closer to the real thing.
 */
import type { Module } from "./types";

export interface Shares {
  easy: number;
  mid: number;
  hard: number;
}
export type Counts = Shares;

/** How the three tiers are shared at a band: 5.5 → 60/30/10, 6.5 → 40/40/20, 7.5 → 20/40/40, 8.0 → 15/35/50. */
export function tierShares(band: number): Shares {
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  const easy = round2(clamp(0.4 - (band - 6.5) * 0.2, 0.15, 0.6));
  const hard = round2(clamp(0.2 + (band - 6.5) * 0.2, 0.1, 0.5));
  return { easy, mid: round2(1 - easy - hard), hard };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Whole items per tier that add up to `total` (largest remainder), every tier keeping at least one item when there are enough. */
export function splitCounts(total: number, shares: Shares): Counts {
  const keys: (keyof Shares)[] = ["easy", "mid", "hard"];
  const raw = keys.map((k) => total * shares[k]);
  const counts = raw.map(Math.floor);
  let left = total - counts.reduce((a, b) => a + b, 0);
  const order = keys.map((_, i) => i).sort((a, b) => raw[b] - counts[b] - (raw[a] - counts[a]));
  for (const i of order) {
    if (left <= 0) break;
    counts[i] += 1;
    left -= 1;
  }
  for (const i of [1, 2]) {
    if (counts[i] > 0) continue;
    const from = counts.indexOf(Math.max(...counts));
    if (counts[from] > 1) {
      counts[from] -= 1;
      counts[i] = 1;
    }
  }
  return { easy: counts[0], mid: counts[1], hard: counts[2] };
}

export type MixKind = "reading" | "listening";

/** The paper's tilt: the first text or part sits half a band under the target, the last half a band over. */
const SLOPE: Record<MixKind, Record<number, number>> = {
  reading: { 1: -0.5, 2: 0, 3: 0.5 },
  listening: { 1: -0.5, 2: 0, 3: 0, 4: 0.5 },
};

export function sectionBand(band: number, kind: MixKind, position: number): number {
  return band + (SLOPE[kind][position] ?? 0);
}

export function difficultyMix(band: number, kind: MixKind, position: number, total: number): Counts & { band: number } {
  const b = sectionBand(band, kind, position);
  return { band: b, ...splitCounts(total, tierShares(b)) };
}

const TIERS =
  '"locate" items are answered by finding one sentence and recognising a close paraphrase, and their distractors are clearly wrong on a careful reading; ' +
  '"paraphrase" items need a paraphrase across two sentences or a paragraph, and their distractors reuse words from the wrong part of the text; ' +
  '"inference" items need inference, the writer\'s stance, or the difference between a claim and an example, and their distractors differ from the key in one precise detail (scope, cause, time, degree).';

/** The prompt's difficulty instruction: the target, the three tiers, and the counts for each section asked for. */
export function difficultyGuide(
  band: number,
  kind: MixKind,
  sections: { position: number; total: number }[],
  module: Module = "academic",
): string {
  const name = kind === "listening" ? "Part" : module === "general" ? "Section" : "Passage";
  const lines = sections.map((s) => {
    const m = difficultyMix(band, kind, s.position, s.total);
    return `- ${name} ${s.position} (${s.total} items): ${m.easy} locate, ${m.mid} paraphrase, ${m.hard} inference`;
  });
  return [
    `Target level: IELTS band ${band.toFixed(1)} overall. Difficulty is set by the questions, not by the vocabulary of the text, which is always written for an educated general reader.`,
    `As in the real paper the items are mixed in difficulty within each ${name.toLowerCase()}, and later ${name.toLowerCase()}s run harder than earlier ones. Three tiers: ${TIERS}`,
    `Items per tier (spread the tiers through the groups rather than putting all the hard items in one group):`,
    ...lines,
  ].join("\n");
}
