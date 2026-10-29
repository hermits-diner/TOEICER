-- Shared option lists (heading lists, matching lists, MCQ choices shared by a group).
ALTER TABLE question_group ADD COLUMN options_json TEXT;
