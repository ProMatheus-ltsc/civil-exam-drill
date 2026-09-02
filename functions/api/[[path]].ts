import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import { z } from "zod";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  difficulties,
  generateQuestion,
  topics,
  type Difficulty,
  type TopicId,
} from "../../src/generator";
import {
  initialProgress,
  scheduleReview,
  type ReviewRating,
} from "../../src/essay/scheduler";

interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: Record<string, unknown> }>;
}
interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}
type Bindings = {
  DB: Database;
  SESSION_HMAC_SECRET: string;
  INVITE_CODE_PEPPER: string;
  // Pages 静态资源绑定（内容 JSON 静态化后运行时读取；运行时经 ASSETS.fetch 读取 /generated/**）
  ASSETS?: { fetch(input: string | URL | Request): Promise<Response> };
};
type Variables = { userId: string; tokenHash: string; nickname: string };

// ---- 知识内容加载（静态 JSON 经 env.ASSETS 运行时读取，isolate 级缓存；避免打进 Worker bundle 超 3MiB）----
interface KnowledgeEntry {
  id: string;
  module: string;
  category: string;
  title: string;
  order: number;
  markdown: string;
  html: string;
  source?: string | null;
}
interface KnowledgeIndex {
  version: string;
  items: Array<Record<string, unknown>>;
}
let entriesCache: KnowledgeEntry[] | null = null;
let entriesVersion = "";
let searchCache: KnowledgeIndex["items"] | null = null;

async function fetchJson<T>(c: { env: Bindings }, path: string): Promise<T> {
  const asset = c.env.ASSETS;
  if (!asset) throw new Error("ASSETS binding 未配置");
  const url = new URL(path, "https://pages.dev");
  const res = await asset.fetch(url.toString());
  if (!res.ok) throw new Error(`读取静态资源失败 ${path}: ${res.status}`);
  return (await res.json()) as T;
}

async function loadEntries(c: { env: Bindings }): Promise<KnowledgeEntry[]> {
  if (entriesCache && entriesVersion) return entriesCache;
  const data = await fetchJson<{
    version: string;
    entries: KnowledgeEntry[];
  }>(c, "/generated/knowledge/entries.json");
  entriesCache = data.entries;
  entriesVersion = data.version;
  return entriesCache;
}

async function loadSearch(c: {
  env: Bindings;
}): Promise<KnowledgeIndex["items"]> {
  if (searchCache) return searchCache;
  const data = await fetchJson<KnowledgeIndex>(c, "/generated/knowledge/search-index.json");
  searchCache = data.items;
  return searchCache;
}

export const app = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>().basePath("/api");
const ok = <T>(data: T) => ({ success: true as const, data, error: null });
const fail = (code: string, message: string, details?: unknown) => ({
  success: false as const,
  data: null,
  error: { code, message, ...(details === undefined ? {} : { details }) },
});
const iso = (date = new Date()) => date.toISOString();
const uuid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const encoder = new TextEncoder();
const SESSION_COOKIE = "civil_exam_session";

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function jsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await request.json());
}

function integerQuery(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  return z.coerce
    .number()
    .int()
    .min(min)
    .max(max)
    .parse(value ?? fallback);
}

app.onError((error, c) => {
  if (error instanceof z.ZodError)
    return c.json(
      fail("INVALID_PARAM", "请求参数不合法", error.flatten()),
      400,
    );
  if (error.message === "GENERATION_FAILED")
    return c.json(
      fail("GENERATION_FAILED", "暂时无法生成合法新题，请重试"),
      503,
    );
  console.error(error);
  return c.json(fail("INTERNAL_ERROR", "服务暂时不可用"), 500);
});

app.use("*", async (c, next) => {
  if (c.req.path === "/api/health" || c.req.path === "/api/auth/login")
    return next();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
    const requestOrigin = c.req.header("Origin");
    const expectedOrigin = new URL(c.req.url).origin;
    if (requestOrigin && requestOrigin !== expectedOrigin)
      return c.json(fail("FORBIDDEN", "拒绝跨站写入请求"), 403);
    if (c.req.header("Sec-Fetch-Site") === "cross-site")
      return c.json(fail("FORBIDDEN", "拒绝跨站写入请求"), 403);
  }
  const token = getCookie(c, SESSION_COOKIE) ?? "";
  if (!token) return c.json(fail("UNAUTHORIZED", "请先登录"), 401);
  const tokenHash = await sha(token);
  const session = await c.env.DB.prepare(
    `SELECT s.user_id AS userId,s.expires_at AS expiresAt,u.nickname FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP AND u.status='active'`,
  )
    .bind(tokenHash)
    .first<{ userId: string; expiresAt: string; nickname: string }>();
  if (!session) return c.json(fail("UNAUTHORIZED", "登录已失效"), 401);
  c.set("userId", session.userId);
  c.set("tokenHash", tokenHash);
  c.set("nickname", session.nickname);
  await c.env.DB.prepare(
    "UPDATE sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=?",
  )
    .bind(tokenHash)
    .run();
  await next();
});

app.get("/health", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json(ok({ status: "ok", database: "ok", time: iso() }));
});

app.post("/auth/login", async (c) => {
  const body = await jsonBody(
    c.req.raw,
    z.object({
      inviteCode: z.string().trim().min(4).max(32),
      nickname: z.string().trim().min(1).max(12),
    }),
  );
  const clientKey = `login:${await sha(c.req.header("CF-Connecting-IP") ?? "local")}`;
  const attempts = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM auth_attempts WHERE client_key=? AND created_at>datetime('now','-10 minutes')",
  )
    .bind(clientKey)
    .first<{ count: number }>();
  if ((attempts?.count ?? 0) >= 10)
    return c.json(fail("RATE_LIMITED", "登录尝试过于频繁，请稍后再试"), 429);
  const codeHash = await hmac(
    body.inviteCode.toUpperCase(),
    c.env.INVITE_CODE_PEPPER,
  );
  const invite = await c.env.DB.prepare(
    `SELECT id FROM invite_codes WHERE code_hash=? AND enabled=1 AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)`,
  )
    .bind(codeHash)
    .first<{ id: number }>();
  await c.env.DB.prepare(
    "INSERT INTO auth_attempts(client_key,succeeded) VALUES(?,?)",
  )
    .bind(clientKey, invite ? 1 : 0)
    .run();
  if (!invite) return c.json(fail("INVITE_INVALID", "邀请码无效或已停用"), 401);
  const normalized = body.nickname.toLocaleLowerCase("zh-CN");
  let user = await c.env.DB.prepare(
    "SELECT id,nickname FROM users WHERE invite_code_id=? AND nickname_normalized=?",
  )
    .bind(invite.id, normalized)
    .first<{ id: string; nickname: string }>();
  if (!user) {
    user = { id: uuid("usr"), nickname: body.nickname };
    await c.env.DB.prepare(
      "INSERT INTO users(id,invite_code_id,nickname,nickname_normalized) VALUES(?,?,?,?)",
    )
      .bind(user.id, invite.id, user.nickname, normalized)
      .run();
  } else {
    await c.env.DB.prepare(
      "UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(user.id)
      .run();
  }
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll(
    "-",
    "",
  );
  const tokenHash = await sha(token);
  const expiresAt = iso(new Date(Date.now() + 30 * 86400000));
  await c.env.DB.prepare(
    "INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)",
  )
    .bind(uuid("ses"), user.id, tokenHash, expiresAt)
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/",
    maxAge: 30 * 86400,
  });
  return c.json(ok({ expiresAt, user }));
});

app.post("/auth/logout", async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
    .bind(c.get("tokenHash"))
    .run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json(ok({ loggedOut: true }));
});

app.get("/auth/me", async (c) => {
  const session = await c.env.DB.prepare(
    "SELECT expires_at AS expiresAt FROM sessions WHERE token_hash=?",
  )
    .bind(c.get("tokenHash"))
    .first<{ expiresAt: string }>();
  return c.json(
    ok({
      user: { id: c.get("userId"), nickname: c.get("nickname") },
      expiresAt: session?.expiresAt,
    }),
  );
});

app.get("/knowledge", async (c) => {
  const params = z
    .object({
      module: z
        .enum([
          "data_analysis",
          "verbal",
          "judgment",
          "common_sense",
          "quantitative",
          "essay",
        ])
        .optional(),
      category: z.string().min(1).max(50).optional(),
      q: z.string().max(50).optional(),
    })
    .passthrough()
    .parse(c.req.query());
  const module = params.module;
  const category = params.category;
  const query = params.q?.trim().toLocaleLowerCase("zh-CN");
  const limit = integerQuery(c.req.query("limit"), 20, 1, 100);
  const offset = integerQuery(c.req.query("cursor"), 0, 0, 1000000);
  const entries = await loadEntries(c);
  const search = query ? await loadSearch(c) : [];
  let items = entries.map(
    ({ markdown: _markdown, html: _html, source: _source, ...entry }) => entry,
  );
  if (module) items = items.filter((item) => item.module === module);
  if (category) items = items.filter((item) => item.category === category);
  if (query) {
    const ids = new Set(
      search
        .filter((item) =>
          `${item.title} ${item.summary} ${item.text}`
            .toLocaleLowerCase("zh-CN")
            .includes(query),
        )
        .map((item) => item.id),
    );
    items = items.filter((item) => ids.has(item.id));
  }
  const page = items.slice(offset, offset + limit);
  return c.json(
    ok({
      items: page,
      nextCursor: offset + limit < items.length ? String(offset + limit) : null,
    }),
  );
});

function splitSections(markdown: string) {
  const sections: Array<{ heading: string; content: string }> = [];
  let heading = "正文";
  let lines: string[] = [];
  for (const line of markdown.split("\n")) {
    if (/^#{1,2}\s+/.test(line)) {
      if (lines.join("\n").trim())
        sections.push({ heading, content: lines.join("\n").trim() });
      heading = line.replace(/^#{1,2}\s+/, "");
      lines = [];
    } else lines.push(line);
  }
  if (lines.join("\n").trim())
    sections.push({ heading, content: lines.join("\n").trim() });
  return sections;
}

type EssayCard = {
  termId: string;
  entryId: string;
  category: string;
  front: string;
  back: string;
  hint: string;
};
function stableTermId(entryId: string, front: string, back: string) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of encoder.encode(`${front}\u0000${back}`)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${entryId}:${hash.toString(16).padStart(16, "0")}`;
}
function essayCards(entries: KnowledgeEntry[]): EssayCard[] {
  const cards: EssayCard[] = [];
  for (const entry of entries.filter(
    (item) => item.module === "essay" && item.category === "standard-terms",
  )) {
    for (const line of entry.markdown.split("\n")) {
      if (!line.trim().startsWith("|")) continue;
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (
        cells.length < 2 ||
        cells[0] === "材料信号" ||
        cells.every((cell) => /^-+$/.test(cell))
      )
        continue;
      cards.push({
        termId: stableTermId(entry.id, cells[0], cells[1]),
        entryId: entry.id,
        category: entry.title.replace(/^规范词：/, ""),
        front: cells[0],
        back: cells[1],
        hint: cells[2] ?? "",
      });
    }
  }
  return cards;
}

app.get("/essay/cards", async (c) => {
  const category = z
    .string()
    .min(1)
    .max(50)
    .optional()
    .parse(c.req.query("category"));
  const now = iso();
  const entries = await loadEntries(c);
  let cards = essayCards(entries);
  if (category) cards = cards.filter((card) => card.category === category);
  const rows = await c.env.DB.prepare(
    "SELECT term_id AS termId,repetitions,interval_days AS intervalDays,ease,due_at AS dueAt,last_reviewed_at AS lastReviewedAt,remembered_count AS rememberedCount,forgot_count AS forgotCount FROM essay_term_progress WHERE user_id=?",
  )
    .bind(c.get("userId"))
    .all<Record<string, unknown>>();
  const progress = new Map(
    rows.results.map((row) => [String(row.termId), row]),
  );
  const enriched = cards.map((card) => ({
    ...card,
    progress: progress.get(card.termId) ?? null,
  }));
  enriched.sort((a, b) => {
    const aDue = !a.progress || String(a.progress.dueAt) <= now;
    const bDue = !b.progress || String(b.progress.dueAt) <= now;
    return Number(bDue) - Number(aDue) || a.termId.localeCompare(b.termId);
  });
  const reviewed = enriched.filter((card) => card.progress);
  const remembered = reviewed.reduce(
    (sum, card) => sum + Number(card.progress?.rememberedCount ?? 0),
    0,
  );
  const forgot = reviewed.reduce(
    (sum, card) => sum + Number(card.progress?.forgotCount ?? 0),
    0,
  );
  const summary = {
    total: enriched.length,
    new: enriched.filter((card) => !card.progress).length,
    due: enriched.filter(
      (card) => card.progress && String(card.progress.dueAt) <= now,
    ).length,
    learning: reviewed.filter((card) => Number(card.progress?.repetitions) < 3)
      .length,
    mastered: reviewed.filter((card) => Number(card.progress?.repetitions) >= 3)
      .length,
    accuracy: remembered + forgot ? remembered / (remembered + forgot) : 0,
  };
  return c.json(
    ok({
      cards: enriched,
      categories: [...new Set(cards.map((card) => card.category))],
      summary,
    }),
  );
});

app.post("/essay/reviews", async (c) => {
  const body = await jsonBody(
    c.req.raw,
    z.object({
      termId: z.string().min(3).max(100),
      rating: z.enum(["forgot", "hard", "remembered"]),
      idempotencyKey: z.string().uuid(),
    }),
  );
  const entriesForCards = await loadEntries(c);
  const card = essayCards(entriesForCards).find(
    (candidate) => candidate.termId === body.termId,
  );
  if (!card) return c.json(fail("NOT_FOUND", "规范词卡片不存在"), 404);
  const previous = await c.env.DB.prepare(
    "SELECT term_id AS termId,rating,interval_days AS intervalDays,due_at AS dueAt,reviewed_at AS reviewedAt FROM essay_review_events WHERE user_id=? AND idempotency_key=?",
  )
    .bind(c.get("userId"), body.idempotencyKey)
    .first<Record<string, unknown>>();
  if (previous) return c.json(ok(previous));
  const current = await c.env.DB.prepare(
    "SELECT repetitions,interval_days AS intervalDays,ease,remembered_count AS rememberedCount,forgot_count AS forgotCount FROM essay_term_progress WHERE user_id=? AND term_id=?",
  )
    .bind(c.get("userId"), body.termId)
    .first<{
      repetitions: number;
      intervalDays: number;
      ease: number;
      rememberedCount: number;
      forgotCount: number;
    }>();
  const next = scheduleReview(
    current ?? initialProgress,
    body.rating as ReviewRating,
  );
  const progressStatement = c.env.DB.prepare(
    `INSERT INTO essay_term_progress(user_id,term_id,repetitions,interval_days,ease,due_at,last_reviewed_at,remembered_count,forgot_count) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,term_id) DO UPDATE SET repetitions=excluded.repetitions,interval_days=excluded.interval_days,ease=excluded.ease,due_at=excluded.due_at,last_reviewed_at=excluded.last_reviewed_at,remembered_count=excluded.remembered_count,forgot_count=excluded.forgot_count`,
  ).bind(
    c.get("userId"),
    body.termId,
    next.repetitions,
    next.intervalDays,
    next.ease,
    next.dueAt,
    next.lastReviewedAt,
    next.rememberedCount,
    next.forgotCount,
  );
  const eventId = uuid("er");
  const eventStatement = c.env.DB.prepare(
    "INSERT INTO essay_review_events(id,user_id,term_id,rating,interval_days,due_at,idempotency_key,reviewed_at) VALUES(?,?,?,?,?,?,?,?)",
  ).bind(
    eventId,
    c.get("userId"),
    body.termId,
    body.rating,
    next.intervalDays,
    next.dueAt,
    body.idempotencyKey,
    next.lastReviewedAt,
  );
  try {
    await c.env.DB.batch([progressStatement, eventStatement]);
  } catch (error) {
    const raced = await c.env.DB.prepare(
      "SELECT term_id AS termId,rating,interval_days AS intervalDays,due_at AS dueAt,reviewed_at AS reviewedAt FROM essay_review_events WHERE user_id=? AND idempotency_key=?",
    )
      .bind(c.get("userId"), body.idempotencyKey)
      .first<Record<string, unknown>>();
    if (raced) return c.json(ok(raced));
    throw error;
  }
  return c.json(
    ok({ eventId, termId: body.termId, rating: body.rating, ...next }),
  );
});

app.get("/essay/reviews/history", async (c) => {
  const limit = integerQuery(c.req.query("limit"), 30, 1, 100);
  const rows = await c.env.DB.prepare(
    "SELECT id,term_id AS termId,rating,interval_days AS intervalDays,due_at AS dueAt,reviewed_at AS reviewedAt FROM essay_review_events WHERE user_id=? ORDER BY reviewed_at DESC LIMIT ?",
  )
    .bind(c.get("userId"), limit)
    .all<Record<string, unknown>>();
  const entriesForHistory = await loadEntries(c);
  const cards = new Map(essayCards(entriesForHistory).map((card) => [card.termId, card]));
  const items = rows.results.map((row) => ({
    ...row,
    card: cards.get(String(row.termId)) ?? null,
  }));
  const today = iso().slice(0, 10);
  return c.json(
    ok({
      items,
      todayCount: items.filter(
        (item) =>
          String((item as Record<string, unknown>).reviewedAt).slice(0, 10) ===
          today,
      ).length,
    }),
  );
});

app.get("/knowledge/:id", async (c) => {
  const entries = await loadEntries(c);
  const entry = entries.find(
    (candidate) => candidate.id === c.req.param("id"),
  );
  if (!entry) return c.json(fail("NOT_FOUND", "知识条目不存在"), 404);
  const sections = splitSections(entry.markdown);
  const take = (name: string) =>
    sections.find((section) => section.heading === name)?.content ?? "";
  const example =
    entry.module === "quantitative"
      ? { stem: take("例题"), answer: take("答案"), explanation: take("讲解") }
      : null;
  return c.json(
    ok({
      id: entry.id,
      module: entry.module,
      category: entry.category,
      title: entry.title,
      html: entry.html,
      sections,
      example,
    }),
  );
});

app.get("/quiz/topics", (c) =>
  c.json(ok({ topics, difficulties, generatorVersion: 2, recentWindow: 50 })),
);

app.post("/quiz/questions", async (c) => {
  const body = await jsonBody(
    c.req.raw,
    z.object({
      topicId: z.enum([
        "arithmetic",
        "multiply",
        "divide",
        "sensitive",
        "decimal",
        "growth",
        "ratio",
        "annual",
        "interval-growth",
        "mixed-growth",
        "multiples",
        "ratio-change",
      ]),
      difficulty: z.enum(["easy", "medium", "hard"]),
    }),
  );
  const generationKey = `generation:${c.get("userId")}`;
  const generatedLastMinute = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM auth_attempts WHERE client_key=? AND created_at>datetime('now','-1 minute')",
  )
    .bind(generationKey)
    .first<{ count: number }>();
  if ((generatedLastMinute?.count ?? 0) >= 120)
    return c.json(fail("RATE_LIMITED", "生成请求过于频繁，请稍后再试"), 429);
  await c.env.DB.prepare(
    "INSERT INTO auth_attempts(client_key,succeeded) VALUES(?,1)",
  )
    .bind(generationKey)
    .run();
  const recent = await c.env.DB.prepare(
    "SELECT fingerprint FROM generated_questions WHERE user_id=? AND topic_id=? AND difficulty=? ORDER BY created_at DESC LIMIT 50",
  )
    .bind(c.get("userId"), body.topicId, body.difficulty)
    .all<{ fingerprint: string }>();
  const seed = crypto.randomUUID();
  const generated = generateQuestion({
    topicId: body.topicId as TopicId,
    difficulty: body.difficulty as Difficulty,
    excludedFingerprints: recent.results.map((row) => row.fingerprint),
    randomSeed: seed,
  });
  const questionId = uuid("q");
  const generatedAt = iso();
  const expiresAt = iso(new Date(Date.now() + 7 * 86400000));
  await c.env.DB.prepare(
    "INSERT INTO generated_questions(id,user_id,topic_id,difficulty,template_id,template_version,fingerprint,seed,stem,options_json,answer_index,explanation,params_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      questionId,
      c.get("userId"),
      body.topicId,
      body.difficulty,
      generated.templateId,
      generated.templateVersion,
      generated.fingerprint,
      seed,
      generated.stem,
      JSON.stringify(generated.options),
      generated.answerIndex,
      generated.explanation,
      JSON.stringify(generated.params),
      generatedAt,
      expiresAt,
    )
    .run();
  return c.json(
    ok({
      questionId,
      topicId: body.topicId,
      difficulty: body.difficulty,
      stem: generated.stem,
      options: generated.options,
      generatedAt,
      expiresAt,
    }),
  );
});

app.post("/quiz/answers", async (c) => {
  const body = await jsonBody(
    c.req.raw,
    z.object({
      questionId: z.string().min(1),
      selectedIndex: z.number().int().min(0).max(3),
      elapsedMs: z.number().int().min(0).max(3600000),
      idempotencyKey: z.string().uuid(),
    }),
  );
  const previous = await c.env.DB.prepare(
    "SELECT a.id AS attemptId,a.correct,q.answer_index AS answerIndex,q.explanation,a.created_at AS savedAt FROM quiz_attempts a JOIN generated_questions q ON q.id=a.question_id WHERE a.user_id=? AND a.idempotency_key=?",
  )
    .bind(c.get("userId"), body.idempotencyKey)
    .first<Record<string, unknown>>();
  if (previous) return c.json(ok(previous));
  const question = await c.env.DB.prepare(
    "SELECT answer_index AS answerIndex,explanation,expires_at AS expiresAt FROM generated_questions WHERE id=? AND user_id=?",
  )
    .bind(body.questionId, c.get("userId"))
    .first<{ answerIndex: number; explanation: string; expiresAt: string }>();
  if (!question) return c.json(fail("NOT_FOUND", "题目不存在或无权访问"), 404);
  if (new Date(question.expiresAt).getTime() < Date.now())
    return c.json(fail("QUESTION_EXPIRED", "题目已过期"), 410);
  const existing = await c.env.DB.prepare(
    "SELECT id FROM quiz_attempts WHERE user_id=? AND question_id=?",
  )
    .bind(c.get("userId"), body.questionId)
    .first();
  if (existing) return c.json(fail("ALREADY_ANSWERED", "该题已提交"), 409);
  const attemptId = uuid("att");
  const correct = body.selectedIndex === question.answerIndex;
  const savedAt = iso();
  await c.env.DB.prepare(
    "INSERT INTO quiz_attempts(id,user_id,question_id,selected_index,correct,duration_ms,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      attemptId,
      c.get("userId"),
      body.questionId,
      body.selectedIndex,
      correct ? 1 : 0,
      body.elapsedMs,
      body.idempotencyKey,
      savedAt,
    )
    .run();
  return c.json(
    ok({
      attemptId,
      correct,
      answerIndex: question.answerIndex,
      explanation: question.explanation,
      savedAt,
    }),
  );
});

app.get("/quiz/stats", async (c) => {
  const filters = z
    .object({
      topicId: z
        .enum([
          "arithmetic",
          "multiply",
          "divide",
          "sensitive",
          "decimal",
          "growth",
          "ratio",
          "annual",
          "interval-growth",
          "mixed-growth",
          "multiples",
          "ratio-change",
        ])
        .optional(),
      difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    })
    .passthrough()
    .parse(c.req.query());
  const conditions = ["a.user_id=?"];
  const bindings: unknown[] = [c.get("userId")];
  if (filters.topicId) {
    conditions.push("q.topic_id=?");
    bindings.push(filters.topicId);
  }
  if (filters.difficulty) {
    conditions.push("q.difficulty=?");
    bindings.push(filters.difficulty);
  }
  const rows = await c.env.DB.prepare(
    `SELECT q.topic_id AS topicId,q.difficulty,COUNT(*) AS total,SUM(a.correct) AS correct,AVG(a.duration_ms) AS averageMs FROM quiz_attempts a JOIN generated_questions q ON q.id=a.question_id WHERE ${conditions.join(" AND ")} GROUP BY q.topic_id,q.difficulty`,
  )
    .bind(...bindings)
    .all<{
      topicId: string;
      difficulty: string;
      total: number;
      correct: number;
      averageMs: number;
    }>();
  const groups = rows.results.map((row) => ({
    ...row,
    accuracy: row.total ? row.correct / row.total : 0,
    averageMs: Math.round(row.averageMs),
  }));
  const total = groups.reduce((sum, row) => sum + row.total, 0);
  const correct = groups.reduce((sum, row) => sum + row.correct, 0);
  const weightedMs = groups.reduce(
    (sum, row) => sum + row.averageMs * row.total,
    0,
  );
  return c.json(
    ok({
      groups,
      overall: {
        total,
        correct,
        accuracy: total ? correct / total : 0,
        averageMs: total ? Math.round(weightedMs / total) : 0,
      },
    }),
  );
});

app.get("/quiz/mistakes", async (c) => {
  const limit = integerQuery(c.req.query("limit"), 20, 1, 100);
  const rows = await c.env.DB.prepare(
    `SELECT q.id AS questionId,q.topic_id AS topicId,q.difficulty,q.stem,q.options_json AS optionsJson,q.answer_index AS answerIndex,q.explanation,a.mastered,COALESCE((SELECT MAX(r.created_at) FROM quiz_retry_attempts r WHERE r.user_id=a.user_id AND r.question_id=a.question_id AND r.correct=0),a.created_at) AS lastWrongAt,1+(SELECT COUNT(*) FROM quiz_retry_attempts r WHERE r.user_id=a.user_id AND r.question_id=a.question_id AND r.correct=0) AS wrongCount FROM quiz_attempts a JOIN generated_questions q ON q.id=a.question_id WHERE a.user_id=? AND a.correct=0 ORDER BY lastWrongAt DESC LIMIT ?`,
  )
    .bind(c.get("userId"), limit)
    .all<Record<string, unknown>>();
  return c.json(
    ok({
      items: rows.results.map((row) => ({
        ...row,
        options: JSON.parse(String(row.optionsJson)),
        optionsJson: undefined,
        mastered: Boolean(row.mastered),
      })),
      nextCursor: null,
    }),
  );
});

app.post("/quiz/mistakes/:questionId/retry", async (c) => {
  const body = await jsonBody(
    c.req.raw,
    z.object({
      selectedIndex: z.number().int().min(0).max(3),
      elapsedMs: z.number().int().min(0).max(3600000),
      idempotencyKey: z.string().uuid(),
    }),
  );
  const previous = await c.env.DB.prepare(
    "SELECT id AS retryId,correct,created_at AS savedAt FROM quiz_retry_attempts WHERE user_id=? AND idempotency_key=?",
  )
    .bind(c.get("userId"), body.idempotencyKey)
    .first<Record<string, unknown>>();
  if (previous) return c.json(ok(previous));
  const mistake = await c.env.DB.prepare(
    "SELECT q.answer_index AS answerIndex,q.explanation,a.id AS attemptId FROM quiz_attempts a JOIN generated_questions q ON q.id=a.question_id WHERE a.user_id=? AND a.question_id=? AND a.correct=0",
  )
    .bind(c.get("userId"), c.req.param("questionId"))
    .first<{ answerIndex: number; explanation: string; attemptId: string }>();
  if (!mistake) return c.json(fail("NOT_FOUND", "错题不存在"), 404);
  const retryId = uuid("retry");
  const correct = body.selectedIndex === mistake.answerIndex;
  const savedAt = iso();
  const insert = c.env.DB.prepare(
    "INSERT INTO quiz_retry_attempts(id,user_id,question_id,selected_index,correct,duration_ms,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?)",
  ).bind(
    retryId,
    c.get("userId"),
    c.req.param("questionId"),
    body.selectedIndex,
    correct ? 1 : 0,
    body.elapsedMs,
    body.idempotencyKey,
    savedAt,
  );
  const mastery = c.env.DB.prepare(
    "UPDATE quiz_attempts SET mastered=? WHERE id=?",
  ).bind(correct ? 1 : 0, mistake.attemptId);
  try {
    await c.env.DB.batch([insert, mastery]);
  } catch (error) {
    const raced = await c.env.DB.prepare(
      "SELECT id AS retryId,correct,created_at AS savedAt FROM quiz_retry_attempts WHERE user_id=? AND idempotency_key=?",
    )
      .bind(c.get("userId"), body.idempotencyKey)
      .first<Record<string, unknown>>();
    if (raced) return c.json(ok(raced));
    throw error;
  }
  return c.json(
    ok({
      retryId,
      correct,
      answerIndex: mistake.answerIndex,
      explanation: mistake.explanation,
      mastered: correct,
      savedAt,
    }),
  );
});

app.patch("/quiz/mistakes/:questionId/mastery", async (c) => {
  const body = await jsonBody(c.req.raw, z.object({ mastered: z.boolean() }));
  const attempt = await c.env.DB.prepare(
    "SELECT id FROM quiz_attempts WHERE user_id=? AND question_id=? AND correct=0",
  )
    .bind(c.get("userId"), c.req.param("questionId"))
    .first();
  if (!attempt) return c.json(fail("NOT_FOUND", "错题不存在"), 404);
  await c.env.DB.prepare("UPDATE quiz_attempts SET mastered=? WHERE id=?")
    .bind(body.mastered ? 1 : 0, (attempt as { id: string }).id)
    .run();
  return c.json(
    ok({ questionId: c.req.param("questionId"), mastered: body.mastered }),
  );
});

app.post("/schulte/results", async (c) => {
  const body = await jsonBody(
    c.req.raw,
    z
      .object({
        gridSize: z.number().int().min(2).max(10),
        variant: z.enum(["standard", "hanzi", "color_letters"]),
        elapsedMs: z.number().int().min(1).max(3600000),
        mistakes: z.number().int().nonnegative(),
        idempotencyKey: z.string().uuid(),
      })
      .refine(
        (value) => value.variant !== "color_letters" || value.gridSize <= 5,
        "彩色字母最大为 5 阶",
      ),
  );
  const previous = await c.env.DB.prepare(
    "SELECT id AS resultId,duration_ms AS elapsedMs,created_at AS savedAt FROM schulte_results WHERE user_id=? AND idempotency_key=?",
  )
    .bind(c.get("userId"), body.idempotencyKey)
    .first<{ resultId: string; elapsedMs: number; savedAt: string }>();
  if (previous)
    return c.json(
      ok({
        ...previous,
        personalBestMs: previous.elapsedMs,
        deltaFromBestMs: 0,
      }),
    );
  const best = await c.env.DB.prepare(
    "SELECT MIN(duration_ms) AS best FROM schulte_results WHERE user_id=? AND grid_size=? AND variant=?",
  )
    .bind(c.get("userId"), body.gridSize, body.variant)
    .first<{ best: number | null }>();
  const resultId = uuid("sr");
  const savedAt = iso();
  await c.env.DB.prepare(
    "INSERT INTO schulte_results(id,user_id,grid_size,variant,duration_ms,errors,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      resultId,
      c.get("userId"),
      body.gridSize,
      body.variant,
      body.elapsedMs,
      body.mistakes,
      body.idempotencyKey,
      savedAt,
    )
    .run();
  const personalBestMs =
    best?.best == null ? body.elapsedMs : Math.min(best.best, body.elapsedMs);
  return c.json(
    ok({
      resultId,
      personalBestMs,
      deltaFromBestMs: best?.best == null ? 0 : body.elapsedMs - best.best,
      savedAt,
    }),
  );
});

app.get("/schulte/results", async (c) => {
  const filters = z
    .object({
      gridSize: z.coerce.number().int().min(2).max(10).optional(),
      variant: z.enum(["standard", "hanzi", "color_letters"]).optional(),
    })
    .passthrough()
    .parse(c.req.query());
  const conditions = ["user_id=?"];
  const bindings: unknown[] = [c.get("userId")];
  if (filters.gridSize) {
    conditions.push("grid_size=?");
    bindings.push(filters.gridSize);
  }
  if (filters.variant) {
    conditions.push("variant=?");
    bindings.push(filters.variant);
  }
  const limit = integerQuery(c.req.query("limit"), 20, 1, 100);
  const rows = await c.env.DB.prepare(
    `SELECT id,grid_size AS gridSize,variant,duration_ms AS elapsedMs,errors AS mistakes,created_at AS createdAt FROM schulte_results WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(...bindings, limit)
    .all<{
      id: string;
      gridSize: number;
      variant: string;
      elapsedMs: number;
      mistakes: number;
      createdAt: string;
    }>();
  const best = await c.env.DB.prepare(
    `SELECT MIN(duration_ms) AS best FROM schulte_results WHERE ${conditions.join(" AND ")}`,
  )
    .bind(...bindings)
    .first<{ best: number | null }>();
  const personalBestMs = best?.best ?? null;
  const trend =
    rows.results.length < 2
      ? []
      : [...rows.results]
          .reverse()
          .map((row) => ({ time: row.createdAt, valueMs: row.elapsedMs }));
  return c.json(
    ok({ items: rows.results, personalBestMs, trend, nextCursor: null }),
  );
});

export const onRequest = handle(app);
