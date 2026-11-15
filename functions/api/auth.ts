/**
 * 认证实现 —— 收归 @shared/core 的统一认证。
 *
 * 共享包提供标准实现（哈希、会话、Cookie、限流表操作），本文件只做
 * "本项目特有的那部分"：
 * - 登录标识是邮箱（共享包统一用 username，这里把 email 同时写入
 *   username / username_normalized 两个列，登录名归一化列因此可直接用共享包）
 * - 昵称在邀请码范围内唯一（`uniqueNickname`）
 * - 密码重置邮件走 Resend
 * - 密码重置链接指向 `/#/reset?token=...`
 *
 * 表结构与共享包统一契约一致（见 migrations/0014_unified_auth.sql）：
 *   users(id, username, username_normalized, password_hash, created_at, last_login_at, ...)
 *   sessions(id, user_id, token_hash, expires_at, created_at)
 *   auth_attempts(id, client_key, succeeded, created_at)
 */
import {
  authOk,
  authFail,
  buildCookie,
  buildClearCookie,
  generateSessionToken,
  getDummyPasswordHash,
  hashPassword,
  isSecureRequest,
  readCookie,
  sha256Hex,
  verifyPassword,
  AUTH_CODES,
} from "@shared/core/server/authCore";
import {
  createSession as sharedCreateSession,
  deleteSession as sharedDeleteSession,
  findUserByUsername,
  insertUser as sharedInsertUser,
  recordAuthAttemptRaw,
  resolveSession as sharedResolveSession,
  touchLastLogin as sharedTouchLastLogin,
  DEFAULT_USER_SHAPE,
  type D1Like,
} from "@shared/core/server/authDb";

/** 响应信封（与本项目其它接口一致） */
export const ok = <T>(data: T) => ({ success: true as const, data, error: null });
export const fail = (code: string, message: string, details?: unknown) => ({
  success: false as const,
  data: null,
  error: { code, message, ...(details === undefined ? {} : { details }) },
});

/** 会话 Cookie 名 */
export const SESSION_COOKIE = "civil_exam_session";

/** 密码重置令牌有效期（分钟） */
export const RESET_TOKEN_MINUTES = 30;

/** 本项目的 D1 句柄与共享包的最小接口兼容 */
type Db = { prepare(sql: string): any };

/** 共享包的 D1Like 适配（本项目 Statement 接口与 D1Like 结构一致） */
function asD1(db: Db): D1Like {
  return db as unknown as D1Like;
}

/** users 表的项目特有列（共享包按 extraColumns 参与读写） */
const USER_EXTRA_COLUMNS = [
  "email",
  "nickname",
  "nickname_normalized",
  "status",
  "invite_code_id",
];

/**
 * 本项目的 users 表形状：
 * - 有 status 列（'active'/'disabled'）—— 禁用账户的会话立即失效
 */
const USER_SHAPE = { ...DEFAULT_USER_SHAPE, hasStatusColumn: true };

// ==================== 会话 ====================

/** 创建会话：token 只在 Cookie 里出现，库里只存 sha256 */
export async function createSession(
  db: Db,
  userId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = generateSessionToken();
  const { expiresAt } = await sharedCreateSession(
    asD1(db),
    userId,
    token,
    {
      sessionDays: 30,
      maxSessionsPerUser: 20,
      userExtraColumns: USER_EXTRA_COLUMNS,
      userShape: USER_SHAPE,
    },
  );
  return { token, expiresAt };
}

/** 解析会话：token → 会话与用户（过期即删行） */
export async function resolveSession(db: Db, token: string | undefined) {
  const tokenHash = await sha256Hex(token ?? "");
  return sharedResolveSession(asD1(db), token, tokenHash, {
    userExtraColumns: USER_EXTRA_COLUMNS,
    userShape: USER_SHAPE,
  });
}

/** 删除会话（登出） */
export async function deleteSessionByToken(db: Db, tokenHash: string): Promise<void> {
  await sharedDeleteSession(asD1(db), tokenHash);
}

/** 写会话 Cookie */
export function sessionCookieHeader(token: string, request: Request): string {
  return buildCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "Strict",
    path: "/",
    maxAge: 30 * 86400,
  });
}

/** 清会话 Cookie */
export function clearSessionCookieHeader(request: Request): string {
  return buildClearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "Strict",
    path: "/",
  });
}

/** 从请求读会话 token */
export function readSessionToken(request: Request): string | undefined {
  return readCookie(request, SESSION_COOKIE);
}

// ==================== 用户 ====================

/** 查用户（按 username_normalized，即邮箱） */
export async function findUser(db: Db, email: string) {
  return findUserByUsername(asD1(db), email, {
    userExtraColumns: USER_EXTRA_COLUMNS,
    userShape: USER_SHAPE,
  });
}

/** 插入用户 */
export async function insertUser(
  db: Db,
  user: {
    id: string;
    email: string;
    nickname: string;
    passwordHash: string;
    inviteCodeId: number;
  },
): Promise<void> {
  await sharedInsertUser(
    asD1(db),
    {
      id: user.id,
      username: user.email,
      passwordHash: user.passwordHash,
      extra: {
        email: user.email,
        nickname: user.nickname,
        // 邀请码范围内昵称唯一（users 表有 nickname_normalized 唯一约束）
        nickname_normalized: user.nickname.toLocaleLowerCase("zh-CN"),
        status: "active",
        invite_code_id: user.inviteCodeId,
      },
    },
    { userExtraColumns: USER_EXTRA_COLUMNS, userShape: USER_SHAPE },
  );
}

/** 更新最后登录时间 */
export async function touchLastLogin(db: Db, userId: string): Promise<void> {
  await sharedTouchLastLogin(asD1(db), userId, {
    userExtraColumns: USER_EXTRA_COLUMNS,
    userShape: USER_SHAPE,
  });
}

/** 校验密码（常量时间比较；兼容历史哈希格式） */
export async function checkPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  return verifyPassword(password, stored);
}

/** 生成密码哈希 */
export async function makePasswordHash(password: string): Promise<string> {
  return hashPassword(password);
}

/** 哑元哈希：用户不存在时也跑一次 PBKDF2，降低邮箱枚举价值 */
export async function dummyPasswordHash(): Promise<string> {
  return getDummyPasswordHash();
}

// ==================== 限流 ====================

/** 检查是否超过限流阈值 */
export async function authAttemptsExceeded(
  db: Db,
  clientKey: string,
  limit: number,
  failuresOnly = false,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM auth_attempts WHERE client_key=? AND created_at>datetime('now','-10 minutes')${failuresOnly ? " AND succeeded=0" : ""}`,
    )
    .bind(clientKey)
    .first();
  const count = (row as { count?: number } | null)?.count ?? 0;
  return count >= limit;
}

/** 记录一次认证尝试（client_key 已含 scope 前缀，原样写入） */
export async function recordAuthAttempt(
  db: Db,
  clientKey: string,
  succeeded: boolean,
): Promise<void> {
  await recordAuthAttemptRaw(asD1(db), clientKey, succeeded);
}

// ==================== 重置令牌 ====================

/** 生成重置令牌（base64url，32 字节） */
export function resetToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export { authOk, authFail, AUTH_CODES, sha256Hex };
