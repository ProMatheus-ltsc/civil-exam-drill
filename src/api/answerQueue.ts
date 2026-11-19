/**
 * 作答上报队列：答题不因网络中断而卡住。
 *
 * 背景：速算一局原本是「取题 ×10 + 提交 ×10」共 20 次跨境请求。`pages.dev` 在国内线路
 * 上单次成功率大约 97%，一局里「至少失败一次」的概率就有四成，用户看到的就是
 * 「提交经常报错 / Load failed」。
 *
 * 现在答题改为**本地判分**（答案随题下发），提交退化成「记账」：
 *   - 成功：正常清队；
 *   - 网络失败：留在 localStorage，页面下次进入 / 网络恢复时自动补传；
 *   - 业务失败（该题已提交、题目过期）：直接丢弃——留着永远不会成功，反而堵住队列。
 *
 * 队列是串行发的：并发一堆请求只会让弱网更糟，且服务端的局次汇总依赖写入顺序。
 */
import { api, isNetworkError } from "./client";

export type PendingAnswer = {
  questionId: string;
  selectedIndex: number;
  elapsedMs: number;
  idempotencyKey: string;
};

export type AnswerRun = {
  finished: boolean;
  difficulty: "easy" | "medium" | "hard";
  total: number;
  correct: number;
  accuracy: number;
  durationMs: number;
  passed: boolean;
  stars: number;
} | null;

export type AnswerResult = {
  correct: boolean;
  answerIndex: number;
  explanation: string;
  run: AnswerRun;
};

const STORAGE_KEY = "quiz.pendingAnswers.v1";

function read(): PendingAnswer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingAnswer[];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.questionId) : [];
  } catch {
    return [];
  }
}

function write(items: PendingAnswer[]) {
  try {
    if (items.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // 隐私模式下 localStorage 可能不可写：内存里继续跑，刷新后丢队列，不影响答题
  }
}

export function pendingAnswers(): PendingAnswer[] {
  return read();
}

/** 入队并立刻尝试上报（不 await，调用方无需等待网络） */
export function enqueueAnswer(item: PendingAnswer) {
  const items = read();
  // 同一题只留一条：重复点选项 / 重试都复用同一个幂等键，服务端只会记一次
  write([...items.filter((existing) => existing.questionId !== item.questionId), item]);
  void flushAnswers();
}

/**
 * 出队**只能按「这一条」删**，绝不能把整份数组写回去。
 *
 * 原实现把队列读进局部数组，每发完一条就 `write(items)` 把旧快照写回 localStorage。
 * 但用户答题的速度总是快于一次跨境往返（0.3~1s）：这一条在途时下一条已经入队，
 * 旧快照一写回就把新作答抹掉了。实测「连答 10 题」只上报了 3 条——
 * 用户看到的就是「答完 10 题、结算三星，刷新后只有 9 题、星级归零」
 * （`runStars` 要求 total≥10，少一条整局就不算数）。
 */
function removeItem(target: PendingAnswer) {
  write(
    read().filter(
      (item) =>
        item.questionId !== target.questionId ||
        item.idempotencyKey !== target.idempotencyKey,
    ),
  );
}

let flushing: Promise<AnswerRun> | null = null;

/** 串行清队；返回最后一次拿到的局次成绩（服务端可能尚未收齐，返回 null） */
export function flushAnswers(): Promise<AnswerRun> {
  if (flushing) return flushing;
  flushing = (async () => {
    let lastRun: AnswerRun = null;
    /** 本次已经发过的条目：localStorage 不可写时队列删不掉，靠它避免原地打转 */
    const attempted = new Set<string>();
    for (;;) {
      // 每轮**重新读队列**：上一题的请求在途时，用户可能已经答了下一题
      const item = read()[0];
      if (!item) break;
      const mark = `${item.questionId}:${item.idempotencyKey}`;
      if (attempted.has(mark)) break;
      attempted.add(mark);
      try {
        const result = await api<AnswerResult>("/quiz/answers", {
          method: "POST",
          // 服务端按 idempotencyKey 去重：重放只记一条，且会重算局次成绩
          idempotent: true,
          attempts: 3,
          body: JSON.stringify(item),
        });
        if (result.run) lastRun = result.run;
        removeItem(item);
      } catch (error) {
        if (isNetworkError(error)) {
          // 网络还没恢复：本轮到此为止，队列留着等下次触发（本轮后续的作答也还在队列里）
          break;
        }
        // 该题已提交 / 已过期这类业务错：留着永远不会成功，丢掉让后面的继续
        removeItem(item);
      }
    }
    return lastRun;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/**
 * 清空队列再返回：某一轮撞上网络错误就歇一会儿再试，最多 `rounds` 轮。
 *
 * 一局结束必须用它而不是只调一次 `flushAnswers`——一次调用只发到失败的那条为止，
 * 剩下的留在队列里，此时去拉 `/quiz/progress` 拿到的就是「9 题、0 星」的旧成绩。
 */
export async function drainAnswers(rounds = 3): Promise<AnswerRun> {
  let lastRun: AnswerRun = null;
  for (let round = 0; round < rounds; round += 1) {
    const result = await flushAnswers();
    if (result) lastRun = result;
    if (read().length === 0) return lastRun;
    await new Promise<void>((resolve) => setTimeout(resolve, 600 * (round + 1)));
  }
  return lastRun;
}
