import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));
const { daysUntil } = await import("./appSettings");

describe("daysUntil", () => {
  const today = new Date(2026, 9, 2); // 2 Oct 2026, local time
  it("counts whole days and goes negative after the date", () => {
    expect(daysUntil("2026-10-02", today)).toBe(0);
    expect(daysUntil("2026-10-03", today)).toBe(1);
    expect(daysUntil("2027-01-01", today)).toBe(91);
    expect(daysUntil("2026-09-30", today)).toBe(-2);
  });
  it("rejects malformed dates", () => {
    expect(daysUntil("2026/10/03", today)).toBeNull();
    expect(daysUntil("", today)).toBeNull();
  });
});
