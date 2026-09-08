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
// 目录数据与 src/generator/catalog.ts 保持一致（开发预览用，字段已精简）
const CATALOG_RAW = [
  ['arithmetic', '加减与多项求和'], ['multiply', '乘法与平方'], ['divide', '除法估算'], ['sensitive', '敏感数与百化分'],
  ['decimal', '小数速算'], ['growth-rate', '增长率'], ['growth-amount', '增长量'], ['base-amount', '基期量'],
  ['multiples', '倍数与翻番'], ['base-difference', '基期差'], ['interval-growth', '间隔增长率'], ['mixed-growth', '混合增长率'],
  ['annual-amount', '年均增长量'], ['annual-rate', '年均增长率'], ['ratio-basic', '比重与整体量'], ['part-quantity', '部分量'],
  ['average-basic', '平均数基础'], ['base-ratio', '基期比重'], ['ratio-change', '两期比重差'], ['average-rate', '平均数增长率'],
  ['diff-rate', '差值增长率'], ['contribution-rate', '增长贡献率'], ['pull-growth', '拉动增长率'],
  ['seq-basic', '基础数列'], ['seq-multilevel', '多级数列'], ['seq-multiple', '多重数列'], ['seq-periodic', '周期数列'],
  ['seq-power', '幂次数列'], ['seq-recursive', '递推数列'], ['seq-fraction', '分数数列'], ['seq-split', '机械划分'],
  ['seq-factor', '因数分解'],
]
const RAW_MAP = new Map(CATALOG_RAW)
const CATALOG = [
  ['arithmetic', '加减与多项求和', 1, [], false, 'quick-calculation'],
  ['multiply', '乘法与平方', 1, ['arithmetic'], false, null],
  ['divide', '除法估算', 1, ['multiply'], false, 'direct-division'],
  ['sensitive', '敏感数与百化分', 2, ['multiply'], false, 'growth-basics'],
  ['decimal', '小数速算', 2, ['arithmetic', 'multiply'], false, 'quick-calculation'],
  ['growth-rate', '增长率', 1, ['divide'], false, 'growth-basics'],
  ['growth-amount', '增长量', 1, ['growth-rate'], false, 'growth-amount'],
  ['base-amount', '基期量', 2, ['growth-rate'], false, 'growth-basics'],
  ['multiples', '倍数与翻番', 2, ['growth-rate', 'divide'], false, 'multiple'],
  ['base-difference', '基期差', 3, ['base-amount'], true, 'common-traps'],
  ['interval-growth', '间隔增长率', 2, ['growth-rate'], false, 'interval-growth'],
  ['mixed-growth', '混合增长率', 3, ['interval-growth'], true, 'mixed-growth'],
  ['annual-amount', '年均增长量', 2, ['growth-amount'], false, 'growth-amount-advanced'],
  ['annual-rate', '年均增长率', 3, ['multiples'], true, 'growth-rate-advanced'],
  ['ratio-basic', '比重与整体量', 2, ['sensitive', 'divide'], false, 'proportion'],
  ['part-quantity', '部分量', 2, ['ratio-basic'], false, 'proportion'],
  ['average-basic', '平均数基础', 1, ['divide'], false, 'average'],
  ['base-ratio', '基期比重', 3, ['part-quantity', 'base-amount'], true, 'proportion'],
  ['ratio-change', '两期比重差', 3, ['base-ratio'], true, 'proportion-advanced'],
  ['average-rate', '平均数增长率', 3, ['average-basic', 'growth-rate'], true, 'average-advanced'],
  ['diff-rate', '差值增长率', 3, ['base-difference', 'part-quantity'], true, 'proportion-advanced'],
  ['contribution-rate', '增长贡献率', 3, ['growth-amount', 'part-quantity'], true, 'growth-amount-advanced'],
  ['pull-growth', '拉动增长率', 3, ['contribution-rate'], true, 'growth-amount-advanced'],
  ['seq-basic', '基础数列', 1, [], false, 'basic-sequences'],
  ['seq-multilevel', '多级数列', 1, ['seq-basic'], false, 'multilevel-sequences'],
  ['seq-multiple', '多重数列', 2, ['seq-basic'], false, 'multiple-sequences'],
  ['seq-periodic', '周期数列', 2, ['seq-multilevel'], false, 'basic-sequences'],
  ['seq-power', '幂次数列', 2, ['seq-basic'], false, 'power-sequences'],
  ['seq-recursive', '递推数列', 3, ['seq-multilevel', 'seq-power'], false, 'recursive-sequences'],
  ['seq-fraction', '分数数列', 3, ['seq-power'], false, 'fraction-sequences'],
  ['seq-split', '机械划分', 3, ['seq-periodic', 'seq-power'], false, 'special-sequences'],
  ['seq-factor', '因数分解', 3, ['seq-split'], false, 'special-sequences'],
].map(([id, title, rating, unlock, material, docId]) => ({
  id, title, rating,
  unlock,
  unlockTitles: unlock.map((u) => RAW_MAP.get(u) || u),
  material,
  docId,
  description: '',
  budgetMs: 600000,
}))
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
        data: { html: entry.html || entry.markdown || '' },
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

  // GET /api/quiz/catalog
  if (pathname === '/api/quiz/catalog' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      success: true,
      data: {
        runLength: RUN_LENGTH,
        passAccuracy: 0.8,
        generatorVersion: 3,
        difficultyRuns: [
          { id: 'easy', label: '低难度', short: '低', description: '选项差异大、数字简洁' },
          { id: 'medium', label: '中难度', short: '中', description: '选项更接近、数字更复杂' },
          { id: 'hard', label: '高难度 · 实战', short: '高', description: '资料速算附文字/表格/图表材料' },
        ],
        tracks: ['speed', 'sequence'].map((trackId) => ({
          id: trackId,
          title: trackId === 'speed' ? '资料速算' : '数字推理',
          description: '',
          topics: CATALOG.filter((t) => (trackId === 'speed' ? !t.id.startsWith('seq-') : t.id.startsWith('seq-')))
            .map((t) => ({ ...t, budgetsMs: { easy: 200000, medium: 380000, hard: 600000 } })),
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
    const body = await readBody(req)
    try {
      const { topicId, runId, index = 0, difficulty = 'medium' } = JSON.parse(body)
      if (runId) {
        const starsByKey = passedRuns()
        const topic = topicOfId(topicId)
        const locked = topic && (topic.unlock || []).filter((u) => (starsByKey.get(`${u}|hard`) ?? 0) < 1)
        if (locked && locked.length) {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, data: null, error: { code: 'TOPIC_LOCKED', message: `请先通过前置关卡的高难度局（实战）：${locked.map((u) => (CATALOG_RAW.find((x) => x[0] === u) || [u, u])[1]).join('、')}` } }))
          return
        }
        if (!quizState.runs.has(runId)) quizState.runs.set(runId, { topicId, difficulty, answered: [] })
        const run = quizState.runs.get(runId)
        if (run.answered.length >= RUN_LENGTH) {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, data: null, error: { code: 'RUN_COMPLETE', message: '本局已完成，请重新开始' } }))
          return
        }
        if (run.answered.length !== index) {
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
      quizState.questions.set(questionId, { topicId, difficulty, runId: runId ?? null, answerIndex, explanation: '这是本地开发环境生成的模拟题目与解析。', options })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: true,
        data: {
          questionId, topicId, difficulty, runId: runId ?? null, index: runId ? index : null,
          runLength: RUN_LENGTH, stem, options, material: null,
          generatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
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