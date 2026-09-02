PRAGMA foreign_keys = ON;

CREATE TABLE quiz_retry_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  selected_index INTEGER NOT NULL CHECK(selected_index BETWEEN 0 AND 3),
  correct INTEGER NOT NULL CHECK(correct IN (0,1)),
  duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(question_id) REFERENCES generated_questions(id),
  UNIQUE(user_id,idempotency_key)
);

CREATE INDEX idx_quiz_retries_user_question ON quiz_retry_attempts(user_id,question_id,created_at DESC);
