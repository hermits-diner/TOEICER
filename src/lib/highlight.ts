/** Passage highlighting and notes, done on the rendered DOM the way the computer-delivered test does it. */

const MARK_CLASS = "hl";

/** Wraps the selected text inside `container` in <mark> elements, one per text node it spans. */
export function highlightRange(range: Range, container: HTMLElement, note?: string): boolean {
  if (range.collapsed || !container.contains(range.commonAncestorContainer)) return false;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const n = walker.currentNode as Text;
    if (range.intersectsNode(n) && n.data.trim() !== "") nodes.push(n);
  }
  let wrapped = false;
  for (const n of nodes) {
    // Already highlighted text is left as it is.
    if (n.parentElement?.closest(`mark.${MARK_CLASS}`)) continue;
    const start = n === range.startContainer ? range.startOffset : 0;
    const end = n === range.endContainer ? range.endOffset : n.length;
    if (start >= end) continue;
    let part = n;
    if (start > 0) part = part.splitText(start);
    if (end - start < part.length) part.splitText(end - start);
    const mark = document.createElement("mark");
    mark.className = MARK_CLASS;
    if (note) {
      mark.classList.add("noted");
      mark.dataset.note = note;
      mark.title = note;
    }
    part.parentNode!.insertBefore(mark, part);
    mark.appendChild(part);
    wrapped = true;
  }
  return wrapped;
}

/** The highlight under a clicked element, if any. */
export function markAt(el: EventTarget | null): HTMLElement | null {
  return el instanceof Element ? el.closest<HTMLElement>(`mark.${MARK_CLASS}`) : null;
}

/** Removes a highlight (and its note), keeping the text. */
export function removeMark(mark: HTMLElement): void {
  const parent = mark.parentNode;
  if (!parent) return;
  while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
  parent.removeChild(mark);
  parent.normalize();
}

export function setNote(mark: HTMLElement, note: string): void {
  const text = note.trim();
  mark.classList.toggle("noted", !!text);
  if (text) {
    mark.dataset.note = text;
    mark.title = text;
  } else {
    delete mark.dataset.note;
    mark.removeAttribute("title");
  }
}
