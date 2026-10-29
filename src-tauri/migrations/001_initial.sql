PRAGMA foreign_keys = ON;

CREATE TABLE source (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  adapter TEXT NOT NULL,
  base_url TEXT,
  robots_json TEXT,
  last_synced TEXT
);

CREATE TABLE test (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES source(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reading','listening','writing','speaking')),
  module TEXT CHECK (module IN ('academic','general')),
  book_no INTEGER,
  test_no INTEGER,
  raw_path TEXT,
  content_hash TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE passage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL REFERENCES test(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  title TEXT,
  body_html TEXT NOT NULL
);

CREATE TABLE question_group (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  passage_id INTEGER NOT NULL REFERENCES passage(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('mcq','lmcq','cword','build','tfng','ynng','heading','matching','fill','short')),
  instructions TEXT
);

CREATE TABLE question (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES question_group(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  prompt TEXT,
  options_json TEXT,
  answer_json TEXT
);

CREATE TABLE audio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL REFERENCES test(id) ON DELETE CASCADE,
  section INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  transcript TEXT
);

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

CREATE TABLE writing_entry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task INTEGER NOT NULL CHECK (task IN (1,2)),
  prompt TEXT,
  body TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  ai_feedback_json TEXT,
  band_estimate REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE note (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER REFERENCES question(id) ON DELETE CASCADE,
  memo TEXT,
  tags TEXT,
  review_due TEXT,
  interval_days INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE crawl_job (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES source(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'discover' CHECK (stage IN ('discover','fetch','extract','normalize','review','store')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  depth INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  etag TEXT,
  last_modified TEXT,
  error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source_id, url)
);

CREATE INDEX idx_response_attempt ON response(attempt_id);
CREATE INDEX idx_question_group ON question(group_id);
CREATE INDEX idx_crawl_job_status ON crawl_job(status, stage);
