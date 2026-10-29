/* Crawl queue: fetch (Rust, rate-limited) -> extract -> review -> store.
   Jobs live in SQLite, so a queue survives an app restart and is resumed on demand.
   Review is automatic by default: a clean draft is stored, an empty one is set aside,
   and only a draft with something to check waits for the user. */

import { invoke } from "@tauri-apps/api/core";
import { decide, reviewDraft } from "./autoReview";
import { getDb } from "./db";
import type { ExtractResult } from "./extract";
import { extractDrafts } from "./extractPrompts";
import { extractLinks, filterLinks, htmlToText, type PageLink } from "./html";
import { ARCHIVED_IMAGE_RE } from "./importFormat";
import { saveImportedTest } from "./repo";
import type { ImportTest } from "./types";

export interface SourceSettings {
  startUrl: string;
  linkPattern?: string;
  minIntervalMs?: number;
  note?: string;
}

export interface Source {
  id: number;
  name: string;
  settings: SourceSettings;
}

export type JobState = "queued" | "running" | "review" | "saved" | "links" | "skipped" | "failed";

export interface Job {
  id: number;
  sourceId: number | null;
  url: string;
  title: string | null;
  state: JobState;
  /** Failure reason, or a note for skipped and automatically stored jobs. */
  message: string | null;
  confidence: number | null;
  issues: string[];
  testId: number | null;
  linkCount: number;
}

export interface JobDetail {
  id: number;
  url: string;
  sourceText: string;
  draft: ImportTest;
  confidence: number | null;
  issues: string[];
  /** The original is archived, so the draft can be rebuilt from it. */
  archived: boolean;
}

interface FetchResult {
  finalUrl: string;
  notModified: boolean;
  contentType: string;
  kind: "html" | "pdf" | "text" | "other";
  text: string | null;
  rawPath: string | null;
  contentHash: string | null;
  etag: string | null;
  lastModified: string | null;
}

interface JobRow {
  id: number;
  source_id: number | null;
  url: string;
  title: string | null;
  stage: string;
  status: string;
  error: string | null;
  confidence: number | null;
  issues_json: string | null;
  test_id: number | null;
  link_count: number | null;
  etag: string | null;
  last_modified: string | null;
  raw_path: string | null;
  content_hash: string | null;
}

const DEFAULT_INTERVAL_MS = 3000;
const AUTO_KEY = "toeicer.autoReview";
const AUTO_STORED = "자동 검수를 통과해 저장했습니다.";

/** Whether clean drafts are stored without waiting for the user (on unless switched off). */
export const autoReviewOn = () => localStorage.getItem(AUTO_KEY) !== "off";
export function setAutoReview(on: boolean): void {
  localStorage.setItem(AUTO_KEY, on ? "on" : "off");
  notify();
}
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function stateOf(r: JobRow): JobState {
  if (r.status === "running") return "running";
  if (r.status === "failed") return "failed";
  if (r.stage === "review") return "review";
  if (r.stage === "store") return "saved";
  if (r.stage === "discover") return "links";
  return r.status === "done" ? "skipped" : "queued";
}

/* ---------- Queries ---------- */

export async function listSources(): Promise<Source[]> {
  const db = await getDb();
  const rows = await db.select<{ id: number; name: string; settings_json: string | null }[]>(
    "SELECT id, name, settings_json FROM source WHERE settings_json IS NOT NULL ORDER BY id",
  );
  return rows.map((r) => ({ id: r.id, name: r.name, settings: JSON.parse(r.settings_json!) as SourceSettings }));
}

const JOB_COLUMNS = `id, source_id, url, title, stage, status, error, confidence, issues_json, test_id, etag, last_modified,
  raw_path, content_hash,
  CASE WHEN stage = 'discover' THEN json_array_length(draft_json, '$.links') END AS link_count`;

export async function listJobs(): Promise<Job[]> {
  const db = await getDb();
  const rows = await db.select<JobRow[]>(`SELECT ${JOB_COLUMNS} FROM crawl_job ORDER BY id DESC LIMIT 500`);
  return rows.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    url: r.url,
    title: r.title,
    state: stateOf(r),
    message: r.error,
    confidence: r.confidence,
    issues: r.issues_json ? (JSON.parse(r.issues_json) as string[]) : [],
    testId: r.test_id,
    linkCount: r.link_count ?? 0,
  }));
}

export async function getJobDetail(id: number): Promise<JobDetail> {
  const db = await getDb();
  const [r] = await db.select<
    {
      id: number;
      url: string;
      source_text: string | null;
      draft_json: string | null;
      confidence: number | null;
      issues_json: string | null;
      raw_path: string | null;
    }[]
  >("SELECT id, url, source_text, draft_json, confidence, issues_json, raw_path FROM crawl_job WHERE id = $1", [id]);
  if (!r?.draft_json) throw new Error("검수할 초안을 찾을 수 없습니다.");
  return {
    id: r.id,
    url: r.url,
    sourceText: r.source_text ?? "",
    draft: JSON.parse(r.draft_json) as ImportTest,
    confidence: r.confidence,
    issues: r.issues_json ? (JSON.parse(r.issues_json) as string[]) : [],
    archived: r.raw_path !== null,
  };
}

export async function getJobLinks(id: number): Promise<PageLink[]> {
  const db = await getDb();
  const [r] = await db.select<{ draft_json: string | null }[]>("SELECT draft_json FROM crawl_job WHERE id = $1", [id]);
  return r?.draft_json ? ((JSON.parse(r.draft_json) as { links?: PageLink[] }).links ?? []) : [];
}

/* ---------- Mutations ---------- */

/** Adds URLs to the queue. Existing jobs are re-queued unless already saved or awaiting review. */
export async function enqueue(items: { url: string; title?: string }[], sourceId: number | null): Promise<number> {
  const db = await getDb();
  let added = 0;
  for (const item of items) {
    const [have] = await db.select<{ id: number; stage: string }[]>("SELECT id, stage FROM crawl_job WHERE url = $1", [item.url]);
    if (!have) {
      await db.execute("INSERT INTO crawl_job (source_id, url, title, stage, status) VALUES ($1, $2, $3, 'fetch', 'pending')", [
        sourceId,
        item.url,
        item.title ?? null,
      ]);
      added++;
    } else if (have.stage !== "store" && have.stage !== "review") {
      await db.execute(
        "UPDATE crawl_job SET stage = 'fetch', status = 'pending', error = NULL, updated_at = datetime('now') WHERE id = $1",
        [have.id],
      );
      added++;
    }
  }
  notify();
  return added;
}

export async function saveDraft(jobId: number, draft: ImportTest): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE crawl_job SET draft_json = $1, title = $2, updated_at = datetime('now') WHERE id = $3", [
    JSON.stringify(draft),
    draft.title,
    jobId,
  ]);
}

/** Stores a reviewed draft as a test in the library and closes the job. */
export async function publishDraft(jobId: number, draft: ImportTest, note: string | null = null): Promise<number> {
  const db = await getDb();
  const [job] = await db.select<{ source_id: number | null; raw_path: string | null }[]>(
    "SELECT source_id, raw_path FROM crawl_job WHERE id = $1",
    [jobId],
  );
  const testId = await saveImportedTest(draft, { sourceId: job?.source_id ?? null, rawPath: job?.raw_path ?? null });
  await db.execute(
    "UPDATE crawl_job SET stage = 'store', status = 'done', test_id = $1, draft_json = $2, title = $3, error = $5, updated_at = datetime('now') WHERE id = $4",
    [testId, JSON.stringify(draft), draft.title, jobId, note],
  );
  notify();
  return testId;
}

export async function deleteJob(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM crawl_job WHERE id = $1", [id]);
  notify();
}

/** Removes finished entries (saved, skipped, failed, link lists); keeps queued and review jobs. */
export async function clearFinished(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM crawl_job WHERE status IN ('done', 'failed')");
  notify();
}

async function putReview(
  target: { id: number } | { url: string; sourceId: number | null },
  r: ExtractResult,
  meta: { rawPath: string | null; contentHash: string | null; etag?: string | null; lastModified?: string | null },
): Promise<number | null> {
  const db = await getDb();
  const values = [r.draft.title, meta.contentHash, meta.rawPath, r.source, JSON.stringify(r.draft), r.confidence, JSON.stringify(r.issues)];
  let id: number | undefined;
  if ("id" in target) {
    id = target.id;
  } else {
    const [have] = await db.select<{ id: number; stage: string }[]>("SELECT id, stage FROM crawl_job WHERE url = $1", [target.url]);
    if (have?.stage === "store") return null; // already in the library
    id = have?.id;
    if (id === undefined) {
      const res = await db.execute(
        `INSERT INTO crawl_job (source_id, url, stage, status, title, content_hash, raw_path, source_text, draft_json, confidence, issues_json)
         VALUES ($8, $9, 'review', 'pending', $1, $2, $3, $4, $5, $6, $7)`,
        [...values, target.sourceId, target.url],
      );
      return res.lastInsertId ?? null;
    }
  }
  await db.execute(
    `UPDATE crawl_job SET stage = 'review', status = 'pending', error = NULL, title = $1, content_hash = $2, raw_path = $3,
       source_text = $4, draft_json = $5, confidence = $6, issues_json = $7, etag = $9, last_modified = $10, updated_at = datetime('now')
     WHERE id = $8`,
    [...values, id, meta.etag ?? null, meta.lastModified ?? null],
  );
  return id;
}

/* ---------- Automatic review ---------- */

/** Acts on a draft awaiting review: stores a clean one, sets an empty one aside, leaves the rest to the user.
    `notes` is everything recorded about the draft so far (extraction issues and review findings). */
async function settle(jobId: number, draft: ImportTest, notes: string[]): Promise<"saved" | "skipped" | "review"> {
  const verdict = reviewDraft(draft);
  const outcome = decide(verdict, notes);
  if (outcome === "discard") {
    await finish(jobId, "fetch", "done", `자동 검수에서 제외했습니다: ${verdict.unusable}`);
    return "skipped";
  }
  if (outcome === "ask" || !verdict.test) return "review";
  try {
    await publishDraft(jobId, verdict.test, AUTO_STORED);
    return "saved";
  } catch (e) {
    // Most often the same test is already in the library.
    await finish(jobId, "fetch", "done", errorText(e));
    return "skipped";
  }
}

/** Adds the review findings to a fresh draft's issues, so the list and the review screen show them. */
function withFindings(r: ExtractResult): ExtractResult {
  for (const reason of reviewDraft(r.draft).reasons) if (!r.issues.includes(reason)) r.issues.push(reason);
  return r;
}

/** Runs the automatic review over every draft still waiting, e.g. drafts collected while it was switched off. */
export async function autoReviewPending(): Promise<{ saved: number; skipped: number; review: number }> {
  const db = await getDb();
  const rows = await db.select<{ id: number; draft_json: string; issues_json: string | null }[]>(
    "SELECT id, draft_json, issues_json FROM crawl_job WHERE stage = 'review' AND draft_json IS NOT NULL ORDER BY id",
  );
  const count = { saved: 0, skipped: 0, review: 0 };
  for (const row of rows) {
    const draft = JSON.parse(row.draft_json) as ImportTest;
    const notes = row.issues_json ? (JSON.parse(row.issues_json) as string[]) : [];
    for (const reason of reviewDraft(draft).reasons) if (!notes.includes(reason)) notes.push(reason);
    const result = await settle(row.id, draft, notes);
    if (result === "review") await db.execute("UPDATE crawl_job SET issues_json = $1 WHERE id = $2", [JSON.stringify(notes), row.id]);
    count[result]++;
  }
  notify();
  return count;
}

/* ---------- Processing ---------- */

/** Collects the pictures the drafts refer to and points the drafts at the archived copies. */
async function archiveImages(results: ExtractResult[], minIntervalMs: number): Promise<void> {
  const fetched = new Map<string, { name?: string; reason?: string }>();
  for (const r of results) {
    const holders: { image?: string }[] = r.draft.passages.flatMap((p) => [...(p.paragraphs ?? []), ...p.groups]);
    for (const h of holders) {
      const address = h.image;
      if (!address || ARCHIVED_IMAGE_RE.test(address)) continue;
      if (!fetched.has(address)) {
        fetched.set(
          address,
          /^https?:/.test(address)
            ? await invoke<string>("crawl_image", { req: { url: address, minIntervalMs, respectRobots: true } }).then(
                (name) => ({ name }),
                (e) => ({ reason: errorText(e) }),
              )
            : { reason: "주소를 알 수 없습니다" }, // a local file gives no address to fetch from
        );
      }
      const { name, reason } = fetched.get(address)!;
      if (name) h.image = name;
      else r.issues.push(`그림을 받지 못했습니다: ${address} (${reason})`);
    }
  }
}

async function finish(id: number, stage: string, status: string, message: string | null, extra: Record<string, unknown> = {}) {
  const db = await getDb();
  const cols = Object.keys(extra);
  const sets = cols.map((c, i) => `, ${c} = $${i + 5}`).join("");
  await db.execute(
    `UPDATE crawl_job SET stage = $1, status = $2, error = $3, updated_at = datetime('now')${sets} WHERE id = $4`,
    [stage, status, message, id, ...cols.map((c) => extra[c])],
  );
}

const firstLine = (text: string) => text.split("\n").find((l) => l.trim())?.trim().slice(0, 120) ?? "";
const fileName = (url: string) => decodeURIComponent(url.replace(/[?#].*$/, "").split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "");

async function processJob(job: JobRow, sources: Source[]): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE crawl_job SET status = 'running', attempts = attempts + 1, error = NULL, updated_at = datetime('now') WHERE id = $1",
    [job.id],
  );
  notify();
  try {
    const source = sources.find((s) => s.id === job.source_id);
    const interval = source?.settings.minIntervalMs ?? DEFAULT_INTERVAL_MS;
    const res = await invoke<FetchResult>("crawl_fetch", {
      req: {
        url: job.url,
        minIntervalMs: interval,
        respectRobots: true,
        etag: job.etag,
        lastModified: job.last_modified,
      },
    });
    if (res.notModified) {
      // The page is unchanged, but the extractor may have improved since: read the archived copy instead.
      if (!job.raw_path) return await finish(job.id, "fetch", "done", "지난 수집 이후 바뀐 내용이 없습니다.");
      const raw = await invoke<{ kind: FetchResult["kind"]; text: string }>("read_raw", { path: job.raw_path });
      Object.assign(res, { kind: raw.kind, text: raw.text, rawPath: job.raw_path, contentHash: job.content_hash, finalUrl: job.url });
      Object.assign(res, { etag: job.etag, lastModified: job.last_modified });
    }
    if (res.kind === "other" || res.text === null) {
      throw new Error(`지원하지 않는 형식입니다 (${res.contentType || "알 수 없음"}).`);
    }

    const dup = await db.select<{ id: number }[]>(
      "SELECT id FROM crawl_job WHERE content_hash = $1 AND id <> $2 AND stage IN ('review', 'store') LIMIT 1",
      [res.contentHash, job.id],
    );
    if (dup.length) {
      return await finish(job.id, "fetch", "done", "이미 수집한 내용과 같습니다.", { content_hash: res.contentHash });
    }

    let title: string;
    let text: string;
    let links: PageLink[] = [];
    if (res.kind === "html") {
      const page = htmlToText(res.text, res.finalUrl);
      title = page.title;
      text = page.text;
      links = filterLinks(extractLinks(res.text, res.finalUrl), res.finalUrl, source?.settings.linkPattern);
    } else {
      text = res.text;
      title = fileName(job.url) || firstLine(text);
    }

    const meta = { rawPath: res.rawPath, contentHash: res.contentHash, etag: res.etag, lastModified: res.lastModified };
    const results = extractDrafts(text, { title: title || job.title || undefined });
    await archiveImages(results, interval);
    if (results.length) {
      // A document with several tasks becomes several drafts, addressed as url, url#2, url#3…
      for (const [i, r] of results.map(withFindings).entries()) {
        const target = i === 0 ? { id: job.id } : { url: `${job.url}#${i + 1}`, sourceId: job.source_id };
        const id = await putReview(target, r, meta);
        if (id !== null && autoReviewOn()) await settle(id, r.draft, r.issues);
      }
    } else if (links.length) {
      await finish(job.id, "discover", "done", null, {
        title: title || job.title,
        draft_json: JSON.stringify({ links }),
        content_hash: res.contentHash,
        etag: res.etag,
        last_modified: res.lastModified,
      });
    } else {
      throw new Error("문항을 찾지 못했습니다. 문제 페이지가 아니거나, 스크립트로 내용을 불러오는 페이지일 수 있습니다.");
    }
  } catch (e) {
    await finish(job.id, "fetch", "failed", errorText(e));
  }
}

/* ---------- Re-extraction from the archive ---------- */

/** Drafts of an archived original, built with the current extractor; nothing is fetched. */
async function extractArchived(rawPath: string, url: string, minIntervalMs: number): Promise<ExtractResult[]> {
  const raw = await invoke<{ kind: string; text: string }>("read_raw", { path: rawPath });
  if (raw.kind !== "html") return extractDrafts(raw.text, { title: fileName(url) || firstLine(raw.text) });
  const page = htmlToText(raw.text, url);
  const results = extractDrafts(page.text, { title: page.title || undefined });
  // Pictures already in the archive are reused; only missing ones are requested from the site.
  await archiveImages(results, minIntervalMs);
  return results;
}

/** Rebuilds one draft from its archived original, replacing any edits made in review. */
export async function reextract(jobId: number, cache = new Map<string, Promise<ExtractResult[]>>()): Promise<void> {
  const db = await getDb();
  const [job] = await db.select<
    {
      url: string;
      stage: string;
      source_id: number | null;
      raw_path: string | null;
      content_hash: string | null;
      etag: string | null;
      last_modified: string | null;
    }[]
  >("SELECT url, stage, source_id, raw_path, content_hash, etag, last_modified FROM crawl_job WHERE id = $1", [jobId]);
  if (!job?.raw_path) throw new Error("보관된 원본이 없어 다시 추출할 수 없습니다.");
  if (job.stage !== "review") throw new Error("검수 대기 중인 초안만 다시 추출할 수 있습니다.");
  // Drafts of one document are addressed as url, url#2, url#3…
  const part = job.url.match(/#(\d+)$/);
  const base = part ? job.url.slice(0, part.index) : job.url;
  let results = cache.get(job.raw_path);
  if (!results) {
    const source = (await listSources()).find((s) => s.id === job.source_id);
    results = extractArchived(job.raw_path, base, source?.settings.minIntervalMs ?? DEFAULT_INTERVAL_MS);
    cache.set(job.raw_path, results);
  }
  const r = (await results)[part ? Number(part[1]) - 1 : 0];
  if (!r) throw new Error("원본에서 이 초안에 해당하는 문항을 찾지 못했습니다.");
  await putReview({ id: jobId }, withFindings(r), {
    rawPath: job.raw_path,
    contentHash: job.content_hash,
    etag: job.etag,
    lastModified: job.last_modified,
  });
  notify();
}

/** Rebuilds every draft awaiting review, e.g. after the extractor has improved. Returns the failures. */
export async function reextractAll(): Promise<{ done: number; failed: { id: number; error: string }[] }> {
  const db = await getDb();
  const jobs = await db.select<{ id: number }[]>(
    "SELECT id FROM crawl_job WHERE stage = 'review' AND raw_path IS NOT NULL ORDER BY id",
  );
  const cache = new Map<string, Promise<ExtractResult[]>>();
  const failed: { id: number; error: string }[] = [];
  for (const j of jobs) {
    await reextract(j.id, cache).catch((e) => failed.push({ id: j.id, error: errorText(e) }));
  }
  return { done: jobs.length - failed.length, failed };
}

/* ---------- Queue runner (one job at a time; the Rust side spaces requests per host) ---------- */

let running = false;
let stopRequested = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export const isRunning = () => running;
export const stopQueue = () => {
  if (running) stopRequested = true;
};
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Jobs left "running" by a previous session go back to the queue. */
export async function resumeInterrupted(): Promise<void> {
  if (running) return;
  const db = await getDb();
  await db.execute("UPDATE crawl_job SET status = 'pending' WHERE status = 'running'");
}

export async function runQueue(): Promise<void> {
  if (running) return;
  running = true;
  notify();
  try {
    const db = await getDb();
    const sources = await listSources();
    while (!stopRequested) {
      const [job] = await db.select<JobRow[]>(
        `SELECT ${JOB_COLUMNS} FROM crawl_job WHERE stage = 'fetch' AND status = 'pending' ORDER BY id LIMIT 1`,
      );
      if (!job) break;
      await processJob(job, sources);
      notify();
    }
  } finally {
    running = false;
    stopRequested = false;
    notify();
  }
}

/* ---------- Local files ---------- */

/** Reads a local PDF/HTML/text file and queues its drafts for review. Returns how many drafts were found. */
export async function importLocalFile(file: File): Promise<number> {
  const base = file.name.replace(/\.[^.]+$/, "");
  let title = base;
  let text: string;
  if (/\.pdf$/i.test(file.name)) {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    text = await invoke<string>("extract_pdf_bytes", { bytes });
  } else if (/\.html?$/i.test(file.name)) {
    const page = htmlToText(await file.text());
    text = page.text;
    title = page.title || base;
  } else {
    text = await file.text();
  }
  const results = extractDrafts(text, { title });
  if (results.length === 0) throw new Error("문항을 찾지 못했습니다. 'Questions 1–5'와 같은 문항 범위 표시가 있는지 확인해 주십시오.");
  await archiveImages(results, DEFAULT_INTERVAL_MS);
  for (let i = 0; i < results.length; i++) {
    const id = await putReview({ url: `file:${file.name}${i ? `#${i + 1}` : ""}`, sourceId: null }, withFindings(results[i]), {
      rawPath: null,
      contentHash: null,
    });
    if (id !== null && autoReviewOn()) await settle(id, results[i].draft, results[i].issues);
  }
  notify();
  return results.length;
}
