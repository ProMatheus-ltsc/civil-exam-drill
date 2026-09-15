import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { app } from "../functions/api/[[path]]";

class FakeStatement {
  values: unknown[] = [];
  constructor(
    readonly db: FakeDb,
    readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async first<T>() {
    if (this.sql.includes("FROM sessions s JOIN users"))
      return {
        userId: "usr_test",
        expiresAt: "2099-01-01T00:00:00Z",
        nickname: "测试用户",
      } as T;
    if (this.sql === "SELECT 1") return { ok: 1 } as T;
    if (this.sql.includes("FROM auth_attempts")) return { count: 0 } as T;
    if (this.sql.includes("FROM invite_codes")) return { id: 1 } as T;
    if (this.sql.includes("FROM users WHERE"))
      return { id: "usr_test", nickname: "测试用户" } as T;
    if (this.sql.includes("a.question_id=? AND a.correct=0"))
      return {
        answerIndex: 2,
        explanation: "测试讲解",
        attemptId: "att_test",
      } as T;
    if (this.sql.includes("SELECT answer_index AS answerIndex"))
      return {
        answerIndex: 1,
        explanation: "测试讲解",
        expiresAt: "2099-01-01T00:00:00Z",
      } as T;
    if (
      this.sql.startsWith("SELECT id FROM quiz_attempts") &&
      this.sql.includes("correct=0")
    )
      return { id: "att_test" } as T;
    if (this.sql.includes("MIN(duration_ms) AS best"))
      return { best: null } as T;
    return null;
  }
  async all<T>() {
    if (this.sql.includes("FROM generated_questions WHERE user_id=? AND run_id=?"))
      return { results: this.db.runQuestionRows as T[] };
    return { results: [] as T[] };
  }
  async run() {
    this.db.writes.push(this.sql);
    return { success: true };
  }
}
class FakeDb {
  batches: FakeStatement[][] = [];
  /** 本局已生成的题（questions 接口按序号回查用），默认空表示「这一序号还没生成」 */
  runQuestionRows: unknown[] = [];
  /** 记录所有写语句，用来断言「重复请求不该再插入新题」 */
  writes: string[] = [];
  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }
  async batch(statements: FakeStatement[]) {
    this.batches.push(statements);
    return statements.map(() => ({ success: true }));
  }
}

const env = {
  DB: new FakeDb(),
  INVITE_CODE: "TEST2026",
  // 静态内容（public/generated/knowledge/*.json）mock：读取本地生成文件，等价 Pages ASSETS.fetch
  ASSETS: {
    async fetch(input: string | URL | Request) {
      const url = new URL(String(input));
      const file = new URL(
        `../public${url.pathname}`,
        import.meta.url,
      );
      const text = readFileSync(file, "utf8");
      return new Response(text, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  },
};
const auth = { cookie: "civil_exam_session=test-session" };

describe("API contract guards", () => {
  it("uses an HttpOnly cookie without exposing the session token", async () => {
    const response = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteCode: "TEST2026", nickname: "测试用户" }),
      },
      env,
    );
    const payload = await response.json();
    expect(response.headers.get("set-cookie")).toMatch(
      /HttpOnly.*SameSite=Strict/i,
    );
    expect(payload.data.token).toBeUndefined();
  });

  it("rejects unauthenticated access", async () => {
    const response = await app.request("/api/essay/cards", {}, env);
    expect(response.status).toBe(401);
  });

  it("rejects invalid pagination with INVALID_PARAM", async () => {
    const response = await app.request(
      "/api/knowledge?limit=bad",
      { headers: auth },
      env,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_PARAM");
  });

  it("exposes all generated normative-expression cards", async () => {
    const response = await app.request(
      "/api/essay/cards",
      { headers: auth },
      env,
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.cards).toHaveLength(126);
    expect(payload.data.categories).toHaveLength(9);
  });

  it("writes progress and review event atomically", async () => {
    const cardsResponse = await app.request(
      "/api/essay/cards",
      { headers: auth },
      env,
    );
    const termId = (await cardsResponse.json()).data.cards[0].termId;
    const response = await app.request(
      "/api/essay/reviews",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          termId,
          rating: "remembered",
          idempotencyKey: crypto.randomUUID(),
        }),
      },
      env,
    );
    expect(response.status).toBe(200);
    expect(env.DB.batches.at(-1)).toHaveLength(2);
  });

  it("rejects cross-site writes", async () => {
    const response = await app.request(
      "/api/auth/logout",
      { method: "POST", headers: { ...auth, origin: "https://evil.example" } },
      env,
    );
    expect(response.status).toBe(403);
  });

  it("supports an atomic mistake retry", async () => {
    const response = await app.request(
      "/api/quiz/mistakes/q_test/retry",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          selectedIndex: 2,
          elapsedMs: 1200,
          idempotencyKey: crypto.randomUUID(),
        }),
      },
      env,
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      correct: true,
      mastered: true,
      answerIndex: 2,
    });
    expect(env.DB.batches.at(-1)).toHaveLength(2);
  });

  it("scores a generated question server-side", async () => {
    const response = await app.request(
      "/api/quiz/answers",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          questionId: "q_test",
          selectedIndex: 1,
          elapsedMs: 800,
          idempotencyKey: crypto.randomUUID(),
        }),
      },
      env,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.correct).toBe(true);
  });

  it("updates mistake mastery only for an owned mistake", async () => {
    const response = await app.request(
      "/api/quiz/mistakes/q_test/mastery",
      {
        method: "PATCH",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ mastered: true }),
      },
      env,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.mastered).toBe(true);
  });

  it("stores a Schulte result idempotently", async () => {
    const response = await app.request(
      "/api/schulte/results",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          gridSize: 5,
          variant: "standard",
          elapsedMs: 22000,
          mistakes: 1,
          idempotencyKey: crypto.randomUUID(),
        }),
      },
      env,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.personalBestMs).toBe(22000);
  });

  it("exposes the dual-track quiz catalog", async () => {
    const response = await app.request(
      "/api/quiz/catalog",
      { headers: auth },
      env,
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.runLength).toBe(10);
    expect(payload.data.passAccuracy).toBe(0.8);
    const speedTrack = payload.data.tracks.find((t) => t.id === "speed");
    const seqTrack = payload.data.tracks.find((t) => t.id === "sequence");
    expect(speedTrack.topics.length).toBeGreaterThanOrEqual(20);
    expect(seqTrack.topics.length).toBeGreaterThanOrEqual(9);
    expect(seqTrack.topics.every((t) => t.budgetMs > 0)).toBe(true);

    // 前端要靠 unlock / unlockTitles 的下标对应关系，把「还差哪几个前置模块没过」点名出来
    // （QuizPage 的 lockedPrereqTitles：用 unlock[i] 查进度、用 unlockTitles[i] 拿名字）。
    // 两者一旦错位，卡片上会显示成别人的模块名——不报错、只是错，所以在这里钉死。
    const allTopics = payload.data.tracks.flatMap((t) => t.topics);
    const titleById = new Map(allTopics.map((t) => [t.id, t.title]));
    const misaligned = allTopics.filter(
      (topic) =>
        topic.unlock.length !== topic.unlockTitles.length ||
        topic.unlock.some((id, index) => topic.unlockTitles[index] !== titleById.get(id)),
    );
    expect(misaligned.map((t) => t.id)).toEqual([]);
    expect(allTopics.every((t) => t.unlock.every((id) => titleById.has(id)))).toBe(true);
  });

  it("locks stages until the hard (combat) run of prerequisites is cleared", async () => {
    const progressResponse = await app.request(
      "/api/quiz/progress",
      { headers: auth },
      env,
    );
    const progress = (await progressResponse.json()).data;
    expect(progressResponse.status).toBe(200);
    const byId = new Map(
      progress.map((p) => [`${p.topicId}:${p.difficulty}`, p]),
    );
    expect(progress).toHaveLength(35 * 3);
    expect(byId.get("addition:easy").unlocked).toBe(true);
    expect(byId.get("addition:hard").unlocked).toBe(true);
    expect(byId.get("multiply:easy").unlocked).toBe(false);

    const lockedResponse = await app.request(
      "/api/quiz/questions",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          topicId: "multiply",
          difficulty: "hard",
          runId: crypto.randomUUID(),
          index: 0,
        }),
      },
      env,
    );
    expect(lockedResponse.status).toBe(409);
    expect((await lockedResponse.json()).error.code).toBe("TOPIC_LOCKED");
  });

  it("generates the first run question of the requested difficulty run", async () => {
    const response = await app.request(
      "/api/quiz/questions",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          topicId: "addition",
          difficulty: "hard",
          runId: crypto.randomUUID(),
          index: 0,
        }),
      },
      env,
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.difficulty).toBe("hard");
    expect(payload.data.runLength).toBe(10);
    expect(payload.data.index).toBe(0);
  });

  it("rejects retired legacy composite topics with a hint", async () => {
    const response = await app.request(
      "/api/quiz/questions",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ topicId: "growth", difficulty: "easy" }),
      },
      env,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("TOPIC_RETIRED");
  });

  it("「加减与多项求和」拆成四关后，旧 id 会被挡下并提示走关卡地图", async () => {
    // 进行中的旧局（客户端还拿着 arithmetic 的 runId）不该静默出题，也不该报「未知专题」
    const response = await app.request(
      "/api/quiz/questions",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ topicId: "arithmetic", difficulty: "easy" }),
      },
      env,
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.code).toBe("TOPIC_RETIRED");
    expect(payload.error.message).toContain("已拆分为独立关卡");
  });

  it("同一序号的重复请求返回同一道题，而不是 RUN_STATE", async () => {
    // 回归：客户端的「预取下一题」与用户点「下一题」会同时发出请求，
    // 老实现只比 COUNT 与 index，撞车就 409「题目序号不连续」。
    const db = new FakeDb();
    db.runQuestionRows = [
      {
        id: "q_existing",
        topicId: "addition",
        difficulty: "hard",
        stem: "已经生成过的题面",
        optionsJson: JSON.stringify(["A", "B", "C", "D"]),
        materialJson: null,
        generatedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    ];
    const response = await app.request(
      "/api/quiz/questions",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          topicId: "addition",
          difficulty: "hard",
          runId: crypto.randomUUID(),
          index: 0,
        }),
      },
      { ...env, DB: db },
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      questionId: "q_existing",
      stem: "已经生成过的题面",
      options: ["A", "B", "C", "D"],
      index: 0,
      reused: true,
    });
    expect(
      db.writes.some((sql) => sql.includes("INSERT INTO generated_questions")),
    ).toBe(false);
  });

  it("序号跳跃（超过已生成题数）仍报 RUN_STATE，防客户端错算", async () => {
    const db = new FakeDb();
    db.runQuestionRows = [];
    const response = await app.request(
      "/api/quiz/questions",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          topicId: "addition",
          difficulty: "hard",
          runId: crypto.randomUUID(),
          index: 1,
        }),
      },
      { ...env, DB: db },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("RUN_STATE");
  });

  it("answers carry run completion metadata when a run ends", async () => {
    const response = await app.request(
      "/api/quiz/answers",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          questionId: "q_test",
          selectedIndex: 1,
          elapsedMs: 800,
          idempotencyKey: crypto.randomUUID(),
        }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.correct).toBe(true);
    expect(payload.data).toHaveProperty("run");
  });

  it("aggregates a personal profile summary", async () => {
    const response = await app.request(
      "/api/profile/summary",
      { headers: auth },
      env,
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.activity).toHaveProperty("streak");
    expect(Array.isArray(payload.data.trend30)).toBe(true);
    expect(payload.data.trend30).toHaveLength(30);
    expect(payload.data.cards.summary).toHaveProperty("mastered");
    expect(payload.data.mistakes).toHaveProperty("open");
    expect(payload.data.schulte).toHaveProperty("bests");
  });
});
