/**
 * Bought sets on this PC (exam-market's docs/superpowers/specs/2026-11-06-buyer-only-sets-design.md, 5.4–5.5). A bought
 * file arrives sealed under its purchase's key, which the site gives only to a PC signed in to the account that bought it.
 * In the database the set's text stays sealed too, under three layers (see 005_market_lock.sql): the device key in the
 * Windows credential store opens the purchase's key, which opens the set's key, which opens the text. So copying the data
 * folder or a backup to another PC opens nothing until the buyer signs in there, and two accounts on one PC that bought
 * the same set share one stored copy, which stays open as long as either can open it.
 *
 * Keys are wiped only when the site says so: an unknown token, an error or no network never lock an honest buyer's sets.
 * A key has no end date, so a set once opened keeps opening offline.
 */
import { invoke } from "@tauri-apps/api/core";
import { BRAND } from "./brand";
import { getDb } from "./db";
import { MARKET } from "./license";
import { base64ToBytes, bytesToBase64, importKey, isSealedValue, openValue, randomKey, sealValue, unwrapKey, wrapKey } from "./sealed";

export const marketUrl = () => (import.meta.env.VITE_MARKET_URL as string | undefined) || MARKET.url;

export type LockReason = "login" | "device_removed" | "refunded";

export const LOCK_TEXT: Record<LockReason, string> = {
  login: "이 PC에서는 아직 열 수 없는 구매본입니다. 구매한 계정으로 로그인하면 열립니다.",
  device_removed: "이 PC가 계정의 기기에서 빠져 구매본이 잠겼습니다. 다시 로그인해 등록하면 열립니다.",
  refunded: "환불된 구매라 잠겼습니다.",
};

/** What a locked set shows in the screens over many sets (오답 노트, CSV), which must not stop for it. */
export const LOCKED_CELL = "(잠긴 세트)";

/** A set is in the library but this PC cannot open it now. */
export class LockedSetError extends Error {
  constructor(readonly reason: LockReason) {
    super(LOCK_TEXT[reason]);
  }
}

/** Opening a bought file takes signing in to the account that bought it. */
export class NeedLogin extends Error {
  constructor() {
    super("구매한 계정으로 로그인해 주십시오.");
  }
}

/** The site could not be reached, or could not answer. */
export class NeedNetwork extends Error {
  constructor() {
    super("처음 여는 구매본은 인터넷이 필요합니다. 인터넷에 연결한 뒤 다시 열어 주십시오.");
  }
}

/** The site refused this purchase for good: it was refunded. */
export class PurchaseRefused extends Error {}

async function post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(`${marketUrl()}/api/market${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new NeedNetwork();
  }
  if (res.status >= 500) throw new NeedNetwork();
  return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
}

/* ---------- The credential store ---------- */

const secretGet = (name: string) => invoke<string | null>("market_secret_get", { name });
const secretSet = (name: string, value: string) => invoke<void>("market_secret_set", { name, value });

async function deviceKey(): Promise<Uint8Array> {
  const have = await secretGet("device-key");
  if (have) return base64ToBytes(have);
  const fresh = randomKey();
  await secretSet("device-key", bytesToBase64(fresh));
  return fresh;
}

async function tokenName(email: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return `token:${[...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const tokenOf = async (email: string) => secretGet(await tokenName(email));

/* ---------- Keys of purchases ---------- */

/** Set keys already opened in this run, so a screen full of questions does not go to the credential store each time. */
const opened = new Map<number, Uint8Array>();

async function storePurchaseKey(no: string, email: string, key: Uint8Array) {
  const db = await getDb();
  const wrapped = await wrapKey(await deviceKey(), key);
  await db.execute(
    `INSERT INTO market_purchase (purchase_no, account, wrapped_key, locked_reason) VALUES ($1, $2, $3, NULL)
     ON CONFLICT(purchase_no) DO UPDATE SET account = excluded.account, wrapped_key = excluded.wrapped_key, locked_reason = NULL`,
    [no, email, wrapped],
  );
}

async function markLocked(no: string, reason: LockReason, email: string | null) {
  const db = await getDb();
  await db.execute(
    `INSERT INTO market_purchase (purchase_no, account, wrapped_key, locked_reason) VALUES ($1, $2, NULL, $3)
     ON CONFLICT(purchase_no) DO UPDATE SET wrapped_key = NULL, locked_reason = excluded.locked_reason`,
    [no, email, reason],
  );
  opened.clear();
}

/** Forgets the set keys opened in this run. */
export const forgetOpenedKeys = () => opened.clear();

const accounts = async () => (await (await getDb()).select<{ email: string }[]>("SELECT email FROM market_account ORDER BY email")).map((a) => a.email);

/**
 * The key of a purchase: the one this PC holds, or from the site for any account signed in here. Throws NeedLogin when
 * none of them may have it, NeedNetwork when the site cannot be asked, PurchaseRefused when it was refunded.
 */
export async function purchaseKey(no: string): Promise<Uint8Array> {
  const db = await getDb();
  const [row] = await db.select<{ wrapped_key: string | null }[]>("SELECT wrapped_key FROM market_purchase WHERE purchase_no = $1", [no]);
  if (row?.wrapped_key) {
    try {
      return await unwrapKey(await deviceKey(), row.wrapped_key);
    } catch {
      // Kept under another PC's device key (a restored backup): ask the site below.
    }
  }
  for (const email of await accounts()) {
    const token = await tokenOf(email);
    if (!token) continue;
    const r = await post("/keys", { token, purchase: no });
    if (r.status === 200 && typeof r.body.key === "string") {
      const key = base64ToBytes(r.body.key);
      await storePurchaseKey(no, email, key);
      return key;
    }
    if (r.body.error === "refunded") {
      await markLocked(no, "refunded", email);
      throw new PurchaseRefused(LOCK_TEXT.refunded);
    }
    // Not this account's, or this account's token no longer works here: the next account may do.
  }
  throw new NeedLogin();
}

/** After signing in: every purchase on this PC that may be this account's and that this PC cannot open. */
async function fetchMissingKeys(email: string, token: string) {
  const db = await getDb();
  const rows = await db.select<{ purchase_no: string; wrapped_key: string | null }[]>("SELECT purchase_no, wrapped_key FROM market_purchase WHERE account = $1 OR account IS NULL", [email]);
  const dk = await deviceKey();
  for (const row of rows) {
    if (row.wrapped_key && (await unwrapKey(dk, row.wrapped_key).then(() => true, () => false))) continue;
    const r = await post("/keys", { token, purchase: row.purchase_no }).catch(() => null);
    if (!r) return;
    if (r.status === 200 && typeof r.body.key === "string") await storePurchaseKey(row.purchase_no, email, base64ToBytes(r.body.key));
    else if (r.body.error === "refunded") await markLocked(row.purchase_no, "refunded", email);
  }
  opened.clear();
}

/* ---------- Signing in, and the PCs on an account ---------- */

export interface AccountDevice {
  id: number;
  name: string;
  createdAt: string;
  lastSeenAt: string;
}

export type SignIn =
  | { status: "ok"; email: string }
  | { status: "full"; message: string; devices: AccountDevice[]; canRemove: boolean; removableAt: string | null }
  | { status: "refused"; code: string; message: string };

/**
 * Registers this PC on the account. The password goes in this request and is not kept. With `purchase`, an account that
 * did not buy it is refused before it takes a place; with `removeDeviceId`, a full account takes that PC off first.
 */
export async function signIn(email: string, password: string, opts: { purchase?: string; removeDeviceId?: number } = {}): Promise<SignIn> {
  const device = await invoke<{ id: string; name: string }>("market_device");
  const r = await post("/devices/register", { email, password, app: BRAND.appCode, deviceId: device.id, deviceName: device.name, ...opts });
  if (r.status === 200 && typeof r.body.token === "string") {
    const account = String(r.body.email ?? email).trim().toLowerCase();
    await secretSet(await tokenName(account), r.body.token);
    const db = await getDb();
    await db.execute("INSERT OR IGNORE INTO market_account (email) VALUES ($1)", [account]);
    await fetchMissingKeys(account, r.body.token);
    return { status: "ok", email: account };
  }
  if (r.body.error === "full") {
    return {
      status: "full",
      message: String(r.body.message ?? ""),
      devices: (r.body.devices ?? []) as AccountDevice[],
      canRemove: r.body.canRemove === true,
      removableAt: typeof r.body.removableAt === "string" ? r.body.removableAt : null,
    };
  }
  return { status: "refused", code: String(r.body.error ?? r.status), message: String(r.body.message ?? `로그인하지 못했습니다 (HTTP ${r.status}).`) };
}

/**
 * Asks the site about each account on this PC, at most once a day and quietly; called when the app starts. Only its plain
 * answers change anything: a removed PC loses that account's keys (other accounts on the PC keep theirs), a refund loses
 * that purchase's. A purchase that is fine again (a refund undone) gets its key back.
 */
export async function checkInIfDue(now = Date.now()): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ email: string; checked_at: string | null }[]>("SELECT email, checked_at FROM market_account");
  for (const a of rows) {
    if (a.checked_at && now - Date.parse(a.checked_at) < 24 * 60 * 60 * 1000) continue;
    const token = await tokenOf(a.email);
    if (!token) continue;
    const mine = await db.select<{ purchase_no: string; wrapped_key: string | null }[]>("SELECT purchase_no, wrapped_key FROM market_purchase WHERE account = $1", [a.email]);
    const r = await post("/checkin", { token, purchases: mine.map((p) => p.purchase_no) }).catch(() => null);
    if (!r || r.status !== 200) continue;
    if (r.body.device === "removed") {
      await db.execute("UPDATE market_purchase SET wrapped_key = NULL, locked_reason = 'device_removed' WHERE account = $1", [a.email]);
    } else if (r.body.device === "active") {
      for (const no of (r.body.refunded ?? []) as string[]) await markLocked(no, "refunded", a.email);
      const live = new Set((r.body.live ?? []) as string[]);
      if (mine.some((p) => live.has(p.purchase_no) && !p.wrapped_key)) await fetchMissingKeys(a.email, token);
    } else {
      continue;
    }
    await db.execute("UPDATE market_account SET checked_at = $1 WHERE email = $2", [new Date(now).toISOString(), a.email]);
    opened.clear();
  }
}

/* ---------- Reading and sealing a set's stored text ---------- */

async function setKeyOf(testId: number): Promise<Uint8Array | null> {
  const have = opened.get(testId);
  if (have) return have;
  const db = await getDb();
  const rows = await db.select<{ set_key: string; purchase_key: string | null }[]>(
    `SELECT l.wrapped_key AS set_key, p.wrapped_key AS purchase_key
       FROM test_lock l LEFT JOIN market_purchase p ON p.purchase_no = l.purchase_no WHERE l.test_id = $1`,
    [testId],
  );
  const live = rows.filter((r) => r.purchase_key);
  if (!live.length) return null;
  const dk = await deviceKey();
  for (const r of live) {
    try {
      const key = await unwrapKey(await unwrapKey(dk, r.purchase_key!), r.set_key);
      opened.set(testId, key);
      return key;
    } catch {
      // Kept under another PC's device key; another purchase may still open it.
    }
  }
  return null;
}

const isLocked = async (testId: number) => (await (await getDb()).select<unknown[]>("SELECT 1 FROM test_lock WHERE test_id = $1 LIMIT 1", [testId])).length > 0;

export interface Reader {
  text: (stored: string) => Promise<string>;
  maybe: (stored: string | null) => Promise<string | null>;
}

const PLAIN: Reader = { text: async (v) => v, maybe: async (v) => v };

/** Reads a set's stored text: as it is for a set that is not locked; null when it is and this PC holds no key for it. */
export async function readerOf(testId: number): Promise<Reader | null> {
  if (!(await isLocked(testId))) return PLAIN;
  const raw = await setKeyOf(testId);
  if (!raw) return null;
  const key = await importKey(raw);
  const text = (v: string) => (isSealedValue(v) ? openValue(key, v) : Promise.resolve(v));
  return { text, maybe: async (v) => (v === null ? null : text(v)) };
}

/** Why this PC cannot open a locked set now; null when it can, or the set is not locked. */
export async function lockReasonOf(testId: number): Promise<LockReason | null> {
  if (await readerOf(testId)) return null;
  const db = await getDb();
  const rows = await db.select<{ locked_reason: LockReason | null }[]>(
    "SELECT p.locked_reason FROM test_lock l LEFT JOIN market_purchase p ON p.purchase_no = l.purchase_no WHERE l.test_id = $1",
    [testId],
  );
  if (rows.some((r) => r.locked_reason === "device_removed")) return "device_removed";
  return rows.length && rows.every((r) => r.locked_reason === "refunded") ? "refunded" : "login";
}

/** As readerOf, for a screen that cannot go on without the text. */
export async function requireReader(testId: number): Promise<Reader> {
  const r = await readerOf(testId);
  if (r) return r;
  throw new LockedSetError((await lockReasonOf(testId)) ?? "login");
}

/** For a screen over many sets: the text, or null for a set this PC cannot open. */
export function lenientReader() {
  const readers = new Map<number, Promise<Reader | null>>();
  return async (testId: number, stored: string | null): Promise<string | null> => {
    if (!isSealedValue(stored)) return stored;
    if (!readers.has(testId)) readers.set(testId, readerOf(testId));
    const r = await readers.get(testId)!;
    return r ? r.text(stored) : null;
  };
}

/**
 * What practice_draft.marked_json keeps for an attempt's highlights, which is the passages' whole HTML: of a locked set
 * sealed under the set's key, like its text, so a backup does not hold the passages in the clear. With no key on this PC
 * nothing is written in the clear either: highlights sealed earlier stay for when the buyer signs in again.
 */
export async function sealDraftMarks(testId: number, marks: string | null, previous: string | null): Promise<string | null> {
  if (marks === null || !(await isLocked(testId))) return marks;
  const raw = await setKeyOf(testId);
  if (raw) return sealValue(await importKey(raw), marks);
  return isSealedValue(previous) ? previous : null;
}

/**
 * The highlights sealDraftMarks kept, or an older version's plain JSON as it stands. Null when they cannot be opened now
 * (no key here, or the set was sealed again under another): the attempt's answers still stand, only its highlights wait.
 */
export async function openDraftMarks(testId: number, stored: string | null): Promise<string | null> {
  if (!isSealedValue(stored)) return stored;
  const reader = await readerOf(testId);
  const opened = reader ? await reader.text(stored).catch(() => null) : null;
  return isSealedValue(opened) ? null : opened;
}

export type Seal = (plain: string) => Promise<string>;

/** A new set key under this purchase: how to seal the set's text, and what test_lock keeps. */
export async function newTestSeal(purchase: Uint8Array): Promise<{ seal: Seal; wrapped: string }> {
  const raw = randomKey();
  const key = await importKey(raw);
  return { seal: (plain) => sealValue(key, plain), wrapped: await wrapKey(purchase, raw) };
}

export async function addTestLock(testId: number, purchaseNo: string, wrapped: string): Promise<void> {
  const db = await getDb();
  await db.execute("INSERT OR REPLACE INTO test_lock (test_id, purchase_no, wrapped_key) VALUES ($1, $2, $3)", [testId, purchaseNo, wrapped]);
  opened.delete(testId);
}

/** Makes `wrapped` the only key of a set that was sealed again. */
export async function replaceTestLocks(testId: number, purchaseNo: string, wrapped: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM test_lock WHERE test_id = $1", [testId]);
  await addTestLock(testId, purchaseNo, wrapped);
}

/**
 * Another purchase of a set already stored. "plain": the stored copy is not locked, nothing to do. "added": the purchase
 * can now open it too. "none": no key on this PC opens the stored copy, so the caller seals it again from the file.
 */
export async function addPurchaseToTest(testId: number, purchaseNo: string, purchase: Uint8Array): Promise<"plain" | "added" | "none"> {
  if (!(await isLocked(testId))) return "plain";
  const raw = await setKeyOf(testId);
  if (!raw) return "none";
  await addTestLock(testId, purchaseNo, await wrapKey(purchase, raw));
  return "added";
}

/** The one purchase that opens a locked set, for signing in to it; null when there are several, or none. */
export async function onlyPurchaseOf(testId: number): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ purchase_no: string }[]>("SELECT purchase_no FROM test_lock WHERE test_id = $1", [testId]);
  return rows.length === 1 ? rows[0].purchase_no : null;
}

/** The purchase number to print on a locked set's pages; null for any other set. */
export async function purchaseNoOf(testId: number): Promise<string | null> {
  const db = await getDb();
  const [r] = await db.select<{ purchase_no: string }[]>("SELECT purchase_no FROM test_lock WHERE test_id = $1 ORDER BY purchase_no LIMIT 1", [testId]);
  return r?.purchase_no ?? null;
}
