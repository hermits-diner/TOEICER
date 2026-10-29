import { BookmarkCheck, BookmarkPlus, Sparkles, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorText, loadAiSettings } from "../lib/ai";
import { DICTIONARY_CREDIT, lookup, preloadDictionary, type Entry } from "../lib/dictionary";
import { explainWord, findWord, saveWord, sentenceAround, type WordInsight } from "../lib/vocab";

interface Target {
  word: string;
  sentence: string | null;
  testId: number | null;
  /** Viewport rectangle of the clicked word. */
  rect: DOMRect;
}

const WORD_RE = /^[A-Za-z][A-Za-z'’-]{0,39}$/;

/** Reads the double-clicked word, its sentence and test from the selection, if it sits inside a `.lookup-zone`. */
function targetFromSelection(): Target | null {
  // Double-clicking inside the answer box selects the user's own text; leave that alone.
  const active = document.activeElement?.tagName;
  if (active === "TEXTAREA" || active === "INPUT") return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const word = sel.toString().trim().replace(/[’']s$/, "");
  if (!WORD_RE.test(word)) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer.nodeType === Node.ELEMENT_NODE ? (range.startContainer as Element) : range.startContainer.parentElement;
  const zone = node?.closest<HTMLElement>(".lookup-zone");
  if (!node || !zone) return null;
  // 실전 모드 mirrors the real test, which has no dictionary.
  if (zone.closest('[data-exam="on"]')) return null;
  const block = node.closest("p, li, div, td") ?? zone;
  let sentence: string | null = null;
  try {
    const pre = document.createRange();
    pre.selectNodeContents(block);
    pre.setEnd(range.startContainer, range.startOffset);
    sentence = sentenceAround(block.textContent ?? "", pre.toString().length) || null;
  } catch {
    sentence = null;
  }
  const testId = Number(zone.dataset.testId) || null;
  return { word, sentence, testId, rect: range.getBoundingClientRect() };
}

function speak(word: string) {
  const u = new SpeechSynthesisUtterance(word);
  u.lang = "en-GB";
  u.rate = 0.9;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/** App-wide: double-click an English word in a passage, transcript or task to see its meaning. */
export default function WordLookup() {
  const [target, setTarget] = useState<Target | null>(null);
  const [entry, setEntry] = useState<Entry | null | undefined>(undefined);
  const [insight, setInsight] = useState<WordInsight | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const box = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setTarget(null), []);

  useEffect(() => {
    preloadDictionary();
    const onDbl = () => {
      const t = targetFromSelection();
      if (!t) return;
      setTarget(t);
      setEntry(undefined);
      setInsight(null);
      setAiError(null);
      setSaved(false);
      void lookup(t.word).then(setEntry, () => setEntry(null));
      void findWord(t.word).then((w) => setSaved(!!w), () => {});
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    document.addEventListener("dblclick", onDbl);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("dblclick", onDbl);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [close]);

  // Below the word when there is room, otherwise above; always inside the window.
  useLayoutEffect(() => {
    if (!target || !box.current) return;
    const { width, height } = box.current.getBoundingClientRect();
    const r = target.rect;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
    const below = r.bottom + 8;
    const top = below + height < window.innerHeight - 8 ? below : Math.max(8, r.top - height - 8);
    setPos({ left, top });
  }, [target, entry, insight, aiBusy, aiError]);

  if (!target) return null;

  const headword = entry?.word ?? target.word.toLowerCase();
  const meaningForSave = insight?.meaning ?? entry?.senses[0]?.glosses.slice(0, 2).join("; ") ?? "";

  const askAi = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      setInsight(await explainWord(loadAiSettings(), headword, target.sentence));
    } catch (e) {
      setAiError(errorText(e));
    } finally {
      setAiBusy(false);
    }
  };

  const save = async () => {
    await saveWord({ word: headword, meaning: meaningForSave, context: target.sentence, testId: target.testId, ai: insight });
    setSaved(true);
  };

  return (
    <div ref={box} className="lookup" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label={`${headword} 뜻`}>
      <div className="lookup-head">
        <span className="lookup-word">{headword}</span>
        {entry?.senses.find((s) => s.ipa) && <span className="lookup-ipa">/{entry.senses.find((s) => s.ipa)!.ipa}/</span>}
        <button className="icon-btn" title="발음 듣기" onClick={() => speak(headword)}>
          <Volume2 size={15} />
        </button>
        <span className="spacer" />
        <button className="icon-btn" title="닫기 (Esc)" onClick={close}>
          <X size={15} />
        </button>
      </div>
      {headword !== target.word.toLowerCase() && <div className="muted lookup-form">{target.word} → {headword}</div>}

      <div className="lookup-body">
        {entry === undefined && <p className="muted">찾는 중…</p>}
        {entry === null && <p className="muted">오프라인 사전에 없는 단어입니다. AI 문맥 풀이를 이용해 보십시오.</p>}
        {entry?.senses.slice(0, 3).map((s, i) => (
          <div key={i} className="lookup-sense">
            {s.pos && <span className="lookup-pos">{s.pos}</span>}
            <ol>
              {s.glosses.slice(0, 3).map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ol>
            {s.example && i === 0 && <p className="lookup-example">{s.example}</p>}
          </div>
        ))}

        {insight && (
          <div className="lookup-ai">
            <div className="lookup-ai-title">
              <Sparkles size={12} /> 이 문장에서: <b>{insight.meaning}</b>
            </div>
            {insight.explanation && <p>{insight.explanation}</p>}
            {insight.synonyms.length > 0 && <p><span className="muted">바꿔 쓰기</span> {insight.synonyms.join(", ")}</p>}
            {insight.collocations.length > 0 && <p><span className="muted">자주 쓰는 조합</span> {insight.collocations.join(", ")}</p>}
            {insight.example && <p className="lookup-example">{insight.example}</p>}
          </div>
        )}
        {aiError && <p className="error">{aiError}</p>}
      </div>

      <div className="lookup-actions">
        <button className="btn" disabled={aiBusy} onClick={() => void askAi()} title="설정에서 고른 AI로 이 문장 속 뜻을 풉니다">
          <Sparkles size={13} /> {aiBusy ? "풀이 중…" : insight ? "다시 풀이" : "AI 문맥 풀이"}
        </button>
        <button className="btn primary" disabled={!meaningForSave} onClick={() => void save()}>
          {saved ? <BookmarkCheck size={13} /> : <BookmarkPlus size={13} />} {saved ? "단어장에 있음" : "단어장에 추가"}
        </button>
      </div>
      <div className="lookup-credit">{DICTIONARY_CREDIT}</div>
    </div>
  );
}
