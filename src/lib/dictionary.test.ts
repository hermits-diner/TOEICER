import { describe, expect, it } from "vitest";
import { candidates } from "./dictionary";

describe("candidates", () => {
  it("keeps the form itself first", () => {
    expect(candidates("Decline")[0]).toBe("decline");
  });
  it("covers regular inflections", () => {
    expect(candidates("declined")).toContain("decline");
    expect(candidates("studies")).toContain("study");
    expect(candidates("running")).toContain("run");
    expect(candidates("stopped")).toContain("stop");
    expect(candidates("making")).toContain("make");
    expect(candidates("larger")).toContain("large");
    expect(candidates("happily")).toContain("happy");
    expect(candidates("investors")).toContain("investor");
  });
  it("covers irregular forms and possessives", () => {
    expect(candidates("began")).toContain("begin");
    expect(candidates("children")).toContain("child");
    expect(candidates("phenomena")).toContain("phenomenon");
    expect(candidates("government's")).toEqual(expect.arrayContaining(["government"]));
  });
  it("tries the other spelling", () => {
    expect(candidates("behaviour")).toContain("behavior");
    expect(candidates("analysed")).toContain("analyze");
    expect(candidates("centre")).toContain("center");
    expect(candidates("organisation")).toContain("organization");
  });
  it("ignores non-words", () => {
    expect(candidates("123")).toEqual([]);
  });
});
