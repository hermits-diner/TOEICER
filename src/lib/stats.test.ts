import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));
const { nextInterval } = await import("./stats");

describe("nextInterval", () => {
  it("starts at one day and grows to a month", () => {
    expect(nextInterval(null)).toBe(1);
    expect(nextInterval(1)).toBe(3);
    expect(nextInterval(3)).toBe(7);
    expect(nextInterval(7)).toBe(15);
    expect(nextInterval(15)).toBe(30);
    expect(nextInterval(30)).toBe(30);
  });
});
