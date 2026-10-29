import Database from "@tauri-apps/plugin-sql";

let handle: Promise<Database> | null = null;

/** Sources added after the first release; seeded by name when missing (see the note on migrations below). */
const MORE_SOURCES = [
  {
    name: "IELTS-up Listening",
    base: "https://ielts-up.com",
    settings: {
      startUrl: "https://ielts-up.com/listening/ielts-listening-practice.html",
      linkPattern: "/listening/ielts-listening-sample-",
      minIntervalMs: 3000,
      respectRobots: true,
      note: "Listening 연습 섹션. 음성은 처음 재생할 때 내려받아 보관합니다.",
    },
  },
  {
    name: "IELTS-up Writing",
    base: "https://ielts-up.com",
    settings: {
      startUrl: "https://ielts-up.com/writing/ielts-writing-practice.html",
      linkPattern: "/writing/((academic|general)-writing|ielts-essay)-sample-",
      minIntervalMs: 3000,
      respectRobots: true,
      note: "Writing 과제와 모범 답안.",
    },
  },
  {
    name: "IELTS-up Speaking",
    base: "https://ielts-up.com",
    settings: {
      startUrl: "https://ielts-up.com/speaking/ielts-speaking-practice.html",
      linkPattern: "/speaking/(ielts-speaking-sample|sample-)",
      minIntervalMs: 3000,
      respectRobots: true,
      note: "Speaking 주제별 질문과 모범 답변.",
    },
  },
];

const OFFICIAL_ACADEMIC = {
  startUrl: "https://ielts.org/cdn/Sample-tests/ielts-academic-reading-sample-tasks-2023.pdf",
  minIntervalMs: 3000,
  respectRobots: true,
  note: "공식 Academic Reading 샘플 과제 PDF입니다. 과제 13개와 정답이 들어 있습니다.",
};

/** Single shared connection. Migrations run on first load (see src-tauri/src/lib.rs). */
export function getDb(): Promise<Database> {
  handle ??= Database.load("sqlite:toeicer.db").then(async (db) => {
    // Tables and sources added after the first release are created here rather than by a migration:
    // an installed older build refuses to open a database that records migrations it does not know,
    // whereas extra tables and rows do not disturb it.
    await db.execute(
      `CREATE TABLE IF NOT EXISTS group_image (
         group_id INTEGER PRIMARY KEY REFERENCES question_group(id) ON DELETE CASCADE,
         data_url TEXT NOT NULL
       )`,
    );
    await db.execute(
      `CREATE TABLE IF NOT EXISTS passage_extra (
         passage_id INTEGER PRIMARY KEY REFERENCES passage(id) ON DELETE CASCADE,
         audio TEXT,
         sample_html TEXT
       )`,
    );
    await db.execute(
      `CREATE TABLE IF NOT EXISTS practice_entry (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         passage_id INTEGER NOT NULL REFERENCES passage(id) ON DELETE CASCADE,
         body TEXT NOT NULL,
         word_count INTEGER NOT NULL DEFAULT 0,
         duration_sec INTEGER,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    );
    await db.execute(
      `CREATE TABLE IF NOT EXISTS ai_feedback (
         entry_id INTEGER PRIMARY KEY REFERENCES practice_entry(id) ON DELETE CASCADE,
         provider TEXT NOT NULL,
         model TEXT NOT NULL,
         feedback_json TEXT NOT NULL,
         band REAL,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    );
    await db.execute(
      `CREATE TABLE IF NOT EXISTS vocab_word (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         word TEXT NOT NULL UNIQUE,
         meaning TEXT NOT NULL DEFAULT '',
         context TEXT,
         test_id INTEGER REFERENCES test(id) ON DELETE SET NULL,
         ai_json TEXT,
         interval_days INTEGER,
         review_due TEXT NOT NULL DEFAULT (datetime('now')),
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    );
    await db.execute(
      `CREATE TABLE IF NOT EXISTS ai_explanation (
         question_id INTEGER NOT NULL REFERENCES question(id) ON DELETE CASCADE,
         user_answer TEXT NOT NULL,
         provider TEXT NOT NULL,
         model TEXT NOT NULL,
         json TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT (datetime('now')),
         PRIMARY KEY (question_id, user_answer)
       )`,
    );
    await db.execute(
      `CREATE TABLE IF NOT EXISTS entry_audio (
         entry_id INTEGER PRIMARY KEY REFERENCES practice_entry(id) ON DELETE CASCADE,
         file TEXT NOT NULL,
         duration_sec INTEGER
       )`,
    );
    // Official practice material the learner owns (PDF or text), used only to calibrate the TOEFL generator.
    await db.execute(
      `CREATE TABLE IF NOT EXISTS reference_doc (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         name TEXT NOT NULL,
         body TEXT NOT NULL,
         enabled INTEGER NOT NULL DEFAULT 1,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    );
    // Source row for sets written by the AI (src/lib/generate.ts), so they can be told apart from collected ones.
    await db.execute(
      `INSERT INTO source (name, adapter, base_url, settings_json)
       SELECT 'AI 생성', 'ai', NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM source WHERE adapter = 'ai')`,
    );
    await db.execute(
      `CREATE TABLE IF NOT EXISTS passage_timing (
         passage_id INTEGER PRIMARY KEY REFERENCES passage(id) ON DELETE CASCADE,
         words_json TEXT NOT NULL
       )`,
    );
    // Questions the user reported as flawed (AI-written sets); they are left out of scoring and statistics.
    await db.execute(
      `CREATE TABLE IF NOT EXISTS question_flag (
         question_id INTEGER PRIMARY KEY REFERENCES question(id) ON DELETE CASCADE,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    );
    // The import form of each saved test, kept so a set can be exported as a package exactly as it was made.
    await db.execute(
      `CREATE TABLE IF NOT EXISTS test_source (
         test_id INTEGER PRIMARY KEY REFERENCES test(id) ON DELETE CASCADE,
         json TEXT NOT NULL
       )`,
    );
    await db.execute(
      `INSERT INTO source (name, adapter, base_url, settings_json)
       SELECT '공유 파일', 'package', NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM source WHERE adapter = 'package')`,
    );
    // A whole exam: one row grouping its six sets (listening, three reading passages, writing, speaking).
    await db.execute(
      `CREATE TABLE IF NOT EXISTS exam (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         title TEXT NOT NULL,
         module TEXT,
         band REAL,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    );
    await db.execute(
      `CREATE TABLE IF NOT EXISTS exam_test (
         exam_id INTEGER NOT NULL REFERENCES exam(id) ON DELETE CASCADE,
         test_id INTEGER NOT NULL REFERENCES test(id) ON DELETE CASCADE,
         ord INTEGER NOT NULL,
         skill TEXT NOT NULL,
         PRIMARY KEY (exam_id, test_id)
       )`,
    );
    await db.execute("CREATE TABLE IF NOT EXISTS app_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    // The request behind an AI-written set (topic, band, provider, model, skill options), for filtering the library.
    await db.execute(
      `CREATE TABLE IF NOT EXISTS test_gen (
         test_id INTEGER PRIMARY KEY REFERENCES test(id) ON DELETE CASCADE,
         topic TEXT NOT NULL,
         band REAL NOT NULL,
         provider TEXT NOT NULL,
         model TEXT NOT NULL,
         options_json TEXT NOT NULL
       )`,
    );
    for (const s of MORE_SOURCES) {
      await db.execute(
        `INSERT INTO source (name, adapter, base_url, settings_json)
         SELECT $1, 'generic', $2, $3 WHERE NOT EXISTS (SELECT 1 FROM source WHERE name = $1)`,
        [s.name, s.base, JSON.stringify(s.settings)],
      );
    }
    // The official Academic page links only answer keys (the tasks run in an exam player);
    // the tasks themselves, with their keys, are in this one PDF. Corrects the source seeded by migration 003.
    await db.execute(
      `UPDATE source SET settings_json = $1
        WHERE name = 'IELTS.org 공식 샘플 (Academic)' AND settings_json LIKE '%sample-test-questions/academic-test%'`,
      [JSON.stringify(OFFICIAL_ACADEMIC)],
    );
    return db;
  });
  return handle;
}
