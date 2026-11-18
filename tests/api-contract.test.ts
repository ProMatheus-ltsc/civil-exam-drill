import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { app } from "../functions/api/[[path]]";
import { topics } from "../src/generator";
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
    // 匹配用的归一化 SQL：去掉所有空白，避免不同来源的 SQL 排版差异影响匹配
    const flat = this.sql.replace(/\s+/g, " ");
    if (flat.includes("FROM sessions s JOIN users")) {
      // 共享包的会话查询：按 token_hash 命中，返回会话 + 用户整行
      return {
        session_id: "ses_test",
        user_id: "usr_test",
        token_hash: String(this.values[0]),
        expires_at: "2099-01-01T00:00:00Z",
        id: "usr_test",
        email_normalized: "test@example.com",
        password_hash: "pbkdf2-sha256$100000$abc$def",
        created_at: "2026-01-01T00:00:00Z",
        last_login_at: "2026-01-01T00:00:00Z",
        email: "test@example.com",
        nickname: "测试用户",
        nickname_normalized: "测试用户",
        status: "active",
        invite_code_id: 1,
      } as T;
    }
    if (this.sql === "SELECT 1") return { ok: 1 } as T;
    if (this.sql.includes("FROM auth_attempts")) return { count: 0 } as T;
    if (this.sql.includes("FROM mock_exams e JOIN users")) {
      const key = String(this.values[0]);
      const shared = this.sql.includes("e.share_token=?");
      const exam = shared
        ? [...this.db.mockExams.values()].find(
            (item) => item.shareToken === key && item.status === "submitted",
          )
        : this.db.mockExams.get(key);
      if (!exam) return null;
      if (!shared && exam.userId !== String(this.values[1])) return null;
      return { ...exam, nickname: "测试用户" } as T;
    }
    if (this.sql.includes("FROM mock_exams WHERE id=? AND user_id=?")) {
      const exam = this.db.mockExams.get(String(this.values[0]));
      if (!exam || exam.userId !== String(this.values[1])) return null;
      return { ...exam } as T;
    }
    if (this.sql.includes("COUNT(*) AS attemptCount,MAX(score) AS bestScore")) {
      const submitted = [...this.db.mockExams.values()].filter(
        (item) =>
          item.userId === String(this.values[0]) &&
          item.status === "submitted" &&
          item.id !== String(this.values[1]),
      );
      return {
        attemptCount: submitted.length,
        bestScore: submitted.length
          ? Math.max(...submitted.map((item) => item.score ?? 0))
          : null,
      } as T;
    }
    if (this.sql.includes("SELECT score FROM mock_exams")) {
      const [userId, examId, before] = this.values.map(String);
      const previous = [...this.db.mockExams.values()]
        .filter(
          (item) =>
            item.userId === userId &&
            item.status === "submitted" &&
            item.id !== examId &&
            (item.submittedAt ?? item.startedAt) < before,
        )
        .sort((a, b) =>
          String(b.submittedAt ?? b.startedAt).localeCompare(
            String(a.submittedAt ?? a.startedAt),
          ),
        )[0];
      return (previous ? { score: previous.score } : null) as T | null;
    }
    if (this.sql.includes("FROM password_resets pr JOIN users")) {
      const reset = this.db.passwordResets.get(String(this.values[0]));
      if (!reset) return null;
      const user = [...this.db.users.values()].find(
        (item) => item.id === reset.userId,
      );
      if (!user) return null;
      return {
        userId: reset.userId,
        expiresAt: reset.expiresAt,
        usedAt: reset.usedAt,
        nickname: user.nickname,
        email: user.email,
      } as T;
    }
    if (this.sql.includes("FROM invite_codes")) return { id: 1 } as T;
    if (flat.includes("FROM users WHERE email_normalized = ?")) {
      const emailNormalized = String(this.values[0]);
      const user = this.db.users.get(emailNormalized) ?? null;
      if (!user) return null;
      // 本项目的登录名归一化列是 email_normalized（不改表结构）
      return {
        id: user.id,
        email_normalized: emailNormalized,
        password_hash: user.passwordHash,
        created_at: "2026-01-01T00:00:00Z",
        last_login_at: "2026-01-01T00:00:00Z",
        email: user.email,
        nickname: user.nickname,
        nickname_normalized: user.nickname,
        status: user.status ?? "active",
        invite_code_id: 1,
      } as T;
    }
    if (flat.includes("FROM users WHERE email_normalized=?")) {
      const email = String(this.values[0]);
      return (this.db.users.get(email) ?? null) as T | null;
    }
    if (
      this.sql.includes("FROM users WHERE invite_code_id=? AND nickname_normalized=?")
    )
      return null;
    if (this.sql.includes("a.question_id=? AND a.correct=0"))
      return {
        answerIndex: 2,
        explanation: "测试讲解",
        attemptId: "att_test",
        reviewStage: this.db.mistakeStage,
      } as T;
    if (this.sql.includes("COUNT(*) AS openCount"))
      return { openCount: this.db.mistakeStage >= 2 ? 0 : 1, dueCount: 1 } as T;
    if (this.sql.includes("SELECT answer_index AS answerIndex"))
      return {
        answerIndex: 1,
        explanation: "测试讲解",
        expiresAt: "2099-01-01T00:00:00Z",
        // 带 run_id 才能走到「局次成绩」这条分支
        runId: "run_test",
      } as T;
    // 幂等重放：按 idempotency_key 回查已写入的作答
    if (this.sql.includes("a.idempotency_key=?")) {
      const record = this.db.attemptsByKey.get(String(this.values[1]));
      return (record ? { ...record } : null) as T | null;
    }
    // 局次成绩聚合：默认 null（不满 10 题），需要时由用例填 runAgg
    if (this.sql.includes("COUNT(*) AS total,SUM(a.correct)"))
      return (this.db.runAgg ? { ...this.db.runAgg } : null) as T | null;
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
    // 错题本列表：一条已到期 + 一条未到期，due=1 时只返回到期的那条
    if (this.sql.includes("q.options_json AS optionsJson")) {
      const now = this.sql.includes("a.next_review_at<=?")
        ? String(this.values[1])
        : null;
      const rows = [
        {
          questionId: "q_due",
          topicId: "addition",
          difficulty: "easy",
          stem: "1+1=?",
          optionsJson: '["1","2","3","4"]',
          materialJson: null,
          answerIndex: 1,
          explanation: "讲解",
          mastered: 0,
          causeTag: this.db.mistakeCause,
          reviewStage: this.db.mistakeStage,
          nextReviewAt: "2026-01-01T00:00:00.000Z",
          lastReviewedAt: null,
          lastWrongAt: "2026-10-01T00:00:00.000Z",
          wrongCount: 2,
        },
        {
          questionId: "q_later",
          topicId: "percentage",
          difficulty: "medium",
          stem: "第二题",
          optionsJson: '["A","B","C","D"]',
          materialJson: null,
          answerIndex: 0,
          explanation: "讲解",
          mastered: 0,
          causeTag: null,
          reviewStage: 1,
          nextReviewAt: "2099-01-01T00:00:00.000Z",
          lastReviewedAt: "2026-10-20T00:00:00.000Z",
          lastWrongAt: "2026-09-01T00:00:00.000Z",
          wrongCount: 1,
        },
      ];
      return {
        results: (now
          ? rows.filter((row) => !row.nextReviewAt || row.nextReviewAt <= now)
          : rows) as T[],
      };
    }
    if (this.sql.includes("FROM mock_exam_questions")) {
      const rows = [...(this.db.mockQuestions.get(String(this.values[0])) ?? [])].sort(
        (a, b) => a.position - b.position,
      );
      if (this.sql.includes("SELECT answer_index AS answerIndex"))
        return {
          results: rows.map((row) => ({
            answerIndex: row.answerIndex,
            selectedIndex: row.selectedIndex,
          })) as T[],
        };
      return { results: rows as T[] };
    }
    // 出题接口的合并查询：一次取回「本局已生成的题」+「去重池」
    if (
      this.sql.includes("FROM generated_questions") &&
      this.sql.includes("(run_id=? OR expires_at>?)")
    )
      return { results: this.db.runQuestionRows as T[] };
    // 开局解锁校验：只查前置模块 hard 局的聚合（不再跑全量聚合）
    if (
      this.sql.includes("a.run_id IS NOT NULL") &&
      this.sql.includes("GROUP BY q.topic_id,a.run_id")
    )
      return { results: this.db.passRuns as T[] };
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
    const flat = this.sql.replace(/\s+/g, " ");
    if (this.sql.startsWith("INSERT INTO quiz_attempts")) {
      // 列顺序：id,user_id,question_id,selected_index,correct,duration_ms,idempotency_key,created_at,run_id
      const [id, , , , correct, , key, createdAt, runId] = this.values;
      this.db.attemptsByKey.set(String(key), {
        attemptId: String(id),
        correct: Number(correct),
        answerIndex: 1,
        explanation: "测试讲解",
        savedAt: String(createdAt),
        runId: runId == null ? null : String(runId),
      });
    }
    if (this.sql.startsWith("UPDATE quiz_attempts SET mastered=?")) {
      const [mastered, reviewStage] = this.values as [number, number];
      this.db.mistakeStage = Number(reviewStage);
      this.db.mistakeMastered = Boolean(mastered);
    }
    if (this.sql.startsWith("UPDATE quiz_attempts SET cause_tag=?")) {
      this.db.mistakeCause = this.values[0] as string | null;
    }
    if (this.sql.startsWith("UPDATE mock_exam_questions SET selected_index")) {
      const [selectedIndex, elapsedMs, , questionId, examId] =
        this.values as [number, number, string, string, string];
      const row = (this.db.mockQuestions.get(examId) ?? []).find(
        (item) => item.id === questionId,
      );
      if (row) {
        row.selectedIndex = selectedIndex;
        row.elapsedMs = elapsedMs;
      }
    }
    if (this.sql.startsWith("UPDATE mock_exams SET status='submitted'")) {
      const [submittedAt, durationMs, correctCount, score, shareToken, examId] =
        this.values as [string, number, number, number, string, string];
      const exam = this.db.mockExams.get(examId);
      if (exam) {
        exam.status = "submitted";
        exam.submittedAt = submittedAt;
        exam.durationMs = durationMs;
        exam.correctCount = correctCount;
        exam.score = score;
        exam.shareToken = shareToken;
      }
    }
    if (
      flat.startsWith("INSERT INTO users (") &&
      flat.includes("email_normalized")
    ) {
      // 共享包的插入语句，列顺序（本项目形状，没有 username / username_normalized）：
      //   id, email_normalized, password_hash, created_at, last_login_at,
      //   + 项目特有列（email, nickname, nickname_normalized, status, invite_code_id）
      const values = this.values.map(String);
      const id = values[0];
      const emailNormalized = values[1];
      const passwordHash = values[2];
      const email = values[5] ?? emailNormalized;
      const nickname = values[6] ?? emailNormalized;
      this.db.users.set(emailNormalized, {
        id,
        nickname,
        email,
        passwordHash,
        status: "active",
      });
    }
    if (this.sql.startsWith("INSERT INTO password_resets")) {
      const [id, userId, tokenHash, expiresAt] = this.values.map(String);
      this.db.passwordResets.set(tokenHash, {
        id,
        userId,
        expiresAt,
        usedAt: null,
      });
    }
    if (this.sql.startsWith("UPDATE users SET password_hash=?")) {
      const [passwordHash, userId] = this.values.map(String);
      for (const user of this.db.users.values()) {
        if (user.id === userId) user.passwordHash = passwordHash;
      }
    }
    if (this.sql.includes("UPDATE password_resets SET used_at")) {
      const userId = String(this.values[0]);
      for (const reset of this.db.passwordResets.values()) {
        if (reset.userId === userId) reset.usedAt = new Date().toISOString();
      }
    }
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
  /** email_normalized → 用户记录（注册后登录用） */
  users = new Map<
    string,
    { id: string; nickname: string; email: string; passwordHash: string }
  >();
  /** token_hash → 重置记录 */
  passwordResets = new Map<
    string,
    { id: string; userId: string; expiresAt: string; usedAt: string | null }
  >();
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
  /** 已写入的作答：idempotencyKey → 记录（重放断言用） */
  attemptsByKey = new Map<
    string,
    {
      attemptId: string;
      correct: number;
      answerIndex: number;
      explanation: string;
      savedAt: string;
      runId: string | null;
    }
  >();
  /** 按局聚合的结果；默认 null 表示该局未满 10 题 */
  runAgg: {
    total: number;
    correct: number;
    durationMs: number;
    topicId: string;
    difficulty: string;
  } | null = null;
  /** 错题复习状态（单题模拟）：当前阶段 / 是否出清 / 错因 */
  mistakeStage = 0;
  mistakeMastered = false;
  mistakeCause: string | null = null;
  /** 模考：examId → 记录；examId → 题目行 */
  mockExams = new Map<
    string,
    {
      id: string;
      userId: string;
      status: "active" | "submitted";
      questionCount: number;
      limitMs: number;
      startedAt: string;
      submittedAt: string | null;
      durationMs: number | null;
      correctCount: number | null;
      score: number | null;
      shareToken: string | null;
    }
  >();
  mockQuestions = new Map<
    string,
    Array<{
      id: string;
      examId: string;
      position: number;
      topicId: string;
      topicTitle: string;
      difficulty: string;
      stem: string;
      optionsJson: string;
      materialJson: string | null;
      answerIndex: number;
      explanation: string;
      selectedIndex: number | null;
      elapsedMs: number;
    }>
  >();
  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }
  async batch(statements: FakeStatement[]) {
    this.batches.push(statements);
    for (const statement of statements) {
      if (statement.sql.startsWith("UPDATE quiz_attempts SET mastered=?")) {
        const [mastered, reviewStage] = statement.values as [number, number];
        this.mistakeStage = Number(reviewStage);
        this.mistakeMastered = Boolean(mastered);
      }
      if (statement.sql.startsWith("INSERT INTO mock_exams")) {
        const [id, userId, , questionCount, limitMs, startedAt] =
          statement.values as [string, string, string, number, number, string];
        this.mockExams.set(id, {
          id,
          userId,
          status: "active",
          questionCount,
          limitMs,
          startedAt,
          submittedAt: null,
          durationMs: null,
          correctCount: null,
          score: null,
          shareToken: null,
        });
      }
      if (statement.sql.startsWith("INSERT INTO mock_exam_questions")) {
        const [
          id,
          examId,
          position,
          topicId,
          topicTitle,
          difficulty,
          stem,
          optionsJson,
          materialJson,
          answerIndex,
          explanation,
        ] = statement.values as [
          string,
          string,
          number,
          string,
          string,
          string,
          string,
          string,
          string | null,
          number,
          string,
        ];
        const rows = this.mockQuestions.get(examId) ?? [];
        rows.push({
          id,
          examId,
          position,
          topicId,
          topicTitle,
          difficulty,
          stem,
          optionsJson,
          materialJson,
          answerIndex,
          explanation,
          selectedIndex: null,
          elapsedMs: 0,
        });
        this.mockQuestions.set(examId, rows);
      }
    }
    return statements.map(() => ({ success: true }));
  }
}

const env = {
  DB: new FakeDb(),
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
  it("registers with email and sets an HttpOnly cookie without exposing the token", async () => {
    const db = new FakeDb();
    const response = await app.request(
      "/api/auth/register",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "New@Example.com",
          password: "password123",
          nickname: "新用户",
        }),
      },
      { ...env, DB: db },
    );
    const payload = await response.json();
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toMatch(
      /HttpOnly.*SameSite=Strict/i,
    );
    expect(payload.data.token).toBeUndefined();
    expect(payload.data.user).toMatchObject({
      nickname: "新用户",
      email: "new@example.com",
    });
    const stored = db.users.get("new@example.com");
    expect(stored?.passwordHash).toMatch(/^pbkdf2-sha256\$/);
    expect(stored?.passwordHash).not.toContain("password123");
  });

  it("rejects duplicate email registration and wrong passwords", async () => {
    const db = new FakeDb();
    const body = JSON.stringify({
      email: "dup@example.com",
      password: "password123",
    });
    const first = await app.request(
      "/api/auth/register",
      { method: "POST", headers: { "content-type": "application/json" }, body },
      { ...env, DB: db },
    );
    expect(first.status).toBe(201);
    const duplicate = await app.request(
      "/api/auth/register",
      { method: "POST", headers: { "content-type": "application/json" }, body },
      { ...env, DB: db },
    );
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe("EMAIL_TAKEN");

    const wrong = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "dup@example.com",
          password: "wrong-password",
        }),
      },
      { ...env, DB: db },
    );
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error.code).toBe("INVALID_CREDENTIALS");

    const login = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      },
      { ...env, DB: db },
    );
    expect(login.status).toBe(200);
    expect((await login.json()).data.user.email).toBe("dup@example.com");
    expect(login.headers.get("set-cookie")).toMatch(/HttpOnly/i);
  });

  it("issues a single-use reset link and switches the password", async () => {
    const db = new FakeDb();
    const email = "reset@example.com";
    const registered = await app.request(
      "/api/auth/register",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "password123" }),
      },
      { ...env, DB: db },
    );
    expect(registered.status).toBe(201);

    const forgot = await app.request(
      "/api/auth/password/forgot",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      },
      { ...env, DB: db },
    );
    expect(forgot.status).toBe(200);
    const forgotPayload = await forgot.json();
    expect(forgotPayload.data.sent).toBe(true);
    expect(forgotPayload.data.devResetUrl).toMatch(/#\/reset\?token=/);
    const token = decodeURIComponent(
      String(forgotPayload.data.devResetUrl).split("token=")[1],
    );

    const unknown = await app.request(
      "/api/auth/password/forgot",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.com" }),
      },
      { ...env, DB: db },
    );
    expect(unknown.status).toBe(200);
    expect((await unknown.json()).data.devResetUrl).toBeUndefined();

    const reset = await app.request(
      "/api/auth/password/reset",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password: "newpassword123" }),
      },
      { ...env, DB: db },
    );
    expect(reset.status).toBe(200);
    expect(reset.headers.get("set-cookie")).toMatch(/HttpOnly/i);

    const oldLogin = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "password123" }),
      },
      { ...env, DB: db },
    );
    expect(oldLogin.status).toBe(401);

    const newLogin = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "newpassword123" }),
      },
      { ...env, DB: db },
    );
    expect(newLogin.status).toBe(200);

    const reuse = await app.request(
      "/api/auth/password/reset",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password: "anotherpassword" }),
      },
      { ...env, DB: db },
    );
    expect(reuse.status).toBe(400);
    expect((await reuse.json()).error.code).toBe("INVALID_RESET_TOKEN");
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
    // 规范词卡片总条目数与分类数：新增条目或新增主题卡片时需同步更新下面两个数值
    // 2026-11-06 新增基层治理 / 数字政府 / 应急管理三类，共 52 张
    // 同日补齐人才（+16）、科技创新（+13）两张偏薄词表，共 402 张
    expect(payload.data.cards).toHaveLength(402);
    expect(payload.data.categories).toHaveLength(13);
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

  it("lists open mistakes with due counts and a due filter", async () => {
    const all = await app.request(
      "/api/quiz/mistakes?limit=100",
      { headers: auth },
      env,
    );
    const allPayload = await all.json();
    expect(allPayload.data.items).toHaveLength(2);
    expect(allPayload.data.counts).toEqual({ open: 1, due: 1 });
    expect(allPayload.data.items[0]).toMatchObject({
      questionId: "q_due",
      options: ["1", "2", "3", "4"],
      reviewStage: 0,
      wrongCount: 2,
    });
    const due = await app.request(
      "/api/quiz/mistakes?due=1",
      { headers: auth },
      env,
    );
    const duePayload = await due.json();
    expect(duePayload.data.items).toHaveLength(1);
    expect(duePayload.data.items[0].questionId).toBe("q_due");
  });

  it("supports an atomic mistake retry", async () => {
    const retry = (selectedIndex: number) =>
      app.request(
        "/api/quiz/mistakes/q_test/retry",
        {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({
            selectedIndex,
            elapsedMs: 1200,
            idempotencyKey: crypto.randomUUID(),
          }),
        },
        env,
      );
    const first = await retry(2);
    const firstPayload = await first.json();
    expect(first.status).toBe(200);
    // 第一次答对只推进到复习阶段 1，次日再考一次
    expect(firstPayload.data).toMatchObject({
      correct: true,
      mastered: false,
      reviewStage: 1,
      answerIndex: 2,
    });
    expect(firstPayload.data.nextReviewAt).toBeTruthy();
    expect(env.DB.batches.at(-1)).toHaveLength(2);
    const second = await retry(2);
    const secondPayload = await second.json();
    // 连续两次答对才出清
    expect(secondPayload.data).toMatchObject({
      correct: true,
      mastered: true,
      reviewStage: 2,
      nextReviewAt: null,
    });
    expect(env.DB.mistakeMastered).toBe(true);
  });

  it("answers a wrong retry by resetting the review stage", async () => {
    const response = await app.request(
      "/api/quiz/mistakes/q_test/retry",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          selectedIndex: 0,
          elapsedMs: 900,
          idempotencyKey: crypto.randomUUID(),
        }),
      },
      env,
    );
    const payload = await response.json();
    expect(payload.data).toMatchObject({
      correct: false,
      mastered: false,
      reviewStage: 0,
    });
    expect(env.DB.mistakeStage).toBe(0);
  });

  it("tags a mistake with an error cause", async () => {
    const response = await app.request(
      "/api/quiz/mistakes/q_test/cause",
      {
        method: "PATCH",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ cause: "formula" }),
      },
      env,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.cause).toBe("formula");
    expect(env.DB.mistakeCause).toBe("formula");
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
    expect((await response.json()).data).toMatchObject({
      mastered: true,
      reviewStage: 2,
      nextReviewAt: null,
    });
    expect(env.DB.mistakeMastered).toBe(true);
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

  it("creates a 20-question timed mock exam and hides answers before submission", async () => {
    const db = new FakeDb();
    const created = await app.request(
      "/api/mock/exams",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      { ...env, DB: db },
    );
    expect(created.status).toBe(200);
    const payload = (await created.json()).data as {
      examId: string;
      questionCount: number;
      limitMs: number;
    };
    expect(payload.questionCount).toBe(20);
    expect(payload.limitMs).toBe(30 * 60 * 1000);
    expect(db.mockExams.get(payload.examId)?.status).toBe("active");
    expect(db.mockQuestions.get(payload.examId)).toHaveLength(20);

    const detail = await app.request(
      `/api/mock/exams/${payload.examId}`,
      { headers: auth },
      { ...env, DB: db },
    );
    expect(detail.status).toBe(200);
    const exam = (await detail.json()).data;
    expect(exam.questions).toHaveLength(20);
    expect(new Set(exam.questions.map((q: { topicId: string }) => q.topicId)).size).toBe(5);
    for (const question of exam.questions) {
      expect(question.options).toHaveLength(4);
      expect(question).not.toHaveProperty("answerIndex");
      expect(question).not.toHaveProperty("explanation");
    }
  });

  it("grades a mock exam and publishes an anonymous shared report", async () => {
    const db = new FakeDb();
    const created = await app.request(
      "/api/mock/exams",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      { ...env, DB: db },
    );
    const { examId } = (await created.json()).data as { examId: string };
    const rows = db.mockQuestions.get(examId) ?? [];
    for (const [index, row] of rows.entries()) {
      const selectedIndex =
        index < 12 ? row.answerIndex : (row.answerIndex + 1) % 4;
      const saved = await app.request(
        `/api/mock/exams/${examId}/answers`,
        {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({
            questionId: row.id,
            selectedIndex,
            elapsedMs: 1000 + index * 100,
          }),
        },
        { ...env, DB: db },
      );
      expect(saved.status).toBe(200);
    }
    const submitted = await app.request(
      `/api/mock/exams/${examId}/submit`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      { ...env, DB: db },
    );
    expect(submitted.status).toBe(200);
    const report = (await submitted.json()).data;
    expect(report.correctCount).toBe(12);
    expect(report.score).toBe(60);
    expect(report.byTopic).toHaveLength(5);
    expect(report.questions).toHaveLength(20);
    expect(report.shareToken).toMatch(/^[a-f0-9]{32}$/);

    const shared = await app.request(
      `/api/mock/reports/${report.shareToken}`,
      {},
      { ...env, DB: db },
    );
    expect(shared.status).toBe(200);
    const publicReport = (await shared.json()).data;
    expect(publicReport.nickname).toBe("测同学");
    expect(publicReport.score).toBe(60);
    expect(publicReport.questions).toBeNull();
    expect(publicReport.shareToken).toBeNull();

    const invalid = await app.request(
      "/api/mock/reports/not-a-valid-token",
      {},
      { ...env, DB: db },
    );
    expect(invalid.status).toBe(404);
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
    // 每个模块 × 三档难度；数量随目录自动派生，新增模块不必手改
    expect(progress).toHaveLength(topics.length * 3);
    expect(byId.get("addition:easy").unlocked).toBe(true);
    expect(byId.get("addition:hard").unlocked).toBe(true);
    // 计算功底是一条链：什么都没过时，只有入口「加法」可练
    expect(byId.get("subtraction:easy").unlocked).toBe(false);
    expect(byId.get("sum-many:easy").unlocked).toBe(false);
    expect(byId.get("sum-long:easy").unlocked).toBe(false);
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

    // 过了加法：减法与多项求和一并解锁，但多项求差、乘法、多项连加还锁着
    const afterAdd = await afterPassing("addition");
    expect(afterAdd.get("subtraction")).toBe(true);
    expect(afterAdd.get("sum-many")).toBe(true);
    expect(afterAdd.get("diff-many")).toBe(false);
    expect(afterAdd.get("multiply")).toBe(false);
    expect(afterAdd.get("sum-long")).toBe(false);

    // 过了减法：多项求差解锁
    const afterSub = await afterPassing("addition", "subtraction");
    expect(afterSub.get("diff-many")).toBe(true);
    expect(afterSub.get("multiply")).toBe(false);

    // 过了多项求和：乘法与平方解锁，但多项连加要等乘法通关（连加用得到乘法）
    const afterSum = await afterPassing("addition", "sum-many");
    expect(afterSum.get("multiply")).toBe(true);
    expect(afterSum.get("sum-long")).toBe(false);
    expect(afterSum.get("divide")).toBe(false);
    expect(afterSum.get("diff-many")).toBe(false);

    // 过了乘法：多项连加与除法估算一并解锁（敏感数也挂在下游）
    const afterMultiply = await afterPassing("addition", "sum-many", "multiply");
    expect(afterMultiply.get("sum-long")).toBe(true);
    expect(afterMultiply.get("divide")).toBe(true);
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
    // 出题接口现在用一次合并查询（本局已生成的题 + 去重池），因此本局的题必须带上 runId。
    const runId = "11111111-1111-4111-8111-111111111111";
    const db = new FakeDb();
    db.runQuestionRows = [
      {
        id: "q_existing",
        topicId: "addition",
        difficulty: "hard",
        runId,
        fingerprint: "fp_existing",
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
          runId,
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

  it("同一 idempotencyKey 重放：只写一条作答，且照样返回局次成绩", async () => {
    const db = new FakeDb();
    // 模拟第 10 题：本局已满 10 题、答对 9 题（用时远低于预算）
    db.runAgg = {
      total: 10,
      correct: 9,
      durationMs: 1000,
      topicId: "addition",
      difficulty: "hard",
    };
    const idempotencyKey = crypto.randomUUID();
    const body = JSON.stringify({
      questionId: "q_test",
      selectedIndex: 1,
      elapsedMs: 800,
      idempotencyKey,
    });
    const send = async () => {
      const response = await app.request(
        "/api/quiz/answers",
        {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body,
        },
        { ...env, DB: db },
      );
      expect(response.status).toBe(200);
      return (await response.json()).data;
    };

    const first = await send();
    const second = await send();

    // 重放拿到的必须是同一条作答，而不是新增一条
    expect(second.attemptId).toBe(first.attemptId);
    // correct 在 D1 里是 0/1，接口必须回布尔，否则重试后前端会判成答错
    expect(first.correct).toBe(true);
    expect(second.correct).toBe(true);
    // 关键：第一次响应若在网络上丢了，客户端会重试；重试也必须带 run，
    // 否则第 10 题永远进不了结算页（用户只能重开一局）
    expect(first.run).toMatchObject({
      finished: true,
      total: 10,
      correct: 9,
      passed: true,
      stars: 2,
    });
    expect(second.run).toEqual(first.run);
    expect(
      db.writes.filter((sql) => sql.startsWith("INSERT INTO quiz_attempts")),
    ).toHaveLength(1);
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
    expect(payload.data.rangeDays).toBe(30);
    expect(Array.isArray(payload.data.trend)).toBe(true);
    expect(payload.data.trend).toHaveLength(30);
    const seven = await app.request(
      "/api/profile/summary?days=7",
      { headers: auth },
      env,
    );
    expect((await seven.json()).data.trend).toHaveLength(7);
    expect(payload.data.cards.summary).toHaveProperty("mastered");
    expect(payload.data.mistakes).toHaveProperty("open");
    expect(payload.data.schulte).toHaveProperty("bests");
    expect(payload.data.quiz.byDifficulty).toHaveLength(3);
    expect(payload.data.quiz.weekday).toHaveLength(7);
    expect(payload.data.progress.totalTopics).toBeGreaterThan(0);
    expect(payload.data.progress.starsDistribution).toHaveLength(4);
    expect(payload.data.progress.tracks.map((track: { id: string }) => track.id)).toEqual([
      "speed",
      "sequence",
      "material",
    ]);
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
