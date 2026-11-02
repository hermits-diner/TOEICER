import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";
import { installUpdate } from "../lib/updates";

/** The market's newer release, offered once per start. App renders this in installed builds only (not `tauri dev`). */
export default function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Offline or the market down: studying goes on, and the next start checks again.
    check().then(
      (u) => live && setUpdate(u),
      (e) => console.warn("update check failed", e),
    );
    return () => {
      live = false;
    };
  }, []);

  if (!update) return null;

  const install = async () => {
    setError(null);
    setPercent(null);
    setInstalling(true);
    try {
      await installUpdate(update, setPercent);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInstalling(false);
    }
  };
  const later = () => {
    update.close().catch(() => {});
    setUpdate(null);
  };

  return (
    <div className="update-banner" role="status">
      <p>
        <b>새 버전 {update.version}</b>이 나왔습니다. 지금 쓰는 버전은 {update.currentVersion}입니다.
      </p>
      {installing && <p className="sub">내려받는 중{percent === null ? "…" : ` ${percent}%`}</p>}
      {error && <p className="error">{error}</p>}
      <div className="toolbar">
        <button className="btn primary" disabled={installing} onClick={install}>
          설치하고 다시 시작
        </button>
        <button className="btn" disabled={installing} onClick={later}>
          나중에
        </button>
      </div>
    </div>
  );
}
