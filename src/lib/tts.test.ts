import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const { assignGeminiVoices } = await import("./tts");

describe("assignGeminiVoices", () => {
  it("picks a voice by gender and never repeats one", () => {
    expect(assignGeminiVoices({ A: { role: "r", gender: "female", accent: "british" }, B: { role: "c", gender: "male", accent: "american" } })).toEqual({ A: "Kore", B: "Puck" });
    expect(assignGeminiVoices({ A: { role: "x", gender: "female", accent: "british" }, B: { role: "y", gender: "female", accent: "british" } })).toEqual({ A: "Kore", B: "Leda" });
  });
});
