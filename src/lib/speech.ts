// Reads text aloud with the voices built into Windows (WebView2 speechSynthesis), for sets that have no recording:
// TOEFL Speaking questions and sentences, and Listening scripts before Gemini audio has been made for them.

export interface SpeechLine {
  text: string;
  /** Speakers alternate between two voices. */
  voice: 0 | 1;
}

export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

function englishVoices(): SpeechSynthesisVoice[] {
  if (!canSpeak()) return [];
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith("en"))
    .sort((a, b) => Number(b.lang === "en-US") - Number(a.lang === "en-US"));
}

/** "Woman: Hello." lines become turns with a voice per speaker; anything else is one narrator. */
export function scriptLines(script: string): SpeechLine[] {
  const speakers: string[] = [];
  return script
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([A-Z][\w .'-]{0,30}):\s+(.+)$/);
      if (!m) return { text: line, voice: 0 as const };
      if (!speakers.includes(m[1])) speakers.push(m[1]);
      return { text: m[2], voice: (speakers.indexOf(m[1]) % 2) as 0 | 1 };
    });
}

/** Speaks the lines in turn and calls onEnd when done. Returns a function that stops it. */
export function speakLines(lines: SpeechLine[], opts: { rate?: number; onLine?: (i: number) => void; onEnd?: () => void } = {}): () => void {
  if (!canSpeak()) {
    opts.onEnd?.();
    return () => {};
  }
  speechSynthesis.cancel();
  const voices = englishVoices();
  let stopped = false;
  const next = (i: number) => {
    if (stopped) return;
    if (i >= lines.length) return opts.onEnd?.();
    const u = new SpeechSynthesisUtterance(lines[i].text);
    u.lang = "en-US";
    u.rate = opts.rate ?? 1;
    const voice = voices[lines[i].voice % Math.max(voices.length, 1)];
    if (voice) u.voice = voice;
    // With a single installed voice, a change of pitch still tells the speakers apart.
    if (voices.length < 2) u.pitch = lines[i].voice === 1 ? 1.25 : 0.95;
    u.onstart = () => opts.onLine?.(i);
    u.onend = () => setTimeout(() => next(i + 1), 300);
    u.onerror = () => next(i + 1);
    speechSynthesis.speak(u);
  };
  next(0);
  return () => {
    stopped = true;
    speechSynthesis.cancel();
  };
}
