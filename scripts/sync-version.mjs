// Run by `npm version <new>` (package.json's "version" script) after npm has bumped package.json: copies that
// version into tauri.conf.json (what the installer, backups and the updater report) and the Rust crate, so the
// release tag npm then makes names the version the app reports. Only the version text changes; line endings stay.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const replaceOnce = (text, pattern, version, what) => {
  if (!pattern.test(text)) throw new Error(`${what}: version line not found`);
  return text.replace(pattern, (_m, head, tail) => `${head}${version}${tail}`);
};

export const setCrateVersion = (toml, version) =>
  replaceOnce(toml, /(^\[package\][^[]*?^version = ")[^"]*(")/m, version, "src-tauri/Cargo.toml");

export const setLockVersion = (lock, name, version) =>
  replaceOnce(lock, new RegExp(`(^name = "${name}"\\r?\\nversion = ")[^"]*(")`, "m"), version, `src-tauri/Cargo.lock (${name})`);

/** The two-space indent is the top level of the file; nested "version" keys sit deeper. */
export const setConfigVersion = (json, version) =>
  replaceOnce(json, /(^ {2}"version": ")[^"]*(")/m, version, "src-tauri/tauri.conf.json");

/** The app crate's name, which is also its entry in Cargo.lock. */
export function crateName(toml) {
  const name = toml.match(/^\[package\][^[]*?^name = "([^"]+)"/m)?.[1];
  if (!name) throw new Error("src-tauri/Cargo.toml: package name not found");
  return name;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const edit = (path, change) => writeFileSync(path, change(readFileSync(path, "utf8")));
  const name = crateName(readFileSync("src-tauri/Cargo.toml", "utf8"));
  edit("src-tauri/tauri.conf.json", (t) => setConfigVersion(t, version));
  edit("src-tauri/Cargo.toml", (t) => setCrateVersion(t, version));
  edit("src-tauri/Cargo.lock", (t) => setLockVersion(t, name, version));
  console.log(`tauri.conf.json, Cargo.toml and Cargo.lock now say ${version}`);
}
