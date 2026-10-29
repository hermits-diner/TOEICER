// What makes this app TOEICER rather than its siblings (IELTS, TOEFLER) built on the same code:
// names shown to the user, how scores read, the signature theme, and where backups go.

export const BRAND = {
  appName: "TOEICER",
  examName: "TOEIC",
  guideLabel: "TOEIC 가이드",
  /** Folder under Documents for automatic backups (src-tauri/src/backup.rs uses the same name). */
  backupFolder: "TOEICER 백업",
  /** What a section result is called on screen. */
  scoreName: "점수",
  /** Score scale shown beside results. */
  scale: "영역별 5–495 · 총점 10–990",
  /** Sections this app practises; TOEIC Listening and Reading. */
  sections: ["listening", "reading"] as const,
  /** Reading time per question: TOEIC Reading allows 75 minutes for 100. */
  secondsPerItem: 45,
  /** Goal choices on the home screen (a section score). */
  goals: ["250", "300", "350", "400", "450", "495"],
} as const;

/** A section score as the app shows it. */
export const formatScore = (n: number) => String(Math.round(n));
