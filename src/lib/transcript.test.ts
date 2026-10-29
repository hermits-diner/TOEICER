import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const { speechProvider, transcriptToBody, transcribeListening } =
  await import("./transcript");
type AiSettings = import("./ai").AiSettings;

const settings: AiSettings = {
  provider: "claude-cli",
  models: { "claude-cli": "opus", "codex-cli": "", "antigravity-cli": "" },
  cliPaths: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
  effort: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
  speed: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
  ttsModel: "gemini-3.8-flash-tts",
  speechModel: "gemini-3.8-flash",
  imageModel: "",
};
const noKeys = { gemini: false };

describe("speechProvider", () => {
  it("is Gemini with the speech model when the key is stored", () => {
    expect(speechProvider(true, settings)).toEqual({ provider: "gemini", model: "gemini-3.8-flash" });
  });

  it("is null without the key or without a model", () => {
    expect(speechProvider(false, settings)).toBeNull();
    expect(speechProvider(true, { ...settings, speechModel: " " })).toBeNull();
  });
});

describe("transcriptToBody", () => {
  it("strips code fences and puts each speaker turn in its own paragraph", () => {
    const raw =
      "```\nNARRATOR: Section 1.\nWOMAN: Good morning, City Lettings.\nMAN: Hello, I'm calling about a flat.\n```";
    expect(transcriptToBody(raw)).toBe(
      "NARRATOR: Section 1.\n\nWOMAN: Good morning, City Lettings.\n\nMAN: Hello, I'm calling about a flat.",
    );
  });

  it("keeps a wrapped turn together and drops blank-only lines", () => {
    const raw =
      "WOMAN: Could you give me\nyour name, please?\n\n\nMAN: It's Smith.";
    expect(transcriptToBody(raw)).toBe(
      "WOMAN: Could you give me your name, please?\n\nMAN: It's Smith.",
    );
  });

  it("returns an empty string for an empty reply", () => {
    expect(transcriptToBody("  \n```\n```\n")).toBe("");
  });
});

describe("transcribeListening", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  it("archives a recording given by address, then sends the archived file to Gemini", async () => {
    invoke.mockImplementation(
      async (
        cmd: string,
        args: { req?: { url?: string; provider?: string; name?: string } },
      ) => {
        if (cmd === "ai_key_status") return { ...noKeys, gemini: true };
        if (cmd === "crawl_audio") return "aud-abc.mp3";
        if (cmd === "ai_audio")
          return { text: "WOMAN: Hello.\nMAN: Hi.", model: "gemini-3.8-flash" };
        throw new Error(`unexpected ${cmd} ${JSON.stringify(args)}`);
      },
    );
    const body = await transcribeListening(
      settings,
      "https://example.com/5.1.mp3",
    );
    expect(body).toBe("WOMAN: Hello.\n\nMAN: Hi.");
    const crawl = invoke.mock.calls.find((c) => c[0] === "crawl_audio")!;
    expect(crawl[1].req.url).toBe("https://example.com/5.1.mp3");
    const audio = invoke.mock.calls.find((c) => c[0] === "ai_audio")!;
    expect(audio[1].req).toMatchObject({
      provider: "gemini",
      model: "gemini-3.8-flash",
      name: "aud-abc.mp3",
    });
    expect(audio[1].req.system).toMatch(/IELTS/i);
  });

  it("uses an archived name as it is", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "ai_key_status") return { ...noKeys, gemini: true };
      if (cmd === "ai_audio") return { text: "MAN: Hi.", model: "gemini-3.8-flash" };
      throw new Error(`unexpected ${cmd}`);
    });
    const body = await transcribeListening(settings, "aud-xyz.mp3");
    expect(body).toBe("MAN: Hi.");
    expect(invoke.mock.calls.some((c) => c[0] === "crawl_audio")).toBe(false);
    expect(
      invoke.mock.calls.find((c) => c[0] === "ai_audio")![1].req,
    ).toMatchObject({ provider: "gemini", name: "aud-xyz.mp3" });
  });

  it("explains what is missing when there is no Gemini key", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "ai_key_status") return noKeys;
      throw new Error(`unexpected ${cmd}`);
    });
    await expect(transcribeListening(settings, "aud-xyz.mp3")).rejects.toThrow(/Gemini/);
  });

  it("rejects an empty transcript instead of saving a blank script", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "ai_key_status") return { ...noKeys, gemini: true };
      if (cmd === "ai_audio") return { text: "```\n```", model: "m" };
      throw new Error(`unexpected ${cmd}`);
    });
    await expect(
      transcribeListening(settings, "aud-xyz.mp3"),
    ).rejects.toThrow();
  });
});
