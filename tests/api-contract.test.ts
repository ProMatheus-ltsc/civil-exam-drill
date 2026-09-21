import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { app } from "../functions/api/[[path]]";
import { essayQuestionById, essayQuizOf } from "../src/essay/bank";

/**
 * 客观题的标准答案与作答构造（测试专用）。
 * 标准答案只在服务端存在——GET 下发数据里没有，所以这里直接从题库取。
 */
const essayAnswerKeys = (levelId: string) =>
  essayQuizOf(levelId).map((item) => ({
    id: item.id,
    key: (essayQuestionById.get(item.id) as { answer: number }).answer,
  }));
/** 前 correct 道答对，其余答错（错项的 key 一定与正确项不同） */
const essayAnswers = (levelId: string, correct: number) =>
  essayAnswerKeys(levelId).map((item, index) => ({
    id: item.id,
    key: index < correct ? item.key : (item.key + 1) % 4,
  }));

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
    // 申论闯关：按关卡取一行（提交时读旧星级，用来实现「星级只增不减」）
    if (this.sql.includes("essay_training_progress") && this.sql.includes("level_id=?")) {
      const levelId = String(this.values[1]);
      const record = this.db.essayProgress.get(levelId);
      if (!record) return null;
      return {
        levelId,
        checkedJson: JSON.stringify(record.checked),
        quizJson: JSON.stringify(record.quiz),
        notes: record.notes,
        stars: record.stars,
        updatedAt: record.updatedAt,
      } as T;
    }
    return null;
  }
  async all<T>() {
    if (this.sql.includes("FROM generated_questions WHERE user_id=? AND run_id=?"))
      return { results: this.db.runQuestionRows as T[] };
    // 通关判定用的「按局聚合」查询：喂 passRuns 即可模拟「某模块某难度局已通关」
    if (this.sql.includes("GROUP BY q.topic_id,q.difficulty,a.run_id"))
      return { results: this.db.passRuns as T[] };
    // 申论闯关进度：两张查询（只取星级 / 取全部字段）都返回同一份内存记录
    if (this.sql.includes("essay_training_progress"))
      return {
        results: [...this.db.essayProgress].map(([levelId, record]) => ({
          levelId,
          checkedJson: JSON.stringify(record.checked),
          quizJson: JSON.stringify(record.quiz),
          notes: record.notes,
          stars: record.stars,
          updatedAt: record.updatedAt,
        })) as T[],
      };
    return { results: [] as T[] };
  }
  async run() {
    this.db.writes.push(this.sql);
    if (this.sql.includes("essay_training_progress")) {
      const [levelId, checkedJson, quizJson, notes, stars] = [
        String(this.values[1]),
        String(this.values[2]),
        String(this.values[3]),
        String(this.values[4]),
        Number(this.values[5]),
      ];
      this.db.essayProgress.set(levelId, {
        checked: JSON.parse(checkedJson) as number[],
        quiz: JSON.parse(quizJson) as Array<{ id: string; key: number }>,
        notes,
        stars,
        updatedAt: "2026-09-21T12:00:00Z",
      });
    }
    return { success: true };
  }
}
class FakeDb {
  batches: FakeStatement[][] = [];
  /** 本局已生成的题（questions 接口按序号回查用），默认空表示「这一序号还没生成」 */
  runQuestionRows: unknown[] = [];
  /** 已通关的局（用于解锁链断言）：{ topicId, difficulty, runId, total, correct, durationMs } */
  passRuns: unknown[] = [];
  /** 申论闯关进度：levelId → { checked, quiz, notes, stars, updatedAt } */
  essayProgress = new Map<
    string,
    {
      checked: number[];
      quiz: Array<{ id: string; key: number }>;
      notes: string;
      stars: number;
      updatedAt: string;
    }
  >();
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
    // 计算功底是一条链：什么都没过时，只有入口「加法」可练
    expect(byId.get("subtraction:easy").unlocked).toBe(false);
    expect(byId.get("sum-many:easy").unlocked).toBe(false);
    expect(byId.get("diff-many:easy").unlocked).toBe(false);
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

  it("计算功底解锁链：加法 → 减法/多项求和 → 多项求差/乘法与平方", async () => {
    const unlockedMap = async (db: FakeDb) => {
      const response = await app.request("/api/quiz/progress", { headers: auth }, { ...env, DB: db });
      expect(response.status).toBe(200);
      const rows = (await response.json()).data as Array<{
        topicId: string;
        difficulty: string;
        unlocked: boolean;
      }>;
      return new Map(
        rows.filter((row) => row.difficulty === "easy").map((row) => [row.topicId, row.unlocked]),
      );
    };
    // 一局 10 题全对且在预算内 → 该难度局通关（高难度局通关才解锁下一关）
    const passedRun = (topicId: string) => ({
      topicId,
      difficulty: "hard",
      runId: `run-${topicId}`,
      total: 10,
      correct: 10,
      durationMs: 1000,
    });
    const afterPassing = async (...topicIds: string[]) => {
      const db = new FakeDb();
      db.passRuns = topicIds.map(passedRun);
      return unlockedMap(db);
    };

    const none = await afterPassing();
    expect(none.get("addition")).toBe(true);
    expect(none.get("subtraction")).toBe(false);

    // 过了加法：减法与多项求和一并解锁，但多项求差、乘法还锁着
    const afterAdd = await afterPassing("addition");
    expect(afterAdd.get("subtraction")).toBe(true);
    expect(afterAdd.get("sum-many")).toBe(true);
    expect(afterAdd.get("diff-many")).toBe(false);
    expect(afterAdd.get("multiply")).toBe(false);

    // 过了减法：多项求差解锁
    const afterSub = await afterPassing("addition", "subtraction");
    expect(afterSub.get("diff-many")).toBe(true);
    expect(afterSub.get("multiply")).toBe(false);

    // 过了多项求和：乘法与平方解锁（除法仍挂在下游）
    const afterSum = await afterPassing("addition", "sum-many");
    expect(afterSum.get("multiply")).toBe(true);
    expect(afterSum.get("divide")).toBe(false);
    expect(afterSum.get("diff-many")).toBe(false);
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

  it("申论闯关：下发 21 关与每关 5 道客观题，答案不下发、未答完不能交卷", async () => {
    const db = new FakeDb();
    const list = await app.request("/api/essay/training", { headers: auth }, { ...env, DB: db });
    expect(list.status).toBe(200);
    const payload = (await list.json()).data;
    expect(payload.levels).toHaveLength(39);
    expect(payload.stages).toHaveLength(6);
    expect(payload.levels[0]).toMatchObject({ unlocked: true, stars: 0, day: 1 });
    expect(payload.levels[1]).toMatchObject({
      unlocked: false,
      previousTitle: payload.levels[0].title,
    });
    expect(payload.summary).toMatchObject({
      total: 39,
      cleared: 0,
      stars: 0,
      quizAnswered: 0,
      quizCorrect: 0,
    });
    // 关卡内容随定义一起下发（前端不重复打包一份文案）
    expect(payload.levels[0].checklist).toHaveLength(10);
    expect(payload.levels[0].tasks.length).toBeGreaterThanOrEqual(2);
    expect(payload.levels[0].minutes).toBeGreaterThan(30);

    // 客观题：下发 5 道，四选一，选项带题库原始下标 key
    const quiz = payload.levels[0].quiz;
    expect(quiz).toHaveLength(5);
    expect(quiz[0].options).toHaveLength(4);
    expect(quiz[0].options.map((option: { key: number }) => option.key).sort()).toEqual([0, 1, 2, 3]);
    expect(quiz[0].tag).toBeTruthy();
    // 关键：下发数据里绝不能出现答案与解析（否则前端一看源码就知道答案）
    const wire = JSON.stringify(payload);
    // 字段名换个写法也不能漏（比如直接叫 answer）——所以逐个关键字都查一遍；
    // 注意 summary.quizAnswered 里的 "Answered" 是大写 A，不会被小写 answer 误伤
    expect(wire).not.toContain("answer");
    expect(wire).not.toContain("answerKey");
    expect(wire).not.toContain("explanation");
    // 注意：不能在整份 payload 上搜「解析」——关卡要点/自评清单里本来就有这个词，只能按字段名查
    expect(payload.levels[0].quizResult).toBeNull();

    // 未答完客观题 → 400（这道校验必须先于入库，否则客观题门槛形同虚设）
    const partial = await app.request(
      "/api/essay/training/essay-day01",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          quiz: quiz.slice(0, 2).map((item: { id: string }) => ({ id: item.id, key: 0 })),
          checked: [0, 1, 2, 3, 4, 5, 6, 7],
        }),
      },
      { ...env, DB: db },
    );
    expect(partial.status).toBe(400);
    const partialError = (await partial.json()).error;
    expect(partialError.code).toBe("QUIZ_INCOMPLETE");
    expect(partialError.message).toContain("未作答");

    // 未通关上一关 → 409（先判解锁，再判卷面；这里故意连题都没答）
    const locked = await app.request(
      "/api/essay/training/essay-day02",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ quiz: [], checked: [] }),
      },
      { ...env, DB: db },
    );
    expect(locked.status).toBe(409);
    expect((await locked.json()).error.code).toBe("LEVEL_LOCKED");

    const missing = await app.request(
      "/api/essay/training/essay-day99",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ quiz: [], checked: [] }),
      },
      { ...env, DB: db },
    );
    expect(missing.status).toBe(404);
  });

  it("申论闯关：客观题是硬门槛，加上自评按加权总分定星（80/90/100 → 1/2/3 星），星级只增不减", async () => {
    const db = new FakeDb();
    const submit = async (levelId: string, quiz: unknown, checked: number[]) => {
      const response = await app.request(
        `/api/essay/training/${levelId}`,
        {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({ quiz, checked, notes: "复盘结论" }),
        },
        { ...env, DB: db },
      );
      return (await response.json()).data;
    };

    // 计分：客观题每题 2 分、自评每条 1 分（满分 20）。
    // 4/5 + 自评 8/10 → 8+8 = 16/20 = 80% → 一星通关
    const one = await submit("essay-day01", essayAnswers("essay-day01", 4), [0, 1, 2, 3, 4, 5, 6, 7]);
    expect(one).toMatchObject({ correct: 4, quizTotal: 5, stars: 1, cleared: true });

    // 星级只增不减：重新交卷答得更差也不抹掉已拿到的星（与专项训练取历史最佳同口径）
    expect((await submit("essay-day01", essayAnswers("essay-day01", 0), [0, 1])).stars).toBe(1);

    // 5/5 + 8/10 = 18/20 = 90% → 二星；5/5 + 10/10 = 满分 → 三星
    expect((await submit("essay-day02", essayAnswers("essay-day02", 5), [0, 1, 2, 3, 4, 5, 6, 7])).stars).toBe(2);
    expect((await submit("essay-day02", essayAnswers("essay-day02", 5), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])).stars).toBe(3);

    // Day3 这时才解锁（要 Day2 通关）：客观题只答对 3/5 → 即使清单全勾也不通关，越界下标同时被丢弃
    const gated = await submit("essay-day03", essayAnswers("essay-day03", 3), [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    expect(gated).toMatchObject({ correct: 3, quizTotal: 5, stars: 0, cleared: false });
    expect(gated.checked).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // 补上 Day3：5/5 + 清单全勾 → 三星（星级从 0 提上来）
    const marked = await submit("essay-day03", essayAnswers("essay-day03", 5), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(marked).toMatchObject({ correct: 5, stars: 3, cleared: true });
    // 判分回传每题的对错、正确项与解析（交卷后才给，前端用它渲染错题解析）
    expect(marked.marks).toHaveLength(5);
    expect(
      marked.marks.every(
        (mark: { correct: boolean; explanation: string; answerKey: number }) =>
          mark.correct && Boolean(mark.explanation) && Number.isInteger(mark.answerKey),
      ),
    ).toBe(true);

    // 逐关解锁 + 汇总：Day3 通关后 Day4 才开
    const after = (
      await (await app.request("/api/essay/training", { headers: auth }, { ...env, DB: db })).json()
    ).data;
    expect(after.levels.slice(0, 4).every((level: { unlocked: boolean }) => level.unlocked)).toBe(true);
    expect(after.levels[4]).toMatchObject({ unlocked: false });
    expect(after.levels[0].notes).toBe("复盘结论");
    expect(after.summary).toMatchObject({ cleared: 3, stars: 7, total: 39 });
    // 交卷后 GET 带回每题的对错与解析（页面刷新后还能看到上次的错题解析）；
    // 星取历史最好、作答留最近一次：Day1 最后一次只答对 0 题，星仍是 1
    expect(after.levels[0].quizResult).toMatchObject({ correct: 0, total: 5 });
    expect(after.levels[0].quizResult.marks).toHaveLength(5);
    expect(after.levels[0].stars).toBe(1);
    // 没交过卷的关卡不下发判分结果（答案面为零）
    expect(after.levels[5].quizResult).toBeNull();
    expect(after.summary).toMatchObject({ quizAnswered: 15, quizCorrect: 10 });
  });
});
