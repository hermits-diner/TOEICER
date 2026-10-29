import { createPortal } from "react-dom";
import { bandFor } from "../lib/bandTable";
import { TOEIC_PARTS, type ToeicPart } from "../lib/toeicSpec";
import type { Passage, Question, TestDetail } from "../lib/types";
import type { PrintMode } from "./PrintSheet";

interface Props {
  test: TestDetail;
  mode: PrintMode;
  responses?: Record<number, string>;
  results?: Record<number, boolean>;
}

const LETTERS = ["A", "B", "C", "D"];

/** Directions for each part, written for this app in the manner of a test book. */
export const PART_DIRECTIONS: Record<ToeicPart, string> = {
  1: "For each question you will hear four statements about a picture in this book. The statements are spoken only once and are not printed. Choose the statement that best describes the picture and mark your answer on the answer sheet.",
  2: "You will hear a question or statement and three responses, spoken only once and not printed. Choose the best response and mark (A), (B) or (C) on the answer sheet.",
  3: "You will hear conversations between two or more people, spoken only once. Answer the three printed questions about each conversation.",
  4: "You will hear short talks given by a single speaker, spoken only once. Answer the three printed questions about each talk.",
  5: "A word or phrase is missing in each sentence below. Choose the answer that best completes the sentence.",
  6: "Read the texts below. A word, phrase or sentence is missing in parts of each text. Choose the answer that best completes the text.",
  7: "Read the texts below, such as emails, notices, articles and online chats. Each text or set of texts is followed by several questions. Choose the best answer to each question.",
};

export const partOf = (p: Passage): ToeicPart | null => {
  const m = (p.title ?? "").match(/^Part\s+([1-7])\b/);
  return m ? (Number(m[1]) as ToeicPart) : null;
};

/** What a set's text is ("e-mail", "text-message chain"), from its title. */
export function genreOf(title: string | null): string {
  const t = title ?? "";
  const paren = t.match(/\(([^)]+)\)\s*$/);
  if (paren) return paren[1].toLowerCase().replace(/^email$/, "e-mail");
  const after = t.split(/\s+·\s+/)[1] ?? "";
  if (after && !/^(single|double|triple|text|talk|conversation|incomplete)\b(?!-)/i.test(after)) return after.toLowerCase();
  return /triple/i.test(after) ? "texts" : /double/i.test(after) ? "texts" : "text";
}

const span = (qs: Question[]) => (qs.length > 1 ? `${qs[0].number}–${qs[qs.length - 1].number}` : `${qs[0].number}`);

/** Choices as in the test book: four short ones two by two, longer ones one per line. */
function Choices({ q }: { q: Question }) {
  const longest = Math.max(...q.options.map((o) => o.text.length));
  return (
    <ol className={`tk-choices${longest <= 24 ? " two" : ""}`}>
      {q.options.map((o) => (
        <li key={o.key}>
          <b>({o.key})</b> {o.text}
        </li>
      ))}
    </ol>
  );
}

function SetBlock({ p, part }: { p: Passage; part: ToeicPart }) {
  const qs = p.groups.flatMap((g) => g.questions);
  if (!qs.length) return null;
  const listening = part <= 4;
  const graphic = p.groups.map((g) => g.instructions ?? "").find((x) => /^Graphic\n/.test(x));
  const image = p.groups.find((g) => g.image)?.image;
  if (part === 1)
    return (
      <div className="tk-photo">
        {image ? <img src={image} alt="" /> : <div className="tk-photo-missing">(사진)</div>}
        <p>
          <b>{qs[0].number}.</b> Mark your answer on your answer sheet.
        </p>
      </div>
    );
  if (part === 2)
    return (
      <>
        {qs.map((q) => (
          <p key={q.id} className="tk-mark">
            <b>{q.number}.</b> Mark your answer on your answer sheet.
          </p>
        ))}
      </>
    );
  const what = listening ? (part === 3 ? "conversation" : "talk") : genreOf(p.title);
  return (
    <section className={`tk-set p${part}`}>
      {part !== 5 && (
        <p className="tk-refer">
          Questions {span(qs)} refer to the following {what}
          {graphic ? " and graphic" : ""}.
        </p>
      )}
      {graphic && (
        <div className="tk-graphic">
          {graphic
            .split("\n")
            .slice(1)
            .map((l, i) => (
              <div key={i}>{l}</div>
            ))}
        </div>
      )}
      {/* body_html is built from escaped text in passageToHtml; a listening script is printed only with the answers */}
      {!listening && part !== 5 && <div className="tk-text" dangerouslySetInnerHTML={{ __html: p.bodyHtml }} />}
      <div className="tk-qs">
        {qs.map((q) => (
          <div key={q.id} className="tk-q">
            <p>
              <b>{q.number}.</b> {/^\(\d+\)$/.test(q.prompt ?? "") ? "" : q.prompt}
            </p>
            <Choices q={q} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** The answer sheet: rows of Ⓐ–Ⓓ in columns of twenty, Listening and Reading apart as on the real one. */
function OmrSheet({ questions, listening }: { questions: Question[]; listening: boolean }) {
  const cols: Question[][] = [];
  for (let i = 0; i < questions.length; i += 20) cols.push(questions.slice(i, i + 20));
  return (
    <section className="tk-omr">
      <header className="tk-omr-head">
        <div>
          <span>ANSWER SHEET</span>
          <b>{listening ? "LISTENING SECTION" : "READING SECTION"}</b>
        </div>
        <table>
          <tbody>
            <tr>
              <th>NAME</th>
              <td className="wide" />
              <th>DATE</th>
              <td />
            </tr>
          </tbody>
        </table>
      </header>
      <div className="tk-omr-grid">
        {cols.map((col, c) => (
          <table key={c} className="tk-omr-col">
            <thead>
              <tr>
                <th>No.</th>
                <th colSpan={4}>ANSWER</th>
              </tr>
            </thead>
            <tbody>
              {col.map((q, i) => (
                <tr key={q.id} className={(i + 1) % 5 === 0 ? "fifth" : ""}>
                  <th>{q.number}</th>
                  {LETTERS.slice(0, Math.max(3, q.options.length)).map((k) => (
                    <td key={k}>
                      <span className="tk-bubble">{k}</span>
                    </td>
                  ))}
                  {q.options.length === 3 && <td />}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </section>
  );
}

function AnswerKey({ test, questions, parts, responses, results }: Props & { questions: Question[]; parts: [ToeicPart, Question[]][] }) {
  const right = results ? questions.filter((q) => results[q.id]).length : null;
  const counted = results ? questions.filter((q) => q.id in results).length : questions.length;
  const estimate = right === null ? null : bandFor(test.kind, test.module, right, counted).band;
  return (
    <section className="tk-key">
      <header className="tk-key-head">
        <div>
          <span>ANSWER KEY · 정답 및 채점표</span>
          <h2>{test.title}</h2>
        </div>
        <b>{test.kind === "listening" ? "LC" : "RC"}</b>
      </header>
      <div className="tk-key-grid">
        {questions.map((q) => {
          const state = results && q.id in results ? (results[q.id] ? "o" : "x") : results ? "skip" : "";
          return (
            <div key={q.id} className={`tk-cell ${state}`}>
              <span>{q.number}</span>
              <b>{q.answer.join("")}</b>
              {responses && <i>{responses[q.id] || "—"}</i>}
            </div>
          );
        })}
      </div>
      <div className="tk-key-lower">
        <table className="tk-key-parts">
          <thead>
            <tr>
              <th>Part</th>
              <th>문항</th>
              <th>맞힌 수</th>
            </tr>
          </thead>
          <tbody>
            {parts.map(([part, qs]) => (
              <tr key={part}>
                <th>
                  Part {part} <span>{TOEIC_PARTS.find((x) => x.part === part)?.korean}</span>
                </th>
                <td>{span(qs)}</td>
                <td className="fill">{results ? `${qs.filter((q) => results[q.id]).length} / ${qs.length}` : `　　/ ${qs.length}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tk-key-score">
          <div className="tk-key-formula">
            <span>맞힌 문항</span>
            <b className="fill">{right ?? ""}</b>
            <span>/ {counted}</span>
            <span className="tk-key-est">
              추정 점수 <b className="fill big">{estimate ?? ""}</b>
            </span>
          </div>
          <p>
            {test.kind === "listening" ? "Listening" : "Reading"} 5–495점. ETS는 회차마다 점수를 따로 환산하므로 이 점수는 정답률로 본 추정치입니다. 이상한 문항은 앱에서
            '문제가 이상해요'로 신고하면 채점에서 빠집니다.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * A print-only copy laid out like a TOEIC test book: the section band (LISTENING TEST / READING TEST), a black PART
 * bar with boxed directions for each part, "Questions 147–148 refer to the following e-mail.", texts in a frame and
 * choices (A)–(D) two by two when short. An answer sheet follows; with answers, a scoring page and the scripts.
 */
export default function ToeicPrintSheet({ test, mode, responses, results }: Props) {
  const listening = test.kind === "listening";
  const questions = test.passages.flatMap((p) => p.groups.flatMap((g) => g.questions));
  const byPart = new Map<ToeicPart, Passage[]>();
  for (const p of test.passages) {
    const part = partOf(p);
    if (part) byPart.set(part, [...(byPart.get(part) ?? []), p]);
  }
  const parts = [...byPart.entries()].sort(([a], [b]) => a - b);
  const partQs: [ToeicPart, Question[]][] = parts.map(([part, ps]) => [part, ps.flatMap((p) => p.groups.flatMap((g) => g.questions))]);
  const today = new Date().toLocaleDateString("ko-KR");
  return createPortal(
    <div className="print-sheet toeic-sheet">
      <header className="tk-cover">
        <div className="tk-band">
          <b>{listening ? "LISTENING TEST" : "READING TEST"}</b>
          <span>
            {test.title} · {questions.length} questions{listening ? "" : ` · about ${Math.max(5, Math.round(questions.length * 0.75))} minutes`}
          </span>
        </div>
        <div className="tk-meta">
          <span>
            이름 <i />
          </span>
          <span>날짜 {today}</span>
        </div>
      </header>
      <p className="tk-general">
        {listening
          ? "In the Listening test you will show how well you understand spoken English. Answer every question from what you hear; nothing you hear is printed except the questions of Parts 3 and 4."
          : "In the Reading test you will read a variety of texts and answer several kinds of questions. Work as quickly and carefully as you can, and mark every answer on the answer sheet."}
      </p>

      {parts.map(([part, ps]) => (
        <section key={part} className="tk-part">
          <div className="tk-part-head">
            <b>PART {part}</b>
            <p>
              <i>Directions:</i> {PART_DIRECTIONS[part]}
            </p>
          </div>
          <div className={part === 5 || part === 2 ? "tk-cols" : ""}>
            {ps.map((p) => (
              <SetBlock key={p.id} p={p} part={part} />
            ))}
          </div>
        </section>
      ))}

      <OmrSheet questions={questions} listening={listening} />

      {mode === "answers" && (
        <>
          <AnswerKey test={test} mode={mode} questions={questions} parts={partQs} responses={responses} results={results} />
          {listening && (
            <section className="tk-scripts">
              <h2>Scripts</h2>
              {test.passages.map((p) => (
                <div key={p.id} className="tk-script">
                  <b>{p.title}</b>
                  <div dangerouslySetInnerHTML={{ __html: p.bodyHtml }} />
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
