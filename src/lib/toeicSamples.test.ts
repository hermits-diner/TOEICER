import { describe, expect, it } from "vitest";
import { validateImport } from "./importFormat";
import { listeningTest } from "./toeicGen";
import { listeningDrafts, listeningSample, toeicSampleAudioJobs, toeicSamplePhotoJobs, toeicSampleTests } from "./toeicSamples";
import { partOfTitle } from "./toeicSpec";
import type { ImportTest } from "./types";

/** A set with every choice order forgotten: the generator moves keys around (balance), the sample keeps its own. */
const unordered = (t: ImportTest) =>
  t.passages.map((p) => ({
    title: p.title,
    body: (p.body ?? "").replace(/\([A-D]\) [^(\n]*/g, "(_)"),
    groups: p.groups.map((g) => ({
      type: g.type,
      instructions: g.instructions,
      questions: g.questions.map((q) => ({
        number: q.number,
        prompt: q.prompt,
        options: (q.options ?? []).map((o) => o.text).sort(),
        key: q.options?.find((o) => o.key === q.answer[0])?.text,
      })),
    })),
  }));
const unorderedTurns = (turns: { speaker: string; text: string }[]) => turns.map((t) => ({ ...t, text: t.text.replace(/\([A-D]\) [^(]*/g, "(_)") }));

describe("built-in TOEIC samples", () => {
  const tests = toeicSampleTests();
  it("pass the import validator", () => {
    for (const t of tests) expect(validateImport(t).errors, t.title).toEqual([]);
  });
  it("number questions consecutively and give Part 1 four and Part 2 three heard options", () => {
    for (const t of tests) {
      const ns = t.passages.flatMap((p) => p.groups.flatMap((g) => g.questions.map((q) => q.number)));
      expect(ns, t.title).toEqual(ns.map((_, i) => i + 1));
    }
    for (const p of tests[0].passages) {
      const part = partOfTitle(p.title ?? null);
      if (part !== 1 && part !== 2) continue;
      expect(p.groups[0].type).toBe("lmcq");
      expect(p.groups[0].questions.every((q) => q.options?.length === (part === 1 ? 4 : 3)), p.title).toBe(true);
    }
  });

  it("cover every Listening part with the planned share of a full test", () => {
    const sets = (part: number) => tests[0].passages.filter((p) => partOfTitle(p.title ?? null) === part);
    const questions = (part: number) => sets(part).flatMap((p) => p.groups.flatMap((g) => g.questions)).length;
    const graphics = (part: number) => sets(part).filter((p) => p.groups.some((g) => g.instructions?.startsWith("Graphic\n"))).length;
    expect([1, 2, 3, 4].map(questions)).toEqual([3, 10, 9, 9]);
    expect([sets(3).length, graphics(3), sets(4).length, graphics(4)]).toEqual([3, 1, 3, 1]);
    // Part 3 is two-person, a woman and a man, as the voice engine reads at most two voices
    for (const s of listeningDrafts.p3.sets) expect(Object.values(s.speakers).map((x) => x.gender).sort()).toEqual(["female", "male"]);
    // the keys are spread over the letters
    const keys = tests[0].passages.flatMap((p) => p.groups.flatMap((g) => g.questions.map((q) => q.answer[0])));
    for (const k of ["A", "B", "C", "D"]) expect(keys.filter((x) => x === k).length, k).toBeGreaterThanOrEqual(4);
  });

  it("is laid out the way the generator lays out a generated Listening set", () => {
    const sample = listeningSample();
    const generated = listeningTest(listeningDrafts, sample.test.title);
    expect(unordered(sample.test)).toEqual(unordered(generated.test));
    expect(sample.media.map((m) => ({ passage: m.passage, turns: unorderedTurns(m.turns), speakers: m.speakers }))).toEqual(
      generated.audio.map((a) => ({ passage: a.passage, turns: unorderedTurns(a.turns), speakers: a.speakers })),
    );
    expect(sample.media.filter((m) => m.photo).map((m) => [m.passage, m.photo?.prompt])).toEqual(generated.images.map((i) => [i.passage, i.prompt]));
  });

  it("ships the speech of every Listening passage and the photograph of every Part 1 item", () => {
    const names = (files: Record<string, unknown>) => new Set(Object.keys(files).map((f) => f.split("/").pop()));
    const audio = names(import.meta.glob("/public/sample-audio/*.mp3"));
    const photos = names(import.meta.glob("/public/sample-photos/*.webp"));
    const listening = tests.filter((t) => t.kind === "listening").flatMap((t) => t.passages);
    expect(listening.length).toBe(11);
    for (const p of listening) {
      expect(p.audio, p.title).toMatch(/^aud-[0-9a-f]{32}\.mp3$/);
      expect(audio.has(p.audio), p.audio).toBe(true);
    }
    const part1 = listening.filter((p) => partOfTitle(p.title ?? null) === 1);
    expect(part1.length).toBe(3);
    for (const p of part1) {
      expect(p.groups[0].image, p.title).toMatch(/^img-[0-9a-f]{32}\.webp$/);
      expect(photos.has(p.groups[0].image), p.groups[0].image).toBe(true);
    }
    // nothing shipped that no passage uses, and no two jobs share a key
    expect(audio.size).toBe(toeicSampleAudioJobs().length);
    expect(photos.size).toBe(toeicSamplePhotoJobs().length);
    expect(new Set(toeicSampleAudioJobs().map((j) => j.key)).size).toBe(toeicSampleAudioJobs().length);
  });
});
