import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const { encodeWav, readTranscript, speakingAudioPrompt } = await import("./speaking");

describe("encodeWav", () => {
  it("writes a valid 16-bit mono header and clamps samples", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000);
    const v = new DataView(wav.buffer);
    const tag = (o: number) => String.fromCharCode(...wav.slice(o, o + 4));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(tag(36)).toBe("data");
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(40, true)).toBe(8);
    expect(wav.length).toBe(52);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });
});

describe("readTranscript / speakingAudioPrompt", () => {
  it("pulls the transcript out of a JSON reply", () => {
    expect(readTranscript('```json\n{"transcript":" Well, um, I live in Seoul. ","overall":6}\n```')).toBe("Well, um, I live in Seoul.");
    expect(readTranscript("no json")).toBe("");
    expect(readTranscript('{"overall":6}')).toBe("");
  });
  it("names the part and wraps the task", () => {
    const p = speakingAudioPrompt("Interview 1", "Describe where you study.");
    expect(p).toContain("TOEFL iBT Speaking · Interview 1.");
    expect(p).toContain("<task>\nDescribe where you study.\n</task>");
    expect(p).toContain("Delivery");
    expect(speakingAudioPrompt("Listen and Repeat 2", "Keep your bags under the bench.")).toContain("Accuracy of repetition");
  });
});
