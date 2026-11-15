/**
 * 本项目认证装配：把 shared-core 的统一认证接到本项目的 API 客户端上。
 *
 * - 认证状态机、错误语义：shared-core（`@shared/core/auth`）
 * - 传输：本项目的 `api/client.ts`（统一错误信封 + credentials:"same-origin"）
 *
 * 本项目的差异（都在这里消化，共享包不为个别项目塞特例）：
 * - 登录标识是邮箱：登录/注册时把 username 映射成 email 字段
 * - `/auth/me` 返回的是 `{ user: { id, nickname, email }, expiresAt }`，
 *   用户被包在 `user` 层里；共享包的 REST 驱动默认读**裸**用户对象，
 *   所以这里先把 `user` 层拆开再交给驱动。
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
 * 拆掉 `{ user: {...} }` 外层，返回裸用户对象。
 *
 * **为什么必须拆**：共享包的 REST 驱动判断「有没有登录态」看的是
 * 载荷顶层有没有 `id`。本项目后端把用户包在 `user` 里，顶层没有 `id`
 * → 驱动认为「未登录」→ AuthProvider 把状态机置为 `login`
 * → **用户被弹回登录页**（症状：点开新标签页里的申论知识库后，
 * 新标签页重新探测会话失败，看起来像「被踢下线」）。
 *
 * 只在确实是 `{ user: { id } }` 形状时才拆；裸用户对象原样返回。
 */
function unwrapUserEnvelope<T>(payload: T): T {
  if (!payload || typeof payload !== "object") return payload;
  const envelope = payload as { user?: AuthUserPayload };
  if (envelope.user && typeof envelope.user === "object" && envelope.user.id)
    return envelope.user as unknown as T;
  return payload;
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
 * - 响应：本项目后端把用户包在 `{ user }` 里，拆开后再交给驱动
 */
async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
  if (body && typeof body.username === "string") {
    const email = typeof body.email === "string" ? body.email : body.username;
    const translated: Record<string, unknown> = { ...body, email };
    // 本项目后端不认 username，只认 email
    delete translated.username;
    return unwrapUserEnvelope(
      await api<T>(path, { ...init, body: JSON.stringify(translated) }),
    );
  }
  return unwrapUserEnvelope(await api<T>(path, init ?? {}));
}

/** 本项目的服务端认证驱动 */
export const restAuthDriver: AuthDriver = createRestAuthDriver({
  basePath: "/auth",
  request: authRequest,
  mapUser,
});
