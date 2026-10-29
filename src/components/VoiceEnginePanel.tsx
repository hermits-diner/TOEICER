import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, KeyRound, Play, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { deleteGeminiKey, errorText, geminiKeyStored, listGeminiModels, setGeminiKey, type AiSettings } from "../lib/ai";
import { GEMINI_IMAGE_MODELS, GEMINI_SPEECH_MODELS, GEMINI_TTS_MODELS } from "../lib/ai";
import { splitGeminiModels, storeGemini } from "../lib/modelCatalog";
import { loadAudio } from "../lib/repo";
import { geminiSynthesize } from "../lib/tts";
import Hint from "./Hint";
import { useCatalog } from "./useCatalog";

const SAMPLE = "Hello, and welcome. In this part of the test, you'll hear a conversation about booking a course.";
const REPLY = "Thanks. Could you tell me when the first session starts, and how much it costs?";
const KEY_URL = "https://aistudio.google.com/apikey";

const PREVIEWS: { id: "female" | "male" | "dialogue"; label: string }[] = [
  { id: "female", label: "여성 (Kore)" },
  { id: "male", label: "남성 (Puck)" },
  { id: "dialogue", label: "두 사람 대화" },
];

interface Props {
  settings: AiSettings;
  onChange: (patch: Partial<AiSettings>) => void;
}

/**
 * Settings › AI › 음성: the one API key the app keeps. Gemini reads AI-written listening scripts aloud, listens to
 * speaking recordings and transcribes collected recordings; no CLI can take or make audio.
 */
export default function VoiceEnginePanel({ settings, onChange }: Props) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const catalog = useCatalog();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    geminiKeyStored().then(setHasKey, (e) => setMsg({ kind: "error", text: errorText(e) }));
  }, []);

  const run = async (kind: string, f: () => Promise<string | void>) => {
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

  const saveKey = () =>
    run("key", async () => {
      await setGeminiKey(keyInput);
      setKeyInput("");
      setHasKey(true);
      return "Gemini 키를 Windows 자격 증명 관리자에 저장했습니다.";
    });

  const removeKey = () =>
    run("key", async () => {
      await deleteGeminiKey();
      setHasKey(false);
      return "Gemini 키를 삭제했습니다.";
    });

  const loadModels = () =>
    run("models", async () => {
      const ids = await listGeminiModels();
      storeGemini(ids);
      const split = splitGeminiModels(ids);
      return `듣기 모델 ${split.speech.length}개, TTS 모델 ${split.tts.length}개를 불러왔습니다.`;
    });

  const preview = (kind: "female" | "male" | "dialogue") =>
    run(kind, async () => {
      const r =
        kind === "dialogue"
          ? await geminiSynthesize(settings.ttsModel, [{ speaker: "A", text: SAMPLE }, { speaker: "B", text: REPLY }], { A: "Kore", B: "Puck" })
          : await geminiSynthesize(settings.ttsModel, [{ speaker: "A", text: SAMPLE }], { A: kind === "female" ? "Kore" : "Puck" });
      const url = await loadAudio(r.name);
      if (audio.current) {
        audio.current.src = url;
        void audio.current.play();
      }
    });

  const speechOptions = [...new Set([...(catalog.gemini?.speech ?? GEMINI_SPEECH_MODELS), settings.speechModel].filter(Boolean))];
  const ttsOptions = [...new Set([...(catalog.gemini?.tts ?? GEMINI_TTS_MODELS), settings.ttsModel].filter(Boolean))];

  return (
    <>
      <h3 className="section-title">
        음성 (Google Gemini)
        <Hint text="Listening 음성 만들기, Speaking 녹음 평가, 스크립트 받아쓰기는 소리를 다루므로 CLI로 할 수 없고 Gemini API 키를 씁니다. 키는 이 PC의 Windows 자격 증명 관리자에만 저장되며 호출마다 과금됩니다." />{" "}
        {hasKey === true ? <span className="pill ok">키 저장됨</span> : hasKey === false ? <span className="pill">키 없음</span> : null}
      </h3>
      <div className="accent-row">
        <input
          className="field wide"
          type="password"
          value={keyInput}
          autoComplete="off"
          spellCheck={false}
          placeholder={hasKey ? "새 키로 바꾸려면 입력" : "Google AI Studio에서 발급한 API 키"}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && keyInput.trim() && void saveKey()}
        />
        <button className="btn primary" disabled={!keyInput.trim() || busy !== null} onClick={() => void saveKey()}>
          <KeyRound size={14} /> 저장
        </button>
        {hasKey && (
          <button className="btn ghost" disabled={busy !== null} title="키 삭제" onClick={() => void removeKey()}>
            <Trash2 size={14} />
          </button>
        )}
        <button className="link-btn" onClick={() => openUrl(KEY_URL).catch(() => {})}>
          키 발급 페이지 <ExternalLink size={12} />
        </button>
      </div>

      <div className="accent-row wrap voice-rows">
        <label className="engine-model">
          <span className="muted">
            듣기·평가 모델
            <Hint text="Speaking 녹음을 듣고 발음까지 네 기준으로 채점하고, 수집한 Listening 음원을 받아씁니다." />
          </span>
          <input
            className="field"
            list="gemini-speech-models"
            value={settings.speechModel}
            spellCheck={false}
            onChange={(e) => onChange({ speechModel: e.target.value })}
          />
          <datalist id="gemini-speech-models">
            {speechOptions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button className="btn" disabled={busy !== null || !hasKey} title={hasKey ? undefined : "먼저 키를 저장하세요."} onClick={() => void loadModels()}>
            <RefreshCw size={14} className={busy === "models" ? "spin" : ""} /> 목록
          </button>
        </label>
        <label className="engine-model">
          <span className="muted">읽기(TTS) 모델</span>
          <input
            className="field"
            list="gemini-tts-models"
            value={settings.ttsModel}
            spellCheck={false}
            onChange={(e) => onChange({ ttsModel: e.target.value })}
          />
          <datalist id="gemini-tts-models">
            {ttsOptions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {PREVIEWS.map((v) => (
            <button key={v.id} className="btn ghost" disabled={busy !== null || !hasKey} onClick={() => void preview(v.id)}>
              <Play size={13} /> {busy === v.id ? "만드는 중…" : v.label}
            </button>
          ))}
        </label>
        <label className="engine-model">
          <span className="muted">그림 모델 (TOEIC Part 1 사진)</span>
          <input
            className="field"
            list="gemini-image-models"
            value={settings.imageModel}
            spellCheck={false}
            onChange={(e) => onChange({ imageModel: e.target.value })}
          />
          <datalist id="gemini-image-models">
            {[...new Set([...GEMINI_IMAGE_MODELS, settings.imageModel].filter(Boolean))].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
      </div>
      {msg && <p className={msg.kind === "ok" ? "success" : "error"}>{msg.text}</p>}
      <audio ref={audio} hidden />
    </>
  );
}
