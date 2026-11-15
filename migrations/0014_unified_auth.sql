PRAGMA foreign_keys = ON;

-- 统一认证表结构：补齐 shared-core 统一契约要求的 username_normalized 列。
--
-- 背景：本项目原先以 email_normalized 作为登录名归一化列，shared-core 的
-- 统一认证契约统一使用 username_normalized（登录名归一化列）。为让本项目
-- 能直接用共享包的 authDb（不必在包内为个别项目塞特例），这里补一列并
-- 从已有 email 回填：
--   - username_normalized = email_normalized（登录标识不变，老用户无需改密码）
--   - username            = email（展示名沿用邮箱）
--
-- 保留 email / email_normalized / nickname / status 等原有列，它们作为
-- 项目特有列通过 userExtraColumns 参与读写。

ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN username_normalized TEXT;

UPDATE users
   SET username = email,
       username_normalized = email_normalized
 WHERE email_normalized IS NOT NULL;

-- 历史邀请码用户（无邮箱、无法登录）不参与统一登录名，保持为空
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_normalized
  ON users(username_normalized)
  WHERE username_normalized IS NOT NULL;
