// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { releasePlan, wranglerBin } from "./publish-update.mjs";

describe("wranglerBin", () => {
  it("finds the CLI file although the package's exports hide bin/ (as wrangler 4.155 does)", () => {
    const root = mkdtempSync(join(tmpdir(), "wrangler-bin-"));
    const pkg = join(root, "node_modules", "wrangler");
    mkdirSync(join(pkg, "bin"), { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({
        name: "wrangler",
        bin: { wrangler: "./bin/wrangler.js" },
        exports: { ".": "./cli.js", "./package.json": "./package.json" },
      }),
    );
    writeFileSync(join(pkg, "bin", "wrangler.js"), "");
    const { resolve } = createRequire(join(root, "publish.mjs"));

    expect(() => resolve("wrangler/bin/wrangler.js")).toThrow(/not defined by "exports"/);
    const bin = wranglerBin(resolve);
    expect(bin).toBe(join(pkg, "bin", "wrangler.js"));
    expect(existsSync(bin)).toBe(true);
  });
});

const MARKET = "https://exam-market.hermitsdiner.workers.dev";
const DIR = "src-tauri/target/release/bundle/nsis";
const release = (over = {}) => ({
  version: "0.2.0",
  pubDate: "2026-11-02T00:00:00.000Z",
  dir: DIR,
  editions: [
    { endpoint: `${MARKET}/updates/exam/free/latest.json`, productName: "EXAM", signature: "SIG-FREE" },
    { endpoint: `${MARKET}/updates/exam/studio/latest.json`, productName: "EXAM Studio", signature: "SIG-STUDIO" },
  ],
  ...over,
});

describe("releasePlan", () => {
  it("uploads both installers before either manifest, at the paths the apps poll", () => {
    const plan = releasePlan(release());
    expect(plan.map(({ key, file }) => ({ key, file }))).toEqual([
      { key: "updates/exam/free/0.2.0/EXAM_0.2.0_x64-setup.exe", file: `${DIR}/EXAM_0.2.0_x64-setup.exe` },
      { key: "updates/exam/studio/0.2.0/EXAM-Studio_0.2.0_x64-setup.exe", file: `${DIR}/EXAM Studio_0.2.0_x64-setup.exe` },
      { key: "updates/exam/free/latest.json", file: undefined },
      { key: "updates/exam/studio/latest.json", file: undefined },
    ]);
    expect(plan.map((s) => s.contentType)).toEqual(["application/octet-stream", "application/octet-stream", "application/json", "application/json"]);
  });

  it("writes each edition's manifest with its own installer and signature", () => {
    const [, , free, studio] = releasePlan(release());
    expect(JSON.parse(free.body)).toEqual({
      version: "0.2.0",
      notes: "",
      pub_date: "2026-11-02T00:00:00.000Z",
      platforms: { "windows-x86_64": { signature: "SIG-FREE", url: `${MARKET}/updates/exam/free/0.2.0/EXAM_0.2.0_x64-setup.exe` } },
    });
    expect(JSON.parse(studio.body).platforms).toEqual({
      "windows-x86_64": { signature: "SIG-STUDIO", url: `${MARKET}/updates/exam/studio/0.2.0/EXAM-Studio_0.2.0_x64-setup.exe` },
    });
  });

  it("refuses an endpoint that is not the market's update path", () => {
    const editions = release().editions.map((e, i) => (i ? e : { ...e, endpoint: "https://github.com/hermits-diner/EXAM/releases/latest/download/latest.json" }));
    expect(() => releasePlan(release({ editions }))).toThrow(/endpoint/);
  });

  it("refuses two editions that poll the same manifest, which would hand one edition the other's installer", () => {
    const editions = release().editions.map((e) => ({ ...e, endpoint: `${MARKET}/updates/exam/free/latest.json` }));
    expect(() => releasePlan(release({ editions }))).toThrow(/same/);
  });
});
