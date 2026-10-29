import { Mic, RotateCcw, Sparkles, Square, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toWav } from "../lib/speaking";

type Phase = "idle" | "preparing" | "recording" | "recorded";

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
const PREP_SECONDS = 60;

/** TOEFL Speaking tasks are named by their passage titles ("Interview 2", "Listen and Repeat 5"). */
export const isInterview = (part: string | null) => !!part && /^interview\b/i.test(part);
export const isRepeat = (part: string | null) => !!part && /^listen and repeat\b/i.test(part);

/** Recording limit for a task: TOEFL answers are short and stop by themselves, like the test. */
export function recordLimit(part: string | null): number {
  if (isInterview(part)) return 45;
  if (isRepeat(part)) return 15;
  return part === "Part 2" ? 120 : 300;
}

/**
 * Records a spoken answer. TOEFL Interview answers get 45 seconds with no preparation and Listen and Repeat 15 seconds;
 * both stop by themselves. (An IELTS-style Part 2 keeps its one minute of preparation and two minutes of speaking.)
 */
export default function SpeakingRecorder({
  part,
  busy,
  onSubmit,
}: {
  part: string | null;
  busy: boolean;
  onSubmit: (take: { wav: Uint8Array; seconds: number }) => void;
}) {
  const cueCard = part === "Part 2";
  const limit = recordLimit(part);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [take, setTake] = useState<{ wav: Uint8Array; seconds: number } | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);

  const release = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  // Stop the microphone if the screen closes mid-recording.
  useEffect(() => () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    release();
  }, []);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const record = async () => {
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setPhase("idle");
      setError("마이크를 쓸 수 없습니다. 마이크가 연결되어 있는지, Windows 설정 › 개인 정보 › 마이크에서 앱 접근이 켜져 있는지 확인해 주십시오.");
      return;
    }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      release();
      // Convert right away: the preview then shows the real length (browser webm has none), and saving needs no second pass.
      try {
        const t = await toWav(new Blob(chunks, { type: rec.mimeType }));
        setTake(t);
        setUrl(URL.createObjectURL(new Blob([t.wav as BlobPart], { type: "audio/wav" })));
        setPhase("recorded");
      } catch {
        setError("녹음을 처리하지 못했습니다. 다시 녹음해 주십시오.");
        setPhase("idle");
      }
    };
    recorder.current = rec;
    rec.start(1000);
    setSeconds(0);
    setPhase("recording");
  };

  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  // One clock drives both the preparation countdown and the recording time.
  useEffect(() => {
    if (phase !== "preparing" && phase !== "recording") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase === "preparing" && seconds >= PREP_SECONDS) void record();
    if (phase === "recording" && seconds >= limit) stop();
    // record/stop only read refs and setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, seconds, limit]);

  const reset = () => {
    setTake(null);
    setUrl(null);
    setSeconds(0);
    setPhase("idle");
  };

  return (
    <div className="recorder">
      {phase === "idle" && (
        <div className="accent-row">
          {cueCard && (
            <button
              className="btn primary"
              onClick={() => {
                setSeconds(0);
                setPhase("preparing");
              }}
            >
              <Timer size={14} /> 1분 준비 시작
            </button>
          )}
          <button className={`btn${cueCard ? "" : " primary"}`} onClick={() => void record()}>
            <Mic size={14} /> {cueCard ? "바로 녹음" : "녹음 시작"}
          </button>
          <span className="muted">
            {cueCard
              ? "준비 1분 동안 메모한 뒤, 2분 녹음이 자동으로 시작·종료됩니다."
              : isInterview(part)
                ? "실제 시험처럼 준비 시간 없이 45초 동안 답합니다. 시간이 되면 자동으로 멈춥니다."
                : isRepeat(part)
                  ? "들은 문장을 그대로 따라 말하세요. 15초가 지나면 자동으로 멈춥니다."
                  : "최대 5분까지 녹음합니다."}
          </span>
        </div>
      )}

      {phase === "preparing" && (
        <div className="accent-row">
          <span className="rec-clock prep">{fmt(PREP_SECONDS - seconds)}</span>
          <span className="muted">준비 시간입니다. 아래 칸에 키워드를 메모해 두십시오.</span>
          <button className="btn" onClick={() => void record()}>
            <Mic size={14} /> 지금 말하기
          </button>
        </div>
      )}

      {phase === "recording" && (
        <div className="accent-row">
          <span className="rec-dot" />
          <span className="rec-clock">{fmt(seconds)}</span>
          <span className="muted">/ {fmt(limit)}</span>
          <div className="rec-bar">
            <span style={{ width: `${Math.min(100, (seconds / limit) * 100)}%` }} />
          </div>
          <button className="btn" onClick={stop}>
            <Square size={13} /> 멈춤
          </button>
        </div>
      )}

      {phase === "recorded" && url && (
        <div className="accent-row wrap">
          <audio src={url} controls className="rec-audio" />
          <button className="btn ghost" disabled={busy} onClick={reset}>
            <RotateCcw size={14} /> 다시 녹음
          </button>
          <button className="btn primary" disabled={busy || !take} onClick={() => take && onSubmit(take)}>
            <Sparkles size={14} /> {busy ? "평가 중…" : "저장하고 AI 평가"}
          </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
