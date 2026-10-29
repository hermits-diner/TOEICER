/**
 * Filtering of the test library by origin and by the request behind an AI-written set (topic, band, model).
 * Pure functions over TestSummary rows, so the list page stays a thin view.
 */
import type { AiSettings } from "./ai";
import type { GenOptions } from "./generate";
import { topicKey } from "./generate";
import type { GenMeta, GenTopic, TestKind, TestSummary } from "./types";

export type Origin = "all" | "ai" | "shared" | "collected";

export interface LibraryFilter {
  origin: Origin;
  /** Target band of an AI-written set; null for any. */
  band: number | null;
  /** Model name, or the provider id when a CLI ran its default model; empty for any. */
  model: string;
  /** Words looked for in the title and the topic; all must occur. */
  query: string;
  /** Only sets never taken. */
  unattempted: boolean;
}

export const EMPTY_FILTER: LibraryFilter = { origin: "all", band: null, model: "", query: "", unattempted: false };

/** The model to show and filter by: a CLI run with no model name is listed under its provider. */
export const modelKey = (g: GenMeta): string => g.model || g.provider;

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

export function filterTests(rows: TestSummary[], f: LibraryFilter): TestSummary[] {
  const terms = words(f.query);
  return rows.filter((t) => {
    if (f.origin === "ai" && !t.ai) return false;
    if (f.origin === "shared" && !t.shared) return false;
    if (f.origin === "collected" && (t.ai || t.shared)) return false;
    if (f.band !== null && t.gen?.band !== f.band) return false;
    if (f.model && (!t.gen || modelKey(t.gen) !== f.model)) return false;
    if (f.unattempted && (t.attempts > 0 || t.entries > 0)) return false;
    if (terms.length) {
      const hay = `${t.title} ${t.gen?.topic ?? ""}`.toLowerCase();
      if (!terms.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export const isFiltering = (f: LibraryFilter): boolean =>
  f.origin !== "all" || f.band !== null || f.model !== "" || f.query.trim() !== "" || f.unattempted;

/** What the filter controls can offer: the bands and models that occur among the AI-written rows. */
export function filterChoices(rows: TestSummary[]): { bands: number[]; models: string[]; hasAi: boolean } {
  const bands = new Set<number>();
  const models = new Set<string>();
  for (const t of rows) {
    if (!t.gen) continue;
    bands.add(t.gen.band);
    models.add(modelKey(t.gen));
  }
  return {
    bands: [...bands].sort((a, b) => a - b),
    models: [...models].sort((a, b) => a.localeCompare(b)),
    hasAi: rows.some((t) => t.ai),
  };
}

const KIND_LABEL: Record<TestKind, string> = { reading: "Reading", listening: "Listening", writing: "Writing", speaking: "Speaking" };

/** Sets already made on this topic, by kind: "Reading 2개 · Writing 1개". Empty when the topic is new. */
export function topicUses(topics: GenTopic[], topic: string): string {
  const key = topicKey(topic);
  if (!key) return "";
  return topics
    .filter((t) => topicKey(t.topic) === key)
    .map((t) => `${KIND_LABEL[t.kind]} ${t.count}개`)
    .join(" · ");
}

/** The record to keep for a set just written: the resolved request plus the provider and model that ran it. */
export function genMetaOf(o: GenOptions, settings: AiSettings): GenMeta {
  const { topic, band, ...rest } = o;
  return {
    topic: topic.trim(),
    band,
    provider: settings.provider,
    model: settings.models[settings.provider] ?? "",
    options: rest,
  };
}

/** One line under an AI-written set's title: topic, target band, model. */
export const genMetaLine = (g: GenMeta): string =>
  [g.topic.trim(), `Band ${g.band}`, modelKey(g)].filter(Boolean).join(" · ");
