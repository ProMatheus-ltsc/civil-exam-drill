import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 会话过期判断的回归测试。
 *
 * 判断逻辑已下沉到 @shared/core/server/authDb（resolveSession），
 * 因此这里同时检查共享包实现与本项目的接入点：
 * - 共享包用 ISO 字符串比较（Date.parse），不是 CURRENT_TIMESTAMP——
 *   SQLite 的 CURRENT_TIMESTAMP 是 'YYYY-MM-DD HH:MM:SS'（UTC、无时区标记），
 *   与 ISO 字符串（'YYYY-MM-DDTHH:MM:SS.sssZ'）字典序比较会出错。
 * - 本项目不再有自建 SQL，但仍在使用共享包的 resolveSession。
 */
const sharedSource = readFileSync(
  new URL("../../shared-core/src/server/authDb.ts", import.meta.url),
  "utf8",
).replace(/\s+/g, "");

const projectSource = readFileSync(
  new URL("../functions/api/[[path]].ts", import.meta.url),
  "utf8",
).replace(/\s+/g, "");

describe("session expiry", () => {
  it("shared package compares expiry as ISO timestamps, not CURRENT_TIMESTAMP", () => {
    // 过期判断用 Date.parse + Date.now（毫秒精度、时区无关）
    expect(sharedSource).toContain("Date.parse(expiresAt)");
    expect(sharedSource).toContain("expiry<=Date.now()");
    // 不能退回 SQLite 的 CURRENT_TIMESTAMP 字符串比较
    expect(sharedSource).not.toContain("CURRENT_TIMESTAMP");
  });

  it("project delegates session resolution to the shared package", () => {
    expect(projectSource).toContain("resolveSession(c.env.DB,token)");
    expect(projectSource).not.toContain("julianday(s.expires_at)");
  });
});
