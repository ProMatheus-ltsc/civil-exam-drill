PRAGMA foreign_keys = ON;

-- 回退 0014_unified_auth.sql：
-- 本项目不改数据库结构，users 表维持原样
-- （id, invite_code_id, nickname, nickname_normalized, status,
--   created_at, last_login_at, email, email_normalized, password_hash）。
--
-- 0014 加了两列 username / username_normalized 并从 email 回填，
-- 现在移除它们，并删掉配套的唯一索引。
-- SQLite 3.35+ 支持 ALTER TABLE ... DROP COLUMN。

DROP INDEX IF EXISTS idx_users_username_normalized;

ALTER TABLE users DROP COLUMN username;
ALTER TABLE users DROP COLUMN username_normalized;
