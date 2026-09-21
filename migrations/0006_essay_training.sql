PRAGMA foreign_keys = ON;

-- 申论 21 天闯关：一关一行进度。
-- 通关判定用「自评清单勾中比例」（≥80% 一星通关、≥90% 二星、全中三星），
-- 与专项训练的星级同一口径；解锁规则（上一关通关才开下一关）不落库，由 src/essay/training.ts 统一判定。
CREATE TABLE essay_training_progress (
  user_id TEXT NOT NULL,
  level_id TEXT NOT NULL,
  -- 自评清单里勾中的条目下标（数组 JSON）；只存下标，清单文案改动不会污染历史
  checked_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  stars INTEGER NOT NULL DEFAULT 0 CHECK(stars BETWEEN 0 AND 3),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, level_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_essay_training_user_updated ON essay_training_progress(user_id, updated_at DESC);
