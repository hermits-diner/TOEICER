import { Lightbulb } from "lucide-react";
import { useEffect, useState } from "react";
import { errorText, loadAiSettings } from "../lib/ai";
import { cachedExplanation, explainWrongAnswer, type Explanation } from "../lib/explain";

/** "왜 틀렸나요?" under a wrong answer: AI explanation with the passage evidence and paraphrases. */
export default function ExplainPanel({ questionId, userAnswer }: { questionId: number; userAnswer: string }) {
  const [exp, setExp] = useState<Explanation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void cachedExplanation(questionId, userAnswer).then(setExp, () => {});
  }, [questionId, userAnswer]);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      setExp(await explainWrongAnswer(loadAiSettings(), questionId, userAnswer));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!exp)
    return (
      <div className="explain">
        <button className="btn small" disabled={busy} onClick={() => void ask()}>
          <Lightbulb size={13} /> {busy ? "AI가 지문을 살펴보는 중…" : "왜 틀렸나요?"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    );

  return (
    <div className="explain explain-body">
      {exp.evidence && (
        <blockquote className="explain-evidence">
          <span className="muted">근거</span> {exp.evidence}
        </blockquote>
      )}
      {exp.paraphrases.length > 0 && (
        <div className="explain-pairs">
          {exp.paraphrases.map((p, i) => (
            <span key={i} className="explain-pair">
              <b>{p.question}</b> = {p.passage}
            </span>
          ))}
        </div>
      )}
      <p>{exp.explanation}</p>
      {exp.whyNot && (
        <p>
          <span className="muted">내 답</span> {exp.whyNot}
        </p>
      )}
      {exp.tip && <p className="explain-tip">💡 {exp.tip}</p>}
      <button className="link-btn" disabled={busy} onClick={() => void ask()}>
        {busy ? "다시 묻는 중…" : "다시 해설 받기"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
