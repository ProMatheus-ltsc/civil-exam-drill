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
});
