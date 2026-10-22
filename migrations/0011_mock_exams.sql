PRAGMA foreign_keys = ON;

-- 资料分析小模考：独立于闯关进度，交卷后生成可分享的成绩报告。
CREATE TABLE mock_exams (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','submitted')),
  question_count INTEGER NOT NULL,
  duration_limit_ms INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  duration_ms INTEGER,
  correct_count INTEGER,
  score INTEGER,
  share_token TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_mock_exams_user_created ON mock_exams(user_id, created_at DESC);
CREATE INDEX idx_mock_exams_share ON mock_exams(share_token);

CREATE TABLE mock_exam_questions (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  topic_id TEXT NOT NULL,
  topic_title TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  stem TEXT NOT NULL,
  options_json TEXT NOT NULL,
  material_json TEXT,
  answer_index INTEGER NOT NULL CHECK(answer_index BETWEEN 0 AND 3),
  explanation TEXT NOT NULL,
  selected_index INTEGER CHECK(selected_index BETWEEN -1 AND 3),
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  answered_at TEXT,
  FOREIGN KEY(exam_id) REFERENCES mock_exams(id) ON DELETE CASCADE,
  UNIQUE(exam_id, position)
);

CREATE INDEX idx_mock_questions_exam ON mock_exam_questions(exam_id, position);
