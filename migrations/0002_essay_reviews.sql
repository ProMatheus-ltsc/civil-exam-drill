PRAGMA foreign_keys = ON;

CREATE TABLE essay_term_progress (
  user_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  repetitions INTEGER NOT NULL DEFAULT 0 CHECK(repetitions >= 0),
  interval_days INTEGER NOT NULL DEFAULT 0 CHECK(interval_days >= 0),
  ease REAL NOT NULL DEFAULT 2.3 CHECK(ease >= 1.3),
  due_at TEXT NOT NULL,
  last_reviewed_at TEXT,
  remembered_count INTEGER NOT NULL DEFAULT 0 CHECK(remembered_count >= 0),
  forgot_count INTEGER NOT NULL DEFAULT 0 CHECK(forgot_count >= 0),
  PRIMARY KEY(user_id,term_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE essay_review_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK(rating IN ('forgot','hard','remembered')),
  interval_days INTEGER NOT NULL,
  due_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id,idempotency_key)
);

CREATE INDEX idx_essay_progress_user_due ON essay_term_progress(user_id,due_at);
CREATE INDEX idx_essay_events_user_reviewed ON essay_review_events(user_id,reviewed_at DESC);
