import { describe, expect, it } from "vitest";
import { chartSvg, niceScale, validateChart } from "./chart";

const bar = {
  type: "bar",
  title: "Household recycling rates",
  unit: "%",
  categories: ["2005", "2010", "2015", "2020"],
  series: [
    { name: "Glass", values: [20, 35, 48, 61] },
    { name: "Paper", values: [30, 42, 50, 55] },
  ],
};

describe("validateChart", () => {
  it("accepts a well-formed spec and tidies values", () => {
    const s = validateChart({ ...bar, categories: [2005, 2010, 2015, 2020] });
    expect(s.categories).toEqual(["2005", "2010", "2015", "2020"]);
    expect(s.series[1].values).toEqual([30, 42, 50, 55]);
  });
  it("rejects specs it cannot draw", () => {
    expect(() => validateChart({ ...bar, type: "radar" })).toThrow(/종류/);
    expect(() => validateChart({ ...bar, categories: ["one"] })).toThrow(/항목 수/);
    expect(() => validateChart({ ...bar, series: [{ name: "x", values: [1, 2] }] })).toThrow(/값의 개수/);
    expect(() => validateChart({ ...bar, series: [{ name: "x", values: [1, -2, 3, 4] }] })).toThrow(/값의 개수/);
  });
});

describe("niceScale", () => {
  it("picks clean steps", () => {
    expect(niceScale(61)).toEqual({ top: 80, step: 20 });
    expect(niceScale(2300)).toEqual({ top: 2500, step: 500 });
    expect(niceScale(0)).toEqual({ top: 1, step: 0.2 });
  });
});

describe("chartSvg", () => {
  it("draws every chart type with a title and labels", () => {
    for (const type of ["bar", "line", "table"] as const) {
      const svg = chartSvg(validateChart({ ...bar, type }));
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain("Household recycling rates");
      expect(svg).toContain("Glass");
      expect(svg).toContain("2015");
    }
    const pie = chartSvg(validateChart({ type: "pie", title: "Energy & sources", unit: "%", categories: ["Coal", "Gas", "Wind"], series: [{ name: "2020", values: [50, 30, 20] }] }));
    expect(pie).toContain("50%");
    expect(pie).toContain("Energy &amp; sources");
  });
  it("adds a legend only for two or more series", () => {
    const one = chartSvg(validateChart({ ...bar, series: [bar.series[0]] }));
    expect(one.match(/<rect[^>]*rx="2"/g)).toBeNull();
    expect(chartSvg(validateChart(bar)).match(/<rect[^>]*rx="2"/g)).toHaveLength(2);
  });
});
