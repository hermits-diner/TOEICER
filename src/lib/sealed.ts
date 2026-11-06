/**
 * The sealing of bought sets (exam-market's buyer-only design), all AES-256-GCM. Two forms:
 * - a set file's entry, as the site writes it (exam-market src/lib/setkeys.ts): {"sealed":1,"iv":…,"data":…}, base64;
 * - a stored value, a column of the database or a key under another key: "enc1:" + base64(iv ‖ ciphertext).
 */
const PREFIX = "enc1:";

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export const bytesToBase64 = toB64;
export const base64ToBytes = fromB64;

export const randomKey = () => crypto.getRandomValues(new Uint8Array(32));

export const importKey = (raw: Uint8Array) => crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);

/** Whether a set file's entry is sealed, without reading it as a set. */
export function isSealedEntry(text: string): boolean {
  if (!text.startsWith('{"sealed"')) return false;
  try {
    return (JSON.parse(text) as { sealed?: unknown }).sealed === 1;
  } catch {
    return false;
  }
}

/** The text of a sealed entry. Throws when the key is not this entry's. */
export async function openEntry(key: Uint8Array, text: string): Promise<string> {
  const s = JSON.parse(text) as { iv: string; data: string };
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(s.iv) as BufferSource }, await importKey(key), fromB64(s.data) as BufferSource);
  return new TextDecoder().decode(plain);
}

export const isSealedValue = (v: unknown): v is string => typeof v === "string" && v.startsWith(PREFIX);

async function sealBytes(key: CryptoKey, plain: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain as BufferSource));
  const out = new Uint8Array(iv.length + data.length);
  out.set(iv);
  out.set(data, iv.length);
  return PREFIX + toB64(out);
}

async function openBytes(key: CryptoKey, stored: string): Promise<Uint8Array> {
  const all = fromB64(stored.slice(PREFIX.length));
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.subarray(0, 12) as BufferSource }, key, all.subarray(12) as BufferSource));
}

export const sealValue = (key: CryptoKey, plain: string) => sealBytes(key, new TextEncoder().encode(plain));

export const openValue = async (key: CryptoKey, stored: string) => new TextDecoder().decode(await openBytes(key, stored));

/** A key kept under another key. */
export const wrapKey = async (outer: Uint8Array, inner: Uint8Array) => sealBytes(await importKey(outer), inner);

/** Throws when `outer` is not the key it was kept under. */
export const unwrapKey = async (outer: Uint8Array, stored: string) => openBytes(await importKey(outer), stored);
