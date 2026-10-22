CREATE TABLE essay_submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  prompt_title TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  score INTEGER NOT NULL,
  grade TEXT NOT NULL,
  dimensions_json TEXT NOT NULL,
  feedback_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_essay_submissions_user_created
  ON essay_submissions(user_id, created_at DESC);
