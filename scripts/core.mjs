// The code the eight exam apps share. core.json lists the shared files with a hash of each; the source app it names
// holds the originals and every sibling holds exact copies, so a fix is made once, in the source app, and copied:
//   node scripts/core.mjs sync <app folder>...   in the source app: record the hashes, then copy into each sibling
//   node scripts/core.mjs lock                   in the source app: only record the hashes after editing a shared file
//   node scripts/core.mjs check                  any app: list shared files that differ from core.json
// core.test.mjs runs the check in every app's `npm test`, so an edit to a sibling's copy fails there. What differs
// between the apps lives in src/lib/brand.ts and src-tauri/src/brand.rs, which are never shared.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MANIFEST = "core.json";

/** git turns line endings into the platform's on checkout, so CRLF and LF copies hash the same. */
export const hashOf = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

const readManifest = (root) => JSON.parse(readFileSync(join(root, MANIFEST), "utf8"));
const writeManifest = (root, m) => writeFileSync(join(root, MANIFEST), `${JSON.stringify(m, null, 2)}\n`);

/** Shared files that are missing from `root` or differ from what its core.json records. */
export function drift(root) {
  return Object.entries(readManifest(root).files)
    .filter(([path, hash]) => {
      const file = join(root, path);
      return !existsSync(file) || hashOf(readFileSync(file, "utf8")) !== hash;
    })
    .map(([path]) => path);
}

/** Records the current hash of every shared file. */
export function lock(root) {
  const m = readManifest(root);
  for (const path of Object.keys(m.files)) m.files[path] = hashOf(readFileSync(join(root, path), "utf8"));
  writeManifest(root, m);
}

/** Copies the shared files and core.json from `source` into the app checkout at `target`. */
export function sync(source, target) {
  if (resolve(source) === resolve(target)) throw new Error("sync copies into a sibling, not into the source itself");
  if (!existsSync(join(target, "src-tauri"))) throw new Error(`${target}: not an app checkout (no src-tauri folder)`);
  const stale = drift(source);
  if (stale.length) throw new Error(`${source}: lock the shared files first (${stale.join(", ")})`);
  // A sibling whose copies were edited after the last sync holds a change the source lacks; copying would erase it.
  const known = existsSync(join(target, MANIFEST)) ? readManifest(target).files : {};
  const edited = existsSync(join(target, MANIFEST)) ? drift(target) : [];
  if (edited.length) throw new Error(`${target}: its shared files were edited there; move the change to the source app first (${edited.join(", ")})`);
  const m = readManifest(source);
  // A file newly shared may already exist in the sibling as its own version; that one needs a look first, too.
  const own = Object.entries(m.files)
    .filter(([path, hash]) => !(path in known) && existsSync(join(target, path)) && hashOf(readFileSync(join(target, path), "utf8")) !== hash)
    .map(([path]) => path);
  if (own.length) throw new Error(`${target}: has its own version of newly shared files; compare them with the source first (${own.join(", ")})`);
  for (const path of Object.keys(m.files)) {
    mkdirSync(dirname(join(target, path)), { recursive: true });
    copyFileSync(join(source, path), join(target, path));
  }
  writeManifest(target, m);
  return Object.keys(m.files).length;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const [command, ...targets] = process.argv.slice(2);
  if (command === "check") {
    const stale = drift(root);
    if (stale.length) {
      console.error(`Shared files differ from core.json: ${stale.join(", ")}`);
      process.exit(1);
    }
    console.log("Shared files match core.json.");
  } else if (command === "lock") {
    lock(root);
    console.log("core.json updated.");
  } else if (command === "sync" && targets.length) {
    lock(root);
    for (const t of targets) console.log(`${t}: ${sync(root, resolve(t))} shared files copied`);
  } else {
    console.error("usage: node scripts/core.mjs check | lock | sync <app folder>...");
    process.exit(2);
  }
}
