import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const { isCli, loadAiSettings, PROVIDERS, SUGGESTED_MODELS } = await import("./ai");

describe("CLI providers", () => {
  it("are the only text providers and have suggested models", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["claude-cli", "codex-cli", "antigravity-cli"]);
    expect(isCli("claude-cli") && isCli("codex-cli") && !isCli("anthropic") && !isCli("gemini")).toBe(true);
    expect(SUGGESTED_MODELS["claude-cli"]).toContain("opus");
  });

  it("moves settings saved with a provider that is gone to the default CLI and keeps the Gemini media models", () => {
    const store: Record<string, string> = {
      "toeicer.ai": JSON.stringify({
        provider: "gemini",
        models: { gemini: "gemini-3.8-flash", anthropic: "claude-opus-5-5" },
        baseUrl: "http://x",
        ttsModel: "t",
      }),
    };
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: () => {},
    });
    try {
      const s = loadAiSettings();
      expect(s.provider).toBe("claude-cli");
      expect(s.ttsModel).toBe("t");
      expect(s.imageModel).toBe("gemini-2.5-flash-image");
      expect(Object.keys(s.models)).toEqual(["claude-cli", "codex-cli", "antigravity-cli"]);
      expect(s.models["claude-cli"]).toBe("opus");
      expect(s.models["codex-cli"]).toBe("");
      expect(s.effort["codex-cli"]).toBe("");
      expect(s.speed["codex-cli"]).toBe("");
      expect(s.cliPaths).toEqual({
        "claude-cli": "",
        "codex-cli": "",
        "antigravity-cli": "",
      });
      store["toeicer.ai"] = JSON.stringify({
        provider: "codex-cli",
        cliPaths: { "codex-cli": "C:/tools/codex.exe" },
      });
      const c = loadAiSettings();
      expect(c.provider).toBe("codex-cli");
      expect(c.cliPaths["codex-cli"]).toBe("C:/tools/codex.exe");
      expect(c.cliPaths["claude-cli"]).toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
