/**
 * 作答上报队列的契约。
 *
 * 答题改成「本地判分 + 后台记账」后，队列必须保证三件事：
 *   1. 网络失败**保留**（下次进页面 / 网络恢复补传）；
 *   2. 成功则出队，不重复上报；
 *   3. 业务错（该题已提交、已过期）直接丢弃——留着永远不会成功，还会堵住后面的作答。
 *
 * 第 3 条尤其容易写错：如果只按「失败就留」，一题过期就会让整个队列永远卡住。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueAnswer,
  drainAnswers,
  flushAnswers,
  pendingAnswers,
} from "../src/api/answerQueue";

const KEY = "quiz.pendingAnswers.v1";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const okBody = (data: unknown) =>
  JSON.stringify({ success: true, data, error: null });
const failBody = (message: string) =>
  JSON.stringify({ success: false, data: null, error: { message } });

const answerItem = (index = 0) => ({
  questionId: `q-${index}`,
  selectedIndex: 1,
  elapsedMs: 8000,
  idempotencyKey: `00000000-0000-4000-8000-00000000000${index}`,
});

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("localStorage", {
    getItem: storage.getItem,
    setItem: storage.setItem,
    removeItem: storage.removeItem,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("作答上报队列", () => {
  it("网络中断时保留在队列里，等下次补传", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // 浏览器在连接被掐断时抛的就是这个（Safari 是 Load failed）
        throw new TypeError("Load failed");
      }),
    );
    enqueueAnswer(answerItem(0));
    await flushAnswers();
    expect(pendingAnswers()).toHaveLength(1);
    expect(storage.data.get(KEY)).toContain("q-0");
  });

  it("上报成功后清空队列，不重复发送", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls.push("post");
        return new Response(
          okBody({ correct: true, answerIndex: 1, explanation: "解析", run: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    enqueueAnswer(answerItem(1));
    await flushAnswers();
    expect(pendingAnswers()).toHaveLength(0);
    // 再清一次队列不该重复发送
    await flushAnswers();
    expect(calls).toHaveLength(1);
  });

  /**
   * 回归：**在途请求期间新入队的作答不能被本轮出队覆盖**。
   *
   * 原实现把队列读进局部数组后，每发完一条就 `write(items)` 把整份快照写回 localStorage。
   * 用户连答时（一题几秒、一次往返 0.3~1s）下一条必定在这段时间入队，而 flush 手里的是
   * 旧快照 —— 写回那一刻就把新作答抹掉了。症状正是用户看到的「答完 10 题，刷新后只有 9 题、
   * 星级归零」（runStars 要求 total≥10，少一条就整局不算）。
   */
  it("请求在途时新入队的作答不会被本轮出队覆盖", async () => {
    const calls: string[] = [];
    let release: (() => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { questionId: string };
        calls.push(body.questionId);
        if (body.questionId === "q-0") {
          // 模拟一次跨境往返：第一题还在路上时，用户已经答了第二题
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return new Response(
          okBody({ correct: true, answerIndex: 1, explanation: "解析", run: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    enqueueAnswer(answerItem(0));
    await vi.waitFor(() => expect(calls).toEqual(["q-0"]));
    enqueueAnswer(answerItem(1));
    expect(pendingAnswers().map((item) => item.questionId)).toContain("q-1");
    release?.();

    await flushAnswers();
    expect(calls).toEqual(["q-0", "q-1"]);
    expect(pendingAnswers()).toHaveLength(0);
  });

  it("连答 10 题（每题都在上次请求在途时到达）全部上报，一条都不能丢", async () => {
    const posted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { questionId: string };
        posted.push(body.questionId);
        // 每一条都慢一点：答题速度总是快于跨境往返
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        return new Response(
          okBody({ correct: true, answerIndex: 1, explanation: "解析", run: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    for (let index = 0; index < 10; index += 1) {
      enqueueAnswer(answerItem(index));
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
    await flushAnswers();
    expect(new Set(posted).size, `上报了 ${posted.length} 条：${posted.join(",")}`).toBe(10);
    expect(pendingAnswers()).toHaveLength(0);
  });

  it("业务错（该题已提交 / 已过期）直接出队，不堵住后面的作答", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(failBody("该题已提交"), {
            status: 409,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    enqueueAnswer(answerItem(2));
    enqueueAnswer(answerItem(3));
    await flushAnswers();
    // 两条都是业务错：都丢掉，不能留下来永远重试
    expect(pendingAnswers()).toHaveLength(0);
  });

  it("drainAnswers 会跨轮重试：一条撞上网络错误也不会被留在队列里", async () => {
    const posted: string[] = [];
    let failures = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { questionId: string };
        // q-1 先连续失败到 api 内部的重试耗尽（3 次），drainAnswers 的下一轮才成功
        if (body.questionId === "q-1" && failures < 3) {
          failures += 1;
          throw new TypeError("Load failed");
        }
        posted.push(body.questionId);
        return new Response(
          okBody({ correct: true, answerIndex: 1, explanation: "解析", run: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    enqueueAnswer(answerItem(0));
    enqueueAnswer(answerItem(1));
    await drainAnswers();
    expect(posted).toEqual(["q-0", "q-1"]);
    expect(pendingAnswers()).toHaveLength(0);
  }, 20_000);
});
