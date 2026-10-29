import { BadgeCheck, Lock } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { canCreate, licenseState, type LicenseState } from "../lib/license";
import { describeLicense } from "./LicensePanel";

/** Shows Studio's making tools while the trial or the subscription runs; otherwise says how to go on. */
export default function StudioGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LicenseState | null>(null);
  useEffect(() => {
    licenseState().then(setState, () => setState({ state: "expired", reason: "구독 상태를 확인하지 못했습니다." }));
  }, []);
  if (!state) return <p className="muted">구독 상태를 확인하는 중…</p>;
  if (!canCreate(state))
    return (
      <div className="gate-card">
        <Lock size={18} />
        <div>
          <b>{state.state === "expired" ? state.reason : ""}</b>
          <p className="muted">설정 › Studio 구독에서 구독 키를 등록하면 AI 출제와 내 자료 변환을 계속 쓸 수 있습니다. 풀이·채점·인쇄는 그대로 됩니다.</p>
        </div>
      </div>
    );
  return (
    <>
      {state.state === "trial" && (
        <p className="gate-note">
          <BadgeCheck size={13} /> {describeLicense(state)}
        </p>
      )}
      {children}
    </>
  );
}
