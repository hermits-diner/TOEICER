/**
 * Set files (.toic): one Listening or Reading set as a zip of manifest.json, test.json (the import form, see
 * importFormat.ts) and media/ with its recordings and Part 1 photographs under their archive names — or, for a whole
 * mock test (Studio's "LC+RC 한 부로 내보내기"), one LC set and one RC set as tests/1.json and tests/2.json with `exam`
 * and `tests[]` in the manifest, the shape TOEFLER and IELTS_Practice write. The manifest says
 * where the set came from and, for an AI-written set, how it was checked, so a market can list only AI originals and
 * show their verification record. The Rust side (package.rs) checks every media file's hash against its name on
 * import. Files from earlier versions (.toeicset) still open.
 */
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { BRAND } from "./brand";
import { EDITION } from "./edition";
import { ARCHIVED_AUDIO_RE, ARCHIVED_IMAGE_RE, validateImport } from "./importFormat";
import { findSavedTest, loadGenMeta, loadTest, loadTestSource, saveImportedTest, saveMarketRecord } from "./repo";
import type { ImportTest, Origin, TestKind } from "./types";

export const PACKAGE_EXT = "toic";
/** Opened, never written: the extension before 2026-10. */
export const LEGACY_EXTS = ["toeicset"];
/** 1–2: earlier .toeicset files. 3: one set, origin and verification in the manifest. */
export const PACKAGE_FORMAT = 3;

/** What a bought set carries, filled in by the market when it hands the file to the buyer. */
export interface MarketRecord {
  itemId: string;
  buyer: string;
  purchasedAt?: string;
}

export interface Manifest {
  format: number;
  app: string;
  appVersion: string;
  edition: string;
  title: string;
  /** Listening (Parts 1–4) or Reading (Parts 5–7). */
  kind: TestKind;
  createdAt: string;
  questions: number;
  /** Where the set came from on the PC that wrote the file; the market accepts only "ai". */
  origin: Origin;
  /** For an AI-written set: who wrote and checked it, and the record of each unit's checks. */
  verification?: unknown;
  trendCheckedAt?: string | null;
  market?: MarketRecord;
  author: string;
  license: string;
  /** A whole mock test: its title. Absent for a single set. */
  exam?: { title: string };
  /** A whole mock test: its sections in file order. */
  tests?: { skill: TestKind; ord: number; title: string; questions: number }[];
}

const countQuestions = (t: ImportTest) => t.passages.reduce((n, p) => n + p.groups.reduce((m, g) => m + g.questions.length, 0), 0);

const safeName = (s: string) =>
  s
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "toeicer-set";

/** Archive names of the recordings and photographs a set refers to, each once. */
export function mediaOf(t: ImportTest): string[] {
  const names = new Set<string>();
  for (const p of t.passages) {
    if (p.audio && ARCHIVED_AUDIO_RE.test(p.audio)) names.add(p.audio);
    for (const g of p.groups) if (g.image && ARCHIVED_IMAGE_RE.test(g.image)) names.add(g.image);
  }
  return [...names];
}

/** The import form of a saved test, as stored when it was saved or last edited. */
export async function testToImport(id: number): Promise<ImportTest> {
  const stored = await loadTestSource(id);
  const v = stored ? validateImport(JSON.parse(stored)) : null;
  if (!v?.test) throw new Error("이 세트는 파일로 내보낼 수 없습니다.");
  return v.test;
}

export async function buildManifest(t: ImportTest, origin: Origin, gen?: Record<string, unknown>): Promise<Manifest> {
  let appVersion = "";
  try {
    appVersion = await getVersion();
  } catch {
    // Not running under Tauri (tests).
  }
  return {
    format: PACKAGE_FORMAT,
    app: BRAND.appCode,
    appVersion,
    edition: EDITION,
    title: t.title,
    kind: t.kind,
    createdAt: new Date().toISOString(),
    questions: countQuestions(t),
    origin,
    verification: gen?.verification,
    trendCheckedAt: (gen?.trendCheckedAt as string | null | undefined) ?? null,
    author: "",
    license: "",
  };
}

/** Writes one set to a file the user places (Studio); a bought set is never written out. Null when cancelled. */
export async function exportTest(id: number): Promise<string | null> {
  const detail = await loadTest(id);
  if (detail.origin === "market") throw new Error("마켓에서 산 세트는 파일로 내보낼 수 없습니다.");
  const t = await testToImport(id);
  const manifest = await buildManifest(t, detail.origin, (await loadGenMeta(id))?.options);
  const dest = await save({ defaultPath: `${safeName(t.title)}.${PACKAGE_EXT}`, filters: [{ name: `${BRAND.appName} 문제 세트`, extensions: [PACKAGE_EXT] }] });
  if (!dest) return null;
  await invoke<number>("package_write", { req: { dest, manifest, tests: [JSON.stringify(t)], media: mediaOf(t) } });
  return dest;
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** The default title of a whole mock test: "TOEIC 모의고사 2026-11-05". */
export const defaultExamTitle = (now = new Date()) => `TOEIC 모의고사 ${now.toLocaleDateString("sv-SE")}`;

/**
 * Writes one Listening set and one Reading set as a single mock test file (Studio), which is what the market sells for
 * TOEIC. The origin is "ai" only when both sets are; the verification records are joined, LC first. Null when cancelled.
 */
export async function exportExam(lcId: number, rcId: number, title: string): Promise<string | null> {
  const ids = [lcId, rcId];
  const details = await Promise.all(ids.map((id) => loadTest(id)));
  if (details.some((d) => d.origin === "market")) throw new Error("마켓에서 산 세트는 파일로 내보낼 수 없습니다.");
  const [lc, rc] = await Promise.all(ids.map((id) => testToImport(id)));
  if (lc.kind !== "listening" || rc.kind !== "reading") throw new Error("Listening 세트 하나와 Reading 세트 하나를 골라 주십시오.");
  const gens = await Promise.all(ids.map(async (id) => (await loadGenMeta(id))?.options));
  const name = title.trim() || defaultExamTitle();
  const origin = details.find((d) => d.origin !== "ai")?.origin ?? "ai";
  const checked = gens.map((g) => g?.trendCheckedAt).filter((x): x is string => typeof x === "string").sort();
  const manifest: Manifest = {
    ...(await buildManifest(lc, origin, gens[0])),
    title: name,
    exam: { title: name },
    tests: [lc, rc].map((t, i) => ({ skill: t.kind, ord: i, title: t.title, questions: countQuestions(t) })),
    questions: countQuestions(lc) + countQuestions(rc),
    verification: [...asList(gens[0]?.verification), ...asList(gens[1]?.verification)],
    trendCheckedAt: checked[0] ?? null,
  };
  const dest = await save({ defaultPath: `${safeName(name)}.${PACKAGE_EXT}`, filters: [{ name: `${BRAND.appName} 문제 세트`, extensions: [PACKAGE_EXT] }] });
  if (!dest) return null;
  const media = [...new Set([...mediaOf(lc), ...mediaOf(rc)])];
  await invoke<number>("package_write", { req: { dest, manifest, tests: [JSON.stringify(lc), JSON.stringify(rc)], media } });
  return dest;
}

export interface OpenedPackage {
  path: string;
  manifest: Manifest;
  tests: ImportTest[];
  warnings: string[];
}

/** Sets made by earlier versions carry this in their titles; a bought set does not show it. */
const bareTitle = (title: string) => title.replace(/^AI · /, "");

/** Reads a set file at a path (a picked file, or one double-clicked in Explorer); its media go into the archive. */
export async function readPackage(path: string): Promise<OpenedPackage> {
  const r = await invoke<{ manifest: Partial<Manifest>; tests: string[] }>("package_read", { path });
  const tests: ImportTest[] = [];
  const warnings: string[] = [];
  for (const [i, text] of r.tests.entries()) {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`세트 파일 안의 ${i + 1}번째 세트를 읽을 수 없습니다.`);
    }
    const v = validateImport(raw);
    if (!v.test) throw new Error(`세트 파일이 올바르지 않습니다: ${v.errors.slice(0, 3).join(" / ")}`);
    tests.push(r.manifest.market ? { ...v.test, title: bareTitle(v.test.title) } : v.test);
    warnings.push(...v.warnings);
  }
  const m = r.manifest;
  const named = (title: string) => (m.market ? bareTitle(title) : title);
  const manifest: Manifest = {
    format: m.format ?? 1,
    app: m.app ?? "",
    appVersion: m.appVersion ?? "",
    edition: m.edition ?? "",
    title: named(m.title ?? tests[0]?.title ?? ""),
    kind: m.kind ?? tests[0]?.kind ?? "reading",
    createdAt: m.createdAt ?? "",
    questions: m.questions ?? tests.reduce((n, t) => n + countQuestions(t), 0),
    // Files written before origins were recorded count as shared material.
    origin: m.origin ?? "shared",
    verification: m.verification,
    trendCheckedAt: m.trendCheckedAt ?? null,
    market: m.market,
    author: m.author ?? "",
    license: m.license ?? "",
  };
  return { path, manifest, tests, warnings };
}

/** Lets the user pick a set file and reads it; null when cancelled. */
export async function openPackage(): Promise<OpenedPackage | null> {
  const picked = await open({ multiple: false, filters: [{ name: `${BRAND.appName} 문제 세트`, extensions: [PACKAGE_EXT, ...LEGACY_EXTS] }] });
  const path = Array.isArray(picked) ? picked[0] : picked;
  return path ? readPackage(String(path)) : null;
}

/**
 * Saves an opened set file to the library: a bought one as "마켓 구매" with its record, anything else as "공유 파일".
 * Sets already in the library are reused rather than refused. Returns the ids in file order.
 */
export async function importOpened(o: OpenedPackage): Promise<{ testIds: number[]; reused: number }> {
  const origin: Origin = o.manifest.market ? "market" : "shared";
  const testIds: number[] = [];
  let reused = 0;
  for (const t of o.tests) {
    const existing = await findSavedTest(t);
    if (existing !== null) {
      testIds.push(existing);
      reused++;
      continue;
    }
    const id = await saveImportedTest(t, origin);
    if (o.manifest.market) await saveMarketRecord(id, { ...o.manifest.market });
    testIds.push(id);
  }
  return { testIds, reused };
}
