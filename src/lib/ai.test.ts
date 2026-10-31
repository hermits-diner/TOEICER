import { describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const { cancelJob, complete, endJob, isCli, loadAiSettings, PROVIDERS, SUGGESTED_MODELS } = await import("./ai");

describe("complete", () => {
  const s = {
    provider: "claude-cli",
    models: { "claude-cli": "opus" },
    cliPaths: { "claude-cli": "" },
    effort: {},
    speed: {},
  } as never;

  it("ties a generation job's call to the job and leaves other calls untagged", async () => {
    invoke.mockReset().mockResolvedValue({ text: "ok" });
    await complete(s, "sys", "hi", { job: "job-1" });
    await complete(s, "sys", "hi");
    expect(invoke.mock.calls[0]).toEqual(["ai_complete", { req: expect.objectContaining({ provider: "claude-cli", model: "opus", job: "job-1" }) }]);
    expect(invoke.mock.calls[1][1].req).not.toHaveProperty("job");
  });

  it("starts nothing for a job that is already cancelled", async () => {
    invoke.mockReset().mockResolvedValue({ text: "ok" });
    const c = new AbortController();
    c.abort();
    await expect(complete(s, "sys", "hi", { job: "job-1", signal: c.signal })).rejects.toThrow("취소했습니다.");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("cancels and forgets jobs through the app", async () => {
    invoke.mockReset().mockResolvedValue(undefined);
    await cancelJob("job-1");
    await endJob("job-1");
    expect(invoke.mock.calls).toEqual([
      ["ai_cancel_job", { job: "job-1" }],
      ["ai_end_job", { job: "job-1" }],
    ]);
  });
});

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
