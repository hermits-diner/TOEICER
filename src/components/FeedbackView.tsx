import type { EntryFeedback } from "../lib/repo";
import { PROVIDERS } from "../lib/ai";

/** Names of providers earlier versions could score with, so old feedback still reads well. */
const LEGACY: Record<string, string> = {
  gemini: "Google Gemini",
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  compatible: "OpenAI 호환",
};

const when = (s: string) => {
  const d = new Date(s.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("ko-KR");
};

export default function FeedbackView({ data }: { data: EntryFeedback }) {
  const f = data.feedback;
  const provider = PROVIDERS.find((p) => p.id === data.provider)?.label ?? LEGACY[data.provider] ?? data.provider;
  return (
    <div className="feedback">
      <div className="fb-head">
        <span className="fb-band">{f.overall === null ? "—" : f.overall.toFixed(1)}</span>
        <div>
          <div className="fb-title">AI 예상 Band</div>
          {f.summary && <p className="fb-summary">{f.summary}</p>}
        </div>
      </div>

      {f.criteria.length > 0 && (
        <table className="facts compact fb-criteria">
          <tbody>
            {f.criteria.map((c) => (
              <tr key={c.name}>
                <th>{c.name}</th>
                <td className="num">{c.band === null ? "평가 불가" : c.band.toFixed(1)}</td>
                <td>{c.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="fb-cols">
        {f.strengths.length > 0 && (
          <section>
            <h4>잘한 점</h4>
            <ul>{f.strengths.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>
        )}
        {f.improvements.length > 0 && (
          <section>
            <h4>개선할 점</h4>
            <ul>{f.improvements.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>
        )}
      </div>

      {f.corrections.length > 0 && (
        <section>
          <h4>표현 교정</h4>
          <div className="fb-corrections">
            {f.corrections.map((c, i) => (
              <div key={i} className="fb-correction">
                <div>
                  <s>{c.original}</s> → <b>{c.suggestion}</b>
                </div>
                {c.note && <div className="muted">{c.note}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="muted fb-foot">
        {provider} · {data.model} · {when(data.createdAt)} · AI 예상 점수는 실제 채점과 다를 수 있습니다.
      </p>
    </div>
  );
}
