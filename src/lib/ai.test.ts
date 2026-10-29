import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const {
  feedbackPrompt,
  isCli,
  loadAiSettings,
  PROVIDERS,
  parseFeedback,
  SUGGESTED_MODELS,
} = await import("./ai");

describe("CLI providers", () => {
  it("are the only text providers and have suggested models", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["claude-cli", "codex-cli", "antigravity-cli"]);
    expect(isCli("claude-cli") && isCli("codex-cli") && !isCli("anthropic") && !isCli("gemini")).toBe(true);
    expect(SUGGESTED_MODELS["claude-cli"]).toContain("opus");
  });

  it("moves settings saved with an API provider to a CLI and keeps the Gemini model for speech", () => {
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
      expect(s.speechModel).toBe("gemini-3.8-flash");
      expect(s.ttsModel).toBe("t");
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

describe("parseFeedback", () => {
  const reply = {
    overall: 6.5,
    summary: "전반적으로 과제에 잘 답했습니다.",
    criteria: [
      { name: "Task Response", band: 6.5, comment: "입장이 분명합니다." },
      { name: "Lexical Resource", band: 6.3, comment: "어휘가 반복됩니다." },
      {
        name: "Pronunciation",
        band: null,
        comment: "글로는 평가할 수 없습니다.",
      },
    ],
    strengths: ["논지가 명확합니다.", ""],
    improvements: ["연결어를 다양하게 쓰십시오."],
    corrections: [
      { original: "peoples", suggestion: "people", note: "불가산 복수" },
      { note: "빈 항목" },
    ],
  };

  it("reads a fenced reply and normalises values", () => {
    const f = parseFeedback(
      "Here you go:\n```json\n" + JSON.stringify(reply) + "\n```",
    );
    expect(f.overall).toBe(6.5);
    expect(f.criteria.map((c) => c.band)).toEqual([6.5, 6.5, null]);
    expect(f.strengths).toEqual(["논지가 명확합니다."]);
    expect(f.corrections).toHaveLength(1);
  });

  it("rejects out-of-range bands and non-JSON replies", () => {
    expect(
      parseFeedback(JSON.stringify({ ...reply, overall: 12 })).overall,
    ).toBeNull();
    expect(() => parseFeedback("I cannot score this.")).toThrow(/형식/);
    expect(() => parseFeedback("{not json}")).toThrow(/다시 시도/);
    expect(() => parseFeedback("{}")).toThrow(/점수/);
  });
});

describe("feedbackPrompt", () => {
  it("picks the TOEFL rubric by task and wraps the texts", () => {
    const email = feedbackPrompt("writing", "Write an Email", "You will miss a meeting.", "Dear Jordan, …", 140);
    expect(email).toContain("Criteria: Task completion; Organization and development; Tone and register; Language use.");
    expect(email).toContain("140 words");
    expect(email).toContain("<answer>\nDear Jordan, …\n</answer>");
    expect(email).toContain("skips a required point");
    const disc = feedbackPrompt("writing", "Academic Discussion", "t", "a", 1);
    expect(disc).toContain("Relevance and contribution");
    expect(disc).toContain("did not already say");
    expect(disc).toContain("1–6 band");
  });
  it("leaves delivery unscored for a typed speaking answer", () => {
    const iv = feedbackPrompt("speaking", "Interview 2", "t", "a", 1);
    expect(iv).toContain("Criteria: Delivery; Language use; Topic development.");
    expect(iv).toContain("set those criteria to null");
    expect(iv).toContain("never the accent");
    expect(feedbackPrompt("speaking", "Listen and Repeat 3", "t", "a", 1)).toContain("Accuracy of repetition");
  });
});
