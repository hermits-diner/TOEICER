import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("./appSettings", () => ({
  getSetting: vi.fn(async (k: string) => store.get(k) ?? null),
  setSetting: vi.fn(async (k: string, v: string | null) => void (v === null ? store.delete(k) : store.set(k, v))),
}));
const { canCreate, licenseState, MARKET, TRIAL_DAYS, verifyToken } = await import("./license");

const DAY = 24 * 60 * 60 * 1000;
const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

/** A market key pair and a token signed with it, as the market would issue one. */
async function market(payload: object) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = b64(await crypto.subtle.exportKey("spki", keys.publicKey));
  const body = b64(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(body)));
  return { publicKey, token: `${body}.${sig}` };
}

beforeEach(() => {
  store.clear();
  MARKET.publicKey = "";
});

describe("Studio licence", () => {
  it("starts a 14-day trial, then stops the making tools", async () => {
    const t0 = Date.parse("2026-11-01T00:00:00Z");
    expect(await licenseState(t0)).toEqual({ state: "trial", daysLeft: TRIAL_DAYS });
    expect(await licenseState(t0 + 13 * DAY + 1)).toEqual({ state: "trial", daysLeft: 1 });
    const over = await licenseState(t0 + TRIAL_DAYS * DAY);
    expect(over.state).toBe("expired");
    expect(canCreate(over)).toBe(false);
  });
  it("accepts only a token the market signed for this app, with a week of grace after the month", async () => {
    const until = "2026-12-01T00:00:00Z";
    const m = await market({ key: "K", app: "TOEICER", plan: "월 구독", expiresAt: until });
    expect(await verifyToken(m.token, m.publicKey)).toMatchObject({ plan: "월 구독" });
    expect(await verifyToken(m.token.replace(/.$/, "A"), m.publicKey)).toBeNull();
    const other = await market({ key: "K", app: "GONGSIER", plan: "월 구독", expiresAt: until });
    expect(await verifyToken(other.token, other.publicKey)).toBeNull();

    MARKET.publicKey = m.publicKey;
    store.set("license.token", m.token);
    expect(await licenseState(Date.parse(until) - DAY)).toMatchObject({ state: "active", offline: false });
    expect(await licenseState(Date.parse(until) + 3 * DAY)).toMatchObject({ state: "active", offline: true });
    expect((await licenseState(Date.parse(until) + 8 * DAY)).state).toBe("expired");
  });
});
