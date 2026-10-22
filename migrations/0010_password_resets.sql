PRAGMA foreign_keys = ON;

-- 忘记密码：只保存重置令牌的 SHA-256，令牌本身仅出现在邮件链接中。
CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_password_resets_user ON password_resets(user_id, expires_at DESC);
CREATE INDEX idx_password_resets_expiry ON password_resets(expires_at);
