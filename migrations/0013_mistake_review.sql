ALTER TABLE quiz_attempts ADD COLUMN cause_tag TEXT;
ALTER TABLE quiz_attempts ADD COLUMN review_stage INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quiz_attempts ADD COLUMN next_review_at TEXT;
ALTER TABLE quiz_attempts ADD COLUMN last_reviewed_at TEXT;

CREATE INDEX idx_quiz_attempts_review
  ON quiz_attempts(user_id, mastered, next_review_at);
