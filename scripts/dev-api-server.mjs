/**
 * 本地开发 API Mock 服务器
 * 读取 src/generated/knowledge/entries.json 提供知识库 API
 * 同时提供 Auth API 模拟（自动登录）
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE = path.resolve(__dirname, '..')
const ENTRIES_PATH = path.join(WORKSPACE, 'public/generated/knowledge/entries.json')
const PORT = 4174
/**
 * 人为延迟（毫秒），用来在本地模拟线上/弱网的服务端耗时，验证预取等体验优化：
 *   DEV_API_DELAY_MS=400 node scripts/dev-api-server.mjs
 * 只作用于 /api/quiz/* 的写读接口。
 */
const API_DELAY_MS = Number(process.env.DEV_API_DELAY_MS ?? 0)
const delay = API_DELAY_MS > 0 ? () => new Promise((r) => setTimeout(r, API_DELAY_MS)) : null

// 读取 entries.json
function loadEntries() {
  try {
    const raw = fs.readFileSync(ENTRIES_PATH, 'utf-8')
    const data = JSON.parse(raw)
    return data.entries || []
  } catch (e) {
    console.error('[dev-api] Failed to load entries.json:', e.message)
    return []
  }
}

// 简化的知识条目列表（不含 markdown/html 大字段）
function toListItem(entry) {
  return {
    id: entry.id,
    module: entry.module,
    category: entry.category,
    title: entry.title,
    summary: entry.summary || entry.title,
  }
}

// 与 functions/api/[[path]].ts 的 splitSections 保持一致：按一级/二级标题切段
function splitSections(markdown) {
  const sections = []
  let heading = '正文'
  let lines = []
  for (const line of markdown.split('\n')) {
    if (/^#{1,2}\s+/.test(line)) {
      if (lines.join('\n').trim()) sections.push({ heading, content: lines.join('\n').trim() })
      heading = line.replace(/^#{1,2}\s+/, '')
      lines = []
    } else lines.push(line)
  }
  if (lines.join('\n').trim()) sections.push({ heading, content: lines.join('\n').trim() })
  return sections
}

function takeSection(markdown, name) {
  return splitSections(markdown).find((section) => section.heading === name)?.content ?? ''
}

function parseQuery(url) {
  const idx = url.indexOf('?')
  if (idx === -1) return {}
  const qs = url.slice(idx + 1)
  const params = {}
  for (const part of qs.split('&')) {
    const [k, v] = part.split('=')
    params[decodeURIComponent(k)] = decodeURIComponent(v || '')
  }
  return params
}

const MOCK_USER = { id: 'dev-user-001', nickname: '开发用户' }

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

// ==================== Quiz（模拟闯关双轨；开发占位，与生产同响应形状） ====================
// 关卡目录直接取自 src/generator/catalog.ts（单一事实源），不再手抄一份：
// 手抄副本会和目录脱钩——比如 data_analysis/direct-division.md 被删掉后，副本里的 docId 依然指着一个不存在的文档，
// 本地点「查看知识讲解」就打不开详情页，而线上（functions/api 读 catalog.ts）和本地还不一致。
// 依赖 Node 的类型剥离（≥22.18 默认开启，`node -v` 应 ≥ v22.18）；本文件下方只做“补字段”，不再重复数据。
const catalogUrl = new URL('../src/generator/catalog.ts', import.meta.url).href
const { topics: CATALOG, difficultyRuns: RUN_META, tracks: TRACKS, titleOf, topicBudget, difficultyBudgetMs } =
  await import(catalogUrl)

const RUN_LENGTH = 10
const DIFFS = ['easy', 'medium', 'hard']
const quizState = {
  questions: new Map(),
  runs: new Map(), // runId -> { topicId, difficulty, answered: [] }
}
const topicOfId = (id) => CATALOG.find((t) => t.id === id)
/** 各难度局是否通过（stars ≥1）；模块解锁看前置模块 high 局 */
const passedRuns = () => {
  const starsByKey = new Map() // `${topicId}|${difficulty}` -> stars
  for (const run of quizState.runs.values()) {
    if (run.answered.length < RUN_LENGTH) continue
    const correct = run.answered.filter((a) => a.correct).length
    if (correct < 8) continue
    const key = `${run.topicId}|${run.difficulty}`
    const accuracy = correct / run.answered.length
    const stars = accuracy >= 1 ? 3 : accuracy >= 0.9 ? 2 : 1
    starsByKey.set(key, Math.max(starsByKey.get(key) ?? 0, stars))
  }
  return starsByKey
}
const topicUnlocked = (starsByKey, topicId) => {
  const topic = topicOfId(topicId)
  if (!topic) return false
  return (topic.unlock || []).every((prereq) => (starsByKey.get(`${prereq}|hard`) ?? 0) >= 1)
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5173')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)
  const pathname = url.pathname
  const query = parseQuery(req.url)

  console.log(`[dev-api] ${req.method} ${pathname}`)

  // === Auth API ===
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true, data: { user: MOCK_USER }, error: null }))
    return
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true, data: { user: MOCK_USER }, error: null }))
    return
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true, data: null, error: null }))
    return
  }

  // === Knowledge API ===
  // GET /api/knowledge?limit=100&q=xxx
  if (pathname === '/api/knowledge' && req.method === 'GET') {
    const entries = loadEntries()
    let items = entries

    // 搜索过滤
    const q = (query.q || '').trim().toLowerCase()
    if (q) {
      items = items.filter(e =>
        (e.title || '').toLowerCase().includes(q) ||
        (e.category || '').toLowerCase().includes(q) ||
        (e.summary || '').toLowerCase().includes(q) ||
        (e.markdown || '').toLowerCase().includes(q)
      )
    }

    // 本地开发模式返回全部条目，不受前端 limit=100 限制
    const sliced = items.map(toListItem)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true, data: { items: sliced }, error: null }))
    return
  }

  // GET /api/knowledge/:id
  const detailMatch = pathname.match(/^\/api\/knowledge\/(.+)$/)
  if (detailMatch && req.method === 'GET') {
    const id = detailMatch[1]
    const entries = loadEntries()
    const entry = entries.find(e => e.id === id)

    if (entry) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: true,
        // 与 functions/api/[[path]].ts 的 /knowledge/:id 同形：title 必须给，
        // 详情页用它渲染自己的标题（正文开头的 h1 已在构建时剥掉），少给就会没标题
        data: {
          id: entry.id,
          module: entry.module,
          category: entry.category,
          title: entry.title,
          html: entry.html,
          sections: splitSections(entry.markdown || ''),
          example: entry.module === 'quantitative'
            ? {
                stem: takeSection(entry.markdown || '', '例题'),
                answer: takeSection(entry.markdown || '', '答案'),
                explanation: takeSection(entry.markdown || '', '讲解'),
              }
            : null,
        },
        error: null,
      }))
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, data: null, error: { message: '知识条目不存在' } }))
    }
    return
  }

  // === Essay API（返回空数据，避免卡死）===
  if (pathname === '/api/essay/cards' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      success: true,
      data: { cards: [], summary: { total: 0, new: 0, due: 0, learning: 0, mastered: 0, accuracy: 0 }, categories: [] },
      error: null,
    }))
    return
  }

  if (pathname.startsWith('/api/essay/') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      success: true,
      data: { items: [], todayCount: 0 },
      error: null,
    }))
    return
  }

  if (pathname.startsWith('/api/essay/') && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true, data: null, error: null }))
    return
  }

  // GET /api/quiz/catalog（字段与 functions/api/[[path]].ts 的 /quiz/catalog 完全对齐）
  if (pathname === '/api/quiz/catalog' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      success: true,
      data: {
        runLength: RUN_LENGTH,
        passAccuracy: 0.8,
        generatorVersion: 3,
        difficultyRuns: RUN_META,
        tracks: TRACKS.map((track) => ({
          ...track,
          topics: CATALOG.filter((t) => t.track === track.id).map((t) => ({
            ...t,
            budgetMs: topicBudget(t),
            budgetsMs: {
              easy: difficultyBudgetMs(t, 'easy'),
              medium: difficultyBudgetMs(t, 'medium'),
              hard: difficultyBudgetMs(t, 'hard'),
            },
            unlockTitles: t.unlock.map(titleOf),
            docId: t.docId ?? null,
          })),
        })),
      },
      error: null,
    }))
    return
  }
  
  // GET /api/quiz/progress：按（模块 × 难度局）返回；解锁看前置模块高难度局
  if (pathname === '/api/quiz/progress' && req.method === 'GET') {
    const starsByKey = passedRuns()
    const data = CATALOG.flatMap((topic) => {
      const unlocked = topicUnlocked(starsByKey, topic.id)
      return DIFFS.map((difficulty) => ({
        topicId: topic.id,
        difficulty,
        unlocked,
        stars: starsByKey.get(`${topic.id}|${difficulty}`) ?? 0,
        total: 0,
        accuracy: 0,
        averageMs: 0,
        lastRunAt: null,
      }))
    })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true, data, error: null }))
    return
  }
  
  const quizQuestionsMatch = pathname === '/api/quiz/questions' && req.method === 'POST'
  if (quizQuestionsMatch) {
    if (delay) await delay()
    const body = await readBody(req)
    try {
      const { topicId, runId, index = 0, difficulty = 'medium' } = JSON.parse(body)
      // 未知/已拆分的模块：与线上一致地拒绝（线上还会提示「已拆分为独立关卡」，
      // 本地没有 legacyTopics 文案，这里只保证不会给已下线的 id 出题）
      if (!topicOfId(topicId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, data: null, error: { code: 'TOPIC_RETIRED', message: `${topicId} 不是有效模块，请从「专项训练」关卡地图进入` } }))
        return
      }
      if (runId) {
        if (!quizState.runs.has(runId)) quizState.runs.set(runId, { topicId, difficulty, answered: [], questions: [] })
        const run = quizState.runs.get(runId)
        run.questions ??= []
        if (run.questions.length === 0) {
          // 开新局才判解锁（与线上一致：局内不再重复做用户级校验）
          const starsByKey = passedRuns()
          const topic = topicOfId(topicId)
          const locked = topic && (topic.unlock || []).filter((u) => (starsByKey.get(`${u}|hard`) ?? 0) < 1)
          if (locked && locked.length) {
            res.writeHead(409, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, data: null, error: { code: 'TOPIC_LOCKED', message: `请先通过前置关卡的高难度局（实战）：${locked.map(titleOf).join('、')}` } }))
            return
          }
        } else {
          const firstQ = quizState.questions.get(run.questions[0])
          if (firstQ && (firstQ.topicId !== topicId || firstQ.difficulty !== difficulty)) {
            res.writeHead(409, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, data: null, error: { code: 'RUN_STATE', message: '本局已切换到其它模块，请重新开始本局' } }))
            return
          }
        }
        // 与 functions/api/[[path]].ts 一致：本局已生成的题按顺序记在 run.questions，
        // 第 index 题已存在就**原样返回**（预取与「下一题」撞车、客户端重试都不该报错），
        // 只有真的越界时才回 RUN_COMPLETE / RUN_STATE。
        const existingId = run.questions[index]
        if (existingId && quizState.questions.has(existingId)) {
          const q = quizState.questions.get(existingId)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: true,
            data: {
              questionId: existingId, topicId: q.topicId, difficulty: q.difficulty, runId,
              index, runLength: RUN_LENGTH, stem: q.stem, options: q.options, material: null,
              generatedAt: q.generatedAt, expiresAt: q.expiresAt, reused: true,
            },
            error: null,
          }))
          return
        }
        if (run.questions.length >= RUN_LENGTH) {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, data: null, error: { code: 'RUN_COMPLETE', message: '本局已完成，请重新开始' } }))
          return
        }
        if (run.questions.length !== index) {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, data: null, error: { code: 'RUN_STATE', message: '题目序号不连续，请重新开始本局' } }))
          return
        }
      }
      const questionId = `q_${crypto.randomUUID()}`
      const stem = topicId.startsWith('seq-')
        ? `模拟数推题（${topicOfId(topicId)?.title ?? topicId}）：3、7、11、15、（ ），求括号中的数。`
        : `模拟${topicOfId(topicId)?.title ?? topicId}题（${difficulty}局）：请选出正确选项。`
      const options = topicId.startsWith('seq-') ? ['19', '21', '17', '18'] : ['选项 A', '选项 B', '选项 C', '选项 D']
      const answerIndex = topicId.startsWith('seq-') ? 0 : index % 4
      const generatedAt = new Date().toISOString()
      const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
      quizState.questions.set(questionId, { topicId, difficulty, runId: runId ?? null, answerIndex, explanation: '这是本地开发环境生成的模拟题目与解析。', options, stem, generatedAt, expiresAt })
      if (runId) quizState.runs.get(runId).questions[index] = questionId
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: true,
        data: {
          questionId, topicId, difficulty, runId: runId ?? null, index: runId ? index : null,
          runLength: RUN_LENGTH, stem, options, material: null,
          generatedAt,
          expiresAt,
        },
        error: null,
      }))
    } catch (e) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, data: null, error: { message: e.message } }))
    }
    return
  }
  
  const quizAnswerMatch = pathname === '/api/quiz/answers' && req.method === 'POST'
  if (quizAnswerMatch) {
    if (delay) await delay()
    const body = await readBody(req)
    try {
      const { questionId, selectedIndex, elapsedMs } = JSON.parse(body)
      const question = quizState.questions.get(questionId)
      if (!question) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, data: null, error: { code: 'NOT_FOUND', message: '题目不存在' } }))
        return
      }
      const correct = selectedIndex === question.answerIndex
      let run = null
      if (question.runId && quizState.runs.has(question.runId)) {
        const runData = quizState.runs.get(question.runId)
        runData.answered.push({ correct, durationMs: elapsedMs })
        if (runData.answered.length >= RUN_LENGTH) {
          const ok = runData.answered.filter((a) => a.correct).length
          const durationMs = runData.answered.reduce((s, a) => s + a.durationMs, 0)
          const accuracy = ok / runData.answered.length
          const passed = accuracy >= 0.8 && durationMs <= 600000
          run = { finished: true, total: runData.answered.length, correct: ok, accuracy, durationMs, passed, stars: passed ? (accuracy >= 1 ? 3 : accuracy >= 0.9 ? 2 : 1) : 0 }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: true,
        data: { correct, answerIndex: question.answerIndex, explanation: question.explanation, savedAt: new Date().toISOString(), run },
        error: null,
      }))
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, data: null, error: { message: e.message } }))
    }
    return
  }
  
  const quizStatsMatch = pathname === '/api/quiz/stats' && req.method === 'GET'
  if (quizStatsMatch) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      success: true,
      data: { groups: [], overall: { total: 0, correct: 0, accuracy: 0, averageMs: 0 } },
      error: null,
    }))
    return
  }
  
  const profileSummaryMatch = pathname === '/api/profile/summary' && req.method === 'GET'
  if (profileSummaryMatch) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      success: true,
      data: {
        activity: { studyDays: 0, streak: 0, activeToday: false, today: { quizCount: 0, cardReviews: 0, schulteRuns: 0, retries: 0 } },
        trend30: Array.from({ length: 30 }, (_, i) => ({ date: '', quizCount: 0, correct: 0, accuracy: 0, durationMs: 0, cardReviews: 0, schulteRuns: 0, retries: 0 })),
        quiz: { items: [], overall: { total: 0, correct: 0, accuracy: 0, averageMs: 0 } },
        cards: { summary: { total: 0, new: 0, due: 0, learning: 0, mastered: 0, accuracy: 0 }, today: 0, last7: 0 },
        mistakes: { open: 0, mastered: 0, retryTotal: 0, retryAccuracy: 0 },
        schulte: { bests: [], runs30: 0 },
      },
      error: null,
    }))
    return
  }

  // === 其他 API 返回空成功 ===
  if (pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true, data: null, error: null }))
    return
  }

  // 非 API 路由，不处理
  res.writeHead(404)
  res.end()
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-api] Mock API server running at http://127.0.0.1:${PORT}`)
  console.log(`[dev-api] Entries: ${path.relative(WORKSPACE, ENTRIES_PATH)}`)
})