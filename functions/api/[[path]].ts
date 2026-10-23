import { Hono } from "hono";
import type { Context } from "hono";
import { handle } from "hono/cloudflare-pages";
import { z } from "zod";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  generateQuestion,
  isCatalogTopic,
  topicById,
  topicBudget,
  difficultyBudgetMs,
  topics,
  titleOf,
  legacyTopics,
  difficulties,
  tracks as catalogTracks,
} from "../../src/generator";
import type { TopicId } from "../../src/generator";
import type { GeneratedQuestion, MaterialSpec } from "../../src/generator/types";
import {
  initialProgress,
  scheduleReview,
  type ReviewRating,
} from "../../src/essay/scheduler";
import {
  ESSAY_LEVELS,
  ESSAY_STAGES,
  essayLevelById,
  essayMinutes,
  essayPreviousLevel,
  essayUnlocked,
} from "../../src/essay/training";
import { essayQuizIssue, essayQuizOf, gradeEssayQuiz } from "../../src/essay/bank";
import { essayStars } from "../../src/essay/rules";
import {
  WRITING_PROMPTS,
  gradeWriting,
  writingPromptById,
} from "../../src/essay/writing";
import { MISTAKE_CAUSE_IDS } from "../../src/mistakes";

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
  // Pages 静态资源绑定（内容 JSON 静态化后运行时读取；运行时经 ASSETS.fetch 读取 /generated/**）
  ASSETS?: { fetch(input: string | URL | Request): Promise<Response> };
  // 密码重置邮件（Resend）；未配置时本地开发通过 devResetUrl 直接拿到链接
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  APP_URL?: string;
};
type Variables = {
  userId: string;
  tokenHash: string;
  nickname: string;
  email: string;
};
type AppEnv = { Bindings: Bindings; Variables: Variables };
type AppContext = Context<AppEnv>;

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
// 说明：sessions.last_seen_at 以前在这里每请求更新一次，节流状态存在 isolate 内存里。
// 但 isolate 随时回收，节流几乎不生效——于是**每个 API 请求都要付一次 D1 写**（写比读贵得多），
// 而该字段全库只写不读（仅建表时有默认值），属纯开销。已移除，登录时由 DEFAULT CURRENT_TIMESTAMP 填充。

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

// ==================== 闯关题库：难度局/通关/星级 ====================
export const RUN_LENGTH = 10;
export const RUN_DIFFICULTIES = ["easy", "medium", "hard"] as const;
type RunDifficulty = (typeof RUN_DIFFICULTIES)[number];

/** 难度局 key：topicId|difficulty */
const diffKey = (topicId: string, difficulty: RunDifficulty) => `${topicId}|${difficulty}`;

/** 单局判定：完整 10 题、答对 ≥8、总用时不超过该难度局预算 */
function runStars(agg: {
  topicId: string;
  difficulty: RunDifficulty;
  total: number;
  correct: number;
  durationMs: number;
}): number {
  if (agg.total < RUN_LENGTH) return 0;
  const topic = topicById.get(agg.topicId as TopicId);
  if (topic && agg.durationMs > difficultyBudgetMs(topic, agg.difficulty)) return 0;
  const accuracy = agg.correct / agg.total;
  if (accuracy >= 1) return 3;
  if (accuracy >= 0.9) return 2;
  if (accuracy >= 0.8) return 1;
  return 0;
}

interface RunAgg {
  topicId: string;
  difficulty: RunDifficulty;
  runId: string;
  total: number;
  correct: number;
  durationMs: number;
}

async function loadQuizStatus(c: { env: Bindings; get(key: string): string }) {
  const userId = c.get("userId");
  const [runRows, statRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT q.topic_id AS topicId,q.difficulty AS difficulty,a.run_id AS runId,COUNT(*) AS total,SUM(a.correct) AS correct,SUM(a.duration_ms) AS durationMs
       FROM quiz_attempts a JOIN generated_questions q ON q.id=a.question_id
       WHERE a.user_id=? AND a.run_id IS NOT NULL GROUP BY q.topic_id,q.difficulty,a.run_id`,
    )
      .bind(userId)
      .all<RunAgg>(),
    c.env.DB.prepare(
      `SELECT q.topic_id AS topicId,q.difficulty AS difficulty,COUNT(*) AS total,SUM(a.correct) AS correct,AVG(a.duration_ms) AS averageMs,MAX(a.created_at) AS lastRunAt
       FROM quiz_attempts a JOIN generated_questions q ON q.id=a.question_id
       WHERE a.user_id=? GROUP BY q.topic_id,q.difficulty`,
    )
      .bind(userId)
      .all<Record<string, unknown>>(),
  ]);
  // 各难度局最佳星级（stars ≥1 即通过该局；模块“高难度局”通过才解锁下一模块）
  const passStars = new Map<string, number>();
  for (const row of runRows.results) {
    const difficulty = (String(row.difficulty) as RunDifficulty) ?? "hard";
    const stars = runStars({
      topicId: row.topicId,
      difficulty,
      total: Number(row.total),
      correct: Number(row.correct),
      durationMs: Number(row.durationMs),
    });
    const key = diffKey(row.topicId, difficulty);
    if (stars > (passStars.get(key) ?? 0)) passStars.set(key, stars);
  }
  const stats = new Map<string, { total: number; correct: number; accuracy: number; averageMs: number; lastRunAt: string | null }>();
  for (const row of statRows.results) {
    const total = Number(row.total) || 0;
    const correct = Number(row.correct) || 0;
    const averageMs = Math.round(Number(row.averageMs) || 0);
    stats.set(diffKey(String(row.topicId), String(row.difficulty) as RunDifficulty), {
      total,
      correct,
      accuracy: total ? correct / total : 0,
      averageMs,
      lastRunAt: row.lastRunAt ? String(row.lastRunAt) : null,
    });
  }
  return { passStars, stats };
}

/**
 * 只查「指定前置模块的高难度局是否通过」，不再全量聚合。
 *
 * 为什么需要它：开局时要做的只是**解锁校验**，而 loadQuizStatus 会把该用户全部历史
 * （所有模块 × 所有难度 × 每一局）JOIN 聚合一遍。它随答题量线性变慢——已经 500+ 题、
 * 几十局时，这一趟是「点进关卡卡在加载中」的主要服务端成本。
 * 这里把范围收窄到 topic.unlock 那 1–2 个前置模块的 hard 局，GROUP BY 组数从「全部局数」
 * 降到「1–3 组」，扫描量只与该模块相关。
 */
async function loadPrereqStars(
  c: { env: Bindings; get(key: string): string },
  prereqIds: readonly TopicId[],
): Promise<Map<string, number>> {
  const stars = new Map<string, number>();
  if (prereqIds.length === 0) return stars;
  const placeholders = prereqIds.map(() => "?").join(",");
  const rows = await c.env.DB.prepare(
    `SELECT q.topic_id AS topicId,COUNT(*) AS total,SUM(a.correct) AS correct,SUM(a.duration_ms) AS durationMs
     FROM quiz_attempts a JOIN generated_questions q ON q.id=a.question_id
     WHERE a.user_id=? AND q.topic_id IN (${placeholders}) AND q.difficulty='hard' AND a.run_id IS NOT NULL
     GROUP BY q.topic_id,a.run_id`,
  )
    .bind(c.get("userId"), ...prereqIds)
    .all<{ topicId: string; total: number; correct: number; durationMs: number }>();
  for (const row of rows.results) {
    const value = runStars({
      topicId: String(row.topicId),
      difficulty: "hard",
      total: Number(row.total),
      correct: Number(row.correct),
      durationMs: Number(row.durationMs),
    });
    if (value > (stars.get(String(row.topicId)) ?? 0)) stars.set(String(row.topicId), value);
  }
  return stars;
}

/** 模块是否解锁：前置模块的“高难度局（实战）”均通过 */
function isUnlocked(passStars: Map<string, number>, topicId: TopicId) {
  const topic = topicById.get(topicId);
  if (!topic) return false;
  return topic.unlock.every((prereq) => (passStars.get(diffKey(prereq, "hard")) ?? 0) >= 1);
}

// 生成节流：isolate 内存滑动窗口（尽力近似，冷启动后重置不影响正确性）
const generationWindow = new Map<string, number[]>();
function allowGeneration(key: string, now = Date.now()): boolean {
  const recent = (generationWindow.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 120) {
    generationWindow.set(key, recent);
    return false;
  }
  recent.push(now);
  generationWindow.set(key, recent);
  return true;
}

/** 规范词卡片解析缓存：内容随部署静态不变，isolate 级缓存一次 */
let essayCardsCache: EssayCard[] | null = null;
async function getEssayCards(c: { env: Bindings }): Promise<EssayCard[]> {
  if (essayCardsCache) return essayCardsCache;
  const entries = await loadEntries(c);
  essayCardsCache = essayCards(entries);
  return essayCardsCache;
}

// ==================== 个人统计（/profile/summary 聚合） ====================
/** 将记录时刻按东八区折算到自然日 */
function cnDay(raw: string, offsetHours = 8) {
  const normalized = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const time = Date.parse(normalized);
  if (Number.isNaN(time)) return raw.slice(0, 10);
  return new Date(time + offsetHours * 3600_000).toISOString().slice(0, 10);
}

/** 连续学习天数：days 为含全部学习日的 Set（'YYYY-MM-DD'，按东八区） */
function streakOf(days: Set<string>) {
  const today = cnDay(iso());
  const toDayKey = (time: number) =>
    new Date(time + 8 * 3600_000).toISOString().slice(0, 10);
  let streak = days.has(today) ? 1 : 0;
  let cursor = Date.now() - 86400_000;
  while (days.has(toDayKey(cursor))) {
    streak += 1;
    cursor -= 86400_000;
  }
  return { streak, activeToday: days.has(today) };
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

async function sha(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// ---- 邮箱注册登录 ----
// Workers WebCrypto rejects PBKDF2 iteration counts above 100000.
const PASSWORD_ITERATIONS = 100_000;
const SESSION_DAYS = 30;
const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email("邮箱格式不正确")
  .transform((value) => value.toLocaleLowerCase("en-US"));
const passwordSchema = z
  .string()
  .min(8, "密码至少 8 位")
  .max(72, "密码最多 72 位");

function toBase64(bytes: Uint8Array) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function fromBase64(value: string) {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as BufferSource,
      iterations,
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

async function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false;
  const [scheme, iterationsRaw, saltBase64, hashBase64] = stored.split("$");
  const iterations = Number(iterationsRaw);
  if (
    scheme !== "pbkdf2-sha256" ||
    !Number.isInteger(iterations) ||
    iterations < 1000 ||
    !saltBase64 ||
    !hashBase64
  )
    return false;
  const expected = fromBase64(hashBase64);
  const actual = await derivePassword(
    password,
    fromBase64(saltBase64),
    iterations,
  );
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < actual.length; index += 1)
    diff |= actual[index] ^ expected[index];
  return diff === 0;
}

/** 未注册邮箱也跑一次 PBKDF2，让失败响应耗时接近，降低邮箱枚举价值 */
let dummyPasswordHash: Promise<string> | null = null;
function getDummyPasswordHash() {
  dummyPasswordHash ??= hashPassword("dummy-password-not-used");
  return dummyPasswordHash;
}

async function createSession(c: AppContext, userId: string) {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll(
    "-",
    "",
  );
  const tokenHash = await sha(token);
  const expiresAt = iso(new Date(Date.now() + SESSION_DAYS * 86400000));
  await c.env.DB.prepare(
    "INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)",
  )
    .bind(uuid("ses"), userId, tokenHash, expiresAt)
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return expiresAt;
}

const RESET_TOKEN_MINUTES = 30;

function resetToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sendResetEmail(c: AppContext, to: string, resetUrl: string) {
  const apiKey = c.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: c.env.MAIL_FROM ?? "学习助手 <onboarding@resend.dev>",
      to: [to],
      subject: "学习助手 · 重置密码",
      text: `请打开以下链接重置密码（${RESET_TOKEN_MINUTES} 分钟内有效）：\n${resetUrl}\n\n如果这不是你的操作，请忽略此邮件。`,
      html: `<p>请打开以下链接重置密码（${RESET_TOKEN_MINUTES} 分钟内有效）：</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>如果这不是你的操作，请忽略此邮件。</p>`,
    }),
  });
  if (!response.ok) {
    console.error(
      `[auth] reset email failed: ${response.status} ${await response.text()}`,
    );
  }
  return response.ok;
}

async function authAttemptsExceeded(
  c: AppContext,
  key: string,
  limit: number,
  failuresOnly = false,
) {
  const attempts = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM auth_attempts WHERE client_key=? AND created_at>datetime('now','-10 minutes')${failuresOnly ? " AND succeeded=0" : ""}`,
  )
    .bind(key)
    .first<{ count: number }>();
  return (attempts?.count ?? 0) >= limit;
}

async function recordAuthAttempt(
  c: AppContext,
  key: string,
  succeeded: boolean,
) {
  await c.env.DB.prepare(
    "INSERT INTO auth_attempts(client_key,succeeded) VALUES(?,?)",
  )
    .bind(key, succeeded ? 1 : 0)
    .run();
}

async function emailSignupInviteId(c: AppContext) {
  await c.env.DB.prepare(
    "INSERT INTO invite_codes(code_hash,label,enabled) VALUES(?,?,1) ON CONFLICT(code_hash) DO NOTHING",
  )
    .bind("email-signup", "email-signup")
    .run();
  const invite = await c.env.DB.prepare(
    "SELECT id FROM invite_codes WHERE code_hash=?",
  )
    .bind("email-signup")
    .first<{ id: number }>();
  if (!invite) throw new Error("EMAIL_SIGNUP_INVITE_MISSING");
  return invite.id;
}

async function uniqueNickname(
  c: AppContext,
  inviteId: number,
  source: string,
) {
  const cleaned = source.replace(/\s+/g, " ").trim() || "学员";
  const base = Array.from(cleaned).slice(0, 12).join("");
  for (let index = 0; index < 20; index += 1) {
    const suffix = index === 0 ? "" : String(index + 1);
    const candidate =
      Array.from(base)
        .slice(0, Math.max(1, 12 - suffix.length))
        .join("") + suffix;
    const exists = await c.env.DB.prepare(
      "SELECT id FROM users WHERE invite_code_id=? AND nickname_normalized=?",
    )
      .bind(inviteId, candidate.toLocaleLowerCase("zh-CN"))
      .first<{ id: string }>();
    if (!exists) return candidate;
  }
  return `学员${crypto.randomUUID().slice(0, 4)}`;
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
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
    const requestOrigin = c.req.header("Origin");
    const expectedOrigin = new URL(c.req.url).origin;
    if (requestOrigin && requestOrigin !== expectedOrigin)
      return c.json(fail("FORBIDDEN", "拒绝跨站写入请求"), 403);
    if (c.req.header("Sec-Fetch-Site") === "cross-site")
      return c.json(fail("FORBIDDEN", "拒绝跨站写入请求"), 403);
  }
  if (
    c.req.path === "/api/health" ||
    c.req.path === "/api/auth/login" ||
    c.req.path === "/api/auth/register" ||
    c.req.path === "/api/auth/password/forgot" ||
    c.req.path === "/api/auth/password/reset" ||
    c.req.path.startsWith("/api/mock/reports/")
  )
    return next();
  const token = getCookie(c, SESSION_COOKIE) ?? "";
  if (!token) return c.json(fail("UNAUTHORIZED", "请先登录"), 401);
  const tokenHash = await sha(token);
  const session = await c.env.DB.prepare(
    `SELECT s.user_id AS userId,s.expires_at AS expiresAt,u.nickname,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP AND u.status='active'`,
  )
    .bind(tokenHash)
    .first<{
      userId: string;
      expiresAt: string;
      nickname: string;
      email: string | null;
    }>();
  if (!session) return c.json(fail("UNAUTHORIZED", "登录已失效"), 401);
  c.set("userId", session.userId);
  c.set("tokenHash", tokenHash);
  c.set("nickname", session.nickname);
  c.set("email", session.email ?? "");
  await next();
});

app.get("/health", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json(ok({ status: "ok", database: "ok", time: iso() }));
});

app.post("/auth/register", async (c) => {
  const body = await jsonBody(
    c.req.raw,
    z.object({
      email: emailSchema,
      password: passwordSchema,
      nickname: z.string().trim().max(12).optional(),
    }),
  );
  const clientKey = `register:${await sha(c.req.header("CF-Connecting-IP") ?? "local")}`;
  if (await authAttemptsExceeded(c, clientKey, 8))
    return c.json(fail("RATE_LIMITED", "注册过于频繁，请稍后再试"), 429);
  const existing = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email_normalized=?",
  )
    .bind(body.email)
    .first<{ id: string }>();
  if (existing) {
    await recordAuthAttempt(c, clientKey, false);
    return c.json(fail("EMAIL_TAKEN", "该邮箱已注册，请直接登录"), 409);
  }
  const inviteId = await emailSignupInviteId(c);
  const nickname = await uniqueNickname(
    c,
    inviteId,
    body.nickname ?? body.email.split("@")[0] ?? "",
  );
  const user = { id: uuid("usr"), nickname, email: body.email };
  try {
    await c.env.DB.prepare(
      "INSERT INTO users(id,invite_code_id,nickname,nickname_normalized,email,email_normalized,password_hash) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(
        user.id,
        inviteId,
        nickname,
        nickname.toLocaleLowerCase("zh-CN"),
        body.email,
        body.email,
        await hashPassword(body.password),
      )
      .run();
  } catch (error) {
    await recordAuthAttempt(c, clientKey, false);
    if (String(error).includes("UNIQUE constraint failed"))
      return c.json(fail("EMAIL_TAKEN", "该邮箱已注册，请直接登录"), 409);
    throw error;
  }
  await recordAuthAttempt(c, clientKey, true);
  const expiresAt = await createSession(c, user.id);
  return c.json(ok({ expiresAt, user }), 201);
});

app.post("/auth/login", async (c) => {
  const body = await jsonBody(
    c.req.raw,
    z.object({ email: emailSchema, password: passwordSchema }),
  );
  const clientKey = `login:${await sha(c.req.header("CF-Connecting-IP") ?? "local")}`;
  if (await authAttemptsExceeded(c, clientKey, 10, true))
    return c.json(fail("RATE_LIMITED", "登录尝试过于频繁，请稍后再试"), 429);
  const user = await c.env.DB.prepare(
    "SELECT id,nickname,email,password_hash AS passwordHash FROM users WHERE email_normalized=? AND status='active'",
  )
    .bind(body.email)
    .first<{
      id: string;
      nickname: string;
      email: string;
      passwordHash: string | null;
    }>();
  const valid = await verifyPassword(
    body.password,
    user?.passwordHash ?? (await getDummyPasswordHash()),
  );
  await recordAuthAttempt(c, clientKey, Boolean(user) && valid);
  if (!user || !valid)
    return c.json(fail("INVALID_CREDENTIALS", "邮箱或密码不正确"), 401);
  await c.env.DB.prepare(
    "UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?",
  )
    .bind(user.id)
    .run();
  await c.env.DB.prepare(
    "DELETE FROM sessions WHERE user_id=? AND expires_at<=CURRENT_TIMESTAMP",
  )
    .bind(user.id)
    .run();
  const expiresAt = await createSession(c, user.id);
  return c.json(
    ok({
      expiresAt,
      user: { id: user.id, nickname: user.nickname, email: user.email },
    }),
  );
});

app.post("/auth/password/forgot", async (c) => {
  const body = await jsonBody(c.req.raw, z.object({ email: emailSchema }));
  const clientKey = `forgot:${await sha(c.req.header("CF-Connecting-IP") ?? "local")}`;
  if (await authAttemptsExceeded(c, clientKey, 5))
    return c.json(fail("RATE_LIMITED", "请求过于频繁，请稍后再试"), 429);
  await recordAuthAttempt(c, clientKey, true);

  const user = await c.env.DB.prepare(
    "SELECT id,nickname,email FROM users WHERE email_normalized=? AND status='active'",
  )
    .bind(body.email)
    .first<{ id: string; nickname: string; email: string }>();

  let devResetUrl: string | undefined;
  if (user) {
    const token = resetToken();
    const expiresAt = iso(
      new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000),
    );
    await c.env.DB.prepare(
      "DELETE FROM password_resets WHERE user_id=? AND (used_at IS NOT NULL OR expires_at<=?)",
    )
      .bind(user.id, iso())
      .run();
    await c.env.DB.prepare(
      "INSERT INTO password_resets(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)",
    )
      .bind(uuid("rst"), user.id, await sha(token), expiresAt)
      .run();
    const origin = (c.env.APP_URL ?? new URL(c.req.url).origin).replace(
      /\/$/,
      "",
    );
    const resetUrl = `${origin}/#/reset?token=${encodeURIComponent(token)}`;
    await sendResetEmail(c, user.email, resetUrl);
    // 本地没有邮件服务时把链接直接交给前端，生产环境绝不返回令牌
    if (
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(c.req.url).hostname,
      )
    )
      devResetUrl = resetUrl;
  }

  return c.json(ok({ sent: true, ...(devResetUrl ? { devResetUrl } : {}) }));
});

app.post("/auth/password/reset", async (c) => {
  const body = await jsonBody(
    c.req.raw,
    z.object({
      token: z.string().trim().min(20, "重置链接不完整").max(200),
      password: passwordSchema,
    }),
  );
  const clientKey = `reset:${await sha(c.req.header("CF-Connecting-IP") ?? "local")}`;
  if (await authAttemptsExceeded(c, clientKey, 10, true))
    return c.json(fail("RATE_LIMITED", "尝试过于频繁，请稍后再试"), 429);

  const record = await c.env.DB.prepare(
    `SELECT pr.user_id AS userId,pr.expires_at AS expiresAt,pr.used_at AS usedAt,u.nickname,u.email
     FROM password_resets pr JOIN users u ON u.id=pr.user_id
     WHERE pr.token_hash=? AND u.status='active'`,
  )
    .bind(await sha(body.token))
    .first<{
      userId: string;
      expiresAt: string;
      usedAt: string | null;
      nickname: string;
      email: string;
    }>();
  const valid =
    record &&
    !record.usedAt &&
    Number.isFinite(Date.parse(record.expiresAt)) &&
    Date.parse(record.expiresAt) > Date.now();
  await recordAuthAttempt(c, clientKey, Boolean(valid));
  if (!record || !valid)
    return c.json(
      fail("INVALID_RESET_TOKEN", "重置链接已失效，请重新申请"),
      400,
    );

  await c.env.DB.prepare(
    "UPDATE users SET password_hash=? WHERE id=?",
  )
    .bind(await hashPassword(body.password), record.userId)
    .run();
  await c.env.DB.prepare(
    "UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE user_id=?",
  )
    .bind(record.userId)
    .run();
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?")
    .bind(record.userId)
    .run();
  const expiresAt = await createSession(c, record.userId);
  return c.json(
    ok({
      expiresAt,
      user: {
        id: record.userId,
        nickname: record.nickname,
        email: record.email,
      },
    }),
  );
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
      user: {
        id: c.get("userId"),
        nickname: c.get("nickname"),
        email: c.get("email"),
      },
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
  // limit 放宽到 200 以覆盖全部 164 条知识条目（避免按 module 切换时截断）
  const limit = integerQuery(c.req.query("limit"), 20, 1, 200);
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

interface EssaySubmissionRow {
  id: string;
  promptId: string;
  promptTitle: string;
  title: string;
  content: string;
  wordCount: number;
  score: number;
  grade: string;
  dimensionsJson: string;
  feedbackJson: string;
  createdAt: string;
}

app.get("/essay/writing/prompts", (c) =>
  c.json(
    ok({
      prompts: WRITING_PROMPTS.map((prompt) => ({
        id: prompt.id,
        type: prompt.type,
        title: prompt.title,
        material: prompt.material,
        question: prompt.question,
        requirements: prompt.requirements,
        keywords: prompt.keywords,
        targetWords: prompt.targetWords,
        suggestedMinutes: prompt.suggestedMinutes,
      })),
    }),
  ),
);

app.post("/essay/writing/submissions", async (c) => {
  const body = await jsonBody(
    c.req.raw,
    z.object({
      promptId: z.string().min(1).max(40),
      title: z.string().trim().min(1, "请填写标题").max(60, "标题请控制在 60 字以内"),
      content: z
        .string()
        .trim()
        .min(200, "正文至少 200 字")
        .max(5000, "正文请控制在 5000 字以内"),
    }),
  );
  const prompt = writingPromptById.get(body.promptId);
  if (!prompt) return c.json(fail("NOT_FOUND", "练习题目不存在"), 404);
  const grade = gradeWriting(prompt, body.title, body.content);
  const id = uuid("essay");
  const createdAt = iso();
  await c.env.DB.prepare(
    "INSERT INTO essay_submissions(id,user_id,prompt_id,prompt_title,title,content,word_count,score,grade,dimensions_json,feedback_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      c.get("userId"),
      prompt.id,
      prompt.title,
      body.title,
      body.content,
      grade.wordCount,
      grade.score,
      grade.grade,
      JSON.stringify(grade.dimensions),
      JSON.stringify({
        paragraphs: grade.paragraphs,
        matchedKeywords: grade.matchedKeywords,
        missingKeywords: grade.missingKeywords,
        issues: grade.issues,
        suggestions: grade.suggestions,
        summary: grade.summary,
      }),
      createdAt,
    )
    .run();
  return c.json(
    ok({
      id,
      promptId: prompt.id,
      promptTitle: prompt.title,
      title: body.title,
      content: body.content,
      createdAt,
      ...grade,
    }),
  );
});

app.get("/essay/writing/submissions", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id,prompt_id AS promptId,prompt_title AS promptTitle,title,word_count AS wordCount,
            score,grade,created_at AS createdAt
     FROM essay_submissions WHERE user_id=? ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(c.get("userId"))
    .all<{
      id: string;
      promptId: string;
      promptTitle: string;
      title: string;
      wordCount: number;
      score: number;
      grade: string;
      createdAt: string;
    }>();
  return c.json(
    ok({
      items: rows.results.map((row) => ({
        ...row,
        wordCount: Number(row.wordCount),
        score: Number(row.score),
      })),
    }),
  );
});

app.get("/essay/writing/submissions/:id", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT id,prompt_id AS promptId,prompt_title AS promptTitle,title,content,
            word_count AS wordCount,score,grade,dimensions_json AS dimensionsJson,
            feedback_json AS feedbackJson,created_at AS createdAt
     FROM essay_submissions WHERE id=? AND user_id=?`,
  )
    .bind(c.req.param("id"), c.get("userId"))
    .first<EssaySubmissionRow>();
  if (!row) return c.json(fail("NOT_FOUND", "批改记录不存在或无权访问"), 404);
  const feedback = JSON.parse(row.feedbackJson) as {
    paragraphs: unknown[];
    matchedKeywords: string[];
    missingKeywords: string[];
    issues: string[];
    suggestions: string[];
    summary: string;
  };
  return c.json(
    ok({
      id: row.id,
      promptId: row.promptId,
      promptTitle: row.promptTitle,
      title: row.title,
      content: row.content,
      wordCount: Number(row.wordCount),
      score: Number(row.score),
      grade: row.grade,
      dimensions: JSON.parse(row.dimensionsJson) as unknown[],
      createdAt: row.createdAt,
      ...feedback,
    }),
  );
});

app.get("/essay/cards", async (c) => {
  const category = z
    .string()
    .min(1)
    .max(50)
    .optional()
    .parse(c.req.query("category"));
  const now = iso();
  const cards = await getEssayCards(c);
  let list = cards;
  if (category) list = list.filter((card) => card.category === category);
  const rows = await c.env.DB.prepare(
    "SELECT term_id AS termId,repetitions,interval_days AS intervalDays,ease,due_at AS dueAt,last_reviewed_at AS lastReviewedAt,remembered_count AS rememberedCount,forgot_count AS forgotCount FROM essay_term_progress WHERE user_id=?",
  )
    .bind(c.get("userId"))
    .all<Record<string, unknown>>();
  const progress = new Map(
    rows.results.map((row) => [String(row.termId), row]),
  );
  const enriched = list.map((card) => ({
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
      categories: [...new Set(list.map((card) => card.category))],
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
  const cards = await getEssayCards(c);
  const card = cards.find(
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

/** 解析历史作答（[{id,key}]）；坏数据一律当没答过，不能让一条脏行把整页卡死 */
function parseQuiz(raw: string): Array<{ id: string; key: number }> {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string" && Number.isInteger(item.key))
      .map((item) => ({ id: String(item.id), key: Number(item.key) }));
  } catch {
    return [];
  }
}

/** 自评清单勾选只存下标（数组 JSON），并对清单长度变化做兜底 */
function parseChecked(json: string, total: number): number[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed
          .filter((item) => Number.isInteger(item))
          .map((item) => Number(item))
          .filter((index) => index >= 0 && index < total),
      ),
    ].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** 该用户各关星数（解锁判定的依据） */
async function loadEssayStars(c: {
  env: Bindings;
  get(key: string): string;
}): Promise<Map<string, number>> {
  const rows = await c.env.DB.prepare(
    "SELECT level_id AS levelId,stars FROM essay_training_progress WHERE user_id=?",
  )
    .bind(c.get("userId"))
    .all<{ levelId: string; stars: number }>();
  return new Map(rows.results.map((row) => [String(row.levelId), Number(row.stars) || 0]));
}

app.get("/essay/training", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT level_id AS levelId,checked_json AS checkedJson,quiz_json AS quizJson,notes,stars,updated_at AS updatedAt FROM essay_training_progress WHERE user_id=?",
  )
    .bind(c.get("userId"))
    .all<{
      levelId: string;
      checkedJson: string;
      quizJson: string;
      notes: string;
      stars: number;
      updatedAt: string;
    }>();
  const byLevel = new Map(rows.results.map((row) => [String(row.levelId), row]));
  const starsOf = (id: string) => Number(byLevel.get(id)?.stars ?? 0);
  const levels = ESSAY_LEVELS.map((level) => {
    const record = byLevel.get(level.id);
    const checked = parseChecked(String(record?.checkedJson ?? []), level.checklist.length);
    return {
      id: level.id,
      day: level.day,
      stage: level.stage,
      title: level.title,
      goal: level.goal,
      rating: level.rating,
      minutes: essayMinutes(level),
      points: level.points,
      tasks: level.tasks,
      checklist: level.checklist,
      docId: level.docId,
      previousTitle: essayPreviousLevel(level)?.title ?? null,
      unlocked: essayUnlocked(level.id, starsOf),
      stars: Number(record?.stars ?? 0),
      checked,
      notes: String(record?.notes ?? ""),
      updatedAt: record?.updatedAt ?? null,
      // 只下发题干与选项（带原始下标 key），答案与解析要交卷后才给——与专项训练同口径
      quiz: essayQuizOf(level.id),
      quizResult: record?.quizJson
        ? gradeEssayQuiz(level.id, parseQuiz(String(record.quizJson)))
        : null,
    };
  });
  return c.json(
    ok({
      stages: ESSAY_STAGES,
      levels,
      summary: {
        total: levels.length,
        cleared: levels.filter((level) => level.stars >= 1).length,
        stars: levels.reduce((sum, level) => sum + level.stars, 0),
        // 客观题累计：只统计已作答过的关卡（老数据没作答，不该被算成 0 分）
        quizAnswered: levels.reduce((sum, level) => sum + (level.quizResult?.total ?? 0), 0),
        quizCorrect: levels.reduce((sum, level) => sum + (level.quizResult?.correct ?? 0), 0),
      },
    }),
  );
});

app.post("/essay/training/:levelId", async (c) => {
  const levelId = c.req.param("levelId");
  const level = essayLevelById.get(levelId);
  if (!level) return c.json(fail("NOT_FOUND", "关卡不存在"), 404);
  const body = await jsonBody(
    c.req.raw,
    z.object({
      quiz: z
        .array(
          z.object({
            id: z.string().min(1).max(64),
            key: z.number().int().min(0).max(3),
          }),
        )
        .max(32),
      checked: z.array(z.number().int().min(0)).max(64),
      notes: z.string().max(4000).optional(),
    }),
  );
  const stars = await loadEssayStars(c);
  // 逐关解锁：上一关没通关不能提交本关（前端也会锁，但服务端必须有这一道）
  if (!essayUnlocked(levelId, (id) => stars.get(id) ?? 0))
    return c.json(
      fail(
        "LEVEL_LOCKED",
        `需先通关：${essayPreviousLevel(level)?.title ?? "上一关"}`
      ),
      409,
    );
  // 客观题必须答完才判分：没答完的提交不入库，否则「客观题门槛」等于没有
  const quizIssue = essayQuizIssue(levelId, body.quiz);
  if (quizIssue) return c.json(fail("QUIZ_INCOMPLETE", quizIssue), 400);
  const quiz = gradeEssayQuiz(levelId, body.quiz);
  const existing = await c.env.DB.prepare(
    "SELECT checked_json AS checkedJson,notes,stars FROM essay_training_progress WHERE user_id=? AND level_id=?",
  )
    .bind(c.get("userId"), levelId)
    .first<{ checkedJson: string; notes: string; stars: number }>();
  const checked = parseChecked(
    JSON.stringify([...new Set(body.checked)]),
    level.checklist.length,
  );
  // 星级只增不减：改自评不该把已拿到的星级抹掉（与专项训练取历史最佳同口径）
  const nextStars = Math.max(
    Number(existing?.stars ?? 0),
    essayStars({
      correct: quiz.correct,
      quizTotal: quiz.total,
      checked: checked.length,
      checklistTotal: level.checklist.length,
    }),
  );
  const notes = body.notes ?? String(existing?.notes ?? "");
  await c.env.DB.prepare(
    "INSERT INTO essay_training_progress(user_id,level_id,checked_json,quiz_json,notes,stars,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,level_id) DO UPDATE SET checked_json=excluded.checked_json,quiz_json=excluded.quiz_json,notes=excluded.notes,stars=excluded.stars,updated_at=excluded.updated_at",
  )
    .bind(
      c.get("userId"),
      levelId,
      JSON.stringify(checked),
      JSON.stringify(body.quiz),
      notes,
      nextStars,
      iso(),
    )
    .run();
  const updated = await loadEssayStars(c);
  updated.set(levelId, nextStars);
  return c.json(
    ok({
      levelId,
      checked,
      notes,
      stars: nextStars,
      cleared: nextStars >= 1,
      correct: quiz.correct,
      quizTotal: quiz.total,
      marks: quiz.marks,
      summary: {
        cleared: [...updated.values()].filter((value) => value >= 1).length,
        stars: [...updated.values()].reduce((sum, value) => sum + value, 0),
      },
    }),
  );
});
app.get("/essay/reviews/history", async (c) => {
  const limit = integerQuery(c.req.query("limit"), 30, 1, 100);
  const rows = await c.env.DB.prepare(
    "SELECT id,term_id AS termId,rating,interval_days AS intervalDays,due_at AS dueAt,reviewed_at AS reviewedAt FROM essay_review_events WHERE user_id=? ORDER BY reviewed_at DESC LIMIT ?",
  )
    .bind(c.get("userId"), limit)
    .all<Record<string, unknown>>();
  const cards = new Map(
    (await getEssayCards(c)).map((card) => [card.termId, card]),
  );
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
  c.json(
    ok({
      topics: topics.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        rating: t.rating,
        track: t.track,
      })),
      difficulties,
      generatorVersion: 3,
      recentWindow: 50,
    }),
  ),
);

/** 关卡目录（含每关按难度局的预算/前置/文档链接；进度由 /quiz/progress 单独提供） */
app.get("/quiz/catalog", (c) => {
  // 目录是编译期静态数据（只随发版变化），允许浏览器短暂复用，避免每次进页面都跨境重取。
  // private：内容依赖登录态，不能被共享缓存命中；5 分钟上限，发版后最多旧 5 分钟。
  c.header("Cache-Control", "private, max-age=300, stale-while-revalidate=600");
  return c.json(
    ok({
      runLength: RUN_LENGTH,
      passAccuracy: 0.8,
      generatorVersion: 3,
      difficultyRuns: [
        { id: "easy", label: "低难度", short: "低", description: "选项差异大、数字简洁，掌握基本算法" },
        { id: "medium", label: "中难度", short: "中", description: "选项更接近、数字更复杂，需要两步换算" },
        { id: "hard", label: "高难度 · 实战", short: "高", description: "资料速算附文字/表格/图表材料，选项接近、数字复杂" },
      ],
      tracks: catalogTracks.map((track) => {
        const items = topics.filter((t) => t.track === track.id);
        return {
          id: track.id,
          title: track.title,
          description: track.description,
          topics: items.map((t) => ({
            ...t,
            budgetMs: topicBudget(t),
            budgetsMs: {
              easy: difficultyBudgetMs(t, "easy"),
              medium: difficultyBudgetMs(t, "medium"),
              hard: difficultyBudgetMs(t, "hard"),
            },
            unlockTitles: t.unlock.map(titleOf),
            docId: t.docId ?? null,
          })),
        };
      }),
    }),
  );
});

/** 关卡进度：按（模块 × 难度局）返回 解锁/星级/统计；模块解锁取决于前置模块高难度局通关 */
app.get("/quiz/progress", async (c) => {
  const { passStars, stats } = await loadQuizStatus(c);
  const rows = topics.flatMap((topic) => {
    const unlocked = isUnlocked(passStars, topic.id);
    return RUN_DIFFICULTIES.map((difficulty) => {
      const key = diffKey(topic.id, difficulty);
      const run = stats.get(key);
      return {
        topicId: topic.id,
        difficulty,
        unlocked,
        stars: passStars.get(key) ?? 0,
        total: run?.total ?? 0,
        accuracy: run?.accuracy ?? 0,
        averageMs: run?.averageMs ?? 0,
        lastRunAt: run?.lastRunAt ?? null,
      };
    });
  });
  return c.json(ok(rows));
});

app.post("/quiz/questions", async (c) => {
  const body = await jsonBody(
    c.req.raw,
    z.object({
      topicId: z.string().min(2).max(40),
      difficulty: z.enum(["easy", "medium", "hard"]),
      runId: z.string().uuid().optional(),
      index: z.number().int().min(0).max(RUN_LENGTH - 1).optional(),
    }),
  );
  const topic = topicById.get(body.topicId as TopicId);
  if (!topic) {
    const retired = legacyTopics.find((item) => item.id === body.topicId);
    return c.json(
      fail(
        "TOPIC_RETIRED",
        retired
          ? `${retired.title}已拆分为独立关卡，请从“专项训练”关卡地图进入`
          : "未知专题",
      ),
      400,
    );
  }
  const difficulty = body.difficulty;
  // 一次查询同时供两处使用，省掉一次跨洋往返：
  //   ① 本局已生成的题（同序号复用，防止预取与手动点击撞车）
  //   ② 去重池（该模块该难度最近 50 条指纹）
  // 条件 (run_id=? OR expires_at>?) 保证「本局的题」永不被条数上限挤掉；
  // DESC 取回后由调用处反转成生成顺序（等价于原 ORDER BY created_at ASC）。
  const fetched = await c.env.DB.prepare(
    `SELECT id,topic_id AS topicId,difficulty,run_id AS runId,fingerprint,stem,
            options_json AS optionsJson,material_json AS materialJson,
            created_at AS generatedAt,expires_at AS expiresAt
     FROM generated_questions
     WHERE user_id=? AND topic_id=? AND difficulty=? AND (run_id=? OR expires_at>?)
     ORDER BY created_at DESC
     LIMIT 60`,
  )
    .bind(c.get("userId"), body.topicId, difficulty, body.runId ?? "", iso())
    .all<{
      id: string;
      topicId: string;
      difficulty: RunDifficulty;
      runId: string | null;
      fingerprint: string;
      stem: string;
      optionsJson: string;
      materialJson: string | null;
      generatedAt: string;
      expiresAt: string;
    }>();
  const runQuestions = body.runId
    ? fetched.results.filter((row) => row.runId === body.runId).reverse()
    : [];
  if (body.runId !== undefined) {
    if (body.index === undefined)
      return c.json(fail("INVALID_PARAM", "闯关模式需要题目序号 index"), 400);
    // 本局已生成的题按生成顺序排列，第 index 题就是 runQuestions[index]。
    // 同一序号重复请求要**返回同一道题**而不是报错：客户端的「预取下一题」与用户点
    // 「下一题」可能同时发出（网络一慢必然撞车），重试也会重复同一序号。
    // 以前这里只比较 COUNT 与 index，撞车就 409 RUN_STATE「题目序号不连续」；
    // 更麻烦的是客户端会把已生成的预取结果丢掉，序号从此永久错位，只能重开一局。
    const existingQuestion = runQuestions[body.index];
    if (existingQuestion) {
      return c.json(
        ok({
          questionId: existingQuestion.id,
          topicId: existingQuestion.topicId,
          difficulty: existingQuestion.difficulty,
          runId: body.runId,
          index: body.index,
          runLength: RUN_LENGTH,
          stem: existingQuestion.stem,
          options: JSON.parse(existingQuestion.optionsJson) as string[],
          material: existingQuestion.materialJson
            ? (JSON.parse(existingQuestion.materialJson) as MaterialSpec)
            : null,
          generatedAt: existingQuestion.generatedAt,
          expiresAt: existingQuestion.expiresAt,
          reused: true,
        }),
      );
    }
    if (runQuestions.length >= RUN_LENGTH)
      return c.json(fail("RUN_COMPLETE", "本局已完成，请重新开始"), 409);
    if (runQuestions.length !== body.index)
      return c.json(
        fail("RUN_STATE", "题目序号不连续，请重新开始本局"),
        409,
      );
    const firstQuestion = runQuestions[0];
    if (firstQuestion) {
      // 本局已经在跑：只确认模块/难度没被换掉。解锁校验在开新局（index 0）时做过一次即可，
      // 这里不再重复跑用户级聚合查询——那是每道题一次的重查询，是答题卡顿的主要来源之一。
      if (
        firstQuestion.topicId !== body.topicId ||
        firstQuestion.difficulty !== difficulty
      )
        return c.json(
          fail("RUN_STATE", "本局已切换到其它模块，请重新开始本局"),
          409,
        );
    } else {
      // 只校验前置模块的 hard 局，不再跑全量聚合（见 loadPrereqStars 注释）
      const prereqStars = await loadPrereqStars(c, topic.unlock);
      const locked = topic.unlock.filter((prereq) => (prereqStars.get(prereq) ?? 0) < 1);
      if (locked.length > 0)
        return c.json(
          fail("TOPIC_LOCKED", `请先通过前置关卡的高难度局（实战）：${locked.map(titleOf).join("、")}`),
          409,
        );
    }
  }
  if (!allowGeneration(`q:${c.get("userId")}:${body.topicId}:${difficulty}`))
    return c.json(fail("RATE_LIMITED", "生成请求过于频繁，请稍后再试"), 429);
  const seed = crypto.randomUUID();
  // 去重池直接复用上面那次查询（按时间倒序，取未过期的前 50 条）
  const nowIso = iso();
  const excluded = fetched.results
    .filter((row) => row.expiresAt > nowIso)
    .slice(0, 50)
    .map((row) => row.fingerprint);
  // 题池可能小于去重池（例：「基期与增速」共 20 道题、去重上限 50 条），
  // 此时若死守"全部排除"就永远生成不出题（503）。逐级放宽，
  // 最后允许重复——宁可出一道做过的，也别让用户卡在"加载失败"。
  let generatedQuestion: GeneratedQuestion | null = null;
  for (const tier of [
    excluded,
    excluded.slice(0, Math.floor(excluded.length / 2)),
    excluded.slice(0, 5),
    [],
  ]) {
    try {
      generatedQuestion = generateQuestion({
        topicId: body.topicId as TopicId,
        difficulty,
        excludedFingerprints: tier,
        randomSeed: seed,
      });
      break;
    } catch {
      // 该档无解，继续放宽
    }
  }
  if (!generatedQuestion) {
    return c.json(fail("GENERATION_FAILED", "暂时无法生成合法新题，请重试"), 503);
  }
  const questionId = uuid("q");
  const generatedAt = iso();
  const expiresAt = iso(new Date(Date.now() + 7 * 86400000));
  const materialJson = generatedQuestion.material ? JSON.stringify(generatedQuestion.material) : null;
  await c.env.DB.prepare(
    "INSERT INTO generated_questions(id,user_id,topic_id,difficulty,template_id,template_version,fingerprint,seed,stem,options_json,answer_index,explanation,params_json,created_at,expires_at,material_json,run_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      questionId,
      c.get("userId"),
      body.topicId,
      difficulty,
      generatedQuestion.templateId,
      generatedQuestion.templateVersion,
      generatedQuestion.fingerprint,
      seed,
      generatedQuestion.stem,
      JSON.stringify(generatedQuestion.options),
      generatedQuestion.answerIndex,
      generatedQuestion.explanation,
      JSON.stringify(generatedQuestion.params),
      generatedAt,
      expiresAt,
      materialJson,
      body.runId ?? null,
    )
    .run();
  return c.json(
    ok({
      questionId,
      topicId: body.topicId,
      difficulty,
      runId: body.runId ?? null,
      index: body.index ?? null,
      runLength: RUN_LENGTH,
      stem: generatedQuestion.stem,
      options: generatedQuestion.options,
      material: generatedQuestion.material ?? null,
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
  const [previous, question] = await Promise.all([
    c.env.DB.prepare(
      "SELECT a.id AS attemptId,a.correct,q.answer_index AS answerIndex,q.explanation,a.created_at AS savedAt FROM quiz_attempts a JOIN generated_questions q ON q.id=a.question_id WHERE a.user_id=? AND a.idempotency_key=?",
    )
      .bind(c.get("userId"), body.idempotencyKey)
      .first<Record<string, unknown>>(),
    c.env.DB.prepare(
      "SELECT answer_index AS answerIndex,explanation,expires_at AS expiresAt,run_id AS runId,topic_id AS topicId,difficulty FROM generated_questions WHERE id=? AND user_id=?",
    )
      .bind(body.questionId, c.get("userId"))
      .first<{ answerIndex: number; explanation: string; expiresAt: string; runId: string | null; topicId: string; difficulty: RunDifficulty }>(),
  ]);
  if (previous) return c.json(ok(previous));
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
    "INSERT INTO quiz_attempts(id,user_id,question_id,selected_index,correct,duration_ms,idempotency_key,created_at,run_id) VALUES(?,?,?,?,?,?,?,?,?)",
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
      question.runId,
    )
    .run();
  // 局次完成时回传通关判定（该难度局正确率与总用时均达标）
  let run = null;
  if (question.runId) {
    const agg = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total,SUM(a.correct) AS correct,SUM(a.duration_ms) AS durationMs,MAX(q.topic_id) AS topicId,MAX(q.difficulty) AS difficulty
       FROM quiz_attempts a JOIN generated_questions q ON q.id=a.question_id
       WHERE a.user_id=? AND a.run_id=?`,
    )
      .bind(c.get("userId"), question.runId)
      .first<{ total: number; correct: number; durationMs: number; topicId: string; difficulty: RunDifficulty }>();
    if (agg && Number(agg.total) >= RUN_LENGTH) {
      const total = Number(agg.total);
      const aggData = {
        topicId: String(agg.topicId),
        difficulty: agg.difficulty ?? "hard",
        total,
        correct: Number(agg.correct),
        durationMs: Number(agg.durationMs),
      };
      const stars = runStars(aggData);
      run = {
        finished: true,
        difficulty: aggData.difficulty,
        total,
        correct: aggData.correct,
        accuracy: aggData.correct / total,
        durationMs: aggData.durationMs,
        passed: stars > 0,
        stars,
      };
    }
  }
  return c.json(
    ok({
      attemptId,
      correct,
      answerIndex: question.answerIndex,
      explanation: question.explanation,
      savedAt,
      run,
    }),
  );
});

app.get("/quiz/stats", async (c) => {
  const filters = z
    .object({
      topicId: z.string().min(2).max(40).optional(),
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

/**
 * 错题本列表：只返回「未掌握」的错题。
 * 间隔复习口径：连续重做正确 2 次才 mastered（出清），第一次正确只推进到阶段 1 并安排次日再复习；
 * 重做错误则回到阶段 0、10 分钟后重新到期。due=1 只返回已到期的题，用于「今日复习」。
 */
app.get("/quiz/mistakes", async (c) => {
  const limit = integerQuery(c.req.query("limit"), 20, 1, 100);
  const dueOnly = c.req.query("due") === "1";
  const userId = c.get("userId");
  const now = iso();
  const rows = await c.env.DB.prepare(
    `SELECT q.id AS questionId,q.topic_id AS topicId,q.difficulty,q.stem,q.options_json AS optionsJson,q.material_json AS materialJson,q.answer_index AS answerIndex,q.explanation,a.mastered,a.cause_tag AS causeTag,a.review_stage AS reviewStage,a.next_review_at AS nextReviewAt,a.last_reviewed_at AS lastReviewedAt,COALESCE((SELECT MAX(r.created_at) FROM quiz_retry_attempts r WHERE r.user_id=a.user_id AND r.question_id=a.question_id AND r.correct=0),a.created_at) AS lastWrongAt,1+(SELECT COUNT(*) FROM quiz_retry_attempts r WHERE r.user_id=a.user_id AND r.question_id=a.question_id AND r.correct=0) AS wrongCount FROM quiz_attempts a JOIN generated_questions q ON q.id=a.question_id WHERE a.user_id=? AND a.correct=0 AND a.mastered=0${dueOnly ? " AND (a.next_review_at IS NULL OR a.next_review_at<=?)" : ""} ORDER BY ${dueOnly ? "a.next_review_at IS NULL DESC,a.next_review_at ASC" : "lastWrongAt DESC"} LIMIT ?`,
  )
    .bind(...(dueOnly ? [userId, now, limit] : [userId, limit]))
    .all<Record<string, unknown>>();
  const counts = await c.env.DB.prepare(
    "SELECT COUNT(*) AS openCount,COALESCE(SUM(CASE WHEN next_review_at IS NULL OR next_review_at<=? THEN 1 ELSE 0 END),0) AS dueCount FROM quiz_attempts WHERE user_id=? AND correct=0 AND mastered=0",
  )
    .bind(now, userId)
    .first<{ openCount: number; dueCount: number }>();
  return c.json(
    ok({
      items: rows.results.map((row) => {
        const materialJson = row.materialJson;
        return {
          ...row,
          options: JSON.parse(String(row.optionsJson)),
          optionsJson: undefined,
          materialJson: undefined,
          material: materialJson ? JSON.parse(String(materialJson)) : null,
          mastered: Boolean(row.mastered),
        };
      }),
      counts: {
        open: Number(counts?.openCount ?? 0),
        due: Number(counts?.dueCount ?? 0),
      },
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
    "SELECT q.answer_index AS answerIndex,q.explanation,a.id AS attemptId,a.review_stage AS reviewStage FROM quiz_attempts a JOIN generated_questions q ON q.id=a.question_id WHERE a.user_id=? AND a.question_id=? AND a.correct=0",
  )
    .bind(c.get("userId"), c.req.param("questionId"))
    .first<{
      answerIndex: number;
      explanation: string;
      attemptId: string;
      reviewStage: number;
    }>();
  if (!mistake) return c.json(fail("NOT_FOUND", "错题不存在"), 404);
  const retryId = uuid("retry");
  const correct = body.selectedIndex === mistake.answerIndex;
  const savedAt = iso();
  const reviewStage = correct ? Number(mistake.reviewStage ?? 0) + 1 : 0;
  const mastered = reviewStage >= 2;
  // 连续答对两次才出清；中途答错重排，避免「蒙对一次就消失」
  const nextReviewAt = mastered
    ? null
    : iso(new Date(Date.now() + (correct ? 86400000 : 600000)));
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
    "UPDATE quiz_attempts SET mastered=?,review_stage=?,next_review_at=?,last_reviewed_at=? WHERE id=?",
  ).bind(mastered ? 1 : 0, reviewStage, nextReviewAt, savedAt, mistake.attemptId);
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
      mastered,
      reviewStage,
      nextReviewAt,
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
  const nextReviewAt = body.mastered ? null : iso();
  await c.env.DB.prepare(
    "UPDATE quiz_attempts SET mastered=?,review_stage=?,next_review_at=? WHERE id=?",
  )
    .bind(body.mastered ? 1 : 0, body.mastered ? 2 : 0, nextReviewAt, (attempt as { id: string }).id)
    .run();
  return c.json(
    ok({
      questionId: c.req.param("questionId"),
      mastered: body.mastered,
      reviewStage: body.mastered ? 2 : 0,
      nextReviewAt,
    }),
  );
});

app.patch("/quiz/mistakes/:questionId/cause", async (c) => {
  const body = await jsonBody(
    c.req.raw,
    z.object({ cause: z.enum(MISTAKE_CAUSE_IDS).nullable() }),
  );
  const attempt = await c.env.DB.prepare(
    "SELECT id FROM quiz_attempts WHERE user_id=? AND question_id=? AND correct=0",
  )
    .bind(c.get("userId"), c.req.param("questionId"))
    .first();
  if (!attempt) return c.json(fail("NOT_FOUND", "错题不存在"), 404);
  await c.env.DB.prepare("UPDATE quiz_attempts SET cause_tag=? WHERE id=?")
    .bind(body.cause, (attempt as { id: string }).id)
    .run();
  return c.json(
    ok({ questionId: c.req.param("questionId"), cause: body.cause }),
  );
});

/** 个人统计聚合（一次请求汇总六大维度，供学习统计页展示） */
app.get("/profile/summary", async (c) => {
  const userId = c.get("userId");
  const now = iso();
  const rangeDays = integerQuery(c.req.query("days"), 30, 7, 90);
  // 一次取回 90 天原始记录，7/30/90 天视图都从这里裁剪，避免切换时重复查库
  const start90 = new Date(Date.now() - 90 * 86400000).toISOString();
  const [attempts, retries, essayEvents, schulte, quizRows, difficultyRows, cardRows, mistakeRows, retryAcc, schulteBests, cards, quizStatus] = await Promise.all([
    c.env.DB.prepare(
      "SELECT created_at,correct,duration_ms FROM quiz_attempts WHERE user_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 5000",
    )
      .bind(userId, start90)
      .all<{ created_at: string; correct: number; duration_ms: number }>(),
    c.env.DB.prepare(
      "SELECT created_at,correct FROM quiz_retry_attempts WHERE user_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 5000",
    )
      .bind(userId, start90)
      .all<{ created_at: string; correct: number }>(),
    c.env.DB.prepare(
      "SELECT reviewed_at FROM essay_review_events WHERE user_id=? AND reviewed_at>=? ORDER BY reviewed_at DESC LIMIT 5000",
    )
      .bind(userId, start90)
      .all<{ reviewed_at: string }>(),
    c.env.DB.prepare(
      "SELECT created_at,duration_ms FROM schulte_results WHERE user_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 5000",
    )
      .bind(userId, start90)
      .all<{ created_at: string; duration_ms: number }>(),
    c.env.DB.prepare(
      `SELECT q.topic_id AS topicId,COUNT(*) AS total,SUM(a.correct) AS correct,AVG(a.duration_ms) AS averageMs
       FROM quiz_attempts a JOIN generated_questions q ON q.id=a.question_id WHERE a.user_id=? GROUP BY q.topic_id`,
    )
      .bind(userId)
      .all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT q.difficulty AS difficulty,COUNT(*) AS total,SUM(a.correct) AS correct,AVG(a.duration_ms) AS averageMs
       FROM quiz_attempts a JOIN generated_questions q ON q.id=a.question_id
       WHERE a.user_id=? GROUP BY q.difficulty`,
    )
      .bind(userId)
      .all<Record<string, unknown>>(),
    c.env.DB.prepare(
      "SELECT repetitions,interval_days AS intervalDays,due_at AS dueAt,remembered_count AS rememberedCount,forgot_count AS forgotCount FROM essay_term_progress WHERE user_id=?",
    )
      .bind(userId)
      .all<Record<string, unknown>>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS total,SUM(CASE WHEN mastered=1 THEN 1 ELSE 0 END) AS mastered FROM quiz_attempts WHERE user_id=? AND correct=0",
    )
      .bind(userId)
      .first<{ total: number; mastered: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS total,SUM(correct) AS correct FROM quiz_retry_attempts WHERE user_id=?",
    )
      .bind(userId)
      .first<{ total: number; correct: number }>(),
    c.env.DB.prepare(
      "SELECT grid_size AS gridSize,variant,MIN(duration_ms) AS bestMs FROM schulte_results WHERE user_id=? GROUP BY grid_size,variant",
    )
      .bind(userId)
      .all<{ gridSize: number; variant: string; bestMs: number }>(),
    getEssayCards(c),
    loadQuizStatus(c),
  ]);
  const { passStars } = quizStatus;

  // —— 学习趋势（本地自然日，按请求范围裁剪） ——
  const dayMap = new Map<
    string,
    { quizCount: number; correct: number; durationMs: number; retries: number; retryCorrect: number; cardReviews: number; schulteRuns: number }
  >();
  const bump = (day: string, key: "quizCount" | "correct" | "durationMs" | "retries" | "retryCorrect" | "cardReviews" | "schulteRuns", amount = 1) => {
    const entry = dayMap.get(day) ?? { quizCount: 0, correct: 0, durationMs: 0, retries: 0, retryCorrect: 0, cardReviews: 0, schulteRuns: 0 };
    entry[key] += amount;
    dayMap.set(day, entry);
  };
  for (const row of attempts.results) {
    const day = cnDay(row.created_at);
    bump(day, "quizCount");
    bump(day, "correct", Number(row.correct));
    bump(day, "durationMs", Number(row.duration_ms));
  }
  for (const row of retries.results) {
    const day = cnDay(row.created_at);
    bump(day, "retries");
    bump(day, "retryCorrect", Number(row.correct));
  }
  for (const row of essayEvents.results) {
    bump(cnDay(row.reviewed_at), "cardReviews");
  }
  for (const row of schulte.results) {
    bump(cnDay(row.created_at), "schulteRuns");
  }
  const activityDays = new Set(dayMap.keys());
  const { streak, activeToday } = streakOf(activityDays);
  const today = cnDay(now);
  const trend: Array<{ date: string; quizCount: number; correct: number; accuracy: number; durationMs: number; cardReviews: number; schulteRuns: number; retries: number }> = [];
  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() + 8 * 3600000 - offset * 86400000).toISOString().slice(0, 10);
    const entry = dayMap.get(date);
    trend.push({
      date,
      quizCount: entry?.quizCount ?? 0,
      correct: entry?.correct ?? 0,
      accuracy: entry?.quizCount ? (entry.correct ?? 0) / entry.quizCount : 0,
      durationMs: entry?.durationMs ?? 0,
      cardReviews: entry?.cardReviews ?? 0,
      schulteRuns: entry?.schulteRuns ?? 0,
      retries: entry?.retries ?? 0,
    });
  }
  const rangeDates = new Set(trend.map((day) => day.date));
  const todayEntry = dayMap.get(today);

  // —— 速算/数推按专题统计 ——
  let quizTotal = 0;
  let quizCorrect = 0;
  let quizMsSum = 0;
  const quizItems = quizRows.results.map((row) => {
    const total = Number(row.total) || 0;
    const correct = Number(row.correct) || 0;
    const averageMs = Math.round(Number(row.averageMs) || 0);
    quizTotal += total;
    quizCorrect += correct;
    quizMsSum += averageMs * total;
    const topicId = String(row.topicId);
    const topic = topicById.get(topicId as TopicId);
    return {
      topicId,
      track: topic?.track ?? "speed",
      total,
      correct,
      accuracy: total ? correct / total : 0,
      averageMs,
      stars: passStars.get(diffKey(topicId, "hard")) ?? 0,
    };
  });

  // —— 难度分布（低/中/高） ——
  const byDifficulty = (["easy", "medium", "hard"] as const).map(
    (difficulty) => {
      const row = difficultyRows.results.find(
        (item) => String(item.difficulty) === difficulty,
      );
      const total = Number(row?.total) || 0;
      const correct = Number(row?.correct) || 0;
      return {
        difficulty,
        total,
        correct,
        accuracy: total ? correct / total : 0,
        averageMs: Math.round(Number(row?.averageMs) || 0),
      };
    },
  );

  // —— 通关进度：模块以高难度局最佳星级判定 ——
  const trackTitles: Record<string, string> = {
    speed: "资料速算",
    sequence: "数字推理",
    material: "资料实战",
  };
  const trackOrder = ["speed", "sequence", "material"] as const;
  let clearedTopics = 0;
  let totalStars = 0;
  const starsDistribution = [0, 1, 2, 3].map((stars) => ({
    stars,
    count: 0,
  }));
  const progressTracks = trackOrder.map((track) => {
    const trackTopics = topics.filter((topic) => topic.track === track);
    const trackItems = quizItems.filter((item) => item.track === track);
    const total = trackItems.reduce((sum, item) => sum + item.total, 0);
    const correct = trackItems.reduce((sum, item) => sum + item.correct, 0);
    const msSum = trackItems.reduce(
      (sum, item) => sum + item.averageMs * item.total,
      0,
    );
    let cleared = 0;
    let stars = 0;
    for (const topic of trackTopics) {
      const value = passStars.get(diffKey(topic.id, "hard")) ?? 0;
      stars += value;
      if (value >= 1) cleared += 1;
      starsDistribution[value].count += 1;
      if (value >= 1) clearedTopics += 1;
      totalStars += value;
    }
    return {
      id: track,
      title: trackTitles[track],
      totalTopics: trackTopics.length,
      clearedTopics: cleared,
      stars,
      maxStars: trackTopics.length * 3,
      total,
      correct,
      accuracy: total ? correct / total : 0,
      averageMs: total ? Math.round(msSum / total) : 0,
    };
  });
  const progress = {
    totalTopics: topics.length,
    clearedTopics,
    totalStars,
    maxStars: topics.length * 3,
    starsDistribution,
    tracks: progressTracks,
  };

  // —— 星期节奏（与趋势范围一致；周一=0） ——
  const weekday = Array.from({ length: 7 }, (_, index) => ({
    weekday: index,
    quizCount: 0,
    correct: 0,
  }));
  for (const row of attempts.results) {
    if (!rangeDates.has(cnDay(row.created_at))) continue;
    const normalized = row.created_at.includes("T")
      ? row.created_at
      : `${row.created_at.replace(" ", "T")}Z`;
    const time = Date.parse(normalized);
    if (Number.isNaN(time)) continue;
    const index = (new Date(time + 8 * 3600_000).getUTCDay() + 6) % 7;
    weekday[index].quizCount += 1;
    weekday[index].correct += Number(row.correct) || 0;
  }

  // —— 规范词卡片 ——
  const rows = cardRows.results;
  const reviewed = rows.length;
  const remembered = rows.reduce((sum, row) => sum + Number(row.rememberedCount ?? 0), 0);
  const forgot = rows.reduce((sum, row) => sum + Number(row.forgotCount ?? 0), 0);
  const due = rows.filter((row) => String(row.dueAt) <= now).length;
  const summary = {
    total: cards.length,
    new: cards.length - reviewed,
    due,
    learning: rows.filter((row) => Number(row.repetitions) < 3).length,
    mastered: rows.filter((row) => Number(row.repetitions) >= 3).length,
    accuracy: remembered + forgot ? remembered / (remembered + forgot) : 0,
  };
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.now() + 8 * 3600000 - i * 86400000).toISOString().slice(0, 10);
    return dayMap.get(date)?.cardReviews ?? 0;
  }).reduce((a, b) => a + b, 0);

  // —— 错题本 ——
  const openMistakes = (Number(mistakeRows?.total) || 0) - (Number(mistakeRows?.mastered) || 0);
  const retryTotal = Number(retryAcc?.total) || 0;
  const retryAccuracy = retryTotal ? (Number(retryAcc?.correct) || 0) / retryTotal : 0;

  return c.json(
    ok({
      rangeDays,
      activity: {
        studyDays: [...activityDays].filter((day) => rangeDates.has(day)).length,
        streak,
        activeToday,
        today: {
          quizCount: todayEntry?.quizCount ?? 0,
          cardReviews: todayEntry?.cardReviews ?? 0,
          schulteRuns: todayEntry?.schulteRuns ?? 0,
          retries: todayEntry?.retries ?? 0,
        },
      },
      trend,
      quiz: {
        items: quizItems,
        byDifficulty,
        weekday,
        overall: {
          total: quizTotal,
          correct: quizCorrect,
          accuracy: quizTotal ? quizCorrect / quizTotal : 0,
          averageMs: quizTotal ? Math.round(quizMsSum / quizTotal) : 0,
        },
      },
      progress,
      cards: { summary, today: todayEntry?.cardReviews ?? 0, last7 },
      mistakes: {
        open: Math.max(0, openMistakes),
        mastered: Number(mistakeRows?.mastered) || 0,
        retryTotal,
        retryAccuracy,
      },
      schulte: {
        bests: schulteBests.results,
        runs: schulte.results.length,
      },
    }),
  );
});

// ==================== 资料分析小模考（20 题 / 30 分钟 / 可分享报告） ====================
const MOCK_QUESTION_COUNT = 20;
const MOCK_DURATION_MS = 30 * 60 * 1000;
/** 模考只取「资料实战」轨道的列式题：固定五类核心题型，各 4 题，中/高难度交替 */
const MOCK_TOPICS = [
  "formula-growth-rate",
  "formula-growth-amount",
  "formula-base-amount",
  "formula-base-ratio",
  "formula-average-basic",
] as const satisfies readonly TopicId[];

type MockGeneratedQuestion = {
  topicId: TopicId;
  difficulty: RunDifficulty;
  generated: GeneratedQuestion;
};

function generateMockQuestionSet(): MockGeneratedQuestion[] | null {
  const used = new Set<string>();
  const result: MockGeneratedQuestion[] = [];
  for (let position = 0; position < MOCK_QUESTION_COUNT; position += 1) {
    const topicId = MOCK_TOPICS[position % MOCK_TOPICS.length];
    const difficulties: RunDifficulty[] =
      position % 2 === 0 ? ["hard", "medium"] : ["medium", "hard"];
    let picked: MockGeneratedQuestion | null = null;
    for (const difficulty of difficulties) {
      for (let attempt = 0; attempt < 5 && !picked; attempt += 1) {
        try {
          const generated = generateQuestion({
            topicId,
            difficulty,
            excludedFingerprints: [...used],
            randomSeed: crypto.randomUUID(),
          });
          if (used.has(generated.fingerprint)) continue;
          picked = { topicId, difficulty, generated };
        } catch {
          // 题池较小时换难度或换随机种子继续试
        }
      }
      if (picked) break;
    }
    if (!picked) return null;
    used.add(picked.generated.fingerprint);
    result.push(picked);
  }
  return result;
}

interface MockExamRow {
  id: string;
  userId: string;
  questionCount: number;
  limitMs: number;
  startedAt: string;
  submittedAt: string | null;
  durationMs: number | null;
  correctCount: number | null;
  score: number | null;
  shareToken: string;
  nickname: string;
}

interface MockQuestionRow {
  id: string;
  position: number;
  topicId: string;
  topicTitle: string;
  difficulty: RunDifficulty;
  stem: string;
  optionsJson: string;
  materialJson: string | null;
  answerIndex: number;
  explanation: string;
  selectedIndex: number | null;
  elapsedMs: number;
}

async function loadMockReport(
  c: AppContext,
  lookup:
    | { examId: string; userId: string }
    | { token: string },
) {
  const publicView = "token" in lookup;
  const exam = await c.env.DB.prepare(
    `SELECT e.id,e.user_id AS userId,e.question_count AS questionCount,e.duration_limit_ms AS limitMs,
            e.started_at AS startedAt,e.submitted_at AS submittedAt,e.duration_ms AS durationMs,
            e.correct_count AS correctCount,e.score,e.share_token AS shareToken,u.nickname
     FROM mock_exams e JOIN users u ON u.id=e.user_id
     WHERE ${publicView ? "e.share_token=?" : "e.id=? AND e.user_id=?"} AND e.status='submitted'`,
  )
    .bind(...(publicView ? [lookup.token] : [lookup.examId, lookup.userId]))
    .first<MockExamRow>();
  if (!exam) return null;
  const rows = await c.env.DB.prepare(
    `SELECT id,position,topic_id AS topicId,topic_title AS topicTitle,difficulty,stem,
            options_json AS optionsJson,material_json AS materialJson,answer_index AS answerIndex,
            explanation,selected_index AS selectedIndex,elapsed_ms AS elapsedMs
     FROM mock_exam_questions WHERE exam_id=? ORDER BY position`,
  )
    .bind(exam.id)
    .all<MockQuestionRow>();
  const questionCount = Number(exam.questionCount) || rows.results.length;
  const correctCount =
    exam.correctCount === null
      ? rows.results.filter((row) => row.selectedIndex === row.answerIndex).length
      : Number(exam.correctCount);
  const score = exam.score === null ? Math.round((correctCount / Math.max(1, questionCount)) * 100) : Number(exam.score);
  const byTopic = MOCK_TOPICS.map((topicId) => {
    const topicRows = rows.results.filter((row) => row.topicId === topicId);
    const total = topicRows.length;
    const correct = topicRows.filter(
      (row) => row.selectedIndex === row.answerIndex,
    ).length;
    const answered = topicRows.filter((row) => row.selectedIndex !== null);
    return {
      topicId,
      title: titleOf(topicId),
      total,
      correct,
      accuracy: total ? correct / total : 0,
      averageMs: answered.length
        ? Math.round(
            answered.reduce((sum, row) => sum + Number(row.elapsedMs), 0) /
              answered.length,
          )
        : 0,
    };
  }).filter((item) => item.total > 0);
  const ranked = [...byTopic].sort((a, b) => a.accuracy - b.accuracy);
  const weakTopics = ranked.filter((item) => item.accuracy < 0.6);
  const slowestTopic = [...byTopic].sort(
    (a, b) => b.averageMs - a.averageMs,
  )[0] ?? null;
  const [historyStats, previous] = await Promise.all([
    c.env.DB.prepare(
      "SELECT COUNT(*) AS attemptCount,MAX(score) AS bestScore FROM mock_exams WHERE user_id=? AND status='submitted' AND id<>?",
    )
      .bind(exam.userId, exam.id)
      .first<{ attemptCount: number; bestScore: number | null }>(),
    c.env.DB.prepare(
      "SELECT score FROM mock_exams WHERE user_id=? AND status='submitted' AND id<>? AND submitted_at<? ORDER BY submitted_at DESC LIMIT 1",
    )
      .bind(exam.userId, exam.id, exam.submittedAt ?? exam.startedAt)
      .first<{ score: number }>(),
  ]);
  const previousScore = previous?.score === undefined ? null : Number(previous.score);
  return {
    id: exam.id,
    status: "submitted" as const,
    nickname: publicView
      ? `${Array.from(exam.nickname)[0] ?? "学"}同学`
      : exam.nickname,
    score,
    correctCount,
    questionCount,
    accuracy: questionCount ? correctCount / questionCount : 0,
    durationMs: Number(exam.durationMs) || 0,
    limitMs: Number(exam.limitMs),
    startedAt: exam.startedAt,
    submittedAt: exam.submittedAt,
    shareToken: publicView ? null : exam.shareToken,
    byTopic,
    weakTopics,
    focusTopics: ranked.slice(0, 2),
    slowestTopic,
    comparison: {
      attemptCount: (Number(historyStats?.attemptCount) || 0) + 1,
      bestScore: Math.max(Number(historyStats?.bestScore) || 0, score),
      previousScore,
      deltaScore: previousScore === null ? null : score - previousScore,
    },
    questions: publicView
      ? null
      : rows.results.map((row) => ({
          id: row.id,
          position: row.position,
          topicId: row.topicId,
          topicTitle: row.topicTitle,
          difficulty: row.difficulty,
          stem: row.stem,
          options: JSON.parse(row.optionsJson) as string[],
          material: row.materialJson
            ? (JSON.parse(row.materialJson) as MaterialSpec)
            : null,
          answerIndex: row.answerIndex,
          explanation: row.explanation,
          selectedIndex: row.selectedIndex,
          correct: row.selectedIndex === row.answerIndex,
          elapsedMs: Number(row.elapsedMs),
        })),
  };
}

app.post("/mock/exams", async (c) => {
  if (!allowGeneration(`mock:${c.get("userId")}`))
    return c.json(fail("RATE_LIMITED", "创建模考过于频繁，请稍后再试"), 429);
  const questions = generateMockQuestionSet();
  if (!questions)
    return c.json(fail("GENERATION_FAILED", "暂时无法生成完整模考，请稍后重试"), 503);
  const examId = uuid("mock");
  const startedAt = iso();
  const statements = [
    c.env.DB.prepare(
      "INSERT INTO mock_exams(id,user_id,status,question_count,duration_limit_ms,started_at) VALUES(?,?,'active',?,?,?)",
    ).bind(
      examId,
      c.get("userId"),
      questions.length,
      MOCK_DURATION_MS,
      startedAt,
    ),
    ...questions.map((item, position) =>
      c.env.DB.prepare(
        "INSERT INTO mock_exam_questions(id,exam_id,position,topic_id,topic_title,difficulty,stem,options_json,material_json,answer_index,explanation) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        uuid("mq"),
        examId,
        position,
        item.topicId,
        titleOf(item.topicId),
        item.difficulty,
        item.generated.stem,
        JSON.stringify(item.generated.options),
        item.generated.material
          ? JSON.stringify(item.generated.material)
          : null,
        item.generated.answerIndex,
        item.generated.explanation,
      ),
    ),
  ];
  await c.env.DB.batch(statements);
  return c.json(ok({ examId, startedAt, questionCount: questions.length, limitMs: MOCK_DURATION_MS }));
});

app.get("/mock/exams", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id,status,question_count AS questionCount,duration_limit_ms AS limitMs,
            started_at AS startedAt,submitted_at AS submittedAt,duration_ms AS durationMs,
            correct_count AS correctCount,score,share_token AS shareToken
     FROM mock_exams WHERE user_id=? ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(c.get("userId"))
    .all<{
      id: string;
      status: "active" | "submitted";
      questionCount: number;
      limitMs: number;
      startedAt: string;
      submittedAt: string | null;
      durationMs: number | null;
      correctCount: number | null;
      score: number | null;
      shareToken: string | null;
    }>();
  const items = rows.results.map((row) => ({
    id: row.id,
    status: row.status,
    questionCount: Number(row.questionCount),
    limitMs: Number(row.limitMs),
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    durationMs: Number(row.durationMs) || 0,
    correctCount: row.correctCount === null ? null : Number(row.correctCount),
    score: row.score === null ? null : Number(row.score),
    shareToken: row.status === "submitted" ? row.shareToken : null,
    remainingMs:
      row.status === "active"
        ? Math.max(
            0,
            Number(row.limitMs) - (Date.now() - Date.parse(row.startedAt)),
          )
        : 0,
  }));
  return c.json(
    ok({
      items,
      active: items.find((item) => item.status === "active") ?? null,
    }),
  );
});

app.get("/mock/exams/:id", async (c) => {
  const exam = await c.env.DB.prepare(
    `SELECT id,status,question_count AS questionCount,duration_limit_ms AS limitMs,
            started_at AS startedAt,submitted_at AS submittedAt,duration_ms AS durationMs,
            correct_count AS correctCount,score,share_token AS shareToken
     FROM mock_exams WHERE id=? AND user_id=?`,
  )
    .bind(c.req.param("id"), c.get("userId"))
    .first<{
      id: string;
      status: "active" | "submitted";
      questionCount: number;
      limitMs: number;
      startedAt: string;
      submittedAt: string | null;
      durationMs: number | null;
      correctCount: number | null;
      score: number | null;
      shareToken: string | null;
    }>();
  if (!exam) return c.json(fail("NOT_FOUND", "模考不存在或无权访问"), 404);
  if (exam.status === "submitted")
    return c.json(
      ok({
        id: exam.id,
        status: exam.status,
        questionCount: Number(exam.questionCount),
        limitMs: Number(exam.limitMs),
        startedAt: exam.startedAt,
        submittedAt: exam.submittedAt,
        durationMs: Number(exam.durationMs) || 0,
        correctCount: exam.correctCount === null ? null : Number(exam.correctCount),
        score: exam.score === null ? null : Number(exam.score),
        shareToken: exam.shareToken,
        remainingMs: 0,
        questions: [],
      }),
    );
  const rows = await c.env.DB.prepare(
    `SELECT id,position,topic_id AS topicId,topic_title AS topicTitle,difficulty,stem,
            options_json AS optionsJson,material_json AS materialJson,selected_index AS selectedIndex
     FROM mock_exam_questions WHERE exam_id=? ORDER BY position`,
  )
    .bind(exam.id)
    .all<{
      id: string;
      position: number;
      topicId: string;
      topicTitle: string;
      difficulty: RunDifficulty;
      stem: string;
      optionsJson: string;
      materialJson: string | null;
      selectedIndex: number | null;
    }>();
  return c.json(
    ok({
      id: exam.id,
      status: exam.status,
      questionCount: Number(exam.questionCount),
      limitMs: Number(exam.limitMs),
      startedAt: exam.startedAt,
      submittedAt: null,
      durationMs: 0,
      correctCount: null,
      score: null,
      shareToken: null,
      remainingMs: Math.max(
        0,
        Number(exam.limitMs) - (Date.now() - Date.parse(exam.startedAt)),
      ),
      questions: rows.results.map((row) => ({
        id: row.id,
        position: row.position,
        topicId: row.topicId,
        topicTitle: row.topicTitle,
        difficulty: row.difficulty,
        stem: row.stem,
        options: JSON.parse(row.optionsJson) as string[],
        material: row.materialJson
          ? (JSON.parse(row.materialJson) as MaterialSpec)
          : null,
        selectedIndex: row.selectedIndex,
      })),
    }),
  );
});

app.post("/mock/exams/:id/answers", async (c) => {
  const body = await jsonBody(
    c.req.raw,
    z.object({
      questionId: z.string().min(1),
      selectedIndex: z.number().int().min(-1).max(3),
      elapsedMs: z.number().int().min(0).max(MOCK_DURATION_MS),
    }),
  );
  const exam = await c.env.DB.prepare(
    "SELECT status FROM mock_exams WHERE id=? AND user_id=?",
  )
    .bind(c.req.param("id"), c.get("userId"))
    .first<{ status: string }>();
  if (!exam) return c.json(fail("NOT_FOUND", "模考不存在或无权访问"), 404);
  if (exam.status === "submitted")
    return c.json(fail("MOCK_SUBMITTED", "本场模考已交卷"), 409);
  await c.env.DB.prepare(
    "UPDATE mock_exam_questions SET selected_index=?,elapsed_ms=?,answered_at=? WHERE id=? AND exam_id=?",
  )
    .bind(
      body.selectedIndex,
      body.elapsedMs,
      iso(),
      body.questionId,
      c.req.param("id"),
    )
    .run();
  return c.json(ok({ saved: true }));
});

app.post("/mock/exams/:id/submit", async (c) => {
  const exam = await c.env.DB.prepare(
    "SELECT status,question_count AS questionCount,duration_limit_ms AS limitMs,started_at AS startedAt FROM mock_exams WHERE id=? AND user_id=?",
  )
    .bind(c.req.param("id"), c.get("userId"))
    .first<{
      status: string;
      questionCount: number;
      limitMs: number;
      startedAt: string;
    }>();
  if (!exam) return c.json(fail("NOT_FOUND", "模考不存在或无权访问"), 404);
  if (exam.status === "submitted") {
    const report = await loadMockReport(c, {
      examId: c.req.param("id"),
      userId: c.get("userId"),
    });
    if (!report) return c.json(fail("NOT_FOUND", "成绩报告不存在"), 404);
    return c.json(ok(report));
  }
  const questions = await c.env.DB.prepare(
    "SELECT answer_index AS answerIndex,selected_index AS selectedIndex FROM mock_exam_questions WHERE exam_id=?",
  )
    .bind(c.req.param("id"))
    .all<{ answerIndex: number; selectedIndex: number | null }>();
  const correctCount = questions.results.filter(
    (row) => row.selectedIndex !== null && row.selectedIndex === row.answerIndex,
  ).length;
  const questionCount = questions.results.length || Number(exam.questionCount);
  const durationMs = Math.min(
    Number(exam.limitMs),
    Math.max(0, Date.now() - Date.parse(exam.startedAt)),
  );
  const score = Math.round((correctCount / Math.max(1, questionCount)) * 100);
  const shareToken = crypto.randomUUID().replaceAll("-", "");
  const submittedAt = iso();
  await c.env.DB.prepare(
    "UPDATE mock_exams SET status='submitted',submitted_at=?,duration_ms=?,correct_count=?,score=?,share_token=? WHERE id=? AND user_id=?",
  )
    .bind(
      submittedAt,
      durationMs,
      correctCount,
      score,
      shareToken,
      c.req.param("id"),
      c.get("userId"),
    )
    .run();
  const report = await loadMockReport(c, {
    examId: c.req.param("id"),
    userId: c.get("userId"),
  });
  if (!report) return c.json(fail("INTERNAL_ERROR", "成绩报告生成失败"), 500);
  return c.json(ok(report));
});

app.get("/mock/exams/:id/report", async (c) => {
  const report = await loadMockReport(c, {
    examId: c.req.param("id"),
    userId: c.get("userId"),
  });
  if (!report) return c.json(fail("NOT_FOUND", "交卷后才能查看成绩报告"), 404);
  return c.json(ok(report));
});

app.get("/mock/reports/:token", async (c) => {
  const token = c.req.param("token");
  if (!/^[a-f0-9]{32}$/.test(token))
    return c.json(fail("NOT_FOUND", "分享链接无效或已失效"), 404);
  const report = await loadMockReport(c, { token });
  if (!report)
    return c.json(fail("NOT_FOUND", "分享链接无效或已失效"), 404);
  return c.json(ok(report));
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
