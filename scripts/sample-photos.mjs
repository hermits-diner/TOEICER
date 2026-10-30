// Makes the Part 1 photographs of the built-in Listening set with a Gemini image model.
//
//   GEMINI_API_KEY=... node scripts/sample-photos.mjs [--force] [--redo <key prefix>,…]
//
// Reads the jobs from src/lib/toeicSamples.ts, has Gemini draw every job that has no photograph yet (the request has
// the same form as ai_image in src-tauri/src/ai.rs), converts it to a 960-pixel-wide WebP with ffmpeg and keeps it in
// public/sample-photos under its archive name. Then src/data/samplePhotos.ts is rewritten and pictures no job uses are
// removed. A picture can come out wrong (a ladder where the key says there is none, an extra person), so look at
// every new one and draw it again with --redo q2 (its job key's start) until it shows its keyed statement and none of
// the others. Needs ffmpeg on PATH. The key is read only from the environment.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "sample-photos");
const MANIFEST = join(ROOT, "src", "data", "samplePhotos.ts");
const API = "https://generativelanguage.googleapis.com/v1beta/models";

const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error("GEMINI_API_KEY is not set.");
const force = process.argv.includes("--force");
const redoAt = process.argv.indexOf("--redo");
const redo = redoAt > 0 ? (process.argv[redoAt + 1] ?? "").split(",").filter(Boolean) : [];

const load = async (path) => (await runnerImport(join(ROOT, path), { root: ROOT, logLevel: "error" })).module;
const jobs = (await load("src/lib/toeicSamples.ts")).toeicSamplePhotoJobs();
const { SAMPLE_IMAGE_MODEL: model } = await load("src/lib/sampleMedia.ts");
const { SAMPLE_PHOTOS: old } = await load("src/data/samplePhotos.ts");

/** Same body as gemini_image_body in ai.rs. */
const imageBody = (prompt) => ({
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
});

async function draw(prompt) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`${API}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(imageBody(prompt)),
    });
    if (r.ok) {
      const res = await r.json();
      const data = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
      if (data) return Buffer.from(data, "base64");
      if (attempt >= 3) throw new Error(`no image (${res.candidates?.[0]?.finishReason ?? "unknown"})`);
      continue;
    }
    const text = await r.text();
    if ((r.status === 429 || r.status >= 500) && attempt < 6) {
      await new Promise((ok) => setTimeout(ok, 5000 * attempt));
      continue;
    }
    throw new Error(`${model} ${r.status}: ${text.slice(0, 300)}`);
  }
}

async function make(job) {
  const picture = await draw(job.prompt);
  const tmp = join(tmpdir(), `sample-photo-${process.pid}-${job.key}`);
  writeFileSync(`${tmp}.img`, picture);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", `${tmp}.img`, "-vf", "scale='min(960,iw)':-2", "-c:v", "libwebp", "-quality", "78", "-compression_level", "6", "-map_metadata", "-1", `${tmp}.webp`]);
  const webp = readFileSync(`${tmp}.webp`);
  rmSync(`${tmp}.img`);
  rmSync(`${tmp}.webp`);
  const name = `img-${createHash("sha256").update(webp).digest("hex").slice(0, 32)}.webp`;
  writeFileSync(join(OUT, name), webp);
  console.log(`${job.key}  ${(webp.length / 1024).toFixed(0)} KB  ${name}`);
  return name;
}

mkdirSync(OUT, { recursive: true });
const made = {};
const failed = [];
const todo = [...jobs];
// Two at a time, like the speech script; a job that fails is left out, so its item has no photograph.
await Promise.all(
  [0, 1].map(async () => {
    while (todo.length) {
      const job = todo.shift();
      const kept = old[job.key];
      if (!force && !redo.some((r) => job.key.startsWith(`${r}-`)) && kept && existsSync(join(OUT, kept))) {
        made[job.key] = kept;
        continue;
      }
      try {
        made[job.key] = await make(job);
      } catch (e) {
        failed.push(job.key);
        console.error(`${job.key}: ${e}`);
      }
    }
  }),
);

const keys = jobs.map((j) => j.key).filter((k) => made[k]);
writeFileSync(
  MANIFEST,
  "// Written by scripts/sample-photos.mjs: job key → archive name of the WebP in public/sample-photos.\n" +
    "export const SAMPLE_PHOTOS: Record<string, string> = {\n" +
    keys.map((k) => `  "${k}": "${made[k]}",\n`).join("") +
    "};\n",
);
const used = new Set(Object.values(made));
for (const f of readdirSync(OUT)) if (!used.has(f)) rmSync(join(OUT, f));
console.log(`${keys.length} of ${jobs.length} photographs made, ${used.size} files in public/sample-photos`);
if (failed.length) {
  console.error(`failed: ${failed.join(", ")}`);
  process.exitCode = 1;
}
