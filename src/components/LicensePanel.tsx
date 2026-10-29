import { openUrl } from "@tauri-apps/plugin-opener";
import { BadgeCheck, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { errorText } from "../lib/ai";
import { activate, deactivate, licenseState, MARKET, TRIAL_DAYS, type LicenseState } from "../lib/license";

const date = (iso: string) => new Date(iso).toLocaleDateString("ko-KR");

export function describeLicense(s: LicenseState): string {
  if (s.state === "trial") return `체험 기간 ${s.daysLeft}일 남음`;
  if (s.state === "active") return `${s.plan} 구독 · ${date(s.until)}까지${s.offline ? " (오프라인 유예 중)" : ""}`;
  return s.reason;
}

/** Settings › Studio 구독: where the subscription stands, and the licence key from the market. */
export default function LicensePanel() {
  const [state, setState] = useState<LicenseState | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    licenseState().then(setState, (e) => setError(errorText(e)));
  }, []);

  const run = async (job: () => Promise<LicenseState | void>) => {
    setBusy(true);
    setError(null);
    try {
      await job();
      setState(await licenseState());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="license-panel">
      <p className={`license-state ${state?.state ?? ""}`}>
        <BadgeCheck size={15} /> {state ? describeLicense(state) : "확인하는 중…"}
      </p>
      <p className="muted small">
        Studio는 월 구독입니다. 처음 {TRIAL_DAYS}일은 무료 체험이고, 그 뒤에는 마켓에서 받은 구독 키를 등록하면 AI 출제·내 자료 변환·편집·세트 파일
        내보내기를 계속 쓸 수 있습니다. 풀이와 채점, 인쇄는 구독과 관계없이 언제나 쓸 수 있습니다.
      </p>
      {state?.state === "active" ? (
        <button className="btn small" disabled={busy} onClick={() => void run(deactivate)}>
          이 PC에서 구독 해제
        </button>
      ) : (
        <div className="accent-row">
          <KeyRound size={14} />
          <input className="field" value={key} placeholder="구독 키" disabled={busy} onChange={(e) => setKey(e.target.value)} />
          <button className="btn small primary" disabled={busy || !key.trim()} onClick={() => void run(() => activate(key))}>
            {busy ? <Loader2 size={13} className="spin" /> : null} 등록
          </button>
        </div>
      )}
      {state?.state !== "active" && (
        <button className="link-btn" onClick={() => openUrl(`${MARKET.url}/studio/${MARKET.slug}/subscribe`).catch(() => {})}>
          <ExternalLink size={13} /> 마켓에서 구독하고 키 받기
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
