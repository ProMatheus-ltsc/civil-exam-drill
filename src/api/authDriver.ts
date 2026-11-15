/**
 * 本项目认证装配：把 shared-core 的统一认证接到本项目的 API 客户端上。
 *
 * - 认证状态机、错误语义：shared-core（`@shared/core/auth`）
 * - 传输：本项目的 `api/client.ts`（统一错误信封 + credentials:"same-origin"）
 *
 * 本项目的差异（都在这里消化，共享包不为个别项目塞特例）：
 * - 登录标识是邮箱：登录/注册时把 username 映射成 email 字段
 * - `/auth/me` 返回的是 `{ user: { id, nickname, email } }`，
 *   用户载荷里没有 username，需要从 email 补
 */
import {
  createRestAuthDriver,
  type AuthDriver,
  type AuthUser,
} from "@shared/core/auth";
import { api } from "./client";

/** 后端返回的用户载荷 */
interface AuthUserPayload {
  id: string;
  nickname?: string;
  displayName?: string;
  email?: string;
  username?: string;
  [key: string]: unknown;
}

/**
 * 共享包的默认映射要求 raw.id 存在，且把非标准字段塞进 extra。
 * 本项目的 nickname 是展示名、email 是登录标识，映射如下。
 */
function mapUser(raw: AuthUserPayload): AuthUser {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (["id", "username", "nickname", "displayName", "email"].includes(key)) continue;
    extra[key] = value;
  }
  const username = raw.username ?? raw.email ?? raw.id;
  return {
    id: raw.id,
    // 本项目以邮箱登录，username 取邮箱
    username: String(username),
    displayName: raw.displayName ?? raw.nickname,
    email: raw.email,
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  };
}

/**
 * 请求适配：把共享包统一契约的字段名翻译成本项目后端认的字段名。
 *
 * - 登录：共享包发 `{ username, password }` → 本项目后端认 `{ email, password }`
 * - 注册：共享包发 `{ username, password, email, nickname }`
 *   → 本项目后端认 `{ email, password, nickname }`（email 必填）
 */
async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
  if (body && typeof body.username === "string") {
    const email = typeof body.email === "string" ? body.email : body.username;
    const translated: Record<string, unknown> = { ...body, email };
    // 本项目后端不认 username，只认 email
    delete translated.username;
    return api<T>(path, { ...init, body: JSON.stringify(translated) });
  }
  return api<T>(path, init ?? {});
}

/** 本项目的服务端认证驱动 */
export const restAuthDriver: AuthDriver = createRestAuthDriver({
  basePath: "/auth",
  request: authRequest,
  mapUser,
});
