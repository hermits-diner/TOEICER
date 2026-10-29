import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const { isStale, loadCatalog, modelOptions, refreshCatalog, splitGeminiModels, ttsOptions, speechOptions } =
  await import("./modelCatalog");
type AiSettings = import("./ai").AiSettings;

const settings: AiSettings = {
  provider: "codex-cli",
  models: { "claude-cli": "opus", "codex-cli": "gpt-5.6-sol", "antigravity-cli": "" },
  cliPaths: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
  effort: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
  speed: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
  ttsModel: "gemini-3.8-flash-tts",
  speechModel: "gemini-3.8-flash",
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
  it("sorts the live list into speech models and TTS models, newest first, leaving out what cannot hear", () => {
    const live = [
      "embedding-001",
      "gemini-3.1-flash",
      "gemini-3.8-flash-tts",
      "gemini-3.8-flash",
      "imagen-4",
      "gemini-3.8-pro",
      "gemini-3.1-flash-tts-preview",
      "learnlm-2",
    ];
    expect(splitGeminiModels(live)).toEqual({
      speech: ["gemini-3.8-pro", "gemini-3.8-flash", "gemini-3.1-flash"],
      tts: ["gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview"],
    });
  });
});

describe("modelOptions / isStale", () => {
  it("falls back to the suggestions until a live list is stored", () => {
    expect(modelOptions("codex-cli")).toEqual(["gpt-5.6-terra", "gpt-5.6-luna"]);
    expect(isStale("codex-cli", "anything")).toBe(false);
  });

  it("uses the stored live list and flags a chosen model that is no longer in it", async () => {
    invoke.mockImplementation(async (cmd: string, args: { provider?: string }) => {
      if (cmd === "ai_key_status") return { gemini: true };
      if (cmd === "ai_list_models" && args.provider === "codex-cli") return ["gpt-5.6-terra", "gpt-5.6-luna"];
      if (cmd === "ai_list_models" && args.provider === "antigravity-cli") throw new Error("agy: not logged in");
      if (cmd === "ai_list_models" && args.provider === "gemini") return ["gemini-3.8-flash", "gemini-3.8-flash-tts"];
      throw new Error(`unexpected ${cmd}`);
    });
    const c = await refreshCatalog(settings);
    expect(c.lists["codex-cli"]).toEqual(["gpt-5.6-terra", "gpt-5.6-luna"]);
    expect(c.lists["antigravity-cli"]).toBeUndefined();
    expect(c.gemini).toEqual({ speech: ["gemini-3.8-flash"], tts: ["gemini-3.8-flash-tts"] });
    expect(c.checkedAt).toBeGreaterThan(0);
    // persisted, and read back by the plain accessors
    expect(loadCatalog().lists["codex-cli"]).toEqual(["gpt-5.6-terra", "gpt-5.6-luna"]);
    expect(modelOptions("codex-cli")).toEqual(["gpt-5.6-terra", "gpt-5.6-luna"]);
    expect(modelOptions("antigravity-cli")[0]).toBe("gemini-3.8-flash-high");
    expect(isStale("codex-cli", "gpt-5.6-sol")).toBe(true);
    expect(isStale("codex-cli", "gpt-5.6-terra")).toBe(false);
    expect(isStale("codex-cli", "")).toBe(false);
    expect(isStale("claude-cli", "opus")).toBe(false);
    expect(speechOptions()).toEqual(["gemini-3.8-flash"]);
    expect(ttsOptions()).toEqual(["gemini-3.8-flash-tts"]);
  });

  it("keeps the earlier list of a provider whose check failed this time", async () => {
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
    // no key: Gemini was not asked
    expect(invoke.mock.calls.some((x) => x[0] === "ai_list_models" && x[1].provider === "gemini")).toBe(false);
  });
});
