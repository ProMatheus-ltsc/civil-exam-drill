/**
 * 登录态恢复回归测试（前端装配层）
 *
 * ## 这次修的是什么
 *
 * 2026-11-15 线上报：「点开申论知识库，登录账号直接被弹出来」。
 *
 * 根因不在申论知识库本身，而在**认证装配层读错了 /auth/me 的响应形状**：
 *
 * - 后端 `/auth/me` 返回 `{ user: { id, nickname, email }, expiresAt }`——
 *   用户被包在 `user` 层里，**顶层没有 `id`**；
 * - 共享包的 REST 驱动判断「有没有登录态」看的是载荷顶层有没有 `id`；
 * - 于是 `restore()` 恒返回 null → AuthProvider 把状态机置为 `login`
 *   → 用户被弹回登录页。
 *
 * 为什么「点申论知识库」才触发：知识库条目是 `target="_blank"` 的深链，
 * 新标签页会**重新挂载 App**（重新探测会话）。旧标签页的登录态还在内存里，
 * 所以不点新标签页就看不出问题；一点新标签页，新标签页探测失败 → 像是被踢下线。
 *
 * ## 这个测试锁住什么
 *
 * 1. 后端 `/auth/me` 的响应形状是「顶层无 id、用户在 user 层」——
 *    把契约钉死，防止有人把后端改成另一种形状；
 * 2. 前端装配层（`src/api/authDriver.ts`）拿到这个形状后，
 *    **共享包的驱动必须能恢复出登录用户**（而不是返回 null）。
 *
 * 第 2 条是真正防回归的那条：它跑的是**生产用的同一个驱动**，
 * 以后共享包再改 `restore()` 的判空逻辑，这里会立刻红。
 */
import { afterEach, describe, expect, it } from "vitest";

import { app } from "../functions/api/[[path]]";
import { restAuthDriver } from "../src/api/authDriver";

/**
 * 最小 D1 mock：只需支撑两条查询
 * - 共享包 `resolveSession`：sessions JOIN users，按 token_hash 命中
 * - 后端 `/auth/me`：SELECT expires_at FROM sessions WHERE token_hash=?
 *
 * 注意：D1 的 `prepare(sql)` 拿 SQL，`first()` 不带参数——
 * 所以 SQL 必须在 prepare 时捕获，不能在 first 里现取。
 */
function sessionEnv() {
  const db = {
    prepare(sql: string) {
      const statement = {
        values: [] as unknown[],
        bind(...values: unknown[]) {
          statement.values = values;
          return statement;
        },
        async first<T>() {
          const flat = sql.replace(/\s+/g, " ");
          if (flat.includes("FROM sessions s JOIN users u")) {
            return {
              session_id: "ses_test",
              user_id: "usr_test",
              token_hash: String(statement.values[0] ?? ""),
              expires_at: "2099-01-01T00:00:00.000Z",
              id: "usr_test",
              email_normalized: "test@example.com",
              password_hash: "pbkdf2-sha256$100000$abc$def",
              created_at: "2026-01-01T00:00:00.000Z",
              last_login_at: "2026-01-01T00:00:00.000Z",
              email: "test@example.com",
              nickname: "测试用户",
              nickname_normalized: "测试用户",
              status: "active",
              invite_code_id: 1,
            } as T;
          }
          if (flat.includes("FROM sessions WHERE token_hash=?")) {
            return { expiresAt: "2099-01-01T00:00:00.000Z" } as T;
          }
          return null;
        },
        async all<T>() {
          return { results: [] as T[] };
        },
        async run() {
          return { success: true };
        },
      };
      return statement;
    },
  };
  return { DB: db };
}

/**
 * 把前端的 `fetch('/api/...')` 接到真实 Hono app 上，
 * 这样测试跑的就是**生产用的那条链路**（api/client → authDriver → 共享包驱动）。
 */
function useApiOverHono() {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://civil-exam-drill.test");
    const headers = new Headers(init?.headers);
    // 带上会话 Cookie，模拟浏览器里的登录态
    headers.set("cookie", "civil_exam_session=test-session");
    const response = await app.request(
      url.pathname + url.search,
      { ...init, headers },
      sessionEnv(),
    );
    return response as unknown as Response;
  }) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = original;
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const originalFetch = globalThis.fetch;

describe("登录态恢复：/auth/me 响应形状契约", () => {
  it("后端 /auth/me 把用户包在 user 层里（顶层没有 id）", async () => {
    const response = await app.request(
      "/api/auth/me",
      { headers: { cookie: "civil_exam_session=test-session" } },
      sessionEnv(),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    // 顶层：user 层 + 过期时间，没有 id
    expect(payload.data.user).toMatchObject({
      id: "usr_test",
      nickname: "测试用户",
      email: "test@example.com",
    });
    expect(payload.data.expiresAt).toBeTruthy();
    expect(payload.data.id).toBeUndefined();
  });

  it("共享包驱动能从该形状恢复出登录用户（回归：曾恒返回 null 把用户踢下线）", async () => {
    const restore = useApiOverHono();
    try {
      // 走生产用的同一个驱动；它内部会请求 /api/auth/me
      const user = await restAuthDriver.restore();
      expect(user).not.toBeNull();
      expect(user?.id).toBe("usr_test");
      expect(user?.username).toBe("test@example.com");
      expect(user?.displayName).toBe("测试用户");
    } finally {
      restore();
    }
  });
});
