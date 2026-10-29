import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const { loadCatalog, refreshCatalog, splitGeminiModels } = await import("./modelCatalog");
type AiSettings = import("./ai").AiSettings;

const settings: AiSettings = {
  provider: "codex-cli",
  models: { "claude-cli": "opus", "codex-cli": "gpt-5.6-sol", "antigravity-cli": "" },
  cliPaths: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
  effort: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
  speed: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
  ttsModel: "gemini-3.8-flash-tts",
  imageModel: "",
};

const store: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  });
  invoke.mockReset();
});

describe("splitGeminiModels", () => {
  it("keeps the TTS and image models, newest first", () => {
    const live = ["embedding-001", "gemini-3.1-flash-tts-preview", "gemini-3.8-flash", "gemini-2.5-flash-image", "imagen-4", "gemini-3.8-flash-tts", "gemini-3.1-flash-image"];
    expect(splitGeminiModels(live)).toEqual({
      tts: ["gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview"],
      image: ["gemini-3.1-flash-image", "gemini-2.5-flash-image"],
    });
  });
});

describe("refreshCatalog", () => {
  it("stores the lists the CLIs and the Gemini key give, never asking Claude Code, which has none", async () => {
    invoke.mockImplementation(async (cmd: string, args: { provider?: string }) => {
      if (cmd === "ai_key_status") return { gemini: true };
      if (cmd === "ai_list_models" && args.provider === "codex-cli") return ["gpt-5.6-terra", "gpt-5.6-luna"];
      if (cmd === "ai_list_models" && args.provider === "gemini") return ["gemini-3.8-flash", "gemini-3.8-flash-tts"];
      throw new Error("agy: not logged in");
    });
    const c = await refreshCatalog(settings);
    expect(c.lists["codex-cli"]).toEqual(["gpt-5.6-terra", "gpt-5.6-luna"]);
    expect(c.lists["antigravity-cli"]).toBeUndefined();
    expect(c.gemini).toEqual({ tts: ["gemini-3.8-flash-tts"], image: [] });
    expect(c.checkedAt).toBeGreaterThan(0);
    expect(loadCatalog().lists["codex-cli"]).toEqual(["gpt-5.6-terra", "gpt-5.6-luna"]);
    expect(invoke.mock.calls.some((x) => x[1]?.provider === "claude-cli")).toBe(false);
  });
  it("keeps the earlier list of a provider whose check failed, and asks Gemini only with a key", async () => {
    store["toeicer.models"] = JSON.stringify({ lists: { "antigravity-cli": ["gemini-3.8-flash-high"] }, checkedAt: 1 });
    invoke.mockImplementation(async (cmd: string, args: { provider?: string }) => {
      if (cmd === "ai_key_status") return { gemini: false };
      if (cmd === "ai_list_models" && args.provider === "codex-cli") return ["gpt-5.6-terra"];
      throw new Error("down");
    });
    const c = await refreshCatalog(settings);
    expect(c.lists["antigravity-cli"]).toEqual(["gemini-3.8-flash-high"]);
    expect(c.lists["codex-cli"]).toEqual(["gpt-5.6-terra"]);
    expect(c.gemini).toBeUndefined();
    expect(invoke.mock.calls.some((x) => x[0] === "ai_list_models" && x[1].provider === "gemini")).toBe(false);
  });
});
