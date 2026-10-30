// Makes the speech for the built-in Listening set with Gemini TTS.
//
//   GEMINI_API_KEY=... node scripts/sample-audio.mjs [--force]
//
// Reads the jobs from src/lib/toeicSamples.ts, has Gemini read every job that has no audio yet (the request has the
// same form as ai_tts in src-tauri/src/ai.rs), converts the WAV to 64 kbps mono MP3 with ffmpeg, and keeps it in
// public/sample-audio under its archive name. Each new take is transcribed by a Gemini text model and compared with the
// script, so a cut-off or garbled take is made again. Then src/data/sampleAudio.ts is rewritten and MP3s no job uses
// are removed. Needs ffmpeg on PATH. The key is read only from the environment.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const JOBS = { module: "src/lib/toeicSamples.ts", export: "toeicSampleAudioJobs" };
const CHECK_MODEL = "gemini-3.5-flash";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "sample-audio");
const MANIFEST = join(ROOT, "src", "data", "sampleAudio.ts");
const API = "https://generativelanguage.googleapis.com/v1beta/models";

const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error("GEMINI_API_KEY is not set.");
const force = process.argv.includes("--force");

const load = async (path) => (await runnerImport(join(ROOT, path), { root: ROOT, logLevel: "error" })).module;
const jobs = (await load(JOBS.module))[JOBS.export]();
const { SAMPLE_TTS_MODEL: model } = await load("src/lib/sampleMedia.ts");
const { SAMPLE_AUDIO: old } = await load("src/data/sampleAudio.ts");

/** Same body as gemini_tts_body in ai.rs. */
function ttsBody(job) {
  const turns = job.turns.filter((t) => t.text.trim());
  const speakers = [...new Set(turns.map((t) => t.speaker))];
  const voice = (s) => ({ prebuiltVoiceConfig: { voiceName: job.voices[s] } });
  if (speakers.length === 1) {
    return {
      contents: [{ parts: [{ text: turns.map((t) => t.text.trim()).join("\n\n") }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: voice(speakers[0]) } },
    };
  }
  if (speakers.length !== 2) throw new Error(`${job.key}: Gemini reads at most two speakers`);
  return {
    contents: [{ parts: turns.map((t) => ({ text: t.text.trim(), speechMetadata: { speaker: t.speaker } })) }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { multiSpeakerVoiceConfig: { speakerVoiceConfigs: speakers.map((s) => ({ speaker: s, voiceConfig: voice(s) })) } },
    },
  };
}

async function gemini(modelName, body) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`${API}/${modelName}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
    if (r.ok) return r.json();
    const text = await r.text();
    if ((r.status === 429 || r.status >= 500) && attempt < 6) {
      await new Promise((ok) => setTimeout(ok, 5000 * attempt));
      continue;
    }
    throw new Error(`${modelName} ${r.status}: ${text.slice(0, 300)}`);
  }
}

/** Gemini's audio as WAV bytes (gemini-3.8 sends a WAV; older models send raw L16 PCM). */
function wavOf(part) {
  const bytes = Buffer.from(part.inlineData.data, "base64");
  if (bytes.subarray(0, 4).toString() === "RIFF") return bytes;
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1] ?? 24000);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + bytes.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([h, bytes]);
}

const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
/** 0–9999 as spoken ("250" → "two hundred fifty"), so the script's numbers meet the transcript's words. */
function numberWords(n) {
  if (n >= 1000) return `${numberWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numberWords(n % 1000)}` : ""}`;
  if (n >= 100) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ""}`;
  if (n >= 20) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
  return ONES[n];
}

// Hyphens split words ("forty-two" and "forty two" match); digits are spelled out on both sides.
const words = (s) =>
  s
    .toLowerCase()
    .replace(/\d+/g, (d) => (d.length <= 4 ? ` ${numberWords(Number(d))} ` : d))
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Share of the script's words, in order, that the transcript has (longest common subsequence over words). */
function coverage(script, heard) {
  const a = words(script);
  const b = words(heard);
  let prev = new Array(b.length + 1).fill(0);
  for (const w of a) {
    const cur = [0];
    for (let j = 1; j <= b.length; j++) cur[j] = w === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length] / Math.max(1, a.length);
}

async function make(job) {
  const script = job.turns.map((t) => t.text).join(" ");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await gemini(model, ttsBody(job));
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) throw new Error(`${job.key}: no audio (${res.candidates?.[0]?.finishReason ?? "unknown"})`);
    const wav = wavOf(part);
    const seconds = (wav.length - 44) / 2 / wav.readUInt32LE(24);

    const heard = await gemini(CHECK_MODEL, {
      contents: [
        {
          parts: [
            {
              // Part 1 and 2 read their choices as "(A) … (B) …": the letters must come back as letters, not dropped.
              text: "Transcribe this English speech word for word. Spell every number, price and time out in words as spoken (fifteen, forty-nine ninety-nine, ten thirty). When an answer choice letter is read out, write it as the single letter (A, B, C, D) where it is said. Reply with the transcript only.",
            },
            { inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } },
          ],
        },
      ],
    });
    const transcript = heard.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join(" ") ?? "";
    const cover = coverage(script, transcript);
    const pace = words(script).length / seconds;
    if (cover >= 0.9 && pace > 1.4 && pace < 4) {
      const tmp = join(tmpdir(), `sample-audio-${process.pid}-${job.key}`);
      writeFileSync(`${tmp}.wav`, wav);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", `${tmp}.wav`, "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "64k", "-map_metadata", "-1", "-id3v2_version", "0", "-write_id3v1", "0", `${tmp}.mp3`]);
      const mp3 = readFileSync(`${tmp}.mp3`);
      rmSync(`${tmp}.wav`);
      rmSync(`${tmp}.mp3`);
      const name = `aud-${createHash("sha256").update(mp3).digest("hex").slice(0, 32)}.mp3`;
      writeFileSync(join(OUT, name), mp3);
      console.log(`${job.key}  ${seconds.toFixed(1)}s  ${(cover * 100).toFixed(0)}% heard  ${name}`);
      return name;
    }
    console.warn(`${job.key}: take ${attempt} rejected (${(cover * 100).toFixed(0)}% of the script heard, ${pace.toFixed(1)} words/s)`);
  }
  throw new Error(`${job.key}: no good take in 3 tries`);
}

mkdirSync(OUT, { recursive: true });
const made = {};
const failed = [];
let fresh = 0;
const todo = [...jobs];
// Two at a time keeps well under the TTS rate limit. A job that fails is left out, so its passage has no audio.
await Promise.all(
  [0, 1].map(async () => {
    while (todo.length) {
      const job = todo.shift();
      const kept = old[job.key];
      if (!force && kept && existsSync(join(OUT, kept))) {
        made[job.key] = kept;
        continue;
      }
      try {
        made[job.key] = await make(job);
        fresh++;
      } catch (e) {
        failed.push(job.key);
        console.error(String(e));
      }
    }
  }),
);

const keys = jobs.map((j) => j.key).filter((k) => made[k]);
writeFileSync(
  MANIFEST,
  "// Written by scripts/sample-audio.mjs: job key → archive name of the MP3 in public/sample-audio.\n" +
    "export const SAMPLE_AUDIO: Record<string, string> = {\n" +
    keys.map((k) => `  "${k}": "${made[k]}",\n`).join("") +
    "};\n",
);
const used = new Set(Object.values(made));
for (const f of readdirSync(OUT)) if (!used.has(f)) rmSync(join(OUT, f));
console.log(`${keys.length} of ${jobs.length} jobs have audio (${fresh} made now), ${used.size} files in public/sample-audio`);
if (failed.length) {
  console.error(`failed: ${failed.join(", ")}`);
  process.exitCode = 1;
}
