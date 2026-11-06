import { describe, expect, it } from "vitest";
import { base64ToBytes, importKey, isSealedEntry, isSealedValue, openEntry, openValue, randomKey, sealValue, unwrapKey, wrapKey } from "./sealed";

describe("a set file's sealed entry", () => {
  // The same sample is in exam-market's test/locked-files.test.ts: if either side changes the form, one of them fails.
  const KEY = base64ToBytes("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=");
  const ENTRY = JSON.stringify({ sealed: 1, iv: "ZGVmZ2hpamtsbW5v", data: "MzmqDw2FM7wEQLRCcon3ZahxpuYJwNFehb+OcsreFzGvg4nW+/V7v5Uq9DHBjA==" });

  it("opens the form the site writes", async () => {
    expect(isSealedEntry(ENTRY)).toBe(true);
    expect(await openEntry(KEY, ENTRY)).toBe('{"title":"모의고사","n":1}');
  });

  it("does not open with another key", async () => {
    await expect(openEntry(randomKey(), ENTRY)).rejects.toThrow();
  });

  it("tells a set from a sealed entry", () => {
    expect(isSealedEntry('{"title":"Reading","kind":"reading","passages":[]}')).toBe(false);
    expect(isSealedEntry('{"sealed":2}')).toBe(false);
    expect(isSealedEntry('{"sealed"')).toBe(false);
  });
});

describe("stored values and keys", () => {
  it("round-trips Korean and long text, differently each time", async () => {
    const key = await importKey(randomKey());
    const text = `지문 ${"가나다 abc ".repeat(20000)}`;
    const a = await sealValue(key, text);
    const b = await sealValue(key, text);
    expect(a).not.toBe(b);
    expect(isSealedValue(a)).toBe(true);
    expect(a).not.toContain("가나다");
    expect(await openValue(key, a)).toBe(text);
  });

  it("does not take a plain value for a sealed one", () => {
    expect(isSealedValue("<p>Bees thrive.</p>")).toBe(false);
    expect(isSealedValue(null)).toBe(false);
  });

  it("does not open under another key", async () => {
    const sealed = await sealValue(await importKey(randomKey()), "비밀");
    await expect(openValue(await importKey(randomKey()), sealed)).rejects.toThrow();
  });

  it("keeps a key under another key", async () => {
    const outer = randomKey();
    const inner = randomKey();
    const kept = await wrapKey(outer, inner);
    expect(await unwrapKey(outer, kept)).toEqual(inner);
    await expect(unwrapKey(randomKey(), kept)).rejects.toThrow();
  });
});
