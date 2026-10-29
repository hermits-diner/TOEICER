PRAGMA foreign_keys = ON;

-- Where a set came from: 'sample' (built in), 'ai' (written in Studio), 'mine' (the user's own material,
-- converted in Studio), 'shared' (a set file someone passed on), 'market' (bought on the market).
CREATE TABLE source (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  adapter TEXT NOT NULL UNIQUE
);
INSERT INTO source (name, adapter) VALUES
  ('샘플', 'sample'), ('AI 생성', 'ai'), ('내 자료', 'mine'), ('공유 파일', 'shared'), ('마켓 구매', 'market');

-- One TOEIC set: a Listening set (Parts 1–4, questions 1–100 on a full test) or a Reading set (Parts 5–7, 101–200).
CREATE TABLE test (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES source(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('listening', 'reading')),
  content_hash TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A part's set ("Part 3 · Conversation 2 (…)"): the text for Reading, the script for Listening (shown after
-- grading), and for Listening the recording's archive name.
CREATE TABLE passage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL REFERENCES test(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  title TEXT,
  body_html TEXT NOT NULL,
  audio TEXT
);

-- 'lmcq': choices heard, not printed (Parts 1–2); 'mcq': printed choices (Parts 3–7). `image` is the Part 1
-- photograph as a data URL.
CREATE TABLE question_group (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  passage_id INTEGER NOT NULL REFERENCES passage(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('mcq', 'lmcq')),
  instructions TEXT,
  options_json TEXT,
  image TEXT
);

CREATE TABLE question (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES question_group(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  prompt TEXT,
  options_json TEXT,
  answer_json TEXT
);

-- `score` is the number right, `band` the estimated section score (5–495).
CREATE TABLE attempt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL REFERENCES test(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_sec INTEGER,
  score INTEGER,
  band REAL
);

CREATE TABLE response (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempt(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  user_answer TEXT,
  is_correct INTEGER,
  time_spent INTEGER
);

-- Wrong-answer notes and their review schedule.
CREATE TABLE note (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER REFERENCES question(id) ON DELETE CASCADE,
  memo TEXT,
  tags TEXT,
  review_due TEXT,
  interval_days INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE vocab_word (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL UNIQUE,
  meaning TEXT NOT NULL DEFAULT '',
  context TEXT,
  test_id INTEGER REFERENCES test(id) ON DELETE SET NULL,
  ai_json TEXT,
  interval_days INTEGER,
  review_due TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ai_explanation (
  question_id INTEGER NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  user_answer TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (question_id, user_answer)
);

-- Official material the learner owns (PDF or text), used only by Studio to calibrate the writer.
CREATE TABLE reference_doc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Questions the user reported as flawed; they are left out of scoring and statistics.
CREATE TABLE question_flag (
  question_id INTEGER PRIMARY KEY REFERENCES question(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The import form of each saved test, kept so a set can be written to a set file exactly as it was made.
CREATE TABLE test_source (
  test_id INTEGER PRIMARY KEY REFERENCES test(id) ON DELETE CASCADE,
  json TEXT NOT NULL
);

-- The request behind an AI-written set (topic, target, provider, model, options with the verification record).
CREATE TABLE test_gen (
  test_id INTEGER PRIMARY KEY REFERENCES test(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  band REAL NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  options_json TEXT NOT NULL
);

-- A bought set's market record (item, buyer), kept so it is never edited or passed on as one's own.
CREATE TABLE test_market (
  test_id INTEGER PRIMARY KEY REFERENCES test(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  buyer TEXT NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE app_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE INDEX idx_response_attempt ON response(attempt_id);
CREATE INDEX idx_question_group ON question(group_id);
