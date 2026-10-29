import { describe, expect, it, vi } from "vitest";

const synth = vi.fn(async (_model: string, _turns: unknown, _voices: Record<string, string>) => ({ name: "aud-0123456789abcdef0123456789abcdef.mp3", duration: 3 }));
vi.mock("./tts", async (orig) => ({ ...(await orig<typeof import("./tts")>()), geminiSynthesize: (...a: Parameters<typeof synth>) => synth(...a) }));
const { makeAudio, missingAudio, scriptTurns } = await import("./listenAudio");

describe("scriptTurns", () => {
  it("gives each role a voice by the sound of it, two at most", () => {
    const r = scriptTurns("Man: Is the printer fixed?\nWoman: Not yet.\nMan 2: I'll call them.\nThank you.");
    expect(r.turns.map((t) => t.speaker)).toEqual(["A", "B", "B", "B"]);
    expect(r.speakers).toEqual({ A: { role: "Man", gender: "male", accent: "american" }, B: { role: "Woman", gender: "female", accent: "american" } });
    expect(scriptTurns("Speaker: Number 7. When is it due?\nResponder: (A) Friday.").speakers.B.gender).toBe("male");
  });
});

describe("makeAudio", () => {
  it("records the passages that have a script and no audio", async () => {
    const t = {
      title: "LC",
      kind: "listening" as const,
      passages: [
        { title: "Part 3 · Conversation 1", body: "Woman: Hi.\nMan: Hello.", groups: [] },
        { title: "Part 3 · Conversation 2", body: "Woman: Bye.", audio: "aud-ffffffffffffffffffffffffffffffff.mp3", groups: [] },
      ],
    };
    expect(missingAudio(t)).toBe(1);
    const out = await makeAudio({ ttsModel: "gemini-3.8-flash-tts" } as never, t);
    expect(out.passages.map((p) => p.audio)).toEqual(["aud-0123456789abcdef0123456789abcdef.mp3", "aud-ffffffffffffffffffffffffffffffff.mp3"]);
    expect(synth).toHaveBeenCalledTimes(1);
    expect(synth.mock.calls[0][2]).toEqual({ A: "Kore", B: "Puck" });
    expect(missingAudio({ ...t, kind: "reading" })).toBe(0);
  });
});
