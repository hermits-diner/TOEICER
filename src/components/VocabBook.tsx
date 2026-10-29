import { Check, Eye, Pencil, Play, RotateCcw, Search, Trash2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteWord, gradeWord, listWords, listWordSets, updateMeaning, type VocabWord, type WordSet } from "../lib/vocab";

function speak(word: string) {
  const u = new SpeechSynthesisUtterance(word);
  u.lang = "en-GB";
  u.rate = 0.9;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/** The saved sentence with the word itself blanked out, so the card tests recall rather than recognition. */
function blanked(context: string, word: string): string {
  const stem = word.length > 4 ? word.slice(0, -1) : word;
  return context.replace(new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*`, "gi"), "_____");
}

function Review({ onDone }: { onDone: () => void }) {
  const [queue, setQueue] = useState<VocabWord[] | null>(null);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);

  useEffect(() => {
    void listWords(true).then(setQueue);
  }, []);

  if (!queue) return <p className="muted">불러오는 중…</p>;
  const card = queue[0];
  if (!card)
    return (
      <div className="empty">
        <p>{done ? `${done}개를 복습했습니다. 수고하셨습니다.` : "지금 복습할 단어가 없습니다."}</p>
        <button className="btn" onClick={onDone}>단어 목록으로</button>
      </div>
    );

  const grade = async (known: boolean) => {
    await gradeWord(card, known);
    setDone((d) => d + 1);
    setShown(false);
    // "모름" puts the card back at the end of today's queue as well.
    setQueue((q) => (q ? [...q.slice(1), ...(known ? [] : [{ ...card, intervalDays: null }])] : q));
  };

  return (
    <div className="flashcard">
      <div className="muted">남은 카드 {queue.length}장</div>
      <div className="fc-word">
        {card.word}
        <button className="icon-btn" title="발음 듣기" onClick={() => speak(card.word)}>
          <Volume2 size={16} />
        </button>
      </div>
      {card.context && <p className="fc-context">{shown ? card.context : blanked(card.context, card.word)}</p>}
      {shown ? (
        <>
          <div className="fc-meaning">{card.meaning}</div>
          {card.ai?.synonyms.length ? <p className="muted">바꿔 쓰기: {card.ai.synonyms.join(", ")}</p> : null}
          <div className="accent-row fc-actions">
            <button className="btn" onClick={() => void grade(false)}>
              <RotateCcw size={14} /> 모름
            </button>
            <button className="btn primary" onClick={() => void grade(true)}>
              <Check size={14} /> 알았음
            </button>
          </div>
        </>
      ) : (
        <button className="btn primary fc-actions" onClick={() => setShown(true)}>
          <Eye size={14} /> 뜻 보기
        </button>
      )}
    </div>
  );
}

export default function VocabBook({ onOpenTest }: { onOpenTest: (id: number) => void }) {
  const [words, setWords] = useState<VocabWord[] | null>(null);
  const [query, setQuery] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const [sets, setSets] = useState<WordSet[]>([]);
  const refresh = useCallback(() => {
    void listWords().then(setWords);
    void listWordSets().then(setSets, () => setSets([]));
  }, []);
  useEffect(refresh, [refresh]);

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const due = words?.filter((w) => w.reviewDue <= now).length ?? 0;
  const shownWords = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (words ?? []).filter((w) => !q || w.word.includes(q) || w.meaning.toLowerCase().includes(q));
  }, [words, query]);

  if (reviewing)
    return (
      <Review
        onDone={() => {
          setReviewing(false);
          refresh();
        }}
      />
    );

  return (
    <section>
      <div className="chart-head">
        <h3 className="section-title">단어장</h3>
        <button className="btn primary" disabled={!due} onClick={() => setReviewing(true)}>
          오늘의 복습 {due}개
        </button>
      </div>
      <p className="muted">
        지문·스크립트·과제에서 단어를 더블클릭해 "단어장에 추가"를 누르면 여기에 모입니다. 복습은 저장한 문장에서 단어를 가린 채
        진행되고, 1·3·7·15·30일 간격으로 다시 나옵니다.
      </p>

      {words && words.length > 0 && (
        <div className="vocab-search">
          <Search size={14} className="muted" />
          <input className="field" value={query} placeholder="단어나 뜻으로 찾기" onChange={(e) => setQuery(e.target.value)} />
          <span className="muted">{words.length}개</span>
        </div>
      )}

      {sets.length > 0 && (
        <div className="word-sets">
          <span className="muted">단어를 많이 저장한 세트:</span>
          {sets.map((s) => (
            <button key={s.testId} className="chip" title="이 세트를 다시 풀기" onClick={() => onOpenTest(s.testId)}>
              <Play size={11} /> {s.title} · {s.count}개
            </button>
          ))}
        </div>
      )}
      {words?.length === 0 && <div className="empty"><p>아직 저장한 단어가 없습니다.</p></div>}
      {shownWords.length > 0 && (
        <div className="list">
          {shownWords.map((w) => (
            <div key={w.id} className="wrong-row">
              <div className="row-main">
                <div className="vocab-word">
                  <b>{w.word}</b>
                  {editing === w.id ? (
                    <input
                      className="field"
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === "Enter") {
                          await updateMeaning(w.id, draft);
                          setEditing(null);
                          refresh();
                        }
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <span>{w.meaning}</span>
                  )}
                </div>
                {w.context && <div className="wrong-prompt vocab-context">{w.context}</div>}
                {w.ai?.synonyms.length ? <div className="row-meta">바꿔 쓰기: {w.ai.synonyms.join(", ")}</div> : null}
                {w.testTitle && (
                  <button className="link-btn" onClick={() => w.testId && onOpenTest(w.testId)}>
                    {w.testTitle}
                  </button>
                )}
              </div>
              <div className="row-actions">
                <button className="btn ghost" title="발음 듣기" onClick={() => speak(w.word)}>
                  <Volume2 size={14} />
                </button>
                <button
                  className="btn ghost"
                  title="뜻 고치기"
                  onClick={() => {
                    setEditing(w.id);
                    setDraft(w.meaning);
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="btn ghost"
                  title="삭제"
                  onClick={async () => {
                    await deleteWord(w.id);
                    refresh();
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
