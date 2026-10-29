import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Plus, X } from "lucide-react";

/** Custom macOS-style title bar: traffic lights on the left, draggable centre. */
export default function TitleBar({ title }: { title: string }) {
  const win = getCurrentWindow();
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="traffic">
        <button className="close" aria-label="닫기" onClick={() => win.close()}>
          <X strokeWidth={3} />
        </button>
        <button className="min" aria-label="최소화" onClick={() => win.minimize()}>
          <Minus strokeWidth={3} />
        </button>
        <button className="max" aria-label="최대화" onClick={() => win.toggleMaximize()}>
          <Plus strokeWidth={3} />
        </button>
      </div>
      <div className="title" data-tauri-drag-region>
        {title}
      </div>
    </div>
  );
}
