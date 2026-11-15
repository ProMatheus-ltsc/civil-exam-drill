/**
 * 共享包服务端认证的**真实 SQLite** 测试
 *
 * 为什么要用真 SQLite：之前的 mock DB 只按 SQL 文本匹配返回值，
 * 抓不到 SQL 本身写错的情况。比如 JOIN 查询里 users 与 sessions
 * 都有 id 列，不加表别名 SQLite 会直接报 "ambiguous column name: id"，
 * 而 mock 完全看不出来——线上才发现 /auth/me 500。
 *
 * 这里用 node:sqlite 建**本项目实际 schema**的表与数据，跑共享包的 authDb，
 * 验证 SQL 能真的执行、结果符合预期。
 *
 * 重点：本项目**不改数据库结构**——users 表的登录名归一化列是
 * email_normalized（不是 username_normalized），没有 username 列，
 * 展示名是 nickname。共享包通过 UserShape 声明这个形状，
 * 因此无需 ALTER TABLE 就能对接。
 */
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  createSession,
  deleteSession,
  findUserByUsername,
  insertUser,
  recordAuthAttemptRaw,
  resolveSession,
  touchLastLogin,
  type D1Like,
} from "@shared/core/server/authDb";
import { generateSessionToken, sha256Hex } from "@shared/core/server/authCore";

/** 把 node:sqlite 适配成共享包的 D1Like 接口 */
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

/**
 * 建一套与**本项目实际 schema 一致**的表。
 * 关键点：没有 username / username_normalized 列。
 */
function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      invite_code_id INTEGER NOT NULL DEFAULT 1,
      nickname TEXT NOT NULL,
      nickname_normalized TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL,
      email TEXT,
      email_normalized TEXT,
      password_hash TEXT
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE auth_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_key TEXT NOT NULL,
      succeeded INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

/** 本项目的表形状（与 functions/api/auth.ts 保持一致） */
const CIVIL_USER_SHAPE = {
  usernameColumn: "email_normalized",
  usernameDisplayColumn: null,
  hasStatusColumn: true,
};

/** 本项目 users 表参与读写的额外列 */
const CIVIL_EXTRA_COLUMNS = [
  "email",
  "nickname",
  "nickname_normalized",
  "status",
  "invite_code_id",
];

describe("共享包 authDb（真实 SQLite，按本项目 schema）", () => {
  it("插入用户后可按邮箱查到，且不写 username 列", async () => {
    const d1 = createD1(createDb());
    await insertUser(
      d1,
      {
        id: "usr_1",
        username: "alice@example.com",
        passwordHash: "pbkdf2-sha256$100000$salt$hash",
        extra: {
          email: "alice@example.com",
          nickname: "爱丽丝",
          nickname_normalized: "爱丽丝",
          status: "active",
          invite_code_id: 1,
        },
      },
      { userExtraColumns: CIVIL_EXTRA_COLUMNS, userShape: CIVIL_USER_SHAPE },
    );

    // 表里没有 username / username_normalized 列——插入若引用它们会直接报错
    const columns = await d1
      .prepare("PRAGMA table_info(users)")
      .all<{ name: string }>();
    const names = columns.results.map((row) => row.name);
    expect(names).not.toContain("username");
    expect(names).not.toContain("username_normalized");
    expect(names).toContain("email_normalized");

    const found = await findUserByUsername(d1, "alice@example.com", {
      userExtraColumns: CIVIL_EXTRA_COLUMNS,
      userShape: CIVIL_USER_SHAPE,
    });
    expect(found).not.toBeNull();
    expect(found?.id).toBe("usr_1");
    expect(found?.nickname).toBe("爱丽丝");
    expect(found?.email).toBe("alice@example.com");
  });

  it("会话解析走 JOIN，两表同名列不会引发歧义", async () => {
    const d1 = createD1(createDb());
    await insertUser(
      d1,
      {
        id: "usr_1",
        username: "alice@example.com",
        passwordHash: "hash",
        extra: {
          email: "alice@example.com",
          nickname: "爱丽丝",
          nickname_normalized: "爱丽丝",
          status: "active",
          invite_code_id: 1,
        },
      },
      { userExtraColumns: CIVIL_EXTRA_COLUMNS, userShape: CIVIL_USER_SHAPE },
    );

    const token = generateSessionToken();
    const tokenHash = await sha256Hex(token);
    await createSession(d1, "usr_1", token, {
      userExtraColumns: CIVIL_EXTRA_COLUMNS,
      userShape: CIVIL_USER_SHAPE,
    });

    const session = await resolveSession(d1, token, tokenHash, {
      userExtraColumns: CIVIL_EXTRA_COLUMNS,
      userShape: CIVIL_USER_SHAPE,
    });
    expect(session).not.toBeNull();
    expect(session?.userId).toBe("usr_1");
    // 项目特有列必须带出来（否则 /auth/me 的 nickname / email 是空的）
    expect(session?.user.nickname).toBe("爱丽丝");
    expect(session?.user.email).toBe("alice@example.com");
  });

  it("过期会话被删掉并返回 null", async () => {
    const d1 = createD1(createDb());
    await insertUser(
      d1,
      {
        id: "usr_1",
        username: "alice@example.com",
        passwordHash: "hash",
        extra: {
          email: "alice@example.com",
          nickname: "爱丽丝",
          nickname_normalized: "爱丽丝",
          status: "active",
          invite_code_id: 1,
        },
      },
      { userExtraColumns: CIVIL_EXTRA_COLUMNS, userShape: CIVIL_USER_SHAPE },
    );
    const tokenHash = await sha256Hex("stale");
    await d1
      .prepare(
        "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)",
      )
      .bind("ses_old", "usr_1", tokenHash, "2000-01-01T00:00:00.000Z", new Date().toISOString())
      .run();

    const session = await resolveSession(d1, "stale", tokenHash, {
      userExtraColumns: CIVIL_EXTRA_COLUMNS,
      userShape: CIVIL_USER_SHAPE,
    });
    expect(session).toBeNull();

    const row = await d1
      .prepare("SELECT id FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .first<{ id: string }>();
    expect(row).toBeNull();
  });

  it("status 被禁用时会话立即失效", async () => {
    const d1 = createD1(createDb());
    await insertUser(
      d1,
      {
        id: "usr_1",
        username: "alice@example.com",
        passwordHash: "hash",
        extra: {
          email: "alice@example.com",
          nickname: "爱丽丝",
          nickname_normalized: "爱丽丝",
          status: "active",
          invite_code_id: 1,
        },
      },
      { userExtraColumns: CIVIL_EXTRA_COLUMNS, userShape: CIVIL_USER_SHAPE },
    );
    const token = generateSessionToken();
    const tokenHash = await sha256Hex(token);
    await createSession(d1, "usr_1", token, {
      userExtraColumns: CIVIL_EXTRA_COLUMNS,
      userShape: CIVIL_USER_SHAPE,
    });

    await d1.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind("usr_1").run();

    const session = await resolveSession(d1, token, tokenHash, {
      userExtraColumns: CIVIL_EXTRA_COLUMNS,
      userShape: CIVIL_USER_SHAPE,
    });
    expect(session).toBeNull();
  });

  it("auth_attempts 的 id 是 INTEGER 自增，不能插字符串", async () => {
    const d1 = createD1(createDb());
    // 这一条在旧实现下会报 datatype mismatch（往 rowid 别名里插 TEXT）
    await recordAuthAttemptRaw(d1, "login:abc", false);
    await recordAuthAttemptRaw(d1, "login:abc", true);

    const row = await d1
      .prepare("SELECT client_key, succeeded FROM auth_attempts ORDER BY id")
      .all<{ client_key: string; succeeded: number }>();
    expect(row.results).toHaveLength(2);
    expect(row.results[0].client_key).toBe("login:abc");
  });

  it("登出删掉会话", async () => {
    const d1 = createD1(createDb());
    await insertUser(
      d1,
      {
        id: "usr_1",
        username: "alice@example.com",
        passwordHash: "hash",
        extra: {
          email: "alice@example.com",
          nickname: "爱丽丝",
          nickname_normalized: "爱丽丝",
          status: "active",
          invite_code_id: 1,
        },
      },
      { userExtraColumns: CIVIL_EXTRA_COLUMNS, userShape: CIVIL_USER_SHAPE },
    );
    const token = generateSessionToken();
    const tokenHash = await sha256Hex(token);
    await createSession(d1, "usr_1", token, {
      userExtraColumns: CIVIL_EXTRA_COLUMNS,
      userShape: CIVIL_USER_SHAPE,
    });

    await deleteSession(d1, tokenHash);
    const session = await resolveSession(d1, token, tokenHash, {
      userExtraColumns: CIVIL_EXTRA_COLUMNS,
      userShape: CIVIL_USER_SHAPE,
    });
    expect(session).toBeNull();
  });

  it("更新最后登录时间", async () => {
    const d1 = createD1(createDb());
    await insertUser(
      d1,
      {
        id: "usr_1",
        username: "alice@example.com",
        passwordHash: "hash",
        extra: {
          email: "alice@example.com",
          nickname: "爱丽丝",
          nickname_normalized: "爱丽丝",
          status: "active",
          invite_code_id: 1,
        },
      },
      { userExtraColumns: CIVIL_EXTRA_COLUMNS, userShape: CIVIL_USER_SHAPE },
    );
    await touchLastLogin(d1, "usr_1", {
      userExtraColumns: CIVIL_EXTRA_COLUMNS,
      userShape: CIVIL_USER_SHAPE,
    });
    const row = await d1
      .prepare("SELECT last_login_at FROM users WHERE id = ?")
      .bind("usr_1")
      .first<{ last_login_at: string }>();
    expect(row?.last_login_at).toBeTruthy();
  });
});
