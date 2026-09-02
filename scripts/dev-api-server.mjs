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
const ENTRIES_PATH = path.join(WORKSPACE, 'src/generated/knowledge/entries.json')
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

// Quiz generator state
const quizState = {
  topics: [
    { id: 'arithmetic', title: '加减与多项求和', description: '两位/三位加减、多数求和与凑整' },
    { id: 'multiply', title: '乘法与常见平方', description: '一位乘法、两位乘法和平方数' },
    { id: 'divide', title: '除法估算', description: '三位除法、五位除三位与商值范围' },
    { id: 'sensitive', title: '敏感数与拆分法 / 415份数法', description: '分数、百分数与份数关系的快速转换' },
    { id: 'decimal', title: '小数点加减乘除速算', description: '小数对齐、凑整与移位技巧' },
    { id: 'growth', title: '增长率 / 增长量', description: 'A·B·R·X 四者互求' },
    { id: 'ratio', title: '比重 / 盐水 / 平均数', description: '部分与整体、浓度及加权平均' },
    { id: 'annual', title: '年平均量 / 年均增长率', description: '时间段口径、年份差和复合增长' },
    { id: 'interval-growth', title: '间隔增长率', description: 'r₁+r₂+r₁×r₂ 累计增长的逻辑估算' },
    { id: 'mixed-growth', title: '混合增长率', description: '整体增速介于部分之间、偏向体量大的' },
    { id: 'multiples', title: '倍数与翻番', description: '现期÷基期与 2ⁿ 对应的翻番数估算' },
    { id: 'ratio-change', title: '两期比重差', description: '方向判断 + 变化幅度上限估算' },
  ],
  difficulties: [
    { id: 'easy', label: '简单', description: '整洁数值，一步计算' },
    { id: 'medium', label: '中等', description: '数值变化，两步换算' },
    { id: 'hard', label: '困难', description: '更大范围，干扰项更接近' },
  ],
  generatorVersion: 2,
  recentWindow: 50,
  questions: new Map(),
}
let quizLoadAttempted = false

function quizGenerateFn(topicId, difficulty, excludedFingerprints) {
  if (!quizLoadAttempted) {
    quizLoadAttempted = true
    console.log('[dev-api] Quiz endpoints ready (using mock for dev preview)')
  }
  return quizFallbackGenerate(topicId, difficulty)
}

function quizFallbackGenerate(topicId, difficulty) {
  // Simplified mock for dev preview — returns a hand-crafted question
  const templates = {
    'interval-growth': {
      body: () => ({
        templateId: 'interval-growth-v1',
        params: { r1: 8, r2: 12, answer: 20.96 },
        stem: '某地区去年增长 8%，今年增长 12%，两年累计增长了多少？',
        options: ['20.00%', '20.96%', '21.60%', '19.60%'],
        answerIndex: 1,
        explanation: '代入公式 R = r₁+r₂+r₁×r₂ = 8%+12%+8%×12% = 20.96%。选项 20% 漏掉了交叉乘积项，21.6% 把乘积项算重了。',
      }),
    },
    'mixed-growth': {
      body: () => ({
        templateId: 'mixed-growth-v1',
        params: { a: 8, b: 20, ratioA: 3, ratioB: 1, answer: 11 },
        stem: '某企业上半年产值增长 8%，下半年产值增长 20%，上下半年产值之比为 3:1。全年产值增长率约为多少？',
        options: ['8.00%', '11.00%', '14.00%', '20.00%'],
        answerIndex: 1,
        explanation: '整体增速介于 8%~20% 之间。上半年占比 75%，远大于下半年，故整体增速应偏向 8%（14%为直接平均，20%则完全无视了下半年），正确答案为 11%。',
      }),
    },
    'multiples': {
      body: () => ({
        templateId: 'multiples-fan-v1',
        params: { base: 200, num: 1600, n: 3 },
        stem: '某企业利润从 200 万元增至 1600 万元，相当于翻了多少番？',
        options: ['2 番', '3 番', '4 番', '3.5 番'],
        answerIndex: 1,
        explanation: '1600÷200=8=2³，翻了 3 番。翻 1 番×2，翻 n 番×2ⁿ。±1 和半番是常见干扰。',
      }),
    },
    'ratio-change': {
      body: () => ({
        templateId: 'ratio-change-v1',
        params: { a: 15, b: 8, partRatio: 25, exactChange: 1.52 },
        stem: '某行业产值同比增长 15%，全国规上工业增加值同比增长 8%，该行业占规上工业增加值的比重比上年：',
        options: ['上升 1.5 个百分点', '下降 1.5 个百分点', '上升 7.0 个百分点', '下降 7.0 个百分点'],
        answerIndex: 0,
        explanation: '部分增速(15%) > 整体增速(8%)，比重上升。|Δ| < |15%−8%| = 7%，故 7 个百分点的选项可以排除，且方向不符的也排除。',
      }),
    },
  }
  const tpl = templates[topicId]
  if (tpl) return { fingerprint: 'mock_fp', templateVersion: 1, ...tpl.body() }
  // fallback for other topics
  return {
    templateId: 'mock-v1',
    params: {},
    stem: '这是模拟题目，实际使用需启动完整 API 服务。',
    options: ['A 选项', 'B 选项', 'C 选项', 'D 选项'],
    answerIndex: 0,
    explanation: '模拟环境下的占位说明。',
    fingerprint: 'mock_fp',
    templateVersion: 1,
  }
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

  // === Quiz API（内存模拟）===
  const quizTopicMatch = pathname === '/api/quiz/topics' && req.method === 'GET'
  if (quizTopicMatch) {
    const { topics, difficulties, generatorVersion, recentWindow } = quizState
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      success: true,
      data: { topics, difficulties, generatorVersion, recentWindow },
      error: null,
    }))
    return
  }

  const quizQuestionsMatch = pathname === '/api/quiz/questions' && req.method === 'POST'
  if (quizQuestionsMatch) {
    const body = await readBody(req)
    try {
      const { topicId, difficulty } = JSON.parse(body)
      const generated = quizGenerateFn(topicId, difficulty, [])
      const questionId = `q_${crypto.randomUUID()}`
      const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
      const generatedAt = new Date().toISOString()
      quizState.questions.set(questionId, generated)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: true,
        data: { questionId, topicId, difficulty, stem: generated.stem, options: generated.options, generatedAt, expiresAt },
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
      const { questionId, selectedIndex } = JSON.parse(body)
      const question = quizState.questions.get(questionId)
      if (!question) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, data: null, error: { code: 'NOT_FOUND', message: '题目不存在' } }))
        return
      }
      const correct = selectedIndex === question.answerIndex
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: true,
        data: { correct, answerIndex: question.answerIndex, explanation: question.explanation, savedAt: new Date().toISOString() },
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