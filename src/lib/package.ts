/**
 * Shareable packages (.toeicset): a saved test, or a whole exam, as one zip another copy of the app can import.
 * The zip holds manifest.json, tests/1.json… (each in the import form, see importFormat.ts) and media/ with the
 * recordings and pictures under their archive names. The Rust side (package.rs) writes and reads the zip and checks
 * every media file's hash against its name on import.
 */
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { convertTestAudio } from "./audio";
import { ARCHIVED_IMAGE_RE, validateImport } from "./importFormat";
import { createExam, findExamWithTests, findSavedTest, loadExam, loadTest, loadTestSource, packageSourceId, saveImage, saveImportedTest } from "./repo";
import type { ImportParagraph, ImportTest, Module, TestKind } from "./types";
import { BRAND } from "./brand";

export const PACKAGE_EXT = "toeicset";
/** 1: one test.json. 2: tests/N.json, optionally grouped as an exam. The app reads both. */
export const PACKAGE_FORMAT = 2;
const ARCHIVED_AUDIO_RE = /^aud-[0-9a-f]{32}\.[a-z0-9]+$/;

export interface ManifestTest {
  skill: TestKind;
  ord: number;
  title: string;
  questions: number;
}

export interface Manifest {
  format: number;
  app: string;
  appVersion: string;
  title: string;
  module: Module;
  createdAt: string;
  /** Present when the package is a whole exam; its tests are then grouped again on import. */
  exam?: { title: string; module: Module; band: number | null };
  tests: ManifestTest[];
  /** Who made the set and on what terms it may be used; empty until a sharing site fills them in. */
  author: string;
  license: string;
}

/** Strips tags and undoes escapeHtml; <br> becomes a line break. */
const decode = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

/**
 * The inverse of passageToHtml: a passage's stored HTML back to import paragraphs, labels and figures included.
 * HTML from other sources (collected pages) becomes plain-text blocks.
 */
export function htmlToParagraphs(html: string): ImportParagraph[] {
  const out: ImportParagraph[] = [];
  const re = /<figure>([\s\S]*?)<\/figure>|<p>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) {
      const src = /src="([^"]*)"/.exec(m[1])?.[1] ?? "";
      const alt = /alt="([^"]*)"/.exec(m[1])?.[1] ?? "";
      if (src) out.push({ text: decode(alt), image: decode(src) });
      continue;
    }
    const inner = m[2];
    const label = /^<span class="para-label">([\s\S]*?)<\/span>/.exec(inner);
    const text = decode(label ? inner.slice(label[0].length) : inner);
    if (text) out.push(label ? { label: decode(label[1]), text } : { text });
  }
  if (out.length) return out;
  return decode(html.replace(/<\/(p|div|h\d|li|tr)>/gi, "\n\n"))
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({ text }));
}

const dataUrlBytes = (url: string): Uint8Array | null => {
  const m = /^data:[^;,]+;base64,([\s\S]*)$/.exec(url);
  if (!m) return null;
  const bin = atob(m[1]);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** Puts a picture held as a data URL into the archive and returns its name; archive names pass through. */
async function archived(image: string | null | undefined): Promise<string | undefined> {
  if (!image) return undefined;
  if (ARCHIVED_IMAGE_RE.test(image)) return image;
  const bytes = dataUrlBytes(image);
  return bytes ? saveImage(bytes) : undefined;
}

/** The import form of a saved test: the stored source when there is one, otherwise rebuilt from the database. */
export async function testToImport(id: number): Promise<ImportTest> {
  const stored = await loadTestSource(id);
  if (stored) {
    const v = validateImport(JSON.parse(stored));
    if (v.test) return v.test;
  }
  const t = await loadTest(id);
  const passages = [];
  for (const p of t.passages) {
    const paragraphs: ImportParagraph[] = [];
    for (const para of htmlToParagraphs(p.bodyHtml)) {
      if (!para.image) paragraphs.push(para);
      else {
        const image = await archived(para.image);
        paragraphs.push(image ? { ...para, image } : { text: para.text });
      }
    }
    const groups = [];
    for (const g of p.groups) {
      groups.push({
        type: g.type,
        instructions: g.instructions ?? undefined,
        options: g.options,
        image: await archived(g.image),
        questions: g.questions.map((q) => ({ number: q.number, prompt: q.prompt ?? undefined, options: q.options, answer: q.answer })),
      });
    }
    passages.push({
      title: p.title ?? undefined,
      paragraphs,
      audio: p.audio ?? undefined,
      sample: p.sampleHtml ? htmlToParagraphs(p.sampleHtml).map((x) => x.text).join("\n\n") : undefined,
      groups,
    });
  }
  const v = validateImport({ title: t.title, kind: t.kind, module: t.module, passages });
  if (!v.test) throw new Error(`내보낼 수 없는 시험입니다: ${v.errors.slice(0, 2).join(" / ")}`);
  return v.test;
}

/** Archive names of the recordings and pictures the tests refer to, each once. */
export function mediaOf(tests: ImportTest[]): string[] {
  const names = new Set<string>();
  for (const t of tests)
    for (const p of t.passages) {
      if (p.audio && ARCHIVED_AUDIO_RE.test(p.audio)) names.add(p.audio);
      for (const para of p.paragraphs ?? []) if (para.image && ARCHIVED_IMAGE_RE.test(para.image)) names.add(para.image);
      for (const g of p.groups) if (g.image && ARCHIVED_IMAGE_RE.test(g.image)) names.add(g.image);
    }
  return [...names];
}

const countQuestions = (t: ImportTest) => t.passages.reduce((n, p) => n + p.groups.reduce((m, g) => m + g.questions.length, 0), 0);

export async function buildManifest(tests: ImportTest[], exam?: Manifest["exam"]): Promise<Manifest> {
  let appVersion = "";
  try {
    appVersion = await getVersion();
  } catch {
    // Not running under Tauri (tests).
  }
  return {
    format: PACKAGE_FORMAT,
    app: BRAND.appName,
    appVersion,
    title: exam?.title ?? tests[0]?.title ?? "",
    module: exam?.module ?? tests[0]?.module ?? "academic",
    createdAt: new Date().toISOString(),
    exam,
    tests: tests.map((t, i) => ({ skill: t.kind, ord: i, title: t.title, questions: countQuestions(t) })),
    author: "",
    license: "",
  };
}

const safeName = (s: string) =>
  s
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "toeicer-set";

async function writePackage(tests: ImportTest[], manifest: Manifest, name: string): Promise<string | null> {
  const dest = await save({ defaultPath: `${safeName(name)}.${PACKAGE_EXT}`, filters: [{ name: `${BRAND.examName} 문제 세트`, extensions: [PACKAGE_EXT] }] });
  if (!dest) return null;
  await invoke<number>("package_write", { req: { dest, manifest, tests: tests.map((t) => JSON.stringify(t)), media: mediaOf(tests) } });
  return dest;
}

/** Exports one test as a package at a place the user picks; null when they cancel. */
export async function exportTest(id: number): Promise<string | null> {
  await convertTestAudio(id);
  const t = await testToImport(id);
  return writePackage([t], await buildManifest([t]), t.title);
}

/** Exports a whole exam, its six sets and their media, as one package; null when the user cancels. */
export async function exportExam(examId: number): Promise<string | null> {
  const e = await loadExam(examId);
  const tests: ImportTest[] = [];
  for (const t of e.tests) {
    await convertTestAudio(t.id);
    tests.push(await testToImport(t.id));
  }
  return writePackage(tests, await buildManifest(tests, { title: e.title, module: e.module, band: e.band }), e.title);
}

export interface OpenedPackage {
  path: string;
  manifest: Manifest;
  tests: ImportTest[];
  warnings: string[];
  media: string[];
}

/** Lets the user pick a package and reads it; its media go into the archive right away. Null when cancelled. */
export async function openPackage(): Promise<OpenedPackage | null> {
  const picked = await open({ multiple: false, filters: [{ name: `${BRAND.examName} 문제 세트`, extensions: [PACKAGE_EXT, "zip"] }] });
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (!path) return null;
  const r = await invoke<{ manifest: Manifest; tests: string[]; media: string[] }>("package_read", { path });
  const tests: ImportTest[] = [];
  const warnings: string[] = [];
  for (const [i, text] of r.tests.entries()) {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`세트 파일 안의 ${i + 1}번째 시험을 읽을 수 없습니다.`);
    }
    const v = validateImport(raw);
    if (!v.test) throw new Error(`세트 파일의 ${i + 1}번째 시험이 올바르지 않습니다: ${v.errors.slice(0, 3).join(" / ")}`);
    tests.push(v.test);
    warnings.push(...v.warnings);
  }
  // Older packages (format 1) lack the newer fields.
  const m = r.manifest as Partial<Manifest>;
  const manifest: Manifest = {
    format: m.format ?? 1,
    app: m.app ?? "",
    appVersion: m.appVersion ?? "",
    title: m.title ?? tests[0]?.title ?? "",
    module: m.module ?? tests[0]?.module ?? "academic",
    createdAt: m.createdAt ?? "",
    exam: m.exam,
    tests: m.tests ?? [],
    author: m.author ?? "",
    license: m.license ?? "",
  };
  return { path: String(path), manifest, tests, warnings, media: r.media };
}

/**
 * Saves an opened package under the "공유 파일" source; a whole exam is grouped again. Sets that are already in the
 * library (same content) are reused rather than refused, so importing twice, or on the PC that exported, opens the
 * same sets and the same exam. `reused` counts them.
 */
export async function importOpened(o: OpenedPackage): Promise<{ examId: number | null; testIds: number[]; reused: number }> {
  const sourceId = await packageSourceId();
  const testIds: number[] = [];
  let reused = 0;
  for (const t of o.tests) {
    const existing = await findSavedTest(t);
    if (existing !== null) {
      testIds.push(existing);
      reused++;
    } else {
      testIds.push(await saveImportedTest(t, { sourceId, rawPath: null }));
    }
  }
  const exam = o.manifest.exam;
  if (!exam || testIds.length < 2) return { examId: null, testIds, reused };
  const examId =
    (await findExamWithTests(testIds)) ??
    (await createExam(
      exam.title,
      exam.module,
      exam.band,
      testIds.map((testId, i) => ({ testId, skill: o.tests[i].kind, ord: i })),
    ));
  return { examId, testIds, reused };
}
