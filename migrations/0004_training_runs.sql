PRAGMA foreign_keys = ON;

-- 闯关体系：题目携带单题短材料（material_json）与关卡局次（run_id）
ALTER TABLE generated_questions ADD COLUMN material_json TEXT;
ALTER TABLE generated_questions ADD COLUMN run_id TEXT;
ALTER TABLE quiz_attempts ADD COLUMN run_id TEXT;

-- 关卡成绩按 (user_id, run_id) 聚合（通关/星级判定）
CREATE INDEX idx_quiz_attempts_user_run ON quiz_attempts(user_id, run_id);
-- 个人统计：错题重做趋势按日聚合
CREATE INDEX idx_quiz_retries_user_created ON quiz_retry_attempts(user_id, created_at DESC);
