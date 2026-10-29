/**
 * Filtering of the set library by section (Listening, Reading), by where a set came from and by the request behind
 * an AI-written set (target, model).
 * Pure functions over TestSummary rows, so the list page stays a thin view.
 */
import type { GenMeta, Origin, TestKind, TestSummary } from "./types";

export const ORIGIN_LABEL: Record<Origin, string> = {
  sample: "샘플",
  ai: "AI 생성",
  mine: "내 자료",
  shared: "공유 파일",
  market: "마켓 구매",
};

export const KIND_LABEL: Record<TestKind, string> = { listening: "Listening", reading: "Reading" };

export interface LibraryFilter {
  kind: TestKind | "all";
  origin: Origin | "all";
  /** Target total score of an AI-written set; null for any. */
  band: number | null;
  /** Model name, or the provider id when a CLI ran its default model; empty for any. */
  model: string;
  /** Words looked for in the title and the topic; all must occur. */
  query: string;
  /** Only sets never taken. */
  unattempted: boolean;
}

export const EMPTY_FILTER: LibraryFilter = { kind: "all", origin: "all", band: null, model: "", query: "", unattempted: false };

/** The model to show and filter by: a CLI run with no model name is listed under its provider. */
export const modelKey = (g: GenMeta): string => g.model || g.provider;

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

export function filterTests(rows: TestSummary[], f: LibraryFilter): TestSummary[] {
  const terms = words(f.query);
  return rows.filter((t) => {
    if (f.kind !== "all" && t.kind !== f.kind) return false;
    if (f.origin !== "all" && t.origin !== f.origin) return false;
    if (f.band !== null && t.gen?.band !== f.band) return false;
    if (f.model && (!t.gen || modelKey(t.gen) !== f.model)) return false;
    if (f.unattempted && t.attempts > 0) return false;
    if (terms.length) {
      const hay = `${t.title} ${t.gen?.topic ?? ""}`.toLowerCase();
      if (!terms.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export const isFiltering = (f: LibraryFilter): boolean =>
  f.kind !== "all" || f.origin !== "all" || f.band !== null || f.model !== "" || f.query.trim() !== "" || f.unattempted;

/** What the filter controls can offer: the origins present, and the targets and models among AI-written rows. */
export function filterChoices(rows: TestSummary[]): { origins: Origin[]; bands: number[]; models: string[] } {
  const bands = new Set<number>();
  const models = new Set<string>();
  for (const t of rows) {
    if (!t.gen) continue;
    bands.add(t.gen.band);
    models.add(modelKey(t.gen));
  }
  const present = new Set(rows.map((t) => t.origin));
  return {
    origins: (Object.keys(ORIGIN_LABEL) as Origin[]).filter((o) => present.has(o)),
    bands: [...bands].sort((a, b) => a - b),
    models: [...models].sort((a, b) => a.localeCompare(b)),
  };
}

/** One line under an AI-written set's title: topic, target score, model. */
export const genMetaLine = (g: GenMeta): string => [g.topic.trim(), `목표 ${g.band}점`, modelKey(g)].filter(Boolean).join(" · ");
