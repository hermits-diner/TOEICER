import { getDb } from "./db";

/** Small per-user values kept in the database (the home photo is too large for localStorage). */
type Key = "home_photo" | "exam_date" | "target_band" | "backup_dir";

export async function getSetting(key: Key): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.select<{ value: string }[]>("SELECT value FROM app_setting WHERE key = $1", [key]);
  return row?.value ?? null;
}

export async function setSetting(key: Key, value: string | null): Promise<void> {
  const db = await getDb();
  if (value === null) await db.execute("DELETE FROM app_setting WHERE key = $1", [key]);
  else
    await db.execute(
      "INSERT INTO app_setting (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
}

/** Shrinks a chosen picture to at most 1600px on the long side and re-encodes it as JPEG, so the database stays small. */
export async function fileToPhotoDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("그림 파일만 고를 수 있습니다.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("이 그림 파일을 열 수 없습니다.");
  });
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Whole days from today until the exam; negative once it has passed. */
export function daysUntil(isoDate: string, today = new Date()): number | null {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const exam = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((exam - now) / 86_400_000);
}
