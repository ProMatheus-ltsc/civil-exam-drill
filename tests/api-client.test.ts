/**
 * 接口客户端的韧性契约。
 *
 * 背景：速算一局 10 题 = 取题 10 次 + 提交 10 次，还要叠加预取；国内访问 pages.dev
 * 单次往返 0.7s、冷启动到过 4.8s，手机端偶发把连接掐掉（浏览器抛 `Load failed`）。
 * 只要单次成功率 97%，一局里「至少失败一次」的概率就有四成——用户感受到的是「经常提交失败」。
 *
 * 所以这里锁三件事：
 *   1. 幂等请求遇到网络错误 / 5xx 会自动重试，业务错误（4xx）不重试；
 *   2. 非幂等 POST 绝不自动重放（避免重复写入）；
 *   3. 任何网络层失败都不把 `Load failed` / `Unexpected token <` 这种浏览器术语抛给用户。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";

const okBody = (data: unknown) =>
  JSON.stringify({ success: true, data, error: null });

const failBody = (message: string) =>
  JSON.stringify({ success: false, data: null, error: { message } });

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

const stubFetch = (impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) =>
  vi.stubGlobal("fetch", vi.fn(impl));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api：网络抖动下的重试", () => {
  it("GET 遇到网络错误会重试，第二次成功即返回", async () => {
    const calls: string[] = [];
    stubFetch(async () => {
      calls.push("attempt");
      if (calls.length === 1) throw new TypeError("Load failed");
      return jsonResponse(okBody({ total: 3 }));
    });

    const data = await api<{ total: number }>("/quiz/progress", {
      retryDelayMs: 0,
    });
    expect(data).toEqual({ total: 3 });
    expect(calls).toHaveLength(2);
  });

  it("POST 默认不重放（非幂等），只允许由服务端幂等键兜底的接口手动开启", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      api("/auth/login", { method: "POST", body: "{}", retryDelayMs: 0 }),
    ).rejects.toThrow("网络连接中断，请检查网络后重试");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("声明 idempotent 的 POST 会重试（/quiz/answers 靠 idempotencyKey 去重）", async () => {
    let count = 0;
    stubFetch(async () => {
      count += 1;
      if (count === 1) throw new TypeError("Load failed");
      return jsonResponse(okBody({ correct: true }));
    });

    const result = await api<{ correct: boolean }>("/quiz/answers", {
      method: "POST",
      body: "{}",
      idempotent: true,
      retryDelayMs: 0,
    });
    expect(result).toEqual({ correct: true });
    expect(count).toBe(2);
  });

  it("5xx 属于瞬时故障，幂等请求会再试；4xx 直接失败不浪费往返", async () => {
    let count = 0;
    stubFetch(async () => {
      count += 1;
      return count === 1
        ? new Response("<html>bad gateway</html>", { status: 502 })
        : jsonResponse(okBody("done"));
    });
    await expect(
      api<string>("/quiz/questions", { method: "POST", idempotent: true, retryDelayMs: 0 }),
    ).resolves.toBe("done");

    const fetchMock = vi.fn(async () => jsonResponse(failBody("题目已过期"), 410));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      api("/quiz/answers", { method: "POST", idempotent: true, retryDelayMs: 0 }),
    ).rejects.toThrow("题目已过期");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("重试耗尽后给出中文文案，而不是浏览器的 Load failed", async () => {
    stubFetch(async () => {
      throw new TypeError("Load failed");
    });
    await expect(
      api("/quiz/questions", {
        method: "POST",
        idempotent: true,
        attempts: 3,
        retryDelayMs: 0,
      }),
    ).rejects.toThrow(/网络连接中断/);
  });

  it("网关返回 HTML 错误页时归一成状态码文案，不会吐出 JSON 解析异常", async () => {
    stubFetch(async () => new Response("<html>524 timeout</html>", { status: 524 }));
    await expect(
      api("/quiz/questions", { method: "POST", idempotent: true, attempts: 1 }),
    ).rejects.toThrow("服务暂时不可用（524），请稍后重试");
  });

  it("超时会中止请求并提示重试", async () => {
    stubFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    await expect(
      api("/quiz/questions", {
        method: "POST",
        idempotent: true,
        attempts: 1,
        timeoutMs: 20,
      }),
    ).rejects.toThrow("请求超时");
  });

  it("业务错误原样透出服务端文案（用户需要知道是「已提交」还是「已过期」）", async () => {
    stubFetch(async () => jsonResponse(failBody("该题已提交"), 409));
    await expect(
      api("/quiz/answers", { method: "POST", idempotent: true }),
    ).rejects.toThrow("该题已提交");
  });
});
