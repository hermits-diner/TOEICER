import { Highlighter, StickyNote, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { highlightRange, markAt, removeMark, setNote } from "../lib/highlight";

interface Tool {
  left: number;
  top: number;
  range: Range | null;
  mark: HTMLElement | null;
}

/**
 * Select text in `container` to highlight it or attach a note; click a highlight to edit or remove it.
 * `onChange` receives the container's HTML so the highlights survive switching passages.
 */
export default function HighlightToolbar({
  container,
  onChange,
}: {
  container: HTMLElement | null;
  onChange: (html: string) => void;
}) {
  const [tool, setTool] = useState<Tool | null>(null);
  const [noting, setNoting] = useState(false);
  const [note, setNoteText] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container) return;
    const onUp = (e: MouseEvent) => {
      // A double-click is a dictionary lookup, not a highlight.
      if (e.detail > 1) return;
      const mark = markAt(e.target);
      const sel = window.getSelection();
      const range = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null;
      if (!mark && !range) return;
      const rect = (range ?? document.createRange()).getBoundingClientRect();
      const anchor = range ? rect : mark!.getBoundingClientRect();
      setTool({ left: anchor.left + anchor.width / 2, top: anchor.top, range: range?.cloneRange() ?? null, mark: range ? null : mark });
      setNoting(false);
      setNoteText(mark?.dataset.note ?? "");
    };
    container.addEventListener("mouseup", onUp);
    return () => container.removeEventListener("mouseup", onUp);
  }, [container]);

  useEffect(() => {
    if (!tool) return;
    const onDown = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      if (container?.contains(e.target as Node)) return; // a new selection replaces the tool on mouseup
      setTool(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTool(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [tool, container]);

  if (!tool || !container) return null;

  const done = () => {
    onChange(container.innerHTML);
    window.getSelection()?.removeAllRanges();
    setTool(null);
  };

  const highlight = (withNote?: string) => {
    if (tool.range && highlightRange(tool.range, container, withNote)) done();
    else setTool(null);
  };

  const saveNote = () => {
    if (tool.mark) {
      setNote(tool.mark, note);
      done();
    } else highlight(note.trim() || undefined);
  };

  return (
    <div
      ref={box}
      className="hl-tool"
      style={{ left: tool.left, top: tool.top }}
      onMouseDown={(e) => e.target instanceof HTMLInputElement || e.preventDefault()} // keep the selection
    >
      {noting ? (
        <>
          <input
            className="field"
            autoFocus
            value={note}
            placeholder="메모 (Enter로 저장)"
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveNote()}
          />
          <button className="btn primary small" onClick={saveNote}>저장</button>
        </>
      ) : tool.mark ? (
        <>
          <button className="btn ghost small" onClick={() => setNoting(true)}>
            <StickyNote size={13} /> {tool.mark.dataset.note ? "메모 고치기" : "메모"}
          </button>
          <button
            className="btn ghost small"
            onClick={() => {
              removeMark(tool.mark!);
              done();
            }}
          >
            <Trash2 size={13} /> 지우기
          </button>
        </>
      ) : (
        <>
          <button className="btn ghost small" onClick={() => highlight()}>
            <Highlighter size={13} /> 형광펜
          </button>
          <button className="btn ghost small" onClick={() => setNoting(true)}>
            <StickyNote size={13} /> 메모
          </button>
        </>
      )}
    </div>
  );
}
