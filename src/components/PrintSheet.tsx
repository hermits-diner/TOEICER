import { createPortal } from "react-dom";
import { BRAND } from "../lib/brand";
import { escapeHtml } from "../lib/importFormat";
import { groupItems, picksOf } from "../lib/multiSelect";
import type { Question, QuestionGroup, TestDetail } from "../lib/types";

export type PrintMode = "questions" | "answers";

interface Props {
  test: TestDetail;
  mode: PrintMode;
  /** After submission: user answers and correctness, printed in the answer key. */
  responses?: Record<number, string>;
  results?: Record<number, boolean>;
}

const JUDGEMENT_HINT = { tfng: "TRUE / FALSE / NOT GIVEN", ynng: "YES / NO / NOT GIVEN" } as const;

/** One row of the answer key: a question, or a "Choose THREE letters" item printed as one row. */
interface KeyRow {
  id: number;
  label: string;
  key: string;
  mine: string;
  verdict: string;
}

function keyRows(g: QuestionGroup, responses?: Record<number, string>, results?: Record<number, boolean>): KeyRow[] {
  return groupItems(g).map((item) => {
    if (item.kind === "single") {
      const q = item.question;
      return {
        id: q.id,
        label: String(q.number),
        key: q.answer.join(" / "),
        mine: responses?.[q.id] || "—",
        verdict: results ? (q.id in results ? (results[q.id] ? "O" : "X") : "제외") : "",
      };
    }
    const qs = item.questions;
    const pool = new Set(qs[0].answer.map((a) => a.trim().toUpperCase()));
    const scored = results ? qs.filter((q) => q.id in results) : [];
    return {
      id: qs[0].id,
      label: `${qs[0].number}–${qs[qs.length - 1].number}`,
      key: g.options.filter((o) => pool.has(o.key.toUpperCase())).map((o) => o.key).join(", "),
      mine: responses ? picksOf(responses, qs).join(", ") || "—" : "—",
      verdict: results ? (scored.length ? `${scored.filter((q) => results[q.id]).length}/${qs.length}` : "제외") : "",
    };
  });
}

/** "Complete the Words" on paper: each `[[n]]` becomes the visible start of the word and a numbered blank. */
export function cwordPrintHtml(bodyHtml: string, questions: Question[]): string {
  const byNumber = new Map(questions.map((q) => [q.number, q]));
  return bodyHtml.replace(/\[\[(\d+)\]\]/g, (_m, n: string) => {
    const q = byNumber.get(Number(n));
    const letters = q?.answer[0]?.length ?? 3;
    return `${escapeHtml(q?.prompt ?? "")}<span class="ps-blank">${"_".repeat(letters + 1)}<sub>${n}</sub></span>`;
  });
}

const SECTION_NAME = { reading: "Reading", listening: "Listening", writing: "Writing", speaking: "Speaking" } as const;

/** Print-only copy of a test, mounted on <body> so the app's fixed-height layout doesn't clip it. */
export default function PrintSheet({ test, mode, responses, results }: Props) {
  const questions = test.passages.flatMap((p) => p.groups.flatMap((g) => g.questions));
  const today = new Date().toLocaleDateString("ko-KR");

  const optionList = (opts: QuestionGroup["options"]) => (
    <ul className="ps-options">
      {opts.map((o) => (
        <li key={o.key}>
          <b>{o.key}</b> {o.text}
        </li>
      ))}
    </ul>
  );

  const printSingle = (g: QuestionGroup, q: Question) => (
    <div key={q.id} className="ps-q">
      <div>
        <b className="ps-num">{q.number}</b> {q.prompt}
        {(g.type === "tfng" || g.type === "ynng") && <span className="ps-hint"> ({JUDGEMENT_HINT[g.type]})</span>}
      </div>
      {g.type === "mcq" && optionList(q.options.length ? q.options : g.options)}
      {g.type === "lmcq" && (mode === "answers" ? optionList(q.options) : <div className="ps-line">(A) (B) (C){q.options.length > 3 ? " (D)" : ""}</div>)}
      {g.type === "build" && (
        <div className="ps-chunks">
          {q.options.map((o) => (
            <span key={o.key}>{o.text}</span>
          ))}
        </div>
      )}
      <div className="ps-line">답: {g.type === "build" ? "____________________________________________" : "____________________"}</div>
    </div>
  );

  const printMulti = (g: QuestionGroup, qs: Question[]) => (
    <div key={qs[0].id} className="ps-q">
      <div>
        <b className="ps-num">
          {qs[0].number}–{qs[qs.length - 1].number}
        </b>{" "}
        {qs[0].prompt}
        <span className="ps-hint"> ({qs.length}개 선택)</span>
      </div>
      {optionList(g.options)}
      <div className="ps-line">답: {qs.map(() => "______").join("  ")}</div>
    </div>
  );

  return createPortal(
    <div className="print-sheet">
      <header className="ps-head">
        <h1>{test.title}</h1>
        <div className="ps-meta">
          <span>
            {BRAND.examName} {SECTION_NAME[test.kind]} · {questions.length}문항
            {test.kind === "listening" ? "" : ` · 제한 시간 약 ${Math.max(3, Math.round((questions.length * BRAND.secondsPerItem) / 60))}분`}
          </span>
          <span>이름 ______________ 날짜 {today}</span>
        </div>
      </header>

      {test.passages.map((p, pi) => {
        const cword = p.groups.length > 0 && p.groups.every((g) => g.type === "cword");
        const listening = test.kind === "listening";
        return (
        <section key={p.id} className="ps-passage">
          <h2>{p.title ?? `${listening ? "Section" : "Passage"} ${pi + 1}`}</h2>
          {/* body_html is built from escaped text in passageToHtml; a listening script prints only with the answers */}
          {cword ? (
            <>
              <p className="ps-instr">{p.groups[0].instructions ?? "Fill in the missing letters in the paragraph."}</p>
              <div className="ps-body" dangerouslySetInnerHTML={{ __html: cwordPrintHtml(p.bodyHtml, p.groups.flatMap((g) => g.questions)) }} />
            </>
          ) : listening ? (
            mode === "answers" && (
              <details open className="ps-script">
                <summary>Script</summary>
                <div className="ps-body" dangerouslySetInnerHTML={{ __html: p.bodyHtml }} />
              </details>
            )
          ) : (
            <div className="ps-body" dangerouslySetInnerHTML={{ __html: p.bodyHtml }} />
          )}

          {!cword && (
          <div className="ps-questions">
            {p.groups.map((g) => (
              <div key={g.id} className="ps-group">
                {g.instructions && <p className="ps-instr">{g.instructions}</p>}
                {g.image && <img className="ps-figure" src={g.image} alt="" />}
                {(g.type === "heading" || g.type === "matching") && g.options.some((o) => o.text) && (
                  <ul className="ps-options boxed">
                    {g.options.map((o) => (
                      <li key={o.key}>
                        <b>{o.key}</b> {o.text}
                      </li>
                    ))}
                  </ul>
                )}
                {groupItems(g).map((item) => (item.kind === "multi" ? printMulti(g, item.questions) : printSingle(g, item.question)))}
              </div>
            ))}
          </div>
          )}
        </section>
        );
      })}

      {mode === "answers" && (
        <section className="ps-key">
          <h2>정답{results ? " 및 채점 결과" : ""}</h2>
          <table>
            <thead>
              <tr>
                <th>번호</th>
                <th>정답</th>
                {results && <th>내 답</th>}
                {results && <th>결과</th>}
              </tr>
            </thead>
            <tbody>
              {test.passages
                .flatMap((p) => p.groups.flatMap((g) => keyRows(g, responses, results)))
                .map((r) => (
                  <tr key={r.id}>
                    <td>{r.label}</td>
                    <td>{r.key}</td>
                    {results && <td>{r.mine}</td>}
                    {results && <td>{r.verdict}</td>}
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}
    </div>,
    document.body,
  );
}
