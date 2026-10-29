/**
 * Studio's monthly subscription. A new Studio starts a 14-day trial; after that it needs a licence key bought on the
 * market. The market signs a token for the key (ECDSA P-256) that names the app, the plan and when the month runs
 * out; the app checks the signature with the market's public key, so it works offline until then and for a week of
 * grace after, and renews the token whenever it can reach the market. Reader needs none of this.
 */
import { getSetting as setting, setSetting } from "./appSettings";
import { BRAND } from "./brand";

export const TRIAL_DAYS = 14;
const GRACE_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

/** The market's address, this app's place on it, and the public half of the market's token-signing key (SPKI, base64). */
export const MARKET = {
  url: "https://exam-market.hermitsdiner.workers.dev",
  /** This app on the market: the subscribe page is /studio/<slug>/subscribe. */
  slug: "toeic",
  publicKey: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEuNY7nlpFWVBa1yU/GvBXlgKurtlkVQwu1Mkax5NOHuAkCnTho0TX6K1cZwx2ljZNcZk0mC95J9qc+dvHuDp4VA==",
};

export interface Token {
  key: string;
  app: string;
  plan: string;
  /** ISO time the paid month ends. */
  expiresAt: string;
}

export type LicenseState =
  | { state: "trial"; daysLeft: number }
  | { state: "active"; plan: string; until: string; offline: boolean }
  | { state: "expired"; reason: string };

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** The token's payload when its signature is the market's; null otherwise. */
export async function verifyToken(token: string, publicKey = MARKET.publicKey): Promise<Token | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !publicKey) return null;
  try {
    const key = await crypto.subtle.importKey("spki", b64(publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64(sig), new TextEncoder().encode(payload));
    if (!ok) return null;
    const t = JSON.parse(new TextDecoder().decode(b64(payload))) as Token;
    return t.app === BRAND.appName && typeof t.expiresAt === "string" ? t : null;
  } catch {
    return null;
  }
}

/** Where the subscription stands now, from the stored token or the trial clock. */
export async function licenseState(now = Date.now()): Promise<LicenseState> {
  const stored = await setting("license.token");
  if (stored) {
    const t = await verifyToken(stored);
    if (t) {
      const end = Date.parse(t.expiresAt);
      if (now <= end) return { state: "active", plan: t.plan, until: t.expiresAt, offline: false };
      if (now <= end + GRACE_DAYS * DAY) return { state: "active", plan: t.plan, until: t.expiresAt, offline: true };
      return { state: "expired", reason: "구독 기간이 끝났습니다." };
    }
  }
  let started = await setting("license.trialStart");
  if (!started) {
    started = new Date(now).toISOString();
    await setSetting("license.trialStart", started);
  }
  const left = Math.ceil((Date.parse(started) + TRIAL_DAYS * DAY - now) / DAY);
  return left > 0 ? { state: "trial", daysLeft: left } : { state: "expired", reason: `${TRIAL_DAYS}일 체험 기간이 끝났습니다.` };
}

/** Whether Studio's making tools may run now. */
export const canCreate = (s: LicenseState) => s.state !== "expired";

/** Exchanges a licence key for a signed token at the market and keeps it. */
export async function activate(licenseKey: string): Promise<LicenseState> {
  if (!MARKET.url) throw new Error("마켓이 아직 열리지 않아 구독을 등록할 수 없습니다. 그동안은 체험 기간으로 쓸 수 있습니다.");
  const res = await fetch(`${MARKET.url}/api/license/activate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: licenseKey.trim(), app: BRAND.appName }),
  });
  if (!res.ok) throw new Error(res.status === 404 ? "등록되지 않은 구독 키입니다." : `구독을 확인하지 못했습니다 (HTTP ${res.status}).`);
  const { token } = (await res.json()) as { token?: string };
  if (!token || !(await verifyToken(token))) throw new Error("마켓의 응답을 확인하지 못했습니다.");
  await setSetting("license.token", token);
  await setSetting("license.key", licenseKey.trim());
  return licenseState();
}

/** Renews the token for the stored key, quietly; a failure keeps the current token. */
export async function refreshLicense(): Promise<void> {
  const key = await setting("license.key");
  if (!key || !MARKET.url) return;
  try {
    await activate(key);
  } catch {
    // offline, or the market is busy: the stored token and its grace period still apply
  }
}

export async function deactivate(): Promise<void> {
  await setSetting("license.token", null);
  await setSetting("license.key", null);
}
