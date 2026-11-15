PRAGMA foreign_keys = ON;

-- 统一认证表结构：补齐 shared-core 统一契约要求的 username_normalized 列。
--
-- !! 本迁移已在生产库执行过，随后由 0015_revert_unified_auth.sql 回退
--    （本项目不改数据库结构，users 表维持原样）。
--    保留本文件是因为 D1 用 d1_migrations 表记录已应用的迁移版本，
--    删掉已应用的文件会让 wrangler d1 migrations apply 报
--    "migration 0014 was applied but is missing"。它不会再被执行。

ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN username_normalized TEXT;

UPDATE users
   SET username = email,
       username_normalized = email_normalized
 WHERE email_normalized IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_normalized
  ON users(username_normalized)
  WHERE username_normalized IS NOT NULL;