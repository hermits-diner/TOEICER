import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("./db", () => ({ getDb: vi.fn() }));
const { keyText, toCsv } = await import("./recordsCsv");

describe("toCsv", () => {
  it("quotes fields holding a comma, a quote or a line break and ends every row with CRLF", () => {
    expect(toCsv([["a", 1, null], ["x,y", 'say "hi"', "two\nlines"]])).toBe('a,1,\r\n"x,y","say ""hi""","two\nlines"\r\n');
  });
  it("writes an empty cell for null and undefined and keeps zero", () => {
    expect(toCsv([[0, undefined, ""]])).toBe("0,,\r\n");
  });
});

describe("keyText", () => {
  it("joins alternative answers and survives a bare string", () => {
    expect(keyText('["B","C"]')).toBe("B | C");
    expect(keyText('"B"')).toBe("B");
    expect(keyText("not json")).toBe("not json");
  });
});
