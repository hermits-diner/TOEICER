/* 출제 동향 확인. Before writing, the app reads the official TOEIC pages (the Korean TOEIC committee and ETS),
   has the learner's own CLI condense them into a short brief — the format as announced today, any announced
   change, and the tendencies a writer should follow — and puts that brief into every writer prompt. The brief
   is cached for a week; without the network the last brief still applies, and without any brief the built-in
   spec alone decides. The CLI is also asked to compare the pages with the app's built-in format and report
   mismatches, so the user is warned when the test itself changes. */

import { invoke } from "@tauri-apps/api/core";
import { complete, type AiSettings } from "./ai";
import { extractJson } from "./generate";
import { specForPrompt, TOEIC_PARTS } from "./toeicSpec";
import { htmlToText } from "./html";

export interface TrendBrief {
  /** ISO datetime of the check. */
  checkedAt: string;
  /** One short Korean paragraph: the format as the pages state it now. */
  summary: string;
  /** Tendencies a writer should follow, from the pages only. */
  trends: string[];
  /** Announced format changes, from the pages only. */
  changes: string[];
  /** Where the app's built-in format no longer matches the pages; empty when they agree. */
  mismatch: string[];
  /** Pages that were actually read. */
  sources: string[];
}

/** The official pages worth reading for this test: the ones the guide already links (examInfo.ts). */
export const TREND_SOURCES = ["https://exam.toeic.co.kr", "https://www.ets.org/toeic.html"];

const KEY = "toeicer.trend";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function loadTrendBrief(): TrendBrief | null {
  try {
    const b = JSON.parse(localStorage.getItem(KEY) ?? "null") as TrendBrief | null;
    return b && typeof b.checkedAt === "string" && typeof b.summary === "string" ? b : null;
  } catch {
    return null;
  }
}

export const trendAgeDays = (b: TrendBrief): number => Math.floor((Date.now() - Date.parse(b.checkedAt)) / (24 * 60 * 60 * 1000));

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, 8) : []);

export function parseBrief(raw: unknown, sources: string[], checkedAt: string): TrendBrief | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const summary = str(o.summary);
  if (!summary) return null;
  return { checkedAt, summary, trends: list(o.trends), changes: list(o.changes), mismatch: list(o.mismatch), sources };
}

/** The format the app has built in, as the CLI compares it with the pages. */
export const BUILT_IN_FORMAT = [
  "200 questions, about 2 hours: Listening 100 (Part 1 6, Part 2 25, Part 3 39, Part 4 30) in about 45 minutes, Reading 100 (Part 5 30, Part 6 16, Part 7 54) in 75 minutes; 5-495 per section, 10-990 in all.",
  "This is the structure of the 2016 revision (text-message and chat passages, triple passages, graphic questions, implied-meaning questions); as of 2026 no change to the Listening and Reading format has been announced.",
].join(" ");

export const TREND_SYSTEM =
  "You monitor the official sites of the TOEIC Listening and Reading test (the Korean TOEIC committee and ETS) for an item-writing app. You report only what the fetched pages actually say; when they say nothing about the test's format or direction, you say so and leave the lists empty. You never guess, and you write the brief in Korean. Reply with one JSON object only, no Markdown fences.";

export function trendPrompt(pages: { url: string; text: string }[]): string {
  return [
    "Below are today's fetches of the official pages, as plain text, followed by the format this app has built in.",
    "Write the brief an item writer needs before writing a new practice test:",
    '- "summary": two or three Korean sentences on the test\'s current format and direction as the pages state it.',
    '- "trends": tendencies a writer should follow (topics, part weighting, question types, difficulty), each one line, only if the pages state them.',
    '- "changes": announced changes to the Listening and Reading format, scoring or schedule that affect items, only if announced on these pages.',
    '- "mismatch": each point where the app\'s built-in format below no longer matches what the pages announce; empty when they agree or the pages are silent.',
    "",
    ...pages.map((p) => `## ${p.url}\n${p.text || "(불러오지 못함)"}`),
    "",
    "# The app's built-in format",
    BUILT_IN_FORMAT,
    specForPrompt(TOEIC_PARTS.map((p) => p.part)),
    "",
    '# Reply format\n{"summary": string, "trends": [string], "changes": [string], "mismatch": [string]}',
  ].join("\n");
}

async function page(url: string): Promise<{ url: string; text: string }> {
  try {
    const r = await invoke<{ kind: string; text: string | null }>("crawl_fetch", {
      req: { url, minIntervalMs: 1500, respectRobots: true },
    });
    const text = !r.text ? "" : r.kind === "html" ? htmlToText(r.text).text : r.text;
    return { url, text: text.replace(/\s+/g, " ").trim().slice(0, 9000) };
  } catch {
    return { url, text: "" };
  }
}

/** Reads the official pages and writes a fresh brief; returns the cached one while it is under a week old
 *  (unless forced), and the stale one when the sites cannot be read. Null only when there is nothing at all. */
export async function officialBrief(settings: AiSettings, force = false): Promise<TrendBrief | null> {
  const cached = loadTrendBrief();
  if (cached && !force && Date.now() - Date.parse(cached.checkedAt) < WEEK_MS) return cached;
  const pages = await Promise.all(TREND_SOURCES.map(page));
  const read = pages.filter((p) => p.text);
  if (!read.length) return cached;
  try {
    const res = await complete(settings, TREND_SYSTEM, trendPrompt(pages));
    const brief = parseBrief(extractJson(res.text), read.map((p) => p.url), new Date().toISOString());
    if (!brief) return cached;
    try {
      localStorage.setItem(KEY, JSON.stringify(brief));
    } catch {
      // the brief still applies to this run
    }
    return brief;
  } catch {
    return cached;
  }
}

/** The lines a writer prompt carries; empty without a brief. */
export function trendSection(b: TrendBrief | null): string[] {
  if (!b) return [];
  const lines = [
    "",
    `# 최신 출제 동향 (공식 사이트 ${b.checkedAt.slice(0, 10)} 확인)`,
    "Follow this brief from the official sites; where it conflicts with the fixed part formats above, keep the formats and follow the brief's direction and topics.",
    b.summary,
    ...b.trends.map((t) => `- ${t}`),
  ];
  if (b.changes.length) lines.push("Announced changes:", ...b.changes.map((c) => `- ${c}`));
  return lines;
}
