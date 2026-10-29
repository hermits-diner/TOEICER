import { Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { canSpeak, scriptLines, speakLines } from "../lib/speech";

/** Plays text with the Windows voices when a task has no recording of its own. */
export default function SpeakButton({ text, label = "듣기", autoPlay = false }: { text: string; label?: string; autoPlay?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const stopRef = useRef<() => void>(() => {});

  const play = () => {
    stopRef.current();
    setPlaying(true);
    stopRef.current = speakLines(scriptLines(text), { onEnd: () => setPlaying(false) });
  };
  const stop = () => {
    stopRef.current();
    setPlaying(false);
  };

  useEffect(() => {
    if (autoPlay) play();
    return () => stopRef.current();
    // play once per text
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, autoPlay]);

  if (!canSpeak()) return <span className="muted">이 PC에서는 음성 읽기를 쓸 수 없습니다.</span>;
  return playing ? (
    <button className="btn" onClick={stop}>
      <Square size={13} /> 멈춤
    </button>
  ) : (
    <button className="btn primary" onClick={play} title="Windows에 설치된 영어 음성으로 읽어 줍니다">
      <Volume2 size={14} /> {label}
    </button>
  );
}
