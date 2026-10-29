/* Writing and speaking pages hold a task and (often) a model answer rather than numbered questions.
   They become drafts of their own kind: one passage per task or part, the model answer kept beside it. */

import { extractTests, IMAGE_RE, type ExtractResult } from "./extract";
import type { ImportParagraph, ImportPassage, Module } from "./types";

const TASK_RE = /^You should spend about (\d+) minutes on this task/i;
const WORDS_RE = /^Write at least \d+ words/i;
const ANSWER_HEAD_RE = /^(?:How to answer|Model answer|Sample answer)\b/i;
const WORD_COUNT_RE = /^\(\s*\d+\s+words?\s*\)$/i;
const PART_RE = /^Part\s+([123])$/i;
/** Lines that belong to the site around the content, not to the task. */
const PAGE_END_RE = /^(?:Tweet|Contact us|See also)\b|^(?:<\s*)?(?:Next|Previous)\b.{0,20}$|All rights reserved/i;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const result = (draft: ExtractResult["draft"], lines: string[], complete: boolean): ExtractResult => ({
  draft,
  confidence: complete ? 1 : 0.8,
  issues: [],
  source: lines.join("\n\n"),
});

function paragraph(line: string): ImportParagraph {
  const picture = line.match(IMAGE_RE);
  return picture ? { text: picture[1], image: picture[2] } : { text: line };
}

/** Writing: each "You should spend about N minutes on this task" opens a task; a model answer may follow it. */
function writingTasks(lines: string[]): ImportPassage[] {
  const starts = lines.flatMap((l, i) => (TASK_RE.test(l) ? [i] : []));
  return starts.map((start, n) => {
    const stop = starts[n + 1] ?? lines.length;
    const minutes = Number(lines[start].match(TASK_RE)![1]);
    // The task runs to "Write at least N words"; a chart may be printed just after it.
    let end = start + 1;
    while (end < stop && end - start < 25 && !WORDS_RE.test(lines[end - 1]) && !ANSWER_HEAD_RE.test(lines[end])) end++;
    while (end < stop && IMAGE_RE.test(lines[end])) end++;

    const from = lines.findIndex((l, i) => i >= end && i < stop && ANSWER_HEAD_RE.test(l));
    let sample: string | undefined;
    if (from >= 0) {
      let to = from + 1;
      while (to < stop && !PAGE_END_RE.test(lines[to]) && !WORD_COUNT_RE.test(lines[to - 1])) to++;
      sample = lines.slice(from, to).filter((l) => !IMAGE_RE.test(l)).join("\n\n");
    }
    return { title: `Task ${minutes <= 20 ? 1 : 2}`, paragraphs: lines.slice(start, end).map(paragraph), sample, groups: [] };
  });
}

/** Speaking: "Part 1/2/3"; the examiner's questions (and the cue card) are the task, the candidate's replies the model answer. */
function speakingParts(lines: string[]): ImportPassage[] {
  const starts = lines.flatMap((l, i) => (PART_RE.test(l) ? [i] : []));
  return starts.flatMap((start, n) => {
    let stop = starts[n + 1] ?? lines.length;
    const end = lines.findIndex((l, i) => i > start && i < stop && PAGE_END_RE.test(l));
    if (end >= 0) stop = end;
    const body = lines.slice(start + 1, stop).filter((l) => !IMAGE_RE.test(l));
    const part = Number(lines[start].match(PART_RE)![1]);
    let task: string[];
    if (part === 2) {
      // The cue card: from "Describe…" to the closing "and say/explain…" line.
      const first = Math.max(0, body.findIndex((l) => /^(?:Describe|Talk about)\b/i.test(l)));
      const last = body.findIndex((l, i) => i >= first && /^and (?:say|explain)\b/i.test(l));
      task = body.slice(first, last >= 0 ? last + 1 : Math.min(body.length, first + 6));
    } else {
      task = body.filter((l) => l.endsWith("?") && l.length <= 200);
    }
    if (task.length === 0) return [];
    const replies = body.filter((l) => !task.includes(l));
    const sample =
      part === 2
        ? replies.filter((l) => !/^Now,? have a look at the card/i.test(l)).join("\n\n")
        : body.map((l) => (task.includes(l) ? `Q. ${l}` : l)).join("\n\n");
    return [{ title: `Part ${part}`, paragraphs: task.map((text) => ({ text })), sample: replies.length ? sample : undefined, groups: [] }];
  });
}

export function extractPrompts(text: string, meta: { title?: string } = {}): ExtractResult[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(squash)
    .filter(Boolean);
  const title = meta.title?.trim() ?? "";

  const tasks = writingTasks(lines);
  if (tasks.length) {
    const module: Module = /general/i.test(title) ? "general" : "academic";
    const draft = { title: title || "Writing task", kind: "writing" as const, module, passages: tasks };
    return [result(draft, lines, tasks.every((t) => t.sample))];
  }
  const parts = speakingParts(lines);
  if (parts.length >= 2 || (parts.length === 1 && /speaking/i.test(title))) {
    const draft = { title: title || "Speaking practice", kind: "speaking" as const, module: "academic" as const, passages: parts };
    return [result(draft, lines, parts.every((p) => p.sample))];
  }
  return [];
}

/** Every draft a document yields: tests with questions first, otherwise writing or speaking tasks. */
export function extractDrafts(text: string, meta: { title?: string } = {}): ExtractResult[] {
  const tests = extractTests(text, meta);
  return tests.length ? tests : extractPrompts(text, meta);
}
