PRAGMA foreign_keys = ON;

-- 邮箱注册登录：邮箱作为唯一登录标识，密码只保存 PBKDF2 哈希。
-- 历史邀请码用户保留在原表中（email/password_hash 为空，无法再登录）。
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_normalized TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;

CREATE UNIQUE INDEX idx_users_email_normalized
  ON users(email_normalized)
  WHERE email_normalized IS NOT NULL;

-- 邮箱注册用户统一挂在该占位邀请码下，避免重建 users 表破坏历史外键。
INSERT OR IGNORE INTO invite_codes(code_hash, label, enabled)
  VALUES ('email-signup', 'email-signup', 1);

-- 改为仅邮箱登录：邀请码时代的历史会话全部失效。
DELETE FROM sessions
  WHERE user_id IN (SELECT id FROM users WHERE email_normalized IS NULL);
