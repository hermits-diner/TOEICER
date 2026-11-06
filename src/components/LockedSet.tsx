import { ChevronLeft, Lock } from "lucide-react";
import { LOCK_TEXT, type LockReason } from "../lib/marketLock";
import MarketLogin from "./MarketLogin";

/** In place of a bought set this PC cannot open now: why, and signing in where that opens it. Attempts are kept. */
export default function LockedSet({ reason, purchase, onUnlocked, onExit }: { reason: LockReason; purchase?: string | null; onUnlocked: () => void; onExit: () => void }) {
  return (
    <div className="content">
      <div className="toolbar">
        <button className="btn ghost" onClick={onExit}>
          <ChevronLeft size={16} /> 목록
        </button>
      </div>
      <div className="task-card">
        <h3 className="section-title">
          <Lock size={15} /> 잠긴 세트
        </h3>
        <p>{LOCK_TEXT[reason]}</p>
        <p className="muted small">풀이 기록은 지워지지 않고 그대로 있습니다.</p>
        {reason !== "refunded" && <MarketLogin purchase={purchase ?? undefined} intro={false} onDone={onUnlocked} />}
      </div>
    </div>
  );
}
