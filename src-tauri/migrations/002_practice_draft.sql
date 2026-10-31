-- An attempt the learner left before submitting, so it can be picked up again: the answers, the questions flagged
-- for later, the passage highlights, where they were and the time already spent. One per set; it goes once the
-- attempt is submitted or the set is deleted.
CREATE TABLE practice_draft (
  test_id INTEGER PRIMARY KEY REFERENCES test(id) ON DELETE CASCADE,
  answers_json TEXT NOT NULL,
  flagged_json TEXT NOT NULL DEFAULT '[]',
  marked_json TEXT,
  passage_idx INTEGER NOT NULL DEFAULT 0,
  elapsed_sec INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
