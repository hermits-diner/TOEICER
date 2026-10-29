import { RefreshCw, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import Dropdown from "./Dropdown";
import Hint from "./Hint";
import VoiceEnginePanel from "./VoiceEnginePanel";
import { useCatalog } from "./useCatalog";
import {
  cliStatus,
  CODEX_SPEEDS,
  complete,
  EFFORT_LEVELS,
  errorText,
  listModels,
  loadAiSettings,
  PROVIDERS,
  saveAiSettings,
  SUGGESTED_MODELS,
  type AiSettings,
  type CliStatus,
  type ProviderId,
} from "../lib/ai";
import { storeList } from "../lib/modelCatalog";

type Msg = { kind: "ok" | "error"; text: string } | null;

const CLI_HINT: Record<ProviderId, string> = {
  "codex-cli":
    "codex exec로 실행합니다. 읽기 전용 샌드박스, 빈 임시 폴더, 출제 지시문만 전달. 사용량은 ChatGPT 구독 한도에 포함됩니다.",
  "antigravity-cli":
    "agy를 비대화형 한 턴으로 실행합니다. 빈 임시 폴더, 도구 사용 금지, 출제 지시문만 전달. 모델 목록은 agy models에서 가져오며 사용량은 Google 구독 한도에 포함됩니다.",
  "claude-cli":
    "claude -p로 실행합니다. 도구·MCP·설정 파일을 모두 끄고 빈 임시 폴더에서 돌며 출제 지시문만 전달. 사용량은 Claude 구독 한도에 포함됩니다.",
};

const MODEL_HINT: Record<ProviderId, string> = {
  "claude-cli":
    "Claude Code는 목록을 주지 않아 별칭을 씁니다. opus가 기본이며 출제 품질이 가장 안정적이고, fable은 가장 높은 등급, sonnet은 더 빠르고 구독 한도를 덜 쓰며, haiku는 가장 빠릅니다. claude-opus-5-5 같은 전체 이름도 됩니다.",
  "codex-cli":
    "앱을 켤 때와 상태 확인 때 codex debug models의 카탈로그를 읽어 옵니다. 첫 항목은 Codex 설정(config.toml)의 기본 모델이며, 비워 두면 그 모델을 씁니다.",
  "antigravity-cli":
    "앱을 켤 때와 상태 확인 때 agy models의 목록을 읽어 옵니다. 비워 두면 Antigravity CLI 설정의 기본 모델을 씁니다. 이름 끝의 low/medium/high는 추론 강도입니다.",
};

const EFFORT_HINT: Record<ProviderId, string> = {
  "claude-cli": "claude --effort로 전달합니다. 높일수록 문항 검수가 꼼꼼해지지만 느리고 구독 한도를 더 씁니다. 비우면 Claude Code의 기본값입니다.",
  "codex-cli": "model_reasoning_effort로 전달합니다. 모델마다 지원 단계가 달라 없는 단계를 고르면 Codex가 오류를 냅니다. 비우면 config.toml의 값입니다.",
  "antigravity-cli": "agy --effort로 전달합니다. 모델 이름 끝의 -low/-medium/-high와 함께 쓰면 이 값이 우선합니다. 비우면 agy의 기본값입니다.",
};

const LOGIN_HINT: Record<ProviderId, string> = {
  "codex-cli": "터미널에서 codex login 후 상태를 다시 확인하세요.",
  "antigravity-cli": "터미널에서 agy를 실행해 Google 계정으로 로그인한 뒤 다시 확인하세요.",
  "claude-cli": "터미널에서 claude를 실행해 /login 후 다시 확인하세요.",
};

const when = (ms: number) => new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Settings › AI: which logged-in CLI writes items and feedback, its model, effort and speed, and the Gemini voice settings below. */
export default function AiSettingsPanel() {
  const [s, setS] = useState<AiSettings>(loadAiSettings);
  const catalog = useCatalog();
  /** Install and sign-in state per CLI; a string is the error from the last check. */
  const [cli, setCli] = useState<Partial<Record<ProviderId, CliStatus | string>>>({});
  const [busy, setBusy] = useState<"models" | "test" | "cli" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  const model = s.models[s.provider];
  const live = catalog.lists[s.provider];
  const options = [...new Set([...(live ?? SUGGESTED_MODELS[s.provider]), ...(model ? [model] : [])])];
  const stale = !!live && !!model.trim() && !live.includes(model.trim());
  const cliState = cli[s.provider];
  const cliOk = (id: ProviderId) => {
    const st = cli[id];
    return typeof st === "object" && st.loggedIn !== false;
  };

  const checkCli = async (id: ProviderId, settings: AiSettings) => {
    setBusy("cli");
    try {
      const st = await cliStatus(settings, id);
      setCli((c) => ({ ...c, [id]: st }));
      if (st.models?.length) storeList(id, st.models);
    } catch (e) {
      setCli((c) => ({ ...c, [id]: errorText(e) }));
    } finally {
      setBusy(null);
    }
  };

  // Looks the CLI up when its provider is first selected; the button below re-checks after a path change.
  useEffect(() => {
    if (cli[s.provider] === undefined) void checkCli(s.provider, s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.provider]);

  const update = (next: AiSettings) => {
    setS(next);
    saveAiSettings(next);
  };
  const setModel = (m: string) => update({ ...s, models: { ...s.models, [s.provider]: m } });

  const run = async (kind: "models" | "test", f: () => Promise<string | void>) => {
    setBusy(kind);
    setMsg(null);
    try {
      const text = await f();
      if (text) setMsg({ kind: "ok", text });
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const loadModels = () =>
    run("models", async () => {
      const ids = await listModels(s);
      storeList(s.provider, ids);
      if (!model && ids.length) setModel(ids[0]);
      return ids.length ? `모델 ${ids.length}개를 불러왔습니다.` : "사용할 수 있는 모델이 없습니다.";
    });

  const test = () =>
    run("test", async () => {
      const r = await complete(s, "Reply with exactly one word.", "Say OK.");
      return `연결 성공 · ${r.model} 응답: "${r.text.trim().slice(0, 40)}"`;
    });

  return (
    <>
      <h3 className="section-title">
        제공사
        <Hint text="문제 출제와 Writing·Speaking 첨삭에 쓰는 AI입니다. 이 PC에 설치되어 로그인된 CLI를 앱이 실행하므로 API 키 없이 구독 한도를 씁니다. 소리를 다루는 기능은 아래 음성 설정의 Gemini 키를 씁니다." />
      </h3>
      <div className="provider-pick">
        <Dropdown
          plain
          required
          value={s.provider}
          options={PROVIDERS.map((p) => ({ key: p.id, text: `${p.label}${cliOk(p.id) ? " ✓" : ""}` }))}
          onChange={(v) => {
            update({ ...s, provider: v as ProviderId });
            setMsg(null);
          }}
        />
      </div>

      <h3 className="section-title">
        실행 파일
        <Hint text={CLI_HINT[s.provider]} />{" "}
        {typeof cliState === "object" ? (
          cliState.loggedIn === false ? (
            <span className="pill">로그인 안 됨</span>
          ) : (
            <span className="pill ok">사용 가능</span>
          )
        ) : typeof cliState === "string" ? (
          <span className="pill">없음</span>
        ) : null}
      </h3>
      <div className="accent-row">
        <input
          className="field wide"
          value={s.cliPaths[s.provider]}
          spellCheck={false}
          placeholder="비우면 PATH와 기본 설치 위치에서 찾음"
          onChange={(e) => update({ ...s, cliPaths: { ...s.cliPaths, [s.provider]: e.target.value } })}
          onKeyDown={(e) => e.key === "Enter" && void checkCli(s.provider, s)}
        />
        <button className="btn" disabled={busy !== null} onClick={() => void checkCli(s.provider, s)}>
          <RefreshCw size={14} className={busy === "cli" ? "spin" : ""} /> 상태 확인
        </button>
      </div>
      {typeof cliState === "object" && (
        <p className="muted">
          {cliState.path}
          {cliState.version ? ` · ${cliState.version}` : ""}
          {cliState.loggedIn === true ? ` · 로그인됨${cliState.account ? ` (${cliState.account})` : ""}` : ""}
          {cliState.loggedIn === null ? " · 로그인 상태를 확인하지 못했습니다" : ""}
        </p>
      )}
      {typeof cliState === "object" && cliState.loggedIn === false && <p className="error">{LOGIN_HINT[s.provider]}</p>}
      {typeof cliState === "string" && <p className="error">{cliState}</p>}

      <h3 className="section-title">
        모델
        <Hint text={MODEL_HINT[s.provider]} />
        {live && catalog.checkedAt > 0 && <span className="muted">· 목록 확인 {when(catalog.checkedAt)}</span>}
      </h3>
      <div className="accent-row">
        <input
          className="field wide"
          list="ai-models"
          value={model}
          spellCheck={false}
          placeholder="비우면 CLI 기본 모델"
          onChange={(e) => setModel(e.target.value.trim())}
        />
        <datalist id="ai-models">
          {options.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        {s.provider !== "claude-cli" && (
          <button className="btn" disabled={busy !== null} onClick={() => void loadModels()}>
            <RefreshCw size={14} className={busy === "models" ? "spin" : ""} /> 목록 불러오기
          </button>
        )}
      </div>
      {options.length > 0 && (
        <div className="model-chips">
          {options.map((m) => (
            <button key={m} className={`chip${m === model ? " on" : ""}${stale && m === model ? " stale" : ""}`} onClick={() => setModel(m)}>
              {m}
            </button>
          ))}
        </div>
      )}
      {stale && <p className="warning">이 모델은 지금 목록에 없습니다. 이름이 바뀌었거나 더는 제공되지 않을 수 있으니 다른 모델을 고르세요.</p>}

      <h3 className="section-title">
        추론 강도
        <Hint text={EFFORT_HINT[s.provider]} />
      </h3>
      <div className="settings-row">
        <div className="segmented small">
          <button className={!s.effort[s.provider] ? "on" : ""} onClick={() => update({ ...s, effort: { ...s.effort, [s.provider]: "" } })}>
            기본
          </button>
          {EFFORT_LEVELS.map((lv) => (
            <button key={lv} className={s.effort[s.provider] === lv ? "on" : ""} onClick={() => update({ ...s, effort: { ...s.effort, [s.provider]: lv } })}>
              {lv}
            </button>
          ))}
        </div>
        <span className="muted">높을수록 꼼꼼하고 느림</span>
      </div>

      {s.provider === "codex-cli" && (
        <>
          <h3 className="section-title">
            속도
            <Hint text="Codex의 service_tier입니다. priority는 대기 시간이 짧은 대신 요금이 높고, flex는 한가할 때 처리되어 느리지만 쌉니다. 비우면 config.toml의 값입니다." />
          </h3>
          <div className="settings-row">
            <div className="segmented small">
              {CODEX_SPEEDS.map((sp) => (
                <button key={sp.id} className={(s.speed["codex-cli"] ?? "") === sp.id ? "on" : ""} title={sp.note} onClick={() => update({ ...s, speed: { ...s.speed, "codex-cli": sp.id } })}>
                  {sp.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="toolbar ai-test">
        <button
          className="btn"
          title="짧은 요청 하나를 보내 CLI와 모델을 확인합니다 (구독 한도에서 소량 차감)."
          disabled={busy !== null || !cliOk(s.provider)}
          onClick={() => void test()}
        >
          <Zap size={14} /> {busy === "test" ? "확인 중…" : "연결 테스트"}
        </button>
      </div>
      {msg && <p className={msg.kind === "ok" ? "success" : "error"}>{msg.text}</p>}

      <VoiceEnginePanel settings={s} onChange={(patch) => update({ ...s, ...patch })} />
    </>
  );
}
