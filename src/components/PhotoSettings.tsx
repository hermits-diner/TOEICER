import { openUrl } from "@tauri-apps/plugin-opener";
import { ImagePlus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fileToPhotoDataUrl, getSetting, setSetting } from "../lib/appSettings";
import { DICTIONARY_CREDIT } from "../lib/dictionary";
import { PHOTOS } from "../lib/photos";

export default function PhotoSettings({ show, onToggle }: { show: boolean; onToggle: (show: boolean) => void }) {
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getSetting("home_photo").then(setUserPhoto);
  }, []);

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      const url = await fileToPhotoDataUrl(f);
      await setSetting("home_photo", url);
      setUserPhoto(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const reset = async () => {
    await setSetting("home_photo", null);
    setUserPhoto(null);
  };

  return (
    <>
      <h3 className="section-title">사진</h3>
      <label className="switch-row" title="풀이 화면과 인쇄물에는 사진을 넣지 않습니다.">
        <input type="checkbox" checked={show} onChange={(e) => onToggle(e.target.checked)} />
        홈과 가이드에 사진 표시
      </label>

      <div className={`photo-pick${show ? "" : " dimmed"}`}>
        <img src={userPhoto ?? PHOTOS.home.src} alt="홈 화면 사진 미리보기" />
        <div>
          <div className="row-title">홈 화면 사진</div>
          <p className="muted">{userPhoto ? "직접 고른 사진 · 이 PC에만 저장" : `기본 사진 · ${PHOTOS.home.caption}`}</p>
          <div className="accent-row">
            <button className="btn" onClick={() => fileRef.current?.click()}>
              <ImagePlus size={14} /> 사진 고르기
            </button>
            {userPhoto && (
              <button className="btn ghost" onClick={() => void reset()}>
                <RotateCcw size={14} /> 기본 사진으로
              </button>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      <details className="credits">
        <summary>사진·사전 출처</summary>
        <p className="muted">기본 사진: Unsplash License</p>
        <ul>
          {Object.values(PHOTOS).map((p) => (
            <li key={p.url}>
              <button className="link-btn" onClick={() => openUrl(p.url).catch(() => {})}>
                {p.caption}
              </button>{" "}
              — {p.author}
            </li>
          ))}
        </ul>
        <p className="muted">영한 사전: {DICTIONARY_CREDIT} · 위키낱말사전 기여자</p>
      </details>
    </>
  );
}
