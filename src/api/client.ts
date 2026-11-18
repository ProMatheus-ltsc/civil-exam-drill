/**
 * 统一的接口客户端。
 *
 * 为什么不是「fetch + 报错弹 toast」这么简单：
 * 站点跑在 Pages Functions 上，国内访问时单次往返实测 0.7s，冷启动能到 5s；
 * 手机端（iOS Safari / 微信）在这条链路上经常直接抛出 `Load failed` / `Failed to fetch`——
 * 那是**网络层中断**，不是业务错误。速算一局 10 题 = 取题 10 次 + 提交 10 次（还要叠加预取），
 * 单次成功率 97% 时一局里「至少失败一次」的概率就有四成，用户看到的就是「经常提交失败」。
 *
 * 所以这里做三件事：
 *   1. **超时**：默认 20s，避免请求无声挂死；
 *   2. **幂等重试**：GET/HEAD 天然幂等，POST 需服务端支持幂等键（由调用方显式声明）；
 *      网络错误与 5xx 退避重试，4xx 业务错误不重试；
 *   3. **文案归一**：把 `Load failed` 这类浏览器术语换成用户能理解的中文。
 */
export type ApiOptions = RequestInit & {
  /**
   * 幂等请求：网络失败 / 5xx 时自动重试。
   * POST 只有在服务端保证「同一请求重放不会产生副作用」时才能置 true
   * （如 `/quiz/answers` 靠 idempotencyKey、`/quiz/questions` 靠 runId+index）。
   */
  idempotent?: boolean;
  /** 单次尝试超时，默认 20s */
  timeoutMs?: number;
  /** 最多尝试次数（首次 + 重试），默认 3；仅幂等请求生效 */
  attempts?: number;
  /** 重试退避基数，默认 400ms（指数退避）；测试里传 0 */
  retryDelayMs?: number;
};

type Envelope<T> = {
  success: boolean;
  data: T;
  error: { message: string } | null;
};

/** 浏览器原生的网络失败文案对用户没有意义，统一换掉 */
const NETWORK_ERROR = "网络连接中断，请检查网络后重试";
const TIMEOUT_ERROR = "请求超时，请稍后重试";

/**
 * 网络层失败（断网 / 超时 / 连接被重置）。
 * 调用方据此区分「可以原样重试」与「业务错误（如该题已提交）不该重试」。
 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

const wait = (ms: number) =>
  ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

function describeStatus(status: number): string {
  if (status === 429) return "请求过于频繁，请稍后重试";
  if (status >= 500) return `服务暂时不可用（${status}），请稍后重试`;
  return `请求失败（${status}）`;
}

export async function api<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const {
    idempotent,
    timeoutMs = 20_000,
    attempts = 3,
    retryDelayMs = 400,
    ...init
  } = options;
  const method = (init.method ?? "GET").toUpperCase();
  const canRetry = idempotent ?? (method === "GET" || method === "HEAD");
  const maxAttempts = canRetry ? Math.max(1, Math.min(attempts, 4)) : 1;

  const headers = new Headers(options.headers);
  if (options.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) await wait(retryDelayMs * 2 ** (attempt - 1));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // 调用方自己的 signal 也要能中止（如页面卸载）
    const external = options.signal;
    const relayAbort = () => controller.abort();
    external?.addEventListener("abort", relayAbort);

    let response: Response;
    try {
      response = await fetch(`/api${path}`, {
        ...init,
        credentials: "same-origin",
        headers,
        signal: controller.signal,
      });
    } catch {
      // fetch 在连接被重置 / 超时中止 / 离线时都会 reject，区分只剩 signal 状态
      if (external?.aborted) throw new DOMException("Aborted", "AbortError");
      lastError = new NetworkError(controller.signal.aborted ? TIMEOUT_ERROR : NETWORK_ERROR);
      if (attempt < maxAttempts - 1) continue;
      break;
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", relayAbort);
    }

    const timedOut = controller.signal.aborted;

    let raw = "";
    try {
      raw = await response.text();
    } catch {
      // 响应读到一半连接断了，按网络错误处理
      lastError = new NetworkError(NETWORK_ERROR);
      if (attempt < maxAttempts - 1) continue;
      break;
    }

    let payload: Envelope<T> | null = null;
    if (raw) {
      try {
        payload = JSON.parse(raw) as Envelope<T>;
      } catch {
        // 网关错误页（502/504 常返回 HTML）或代理注入的页面
        payload = null;
      }
    }

    if (!payload) {
      lastError = timedOut
        ? new NetworkError(TIMEOUT_ERROR)
        : new Error(describeStatus(response.status));
      // 5xx 多半是瞬时故障，幂等请求值得再试一次；4xx 没有意义
      if (response.status >= 500 && attempt < maxAttempts - 1) continue;
      throw lastError;
    }

    if (!response.ok || !payload.success) {
      lastError = new Error(
        payload.error?.message ?? describeStatus(response.status),
      );
      if (response.status >= 500 && attempt < maxAttempts - 1) continue;
      throw lastError;
    }

    return payload.data;
  }

  throw lastError ?? new Error(describeStatus(0));
}
