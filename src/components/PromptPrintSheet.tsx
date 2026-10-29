import { createPortal } from "react-dom";
import { BRAND } from "../lib/brand";
import type { TestDetail } from "../lib/types";

interface Props {
  test: TestDetail;
  /** The learner's own draft for the passage at this index, printed under the task when present. */
  draft?: { index: number; text: string };
}

/** Print-only copy of a writing or speaking set: every task with its model answer, mounted on <body> like PrintSheet. */
export default function PromptPrintSheet({ test, draft }: Props) {
  const writing = test.kind === "writing";
  const today = new Date().toLocaleDateString("ko-KR");
  return createPortal(
    <div className="print-sheet">
      <header className="ps-head">
        <h1>{test.title}</h1>
        <div className="ps-meta">
          <span>
            {BRAND.examName} {writing ? "Writing" : "Speaking"} · 과제 {test.passages.length}개
            {test.passages.some((p) => p.sampleHtml) ? " · 모범 답안 포함" : ""}
          </span>
          <span>이름 ______________ 날짜 {today}</span>
        </div>
      </header>

      {test.passages.map((p, i) => (
        <section key={p.id} className="ps-passage">
          <h2>{p.title ?? `${writing ? "Task" : "Part"} ${i + 1}`}</h2>
          {/* body_html and sample_html are built from escaped text in passageToHtml */}
          <div className="ps-body" dangerouslySetInnerHTML={{ __html: p.bodyHtml }} />
          {writing && !(draft && draft.index === i && draft.text.trim()) && (
            <div className="ps-lines" aria-hidden="true">
              {Array.from({ length: /email/i.test(p.title ?? "") ? 10 : 12 }, (_, k) => (
                <div key={k} />
              ))}
            </div>
          )}
          {draft && draft.index === i && draft.text.trim() && (
            <>
              <h3>내 답안</h3>
              <div className="ps-body">
                {draft.text.split(/\n\s*\n/).map((para, k) => (
                  <p key={k}>{para}</p>
                ))}
              </div>
            </>
          )}
          {p.sampleHtml && (
            <>
              <h3>모범 답안</h3>
              <div className="ps-body" dangerouslySetInnerHTML={{ __html: p.sampleHtml }} />
            </>
          )}
        </section>
      ))}
    </div>,
    document.body,
  );
}
