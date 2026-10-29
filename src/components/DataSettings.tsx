import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Archive, Cloud, FolderInput, FolderOpen, History, RotateCcw, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import Hint from "./Hint";
import {
  backupLocation,
  cancelRestore,
  commitRestore,
  createBackupFile,
  defaultBackupName,
  listAutoBackups,
  oneDriveDir,
  prepareRestore,
  setBackupDir,
  type BackupInfo,
  type BackupLocation,
  type RestorePreview,
} from "../lib/backup";

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);
const when = (sec: number) => new Date(sec * 1000).toLocaleString("ko-KR");
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function DataSettings() {
  const [autos, setAutos] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string; path?: string } | null>(null);
  const [preview, setPreview] = useState<{ label: string; data: RestorePreview } | null>(null);
  const [location, setLocation] = useState<BackupLocation | null>(null);
  const [oneDrive, setOneDrive] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listAutoBackups().then(setAutos, () => setAutos([]));
    backupLocation().then(setLocation, () => setLocation(null));
  }, []);
  useEffect(() => {
    oneDriveDir().then(setOneDrive, () => setOneDrive(null));
  }, []);
  useEffect(refresh, [refresh]);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
    } catch (e) {
      setMsg({ kind: "error", text: err(e) });
    } finally {
      setBusy(false);
    }
  };

  const backup = () =>
    run(async () => {
      const defaultPath = location ? `${location.path}\\${defaultBackupName()}` : defaultBackupName();
      const dest = await save({ defaultPath, filters: [{ name: "TOEICER 백업", extensions: ["zip"] }] });
      if (!dest) return;
      const info = await createBackupFile(dest);
      setMsg({ kind: "ok", text: `백업 파일을 만들었습니다 (${size(info.bytes)}).`, path: info.path });
    });

  const stage = (label: string, source: string) =>
    run(async () => {
      setPreview({ label, data: await prepareRestore(source) });
    });

  const pickFile = () =>
    run(async () => {
      const source = await open({ multiple: false, filters: [{ name: "TOEICER 백업", extensions: ["zip", "db"] }] });
      if (typeof source !== "string") return;
      setPreview({ label: source.split(/[\\/]/).pop() ?? source, data: await prepareRestore(source) });
    });

  const moveTo = (dir: string | null, label: string) =>
    run(async () => {
      await setBackupDir(dir);
      refresh();
      setMsg({ kind: "ok", text: `${label}에 오늘 백업을 저장했습니다. 앞으로 자동 백업도 이곳에 저장됩니다.` });
    });

  const pickFolder = async () => {
    const dir = await open({ directory: true, multiple: false, defaultPath: location?.path });
    if (typeof dir === "string") void moveTo(dir, "고른 폴더");
  };

  const confirm = () =>
    run(async () => {
      await commitRestore(); // the app restarts here
    });

  const cancel = () =>
    run(async () => {
      await cancelRestore();
      setPreview(null);
    });

  return (
    <>
      <h3 className="section-title">
        백업 위치
        <Hint text="학습 기록과 수집한 시험, 음원, 작문과 첨삭은 모두 이 PC에만 있습니다. OneDrive처럼 동기화되는 폴더나 USB를 고르면 PC가 바뀌어도 백업이 남습니다. 지난 백업은 원래 폴더에 그대로 둡니다." />
      </h3>
      {location && (
        <div className="backup-where">
          <div className="row-main">
            <div className="row-title backup-path">{location.path}</div>
            <div className="row-meta">{location.custom ? "직접 고른 폴더" : "기본 위치 (문서 › TOEICER 백업)"} · 자동 백업 · 녹음 사본</div>
          </div>
          <button className="btn ghost" title="폴더 열기" onClick={() => revealItemInDir(location.path).catch(() => {})}>
            <FolderOpen size={14} />
          </button>
        </div>
      )}
      {location?.fallback && (
        <p className="warning">고른 백업 폴더를 지금 쓸 수 없어 기본 위치에 대신 저장하고 있습니다.</p>
      )}
      <div className="accent-row wrap">
        {oneDrive && (
          <button className="btn" disabled={busy} onClick={() => void moveTo(`${oneDrive}\\TOEICER 백업`, "OneDrive")}>
            <Cloud size={14} /> OneDrive에 저장
          </button>
        )}
        <button className="btn" disabled={busy} onClick={() => void pickFolder()}>
          <FolderInput size={14} /> 다른 폴더 고르기
        </button>
        {location?.custom && (
          <button className="btn ghost" disabled={busy} onClick={() => void moveTo(null, "기본 위치")}>
            <RotateCcw size={14} /> 기본 위치로
          </button>
        )}
      </div>

      <h3 className="section-title">백업 파일</h3>
      <div className="accent-row">
        <button className="btn primary" disabled={busy} title="모든 데이터를 .zip 하나로 저장합니다." onClick={() => void backup()}>
          <Archive size={14} /> 백업 파일 만들기
        </button>
        <button className="btn" disabled={busy} onClick={() => void pickFile()}>
          <Upload size={14} /> 백업에서 복원
        </button>
      </div>

      {msg && (
        <p className={msg.kind === "ok" ? "success" : "error"}>
          {msg.text}{" "}
          {msg.path && (
            <button className="link-btn" onClick={() => revealItemInDir(msg.path!).catch(() => {})}>
              <FolderOpen size={12} /> 폴더 열기
            </button>
          )}
        </p>
      )}

      {preview && (
        <div className="restore-confirm">
          <div className="row-title">이 백업으로 되돌릴까요?</div>
          <p>
            <b>{preview.label}</b> · 시험 {preview.data.tests}개 · 풀이 기록 {preview.data.attempts}회 · Writing·Speaking 기록{" "}
            {preview.data.entries}개
          </p>
          <p className="muted">지금 데이터는 자동 백업 폴더에 따로 저장한 뒤 앱이 다시 시작됩니다.</p>
          <div className="accent-row">
            <button className="btn primary" disabled={busy} onClick={() => void confirm()}>
              복원하고 다시 시작
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => void cancel()}>
              취소
            </button>
          </div>
        </div>
      )}

      <h3 className="section-title">
        자동 백업
        <span className="muted">· 앱을 켤 때 하루 한 번 · 최근 7일 보관</span>
        <Hint text="Speaking 녹음은 새로 생길 때마다 함께 복사합니다(수집한 그림·음원 원본은 제외). 앱을 지우거나 다시 설치해도 백업 위치에 남습니다." />
      </h3>
      <p className="warning">새 버전 설치 때 제거 화면의 "애플리케이션 데이터 삭제하기"는 체크하지 마세요. 학습 기록이 지워집니다.</p>
      {autos.length === 0 ? (
        <p className="muted">아직 자동 백업이 없습니다.</p>
      ) : (
        <div className="list">
          {autos.map((b) => (
            <div key={b.path} className="list-row">
              <History size={16} className="muted" />
              <div className="row-main">
                <div className="row-title">{when(b.modified)}</div>
                <div className="row-meta">{size(b.bytes)}</div>
              </div>
              <button className="btn" disabled={busy} onClick={() => void stage(when(b.modified), b.path)}>
                이 시점으로 되돌리기
              </button>
            </div>
          ))}
        </div>
      )}
      {autos.length > 0 && (
        <button className="link-btn" onClick={() => revealItemInDir(autos[0].path).catch(() => {})}>
          <FolderOpen size={12} /> 자동 백업 폴더 열기
        </button>
      )}
    </>
  );
}
