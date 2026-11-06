import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Loader2, LogIn } from "lucide-react";
import { useState } from "react";
import { marketUrl, signIn, type AccountDevice } from "../lib/marketLock";

const day = (iso: string) => new Date(iso).toLocaleDateString("ko-KR");

interface Props {
  /** The bought file being opened: an account that did not buy it is refused before it takes a place. */
  purchase?: string;
  /** Says why signing in is asked for; a screen that has already said so turns it off. */
  intro?: boolean;
  onDone: () => void;
}

/**
 * Signs this PC in to the buyer's account, once per PC: the password goes to the site and is not kept. A full account
 * shows its PCs and takes one off here; when that has to wait, it says from when and where else to turn.
 */
export default function MarketLogin({ purchase, intro = true, onDone }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState<{ devices: AccountDevice[]; canRemove: boolean; removableAt: string | null; message: string } | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  const submit = async (removeDeviceId?: number) => {
    setBusy(true);
    setError(null);
    try {
      const r = await signIn(email, password, { ...(purchase ? { purchase } : {}), ...(removeDeviceId !== undefined ? { removeDeviceId } : {}) });
      if (r.status === "ok") {
        setPassword("");
        onDone();
      } else if (r.status === "full") {
        setFull(r);
      } else {
        setFull(null);
        setError(r.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const open = (path: string) => void openUrl(`${marketUrl()}${path}`).catch(() => {});

  if (full) {
    return (
      <div className="market-login">
        <p>{full.message}</p>
        <div className="list">
          {full.devices.map((d) => (
            <label key={d.id} className="list-row">
              <input type="radio" name="device" disabled={!full.canRemove || busy} checked={removing === d.id} onChange={() => setRemoving(d.id)} />
              <div className="row-main">
                <div className="row-title">{d.name}</div>
                <div className="row-meta">
                  등록 {day(d.createdAt)} · 마지막 사용 {day(d.lastSeenAt)}
                </div>
              </div>
            </label>
          ))}
        </div>
        {full.canRemove ? (
          <>
            <p className="muted small">PC 빼기는 30일에 한 번 할 수 있습니다. 뺀 PC는 인터넷에 연결되면 구매한 세트가 잠깁니다.</p>
            <button className="btn primary" disabled={busy || removing === null} onClick={() => void submit(removing ?? undefined)}>
              {busy ? <Loader2 size={13} className="spin" /> : null} 고른 PC를 빼고 이 PC 등록
            </button>
          </>
        ) : (
          <p className="error">
            PC 빼기는 30일에 한 번 할 수 있습니다. {full.removableAt ? `${day(full.removableAt)}부터 뺄 수 있습니다.` : ""} PC가 고장 났다면 고객센터에 알려 주십시오.
          </p>
        )}
        <button className="link-btn" onClick={() => open("/account#devices")}>
          <ExternalLink size={13} /> 사이트의 내 기기 보기
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <form
      className="market-login"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="muted small">{intro ? "이 PC에서 처음 여는 구매본입니다. 세트를 구매한 계정으로 한 번 로그인해 주십시오. " : ""}비밀번호는 이 PC에 저장하지 않습니다.</p>
      <input className="field" type="email" placeholder="이메일" autoComplete="username" value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} required />
      <input className="field" type="password" placeholder="비밀번호" autoComplete="current-password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} required />
      <button className="btn primary" type="submit" disabled={busy || !email.trim() || !password}>
        {busy ? <Loader2 size={13} className="spin" /> : <LogIn size={14} />} 로그인
      </button>
      <button className="link-btn" type="button" onClick={() => open("/reset")}>
        <ExternalLink size={13} /> 비밀번호를 잊었다면
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
