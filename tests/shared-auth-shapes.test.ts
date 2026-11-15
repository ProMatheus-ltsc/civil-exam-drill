/**
 * 共享包服务端认证的**表形状适配**测试（真实 SQLite）
 *
 * 共享包要能在**不改消费方数据库**的前提下对接既有 schema。
 * 这里用几种真实存在的表形状验证：
 *
 * 1. 标准形状        —— username / username_normalized
 * 2. 邮箱形状        —— email（COLLATE NOCASE）/ display_name / 无 username 列
 * 3. 独立盐列形状    —— salt 单独成列，且盐是 base64url
 * 4. 无 id 列的会话表 —— token_hash 直接作主键
 *
 * 这些形状来自真实的消费项目，每加一种都要保证
 * 「存量用户仍能登录、且不需要 ALTER TABLE」。
 */
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  createSession,
  findUserByUsername,
  insertUser,
  resolveSession,
  type D1Like,
} from "@shared/core/server/authDb";
import {
  fromBase64Url,
  generateSessionToken,
  sha256Hex,
  toBase64Url,
  verifyPassword,
} from "@shared/core/server/authCore";

function createD1(db: DatabaseSync): D1Like {
  return {
    prepare(query: string) {
      const statement = db.prepare(query);
      const run = (...values: unknown[]) => statement.run(...(values as never[]));
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              run(...values);
              return { success: true };
            },
            async first<T>() {
              return (statement.get(...(values as never[])) as T | undefined) ?? null;
            },
            async all<T>() {
              return { results: statement.all(...(values as never[])) as T[] };
            },
          };
        },
        async run() {
          run();
          return { success: true };
        },
        async first<T>() {
          return (statement.get() as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: statement.all() as T[] };
        },
      };
    },
  } as unknown as D1Like;
}

/** 邮箱形状：登录名是 email（大小写不敏感），展示名 display_name，无 username 列 */
function createEmailShapedDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL DEFAULT 100000,
      display_name TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      verified_at TEXT,
      last_login_at TEXT
    );
    CREATE UNIQUE INDEX ux_users_email ON users(email);
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      user_agent TEXT,
      ip_hash TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  return db;
}

const EMAIL_SHAPE = {
  usernameColumn: "email",
  usernameDisplayColumn: "display_name",
  saltColumn: "password_salt",
  saltEncoding: "base64url" as const,
  usernameNormalization: "none" as const,
  hasLastLoginAt: true,
  hasStatusColumn: true,
};

const EMAIL_EXTRA_COLUMNS = ["email", "display_name", "email_verified", "status"];

describe("共享包 authDb：表形状适配（不改消费方数据库）", () => {
  it("邮箱形状：插入后能按邮箱查到，且不引用 username 列", async () => {
    const db = createEmailShapedDb();
    const d1 = createD1(db);

    const columns = await d1.prepare("PRAGMA table_info(users)").all<{ name: string }>();
    const names = columns.results.map((row) => row.name);
    expect(names).not.toContain("username");
    expect(names).not.toContain("username_normalized");
    expect(names).toContain("email");
    expect(names).toContain("password_salt");

    await insertUser(
      d1,
      {
        id: "usr_1",
        username: "alice@example.com",
        displayName: "爱丽丝",
        passwordHash: "hash-value",
        salt: "c2FsdA",
        extra: {
          email: "alice@example.com",
          email_verified: 1,
          status: "active",
        },
      },
      { userExtraColumns: EMAIL_EXTRA_COLUMNS, userShape: EMAIL_SHAPE },
    );

    const found = await findUserByUsername(d1, "alice@example.com", {
      userExtraColumns: EMAIL_EXTRA_COLUMNS,
      userShape: EMAIL_SHAPE,
    });
    expect(found?.id).toBe("usr_1");
    expect(found?.display_name).toBe("爱丽丝");
  });

  it("邮箱形状：会话表无 id 列也能建会话并解析", async () => {
    const db = createEmailShapedDb();
    const d1 = createD1(db);

    await insertUser(
      d1,
      {
        id: "usr_1",
        username: "alice@example.com",
        displayName: "爱丽丝",
        passwordHash: "hash-value",
        salt: "c2FsdA",
        extra: {
          email: "alice@example.com",
          email_verified: 1,
          status: "active",
        },
      },
      { userExtraColumns: EMAIL_EXTRA_COLUMNS, userShape: EMAIL_SHAPE },
    );

    const token = generateSessionToken();
    const tokenHash = await sha256Hex(token);
    await createSession(d1, "usr_1", token, {
      userExtraColumns: EMAIL_EXTRA_COLUMNS,
      userShape: EMAIL_SHAPE,
      sessionShape: {
        hasIdColumn: false,
        extraColumns: ["user_agent", "ip_hash"],
        extraValues: { user_agent: "jest", ip_hash: "ip" },
      },
    });

    // token_hash 是主键，没有 id 列
    const row = await d1
      .prepare("SELECT token_hash, user_agent FROM sessions WHERE user_id = ?")
      .bind("usr_1")
      .first<{ token_hash: string; user_agent: string }>();
    expect(row?.user_agent).toBe("jest");

    const session = await resolveSession(d1, token, tokenHash, {
      userExtraColumns: EMAIL_EXTRA_COLUMNS,
      userShape: EMAIL_SHAPE,
      sessionShape: { hasIdColumn: false },
    });
    expect(session?.userId).toBe("usr_1");
    expect(session?.user.display_name).toBe("爱丽丝");
  });

  it("邮箱形状：status 禁用后会话立即失效", async () => {
    const db = createEmailShapedDb();
    const d1 = createD1(db);
    await insertUser(
      d1,
      {
        id: "usr_1",
        username: "alice@example.com",
        passwordHash: "hash-value",
        salt: "c2FsdA",
        extra: {
          email: "alice@example.com",
          display_name: "爱丽丝",
          email_verified: 1,
          status: "active",
        },
      },
      { userExtraColumns: EMAIL_EXTRA_COLUMNS, userShape: EMAIL_SHAPE },
    );
    const token = generateSessionToken();
    const tokenHash = await sha256Hex(token);
    await createSession(d1, "usr_1", token, {
      userExtraColumns: EMAIL_EXTRA_COLUMNS,
      userShape: EMAIL_SHAPE,
      sessionShape: { hasIdColumn: false },
    });

    await d1.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind("usr_1").run();

    const session = await resolveSession(d1, token, tokenHash, {
      userExtraColumns: EMAIL_EXTRA_COLUMNS,
      userShape: EMAIL_SHAPE,
      sessionShape: { hasIdColumn: false },
    });
    expect(session).toBeNull();
  });

  it("base64url 盐 + 摘要的历史格式能校验（存量用户无需重置密码）", async () => {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode("oldpass"),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
      key,
      256,
    );
    const digest = toBase64Url(new Uint8Array(bits));
    const saltText = toBase64Url(salt);

    await expect(verifyPassword("oldpass", digest, saltText, "base64url")).resolves.toBe(true);
    await expect(verifyPassword("wrong", digest, saltText, "base64url")).resolves.toBe(false);
  });

  it("base64url 编解码互逆", () => {
    const bytes = new Uint8Array([251, 255, 190, 0, 1]);
    const text = toBase64Url(bytes);
    expect(text).not.toContain("+");
    expect(text).not.toContain("/");
    expect(text).not.toContain("=");
    expect(Array.from(fromBase64Url(text))).toEqual(Array.from(bytes));
  });
});
