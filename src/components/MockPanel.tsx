import { ChevronDown, ChevronRight, Play, Plus, Timer } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createMockTest, findMockSets, type MockSet } from "../lib/mock";
import type { TestKind } from "../lib/types";

/** Full-length tests assembled from "Section 1–3/4" tests, timed like the real exam. */
export default function MockPanel({ kind, onOpen, onCreated }: { kind: TestKind; onOpen: (id: number) => void; onCreated: () => void }) {
  const [sets, setSets] = useState<MockSet[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    findMockSets(kind).then(setSets, (e) => setError(String(e)));
  }, [kind]);
  useEffect(refresh, [refresh]);

  if (!sets || sets.length === 0) return null;

  const start = async (s: MockSet) => {
    if (s.existingId) return onOpen(s.existingId);
    setBusy(s.name);
    setError(null);
    try {
      const id = await createMockTest(s);
      refresh();
      onCreated();
      onOpen(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const ready = sets.filter((s) => s.existingId).length;

  return (
    <section className="mock-panel">
      <button
        className="mock-head"
        title='같은 시험의 Section을 하나로 묶어 실제 시험처럼 문항 번호를 이어 붙입니다. 실전 모드를 켜면 사전이 꺼집니다.'
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Timer size={16} className="accent" />
        <span className="row-title">실전 모의고사</span>
        <span className="muted">
          {kind === "reading" ? "지문 3 · 60분" : "Part 4 · 약 30분"} · 세트 {sets.length}{ready ? ` (만든 것 ${ready})` : ""}
        </span>
      </button>
      {open && (
        <>
          {error && <p className="error">{error}</p>}
          <div className="list">
            {sets.map((s) => (
              <div key={s.name} className="list-row">
                <div className="row-main">
                  <div className="row-title">{s.name}</div>
                  <div className="row-meta">{s.questionCount}문항</div>
                </div>
                <button className="btn primary" disabled={busy !== null} onClick={() => void start(s)}>
                  {s.existingId ? <Play size={14} /> : <Plus size={14} />}{" "}
                  {busy === s.name ? "만드는 중…" : s.existingId ? "풀기" : "만들고 풀기"}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
