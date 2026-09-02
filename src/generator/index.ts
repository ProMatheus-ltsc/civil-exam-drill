import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export type TopicId = 'arithmetic' | 'multiply' | 'divide' | 'sensitive' | 'decimal' | 'growth' | 'ratio' | 'annual' | 'interval-growth' | 'mixed-growth' | 'multiples' | 'ratio-change'
export type Difficulty = 'easy' | 'medium' | 'hard'

export interface GeneratedQuestion {
  templateId: string
  templateVersion: number
  params: Record<string, number | string>
  fingerprint: string
  stem: string
  options: [string, string, string, string]
  answerIndex: 0 | 1 | 2 | 3
  explanation: string
}

export const topics = [
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
] as const

export const difficulties = [
  { id: 'easy', label: '简单', description: '整洁数值，一步计算' },
  { id: 'medium', label: '中等', description: '数值变化，两步换算' },
  { id: 'hard', label: '困难', description: '更大范围，干扰项更接近' },
] as const

const scales: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 }

function seeded(seed: string) {
  let state = 2166136261
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619)
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function canonical(params: Record<string, number | string>) {
  return JSON.stringify(Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))))
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function options(answer: number, distractors: number[], suffix: string, random: () => number, digits = 2) {
  const values = [answer, ...distractors].map((value) => round(value, digits))
  const unique = [...new Set(values)]
  const step = Math.max(10 ** -digits, Math.abs(answer) * .05)
  while (unique.length < 4) unique.push(round(answer + step * unique.length))
  for (let index = unique.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[unique[index], unique[target]] = [unique[target], unique[index]]
  }
  const answerIndex = unique.indexOf(round(answer, digits)) as 0 | 1 | 2 | 3
  return { options: unique.map((value) => `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}${suffix}`) as [string, string, string, string], answerIndex }
}

export function generateQuestion(input: { topicId: TopicId; difficulty: Difficulty; excludedFingerprints: string[]; randomSeed?: string }): GeneratedQuestion {
  const level = scales[input.difficulty]
  const seed = input.randomSeed ?? crypto.randomUUID()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const random = seeded(`${seed}:${attempt}`)
    const integer = (min: number, max: number) => Math.floor(random() * (max - min + 1)) + min
    const pick = <T>(values: readonly T[]) => values[integer(0, values.length - 1)]
    let draft: Omit<GeneratedQuestion, 'fingerprint' | 'templateVersion'>

    if (input.topicId === 'arithmetic') {
      const count = level === 1 ? 2 : level === 2 ? pick([2, 3]) : pick([3, 5])
      const values = Array.from({ length: count }, () => integer(12 * level, 99 * level))
      const subtract = count === 2 && random() > .5
      const left = subtract ? Math.max(...values) : values[0]
      const right = subtract ? Math.min(...values) : values[1]
      const answer = subtract ? left - right : values.reduce((sum, value) => sum + value, 0)
      const expression = subtract ? `${left}-${right}` : values.join('+')
      draft = { templateId: subtract ? 'arithmetic-subtract-v1' : `arithmetic-sum-${count}-v1`, params: { expression, answer }, stem: `不使用计算器，计算 ${expression}。`, ...options(answer, [answer - 10, answer + 10, answer + (subtract ? 1 : values[0])], '', random, 0), explanation: subtract ? `按位退位计算，并用“差+减数=被减数”验算：${left}-${right}=${answer}。` : `优先把个位能凑成 10 的数配对，再合并其余项，结果为 ${answer}。` }
    } else if (input.topicId === 'multiply') {
      const square = random() > .65
      const a = square ? integer(11, 30) : integer(12 * level, 49 * level)
      const b = square ? a : integer(3, level === 1 ? 9 : 19)
      const answer = a * b
      draft = { templateId: square ? 'common-square-v1' : `multiply-${level}-v1`, params: { a, b, answer }, stem: `不使用计算器，计算 ${a}×${b}。`, ...options(answer, [answer - a, answer + a, (a + 1) * b], '', random, 0), explanation: square ? `${a}² 可用临近整十数展开：(${a > 20 ? 20 : 10}+${a - (a > 20 ? 20 : 10)})²=${answer}。` : `拆分乘数后使用分配律，例如 ${a}×${b}=${a}×${Math.max(1, b - 1)}+${a}=${answer}。` }
    } else if (input.topicId === 'divide') {
      const divisor = integer(level === 1 ? 4 : 12, level === 1 ? 9 : level === 2 ? 49 : 199)
      const quotient = integer(12, 99 * level)
      const estimate = random() > .5
      const remainder = estimate ? integer(1, Math.max(1, Math.floor(divisor / 3))) : 0
      const dividend = divisor * quotient + remainder
      draft = { templateId: estimate ? `division-estimate-${level}-v1` : `division-exact-${level}-v1`, params: { dividend, divisor, quotient, remainder }, stem: `不使用计算器，${estimate ? '估算' : '计算'} ${dividend}÷${divisor}${estimate ? '（取最接近的整数）' : ''}。`, ...options(quotient, [quotient - 1, quotient + 1, quotient + 10], '', random, 0), explanation: estimate ? `${dividend} 接近 ${divisor}×${quotient}=${divisor * quotient}，余数 ${remainder} 不足半个除数，因此最接近 ${quotient}。` : `先用商的首位估范围，再用乘法验证：${divisor}×${quotient}=${dividend}，所以商为 ${quotient}。` }
    } else if (input.topicId === 'sensitive') {
      const denominator = pick(level === 1 ? [4, 5, 8, 10] : level === 2 ? [6, 8, 12, 16] : [7, 11, 13, 16])
      const numerator = integer(1, Math.min(3, denominator - 1))
      const unit = integer(4 * level, 24 * level) * 10
      const part = unit * numerator
      const whole = unit * denominator
      const percent = round(100 * numerator / denominator, 1)
      const variant = integer(0, 2)
      if (variant === 0) {
        draft = { templateId: 'sensitive-fraction-to-whole-v2', params: { denominator, numerator, part, whole }, stem: `某地区高新技术企业实现营业收入 ${part} 亿元，占全部规上企业营业收入的 ${percent}%。全部规上企业营业收入约为多少亿元？`, ...options(whole, [part * (denominator - numerator), part * denominator, whole + unit], ' 亿元', random), explanation: `第一步识别“部分÷比重=整体”。${percent}%≈${numerator}/${denominator}；第二步按份数计算：${part}÷${numerator}×${denominator}=${whole} 亿元。` }
      } else if (variant === 1) {
        const answer = round(part / whole * 100, 1)
        draft = { templateId: 'sensitive-share-v2', params: { denominator, numerator, part, whole }, stem: `某行业完成投资 ${part} 亿元，全行业投资为 ${whole} 亿元。该行业投资占比约为多少？`, ...options(answer, [round(100 / denominator, 1), round(100 * (denominator - numerator) / denominator, 1), round(answer + 5, 1)], '%', random, 1), explanation: `占比=部分÷整体=${part}÷${whole}=${numerator}/${denominator}≈${answer}%。先约成敏感分数，可以避免长除法。` }
      } else {
        const rate = pick([10, 20, 25])
        const current = unit * (100 + rate) / 100
        const growth = current - unit
        draft = { templateId: 'sensitive-growth-shares-v2', params: { current, rate, unit, growth }, stem: `某产品本期产量为 ${current} 万吨，同比增长 ${rate}%。按份数法估算增长量是多少万吨？`, ...options(growth, [current * rate / 100, unit, current - growth], ' 万吨', random), explanation: `同比增长 ${rate}% 时，基期看作 100 份、本期为 ${100 + rate} 份。基期=${current}÷${100 + rate}×100=${unit}，增长量=${current}-${unit}=${growth} 万吨。` }
      }
    } else if (input.topicId === 'decimal') {
      const digits = level === 1 ? 1 : 2
      const factor = 10 ** digits
      const a = integer(80 * level, 300 * level) / factor
      const b = integer(20 * level, 90 * level) / factor
      const variant = integer(0, 2)
      if (variant < 2) {
        const operation = variant === 0 ? '+' : '-'
        const left = operation === '-' ? Math.max(a, b) : a
        const right = operation === '-' ? Math.min(a, b) : b
        const answer = round(operation === '+' ? left + right : left - right, digits)
        draft = { templateId: `decimal-${operation === '+' ? 'add' : 'subtract'}-v2`, params: { left, right, operation, digits }, stem: `某表两项数值分别为 ${left} 和 ${right}，求二者${operation === '+' ? '合计' : '差值'}。`, ...options(answer, [round(answer + 1 / factor, digits), round(answer - 1 / factor, digits), round(left + right, digits)], '', random, digits), explanation: `先对齐小数点，再逐位${operation === '+' ? '相加' : '相减'}：${left}${operation}${right}=${answer}。选项接近时必须保留 ${digits} 位小数。` }
      } else {
        const multiplier = pick([1.1, 1.2, 1.25, 1.5])
        const answer = round(a * multiplier, digits)
        draft = { templateId: 'decimal-multiply-split-v2', params: { a, multiplier, digits }, stem: `某指标为 ${a}，调整后为原来的 ${multiplier} 倍，调整后的数值是多少？`, ...options(answer, [round(a + multiplier, digits), round(a * (multiplier - 1), digits), round(answer + 1 / factor, digits)], '', random, digits), explanation: `拆分 ${multiplier}=1+${round(multiplier - 1, 2)}：${a}×${multiplier}=${a}+${a}×${round(multiplier - 1, 2)}=${answer}。` }
      }
    } else if (input.topicId === 'growth') {
      const rate = pick(level === 1 ? [10, 20, 25] : level === 2 ? [5, 10, 15, 20, 25] : [5, 8, 12, 15, 18, 25])
      const base = integer(5 * level, 18 * level) * 100
      const growth = round(base * rate / 100)
      const current = base + growth
      const variant = integer(0, 2)
      if (variant === 0) draft = { templateId: 'growth-amount-from-current-v2', params: { base, rate, growth, current }, stem: `某产业增加值为 ${current} 亿元，同比增长 ${rate}%。其同比增量为多少亿元？`, ...options(growth, [current * rate / 100, base, current - growth], ' 亿元', random), explanation: `题干给现期，应使用增长量=现期×r÷(1+r)。列式：${current}×${rate}%÷(1+${rate}%)=${growth} 亿元。不能直接用现期乘增长率。` }
      else if (variant === 1) draft = { templateId: 'growth-base-v2', params: { base, rate, growth, current }, stem: `某地本年零售额为 ${current} 亿元，同比增长 ${rate}%。上年零售额是多少亿元？`, ...options(base, [growth, current * (1 - rate / 100), current + growth], ' 亿元', random), explanation: `基期量=现期量÷(1+r)=${current}÷${1 + rate / 100}=${base} 亿元。` }
      else draft = { templateId: 'growth-current-v2', params: { base, rate, growth, current }, stem: `某地上年货运量为 ${base} 万吨，本年同比增长 ${rate}%。本年货运量是多少万吨？`, ...options(current, [growth, base * (1 - rate / 100), base + rate], ' 万吨', random), explanation: `现期量=基期量×(1+r)=${base}×${1 + rate / 100}=${current} 万吨。` }
    } else if (input.topicId === 'ratio') {
      const percent = pick(level === 1 ? [20, 25, 40, 50] : level === 2 ? [15, 30, 35, 60] : [12, 18, 32, 45])
      const whole = integer(10 * level, 30 * level) * 100
      const part = round(whole * percent / 100)
      const variant = integer(0, 2)
      if (variant === 0) draft = { templateId: 'ratio-whole-v2', params: { whole, percent, part }, stem: `民营企业出口额为 ${part} 亿元，占出口总额的 ${percent}%。出口总额是多少亿元？`, ...options(whole, [part * percent / 100, whole - part, whole + part], ' 亿元', random), explanation: `整体=部分÷比重=${part}÷${percent}%=${whole} 亿元。先确认题目问整体，避免把除法写成乘法。` }
      else if (variant === 1) draft = { templateId: 'ratio-part-v2', params: { whole, percent, part }, stem: `某市财政支出 ${whole} 亿元，其中教育支出占 ${percent}%。教育支出为多少亿元？`, ...options(part, [whole / (percent / 100), whole - part, whole * (1 - percent / 100)], ' 亿元', random), explanation: `部分=整体×比重=${whole}×${percent}%=${part} 亿元。` }
      else {
        const count = pick([4, 5, 8, 10])
        const average = integer(8 * level, 24 * level) * 10
        const total = average * count
        draft = { templateId: 'average-total-v2', params: { count, average, total }, stem: `某地区 ${count} 个园区平均每个完成投资 ${average} 亿元，合计完成投资多少亿元？`, ...options(total, [average / count, total - average, total + count], ' 亿元', random), explanation: `总量=平均数×份数=${average}×${count}=${total} 亿元。看到“平均每个”要同时寻找单位数。` }
      }
    } else if (input.topicId === 'interval-growth') {
      const minR = level === 1 ? 3 : level === 2 ? 5 : 8
      const maxR = level === 1 ? 12 : level === 2 ? 25 : 35
      const r1 = integer(minR, maxR)
      const r2 = integer(minR, maxR)
      const product = round(r1 * r2 / 100, 2)
      const answer = round(r1 + r2 + product, 2)
      const r1Desc = r1 >= 0 ? `增长 ${r1}%` : `下降 ${Math.abs(r1)}%`
      const r2Desc = r2 >= 0 ? `增长 ${r2}%` : `下降 ${Math.abs(r2)}%`
      draft = {
        templateId: 'interval-growth-v1',
        params: { r1, r2, answer },
        stem: `某地区去年${r1Desc}，今年${r2Desc}，两年累计增长了多少？`,
        ...options(answer, [round(r1 + r2, 2), round(product, 2), round(r1 + r2 + 2 * product, 2)], '%', random, 2),
        explanation: `间隔增长率 R = r₁ + r₂ + r₁×r₂。代入：${r1}%${r2 >= 0 ? '+' : ''}${r2}%${product >= 0 ? '+' : ''}${product}% = ${answer}%。选项 ${r1 + r2}% 漏掉了${product >= 0 ? '正的' : '负的'}乘积项${product >= 0 ? '+' : ''}${product}%，可以排除。`,
      }
    } else if (input.topicId === 'mixed-growth') {
      const minR = level === 1 ? 3 : level === 2 ? 5 : -10
      const maxR = level === 1 ? 15 : level === 2 ? 25 : 30
      const a = integer(minR, Math.max(minR + 5, Math.floor(maxR * .55)))
      const b = integer(a + 5, maxR)
      const ratioA = pick(level === 1 ? [2, 3] : level === 2 ? [2, 3, 4] : [2, 3, 4])
      const ratioB = 1
      const answer = round((a * ratioA + b * ratioB) / (ratioA + ratioB), 2)
      const avg = round((a + b) / 2, 2)
      const aDesc = a >= 0 ? `增长 ${a}%` : `下降 ${Math.abs(a)}%`
      const bDesc = b >= 0 ? `增长 ${b}%` : `下降 ${Math.abs(b)}%`
      const swapSide = random() > .5
      draft = {
        templateId: 'mixed-growth-v1',
        params: swapSide ? { a, b, ratioA, ratioB, answer } : { a, b, ratioA: ratioB, ratioB: ratioA, answer },
        stem: swapSide
          ? `某企业上半年产值${aDesc}，下半年产值${bDesc}，上、下半年产值之比为 ${ratioA}:${ratioB}。全年产值增长率约为多少？`
          : `某企业上半年产值${bDesc}，下半年产值${aDesc}，上、下半年产值之比为 ${ratioB}:${ratioA}。全年产值增长率约为多少？`,
        ...options(answer, [a, b, avg], '%', random, 2),
        explanation: swapSide
          ? `整体增速介于 ${a}%~${b}% 之间。上半年占比为 ${Math.round(ratioA / (ratioA + ratioB) * 100)}%，远大于下半年，故整体增速应偏向 ${a}%（${avg}% 直接平均忽略权重，${b}% 则无视了慢的部分）。正确答案为 ${answer}%。`
          : `整体增速介于 ${a}%~${b}% 之间。下半年占比为 ${Math.round(ratioA / (ratioA + ratioB) * 100)}%，远大于上半年，故整体增速应偏向 ${a}%（${avg}% 直接平均忽略权重，${b}% 则无视了慢的部分）。正确答案为 ${answer}%。`,
      }
    } else if (input.topicId === 'multiples') {
      const n = pick(level === 1 ? [1, 2] : level === 2 ? [1, 2, 3] : [1, 2, 3, 4])
      const base = integer(10, 50) * 10
      const factor = 2 ** n
      const num = base * factor
      const askFan = random() > .5
      if (askFan) {
        draft = {
          templateId: 'multiples-fan-v1',
          params: { base, num, n },
          stem: `某企业利润从 ${base} 万元增至 ${num} 万元，相当于翻了多少番？`,
          ...options(n, [n - 1, n + 1, n + 0.5], ' 番', random, 1),
          explanation: `${num} ÷ ${base} = ${factor} = 2^${n}，所以翻了 ${n} 番。翻 1 番 = ×2，翻 n 番 = ×2ⁿ。±1 和半番是常见干扰项。`,
        }
      } else {
        const times = factor - 1
        draft = {
          templateId: 'multiples-times-v1',
          params: { base, num, times, factor },
          stem: `某企业利润从 ${base} 万元增至 ${num} 万元，增长了多少倍？`,
          ...options(times, [times + 1, Math.max(0, times - 1), Math.round(factor / 2)], '', random, 0),
          explanation: `增长了 = (现期 − 基期) ÷ 基期 = (${num} − ${base}) ÷ ${base} = ${times} 倍。注意“增长了多少倍”要减 $1$，“是的多少倍”才不减。`,
        }
      }
    } else if (input.topicId === 'ratio-change') {
      const minR = level === 1 ? 3 : level === 2 ? 5 : -15
      const maxR = level === 1 ? 15 : level === 2 ? 25 : 35
      const a = integer(minR, maxR)
      const canGoUp = a + 3 <= maxR
      const canGoDown = a - 3 >= minR
      const b = (canGoUp && (!canGoDown || random() > .5))
        ? integer(a + 3, maxR)
        : integer(minR, a - 3)
      const partRatio = pick(level === 1 ? [20, 30] : level === 2 ? [25, 40, 55] : [25, 35, 50, 65])
      const diff = Math.abs(a - b)
      const exactChange = round(partRatio * (a - b) / (100 + b), 2)
      const absChange = round(Math.abs(exactChange), 2)
      const direction = a > b ? '上升' : '下降'
      const opposite = a > b ? '下降' : '上升'
      let bigVal = round(Math.max(diff, absChange + Math.abs(diff - absChange) * 1.2), 2)
      while (round(bigVal, 2) === round(absChange, 2)) bigVal = round(bigVal + 0.5, 2)
      const aDesc = a >= 0 ? `增长 ${a}%` : `下降 ${Math.abs(a)}%`
      const bDesc = b >= 0 ? `增长 ${b}%` : `下降 ${Math.abs(b)}%`
      const optStrs = [
        `${direction} ${absChange} 个百分点`,
        `${opposite} ${absChange} 个百分点`,
        `${direction} ${bigVal} 个百分点`,
        `${opposite} ${bigVal} 个百分点`,
      ]
      for (let i = optStrs.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1))
        ;[optStrs[i], optStrs[j]] = [optStrs[j], optStrs[i]]
      }
      draft = {
        templateId: 'ratio-change-v1',
        params: { a, b, partRatio, exactChange },
        stem: `某行业产值同比${aDesc}，全国规上工业增加值同比${bDesc}，该行业占规上工业增加值的比重比上年：`,
        options: optStrs as [string, string, string, string],
        answerIndex: optStrs.indexOf(`${direction} ${absChange} 个百分点`) as 0 | 1 | 2 | 3,
        explanation: `部分增速（${a}%）${a > b ? '>' : '<'}整体增速（${b}%），比重${direction}。且 |Δ| < |a−b| = ${diff}%，故 ${bigVal} 个百分点的选项可排除（超出上限），方向相反的也排除。`,
      }
    } else {
      const years = pick(level === 1 ? [2, 3] : [3, 4, 5])
      const rate = pick(level === 1 ? [10, 20] : level === 2 ? [5, 10, 20] : [5, 8, 10, 12])
      const base = integer(5, 20) * 100
      const current = round(base * (1 + rate / 100) ** years, 2)
      const askAverage = random() > .5
      if (askAverage) {
        const values = Array.from({ length: years + 1 }, (_, index) => round(base * (1 + rate / 100) ** index, 2))
        const answer = round(values.reduce((sum, value) => sum + value, 0) / values.length, 2)
        draft = { templateId: 'annual-average-v1', params: { years, rate, base, current }, stem: `某指标连续 ${years + 1} 年的数值依次为 ${values.join('、')}，这 ${years + 1} 年的年平均量约为多少？`, ...options(answer, [round((base + current) / 2, 2), round(current / (years + 1), 2), round(answer + base * .05, 2)], '', random), explanation: `年平均量=各年数值之和÷年份个数。这里共有 ${years + 1} 个年度，不是 ${years} 个年份差，结果约为 ${answer}。` }
      } else {
        draft = { templateId: 'annual-growth-rate-v1', params: { years, rate, base, current }, stem: `某指标由 ${base} 增至 ${current}，跨越 ${years} 个年份间隔，年均增长率约为多少？`, ...options(rate, [round((current / base - 1) * 100, 2), round(rate / years, 2), rate + 5], '%', random), explanation: `年均增长率满足 现期=基期×(1+r)^n。这里 n=${years}，代入可得 r≈${rate}%。不能用总增幅直接除以年份数。` }
      }
    }

    const fingerprint = bytesToHex(sha256(utf8ToBytes(`${input.topicId}|${input.difficulty}|${draft.templateId}|${canonical(draft.params)}`)))
    if (!input.excludedFingerprints.includes(fingerprint)) return { ...draft, templateVersion: 1, fingerprint }
  }
  throw new Error('GENERATION_FAILED')
}
