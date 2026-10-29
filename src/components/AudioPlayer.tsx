import { Download, RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isArchivedAudio, saveAudioAs } from "../lib/audio";
import { loadAudio } from "../lib/repo";

const RATES = [0.75, 1, 1.25, 1.5];

/** Player for a listening set's recording, kept in the archive. */
export default function AudioPlayer({ source }: { source: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let live = true;
    let made: string | null = null;
    setUrl(null);
    setError(null);
    loadAudio(source).then(
      (u) => {
        made = u;
        if (live) setUrl(u);
        else URL.revokeObjectURL(u);
      },
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [source]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate, url]);

  /** Writes the recording to a file the user picks; a WAV in the archive is converted to MP3 on the way. */
  const download = async () => {
    setSaving(true);
    setSaved(null);
    try {
      const dest = await saveAudioAs(source, "listening");
      if (dest) setSaved(dest);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const skip = (sec: number) => {
    if (audio.current) audio.current.currentTime = Math.max(0, audio.current.currentTime + sec);
  };

  if (error) return <p className="error">음성을 불러오지 못했습니다: {error}</p>;
  if (!url) return <p className="muted">음성을 불러오는 중…</p>;

  return (
    <div className="audio-player">
      <audio ref={audio} controls src={url} />
      <div className="toolbar">
        <button className="btn" onClick={() => skip(-5)} title="5초 뒤로">
          <RotateCcw size={13} /> 5초
        </button>
        <button className="btn" onClick={() => skip(5)} title="5초 앞으로">
          5초 <RotateCw size={13} />
        </button>
        <span className="spacer" />
        {isArchivedAudio(source) && (
          <button className="btn" disabled={saving} onClick={() => void download()} title="이 음성을 MP3 파일로 저장">
            <Download size={13} /> {saving ? "저장 중…" : "MP3 저장"}
          </button>
        )}
        <div className="segmented small">
          {RATES.map((r) => (
            <button key={r} className={r === rate ? "on" : ""} onClick={() => setRate(r)}>
              {r}×
            </button>
          ))}
        </div>
      {saved && <p className="muted">저장했습니다: {saved}</p>}
      </div>
    </div>
  );
}
