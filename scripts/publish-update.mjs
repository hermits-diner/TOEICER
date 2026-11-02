// Run by release.yml after both editions are built and signed: puts each installer and its updater manifest in the
// market's R2 bucket, where the market serves /updates/<slug>/<edition>/... (exam-market src/routes/updates.ts).
// The paths come from the endpoints the apps poll (plugins.updater in tauri.conf.json and tauri.studio.conf.json),
// so what is published is what the apps look for. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, and wrangler
// installed next to the app (`npm install --no-save wrangler`).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const BUCKET = "exam-market-files";

/** wrangler's CLI file. Its package exports hide bin/ (ERR_PACKAGE_PATH_NOT_EXPORTED), but package.json is public. */
export function wranglerBin(resolve = createRequire(import.meta.url).resolve) {
  const pkg = resolve("wrangler/package.json");
  return join(dirname(pkg), JSON.parse(readFileSync(pkg, "utf8")).bin.wrangler);
}
const ENDPOINT = /^(https:\/\/[^/]+)\/updates\/([a-z0-9-]+)\/(free|studio)\/latest\.json$/;

/** The NSIS installer tauri build names after productName; published without spaces (one URL path segment). */
const installerName = (productName, version) => `${productName}_${version}_x64-setup.exe`;

/**
 * The uploads, installers first: a manifest goes up only once the installer it names is there, so an app never
 * finds an update it cannot download.
 */
export function releasePlan({ version, pubDate, dir, editions }) {
  const parsed = editions.map((e) => {
    const m = ENDPOINT.exec(e.endpoint);
    if (!m) throw new Error(`updater endpoint is not the market's update path: ${e.endpoint}`);
    const [, market, slug, edition] = m;
    const local = installerName(e.productName, version);
    const prefix = `updates/${slug}/${edition}`;
    const key = `${prefix}/${version}/${local.replaceAll(" ", "-")}`;
    return { ...e, market, prefix, key, local };
  });
  if (new Set(parsed.map((e) => e.endpoint)).size !== parsed.length) {
    throw new Error("two editions poll the same manifest; each needs its own endpoint (tauri.studio.conf.json)");
  }
  const manifest = (e) =>
    JSON.stringify({
      version,
      notes: "",
      pub_date: pubDate,
      platforms: { "windows-x86_64": { signature: e.signature, url: `${e.market}/${e.key}` } },
    });
  return [
    ...parsed.map((e) => ({ key: e.key, file: `${dir}/${e.local}`, contentType: "application/octet-stream" })),
    ...parsed.map((e) => ({ key: `${e.prefix}/latest.json`, body: manifest(e), contentType: "application/json" })),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = (p) => readFileSync(p, "utf8");
  const free = JSON.parse(read("src-tauri/tauri.conf.json"));
  const studio = JSON.parse(read("src-tauri/tauri.studio.conf.json"));
  const version = free.version;
  const dir = "src-tauri/target/release/bundle/nsis";
  const editions = [
    { endpoint: free.plugins.updater.endpoints[0], productName: free.productName },
    { endpoint: studio.plugins.updater.endpoints[0], productName: studio.productName },
  ].map((e) => ({ ...e, signature: read(`${dir}/${installerName(e.productName, version)}.sig`).trim() }));
  const plan = releasePlan({ version, pubDate: new Date().toISOString(), dir, editions });

  // No shell: the Studio installer's name has a space.
  const wrangler = wranglerBin();
  const tmp = mkdtempSync(join(tmpdir(), "release-"));
  for (const [i, step] of plan.entries()) {
    let file = step.file;
    if (!file) writeFileSync((file = join(tmp, `${i}.json`)), step.body);
    console.log(`→ ${BUCKET}/${step.key}`);
    execFileSync(process.execPath, [wrangler, "r2", "object", "put", `${BUCKET}/${step.key}`, "--file", file, "--content-type", step.contentType, "--remote"], {
      stdio: "inherit",
    });
  }
}
