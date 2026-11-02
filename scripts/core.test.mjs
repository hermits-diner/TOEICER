// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { drift, hashOf, lock, MANIFEST, sync } from "./core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function app(files) {
  const dir = mkdtempSync(join(tmpdir(), "core-"));
  mkdirSync(join(dir, "src-tauri"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe("shared core", () => {
  it("this app's shared files are the ones core.json records (edit them in the source app it names, then sync)", () => {
    expect(drift(root)).toEqual([]);
  });

  it("hashes a file the same with CRLF or LF line endings", () => {
    expect(hashOf("a\r\nb\r\n")).toBe(hashOf("a\nb\n"));
    expect(hashOf("a\nb\n")).not.toBe(hashOf("a\nc\n"));
  });

  it("copies the shared files and the record into a sibling, then refuses to overwrite an edited copy", () => {
    const source = app({ [MANIFEST]: JSON.stringify({ files: { "src/a.ts": "" } }), "src/a.ts": "shared\n" });
    const sibling = app({ "src/b.ts": "its own\n" });
    expect(() => sync(source, sibling)).toThrow(/lock the shared files first/);
    lock(source);
    expect(sync(source, sibling)).toBe(1);
    expect(readFileSync(join(sibling, "src/a.ts"), "utf8")).toBe("shared\n");
    expect(drift(sibling)).toEqual([]);

    writeFileSync(join(sibling, "src/a.ts"), "fixed only here\n");
    expect(drift(sibling)).toEqual(["src/a.ts"]);
    expect(() => sync(source, sibling)).toThrow(/edited there/);
  });

  it("refuses to overwrite a sibling's own version of a file that is newly shared", () => {
    const source = app({ [MANIFEST]: JSON.stringify({ files: { "src/b.ts": "" } }), "src/b.ts": "shared\n" });
    const sibling = app({ "src/b.ts": "its own\n" });
    lock(source);
    expect(() => sync(source, sibling)).toThrow(/its own version of newly shared files.*\(src\/b\.ts\)/);
    writeFileSync(join(sibling, "src/b.ts"), "shared\r\n");
    expect(sync(source, sibling)).toBe(1);
  });
});
