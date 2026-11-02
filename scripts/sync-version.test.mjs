// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { crateName, setConfigVersion, setCrateVersion, setLockVersion } from "./sync-version.mjs";

describe("sync-version", () => {
  it("changes only the crate's own version in Cargo.toml and keeps its CRLF line endings", () => {
    const toml = '[package]\r\nname = "exam-app"\r\nversion = "0.1.0"\r\n\r\n[dependencies]\r\nserde = { version = "1" }\r\n';
    expect(setCrateVersion(toml, "0.2.0")).toBe(
      '[package]\r\nname = "exam-app"\r\nversion = "0.2.0"\r\n\r\n[dependencies]\r\nserde = { version = "1" }\r\n',
    );
    expect(crateName(toml)).toBe("exam-app");
  });

  it("changes only the app's entry in Cargo.lock", () => {
    const lock = '[[package]]\nname = "tokio"\nversion = "0.1.0"\n\n[[package]]\nname = "exam-app"\nversion = "0.1.0"\ndependencies = [\n';
    expect(setLockVersion(lock, "exam-app", "0.2.0")).toBe(
      '[[package]]\nname = "tokio"\nversion = "0.1.0"\n\n[[package]]\nname = "exam-app"\nversion = "0.2.0"\ndependencies = [\n',
    );
  });

  it("changes only the top-level version in tauri.conf.json", () => {
    const json = '{\r\n  "productName": "EXAM",\r\n  "version": "0.1.0",\r\n  "plugins": {\r\n    "x": { "version": "9" }\r\n  }\r\n}\r\n';
    expect(setConfigVersion(json, "0.2.0")).toBe(
      '{\r\n  "productName": "EXAM",\r\n  "version": "0.2.0",\r\n  "plugins": {\r\n    "x": { "version": "9" }\r\n  }\r\n}\r\n',
    );
  });

  it("fails loudly instead of leaving a file behind when its version line is missing", () => {
    expect(() => setCrateVersion('[package]\nname = "exam-app"\n', "0.2.0")).toThrow(/Cargo\.toml/);
    expect(() => setLockVersion('[[package]]\nname = "tokio"\nversion = "1"\n', "exam-app", "0.2.0")).toThrow(/exam-app/);
    expect(() => setConfigVersion('{\n  "productName": "EXAM"\n}\n', "0.2.0")).toThrow(/tauri\.conf\.json/);
    expect(() => crateName("[dependencies]\n")).toThrow(/package name/);
  });
});

// The installer, the backup header and the updater read tauri.conf.json; the release tag is checked against
// package.json. All four must name the same version.
it("package.json, tauri.conf.json, Cargo.toml and Cargo.lock name the same app version", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const pkg = JSON.parse(read("package.json")).version;
  const conf = JSON.parse(read("src-tauri/tauri.conf.json")).version;
  const toml = read("src-tauri/Cargo.toml");
  const crate = toml.match(/^\[package\][^[]*?^version = "([^"]+)"/m)?.[1];
  const lock = read("src-tauri/Cargo.lock").match(new RegExp(`^name = "${crateName(toml)}"\\r?\\nversion = "([^"]+)"`, "m"))?.[1];
  expect({ conf, crate, lock }).toEqual({ conf: pkg, crate: pkg, lock: pkg });
});
