/**
 * 「列式训练」生成器：**只给材料与问题，不给算式**，考察「题型 → 公式」的判断。
 *
 * 与「资料速算」共用同一套概念分类（18 个「资料概念」），知识库也共用同名专文：
 *   速算关练「这个概念怎么算得快」，列式关练「这个问题该用哪个算式」。
 *
 * ⚠️ 列式题**程序生成、不依赖材料库**：它考的是公式选择，真实材料由
 * 「材料阅读」「数据定位」两关负责；程序生成让每一关的题池都是无限的
 * （材料库派生的题池有限，曾导致"题池打满后加载失败"）。
 *
 * 每题的干扰项都取自**经典错法**（基期/现期颠倒、增长量用现期乘、分母漏项、
 * 百分点与百分数混用等），这是本模块的核心价值。
 */
import type { QuestionDraft, Rng } from "../types";
import type { TopicId } from "../catalog";
import { shuffle } from "./helpers";

/** 本文件负责的 18 个列式关卡 id（与速算轨道的「资料概念」模块同名） */
type FormulaTopicId = Extract<TopicId, `formula-${string}`>;

/* ────────────────────────── 语料池 ────────────────────────── */

const REGIONS = ["某市", "某省", "甲市", "乙省", "全国"];
const METRICS: [string, string][] = [
  ["规模以上工业增加值", "亿元"],
  ["社会消费品零售总额", "亿元"],
  ["固定资产投资", "亿元"],
  ["一般公共预算收入", "亿元"],
  ["出口额", "亿元"],
  ["网上零售额", "亿元"],
  ["旅游总收入", "亿元"],
  ["粮食总产量", "万吨"],
  ["发电量", "亿千瓦时"],
  ["建筑业总产值", "亿元"],
  ["居民人均可支配收入", "元"],
  ["卫生技术人员数", "万人"],
];
const UNITS = ["亿元", "万吨", "万人", "万件", "万平方米"];

/** 部分 / 整体 配对（比重类题目） */
const PART_WHOLE: [string, string, string][] = [
  ["出口额", "进出口总额", "亿元"],
  ["城镇消费品零售额", "社会消费品零售总额", "亿元"],
  ["第三产业投资", "固定资产投资", "亿元"],
  ["高技术产业投资", "固定资产投资", "亿元"],
  ["教育支出", "一般公共预算支出", "亿元"],
];

/** 适合做「总量÷份数」的指标（总量口径，不能用人均类指标） */
const TOTALS: [string, string][] = [
  ["固定资产投资", "亿元"],
  ["一般公共预算支出", "亿元"],
  ["社会消费品零售总额", "亿元"],
  ["出口额", "亿元"],
  ["规模以上工业增加值", "亿元"],
  ["粮食总产量", "万吨"],
];

/** 计数单位（平均数类题目） */
const COUNTERS: [string, string, number, number][] = [
  ["规模以上企业", "家", 120, 900],
  ["行政村", "个", 260, 900],
  ["县（市、区）", "个", 6, 40],
  ["乡镇（街道）", "个", 15, 180],
];

/* ────────────────────────── 数值工具 ────────────────────────── */

/** 基期量：按难度分档（位数越长，越难在脑子里估） */
const baseAmount = (r: Rng) =>
  r.level === 1
    ? r.integer(120, 300) * 10
    : r.level === 2
      ? r.integer(120, 600) * 10
      : r.integer(120, 960) * 10;

/** 出现「下降」的概率：难度越高越常见（真实材料里负增长并不少） */
function declineChance(r: Rng): number {
  return r.level === 1 ? 0.15 : r.level === 2 ? 0.3 : 0.45;
}

/**
 * 增长率（**带符号**，负号表示下降）。这是三档梯度的主要来源：
 *   easy   整数百分比（5%–30%）、基数小 → 可纯心算
 *   medium 一位小数（5.5%–20.5%）       → 需笔算一步
 *   hard   一位小数、跨度更大（2.3%–35.7%）→ 需估中带算
 */
function rateOf(r: Rng): number {
  const magnitude =
    r.level === 1
      ? r.integer(5, 30)
      : r.level === 2
        ? round1(r.integer(55, 205) / 10)
        : round1(r.integer(23, 357) / 10);
  return r.random() < declineChance(r) ? -magnitude : magnitude;
}

/** 恒正的增长率：供「两个增速复合」的公式使用（间隔/混合/平均数/差值等） */
function ratePositive(r: Rng): number {
  return r.level === 1
    ? r.integer(5, 30)
    : r.level === 2
      ? round1(r.integer(55, 205) / 10)
      : round1(r.integer(23, 357) / 10);
}

/** 两个**互不相同**的增长率（相同会让干扰项与正确项撞车） */
function twoRates(r: Rng): [number, number] {
  const a = ratePositive(r);
  let b = ratePositive(r);
  if (b === a) b = round1(a + 2.5);
  return [a, b];
}
/** 年份 */
const yearOf = (r: Rng) => r.integer(2020, 2024);

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 依基期与增速算现期（保证三者自洽） */
function currentOf(base: number, rate: number): number {
  return Math.round(base * (1 + rate / 100));
}

const pct = (n: number) => `${n}%`;

/** 增长率的**幅度**（不带符号）：题干写"下降 5.5%"用 */
const pctAbs = (n: number) => `${Math.abs(round1(n))}%`;

/** 题干用词：增长 / 下降 */
const trend = (n: number) => (n >= 0 ? "增长" : "下降");

/**
 * 把 1+r 写成可直接抄进算式的形式（**带括号**，否则 `÷1+5%` 会被读成 `(x÷1)+5%`）：
 *   增长 → `(1+5.5%)`；下降 → `(1−5.5%)`
 * 这样同一个模板在两种场景下都成立（求基期除以它、求增量乘它）。
 */
const factor = (n: number) => `(1${n >= 0 ? "+" : "−"}${pctAbs(n)})`;

/* ────────────────────────── 组装 ────────────────────────── */

function buildFormula(
  r: Rng,
  templateId: string,
  materialLine: string,
  stem: string,
  correct: string,
  wrong: string[],
  explanation: string,
): QuestionDraft {
  const { options, answerIndex } = shuffle(correct, wrong, r.random);
  return {
    templateId,
    params: { concept: templateId, stem },
    stem,
    options,
    answerIndex,
    explanation,
    material: { paragraphs: [materialLine] },
  };
}

/* ────────────────────────── 18 个概念 ────────────────────────── */

/** ① 增长率：由基期与现期求增速 */
function genGrowthRate(r: Rng): QuestionDraft {
  const region = r.pick(REGIONS);
  const [metric, unit] = r.pick(METRICS);
  const y = yearOf(r);
  const base = baseAmount(r);
  const rate = rateOf(r);
  const current = currentOf(base, rate);
  return buildFormula(
    r,
    "formula-growth-rate",
    `${region} ${y} 年${metric}为 ${base} ${unit}，${y + 1} 年为 ${current} ${unit}。`,
    `材料中，求 ${y + 1} 年该地区${metric}的同比增速，下列算式正确的是？`,
    `(${current}−${base})÷${base}`,
    [`(${current}−${base})÷${current}`, `${current}÷${base}`, `(${base}−${current})÷${base}`],
    `增长率＝(现期−基期)÷基期，分母永远是**基期**（${base}）。用现期作分母会把结果压向 0；写成"现期÷基期"只是倍数，还差一个减 1。${rate < 0 ? `本题是**下降**，结果应为负数（${rate}%）；若题干问"降幅"，答绝对值。` : ""}`,
  );
}

/** ② 增长量 */
function genGrowthAmount(r: Rng): QuestionDraft {
  const region = r.pick(REGIONS);
  const [metric, unit] = r.pick(METRICS);
  const y = yearOf(r);
  const base = baseAmount(r);
  const rate = rateOf(r);
  const current = currentOf(base, rate);
  return buildFormula(
    r,
    "formula-growth-amount",
    `${region} ${y} 年${metric}为 ${current} ${unit}，比上年${trend(rate)} ${pctAbs(rate)}。`,
    `材料中，求 ${y} 年该地区${metric}的同比${rate >= 0 ? "增量" : "减少量"}，下列算式正确的是？`,
    `${current}×${pctAbs(rate)}÷${factor(rate)}`,
    [
      `${current}×${pctAbs(rate)}`,
      `${current}÷${factor(rate)}`,
      `${current}×${pctAbs(rate)}×${factor(rate)}`,
    ],
    `${rate >= 0 ? "增长量" : "减少量"}＝现期×${rate >= 0 ? "增长率" : "降幅"}÷${factor(rate)}。**绝不能用「现期×${rate >= 0 ? "增长率" : "降幅"}」**——那个比率是相对基期算的，拿现期直接乘会把基数放大一档。${rate < 0 ? "注意：下降时分母是 (1−降幅)，不是 (1+降幅)。" : ""}`,
  );
}

/** ③ 基期量 */
function genBaseAmount(r: Rng): QuestionDraft {
  const region = r.pick(REGIONS);
  const [metric, unit] = r.pick(METRICS);
  const y = yearOf(r);
  const base = baseAmount(r);
  const rate = rateOf(r);
  const current = currentOf(base, rate);
  return buildFormula(
    r,
    "formula-base-amount",
    `${region} ${y} 年${metric}为 ${current} ${unit}，比上年${trend(rate)} ${pctAbs(rate)}。`,
    `材料中，求 ${y - 1} 年该地区${metric}，下列算式正确的是？`,
    `${current}÷${factor(rate)}`,
    [
      `${current}×${factor(rate)}`,
      `${current}÷${factor(-rate)}`,
      `${current}×${pctAbs(rate)}`,
    ],
    `求过去用除：基期量＝现期÷${factor(rate)}。写成"×"是把方向搞反了（那是求未来）；写成"÷${factor(-rate)}"则把${rate >= 0 ? "增长" : "下降"}的符号弄反了。`,
  );
}

/** ④ 倍数与翻番 */
function genMultiples(r: Rng): QuestionDraft {
  const region = r.pick(REGIONS);
  const [metric, unit] = r.pick(METRICS);
  const y = yearOf(r);
  const base = baseAmount(r);
  const rate = rateOf(r);
  const current = currentOf(base, rate);
  return buildFormula(
    r,
    "formula-multiples",
    `${region} ${y} 年${metric}为 ${current} ${unit}，${y - 1} 年为 ${base} ${unit}。`,
    `材料中，求 ${y} 年该地区${metric}是 ${y - 1} 年的多少倍，下列算式正确的是？`,
    `${current}÷${base}`,
    [`${base}÷${current}`, `(${current}−${base})÷${base}`, `(${current}−${base})÷${current}`],
    `"是几倍"＝现期÷基期，直接相除即可。注意区分：问"增长了几倍"才是 (现期−基期)÷基期——那个选项是经典干扰项。${rate < 0 ? "本题现期低于基期，倍数小于 1，属正常（问的是倍数不是增速）。" : ""}`,
  );
}

/** ⑤ 基期差：两个对象的基期量之差 */
function genBaseDifference(r: Rng): QuestionDraft {
  const [metric, unit] = r.pick(METRICS);
  const y = yearOf(r);
  const a = baseAmount(r);
  const ra = rateOf(r);
  const b = a + r.integer(20, 300) * 10;
  const rb = rateOf(r);
  const ca = currentOf(a, ra);
  const cb = currentOf(b, rb);
  return buildFormula(
    r,
    "formula-base-difference",
    `甲市 ${y} 年${metric}为 ${ca} ${unit}，比上年${trend(ra)} ${pctAbs(ra)}；乙市为 ${cb} ${unit}，比上年${trend(rb)} ${pctAbs(rb)}。`,
    `材料中，求 ${y - 1} 年两市${metric}之差，下列算式正确的是？`,
    `${ca}÷${factor(ra)}−${cb}÷${factor(rb)}`,
    [
      `${ca}−${cb}`,
      `${ca}÷${factor(ra)}+${cb}÷${factor(rb)}`,
      `(${ca}−${cb})÷${factor(ra)}`,
    ],
    `基期差＝各自先还原到基期再相减：A÷${factor(ra)}−B÷${factor(rb)}。直接用现期相减（${ca}−${cb}）是最典型的错法——两个对象的增速不同，现期之差≠基期之差。${ra < 0 || rb < 0 ? "注意本题有下降项，还原时用 (1−降幅)。" : ""}`,
  );
}

/** ⑥ 间隔增长率 */
function genIntervalGrowth(r: Rng): QuestionDraft {
  const region = r.pick(REGIONS);
  const [metric] = r.pick(METRICS);
  const y = yearOf(r);
  const [r1, r2] = twoRates(r);
  return buildFormula(
    r,
    "formula-interval-growth",
    `${region}${metric} ${y} 年比 ${y - 1} 年增长 ${pct(r1)}，${y - 1} 年比 ${y - 2} 年增长 ${pct(r2)}。`,
    `材料中，求 ${y} 年该地区${metric}比 ${y - 2} 年的增速，下列算式正确的是？`,
    `${pct(r1)}+${pct(r2)}+${pct(r1)}×${pct(r2)}`,
    [`${pct(r1)}+${pct(r2)}`, `${pct(r1)}×${pct(r2)}`, `${pct(r1)}+${pct(r2)}−${pct(r1)}×${pct(r2)}`],
    `间隔增长率 R＝r₁+r₂+r₁×r₂。**不是简单相加**：两次增长是叠乘关系，漏掉乘积项在增速较大时会差好几个百分点。`,
  );
}

/** ⑦ 混合增长率（定性判断，文字选项） */
function genMixedGrowth(r: Rng): QuestionDraft {
  const unit = r.pick(UNITS);
  const y = yearOf(r);
  const a = baseAmount(r) * r.integer(1, 4);
  let b = baseAmount(r) * r.integer(1, 4);
  if (b === a) b = a * 2;
  const [r1, r2] = twoRates(r);
  const high = Math.max(r1, r2);
  const low = Math.min(r1, r2);
  const bigIsA = a > b;
  const near = bigIsA ? r1 : r2;
  const nearName = bigIsA ? "甲项" : "乙项";
  return buildFormula(
    r,
    "formula-mixed-growth",
    `某市 ${y} 年甲项为 ${a} ${unit}，比上年增长 ${pct(r1)}；乙项为 ${b} ${unit}，比上年增长 ${pct(r2)}。甲、乙两项构成该市全部规模。`,
    `材料中，该市整体的同比增速最可能是（ ）。`,
    `介于 ${pct(low)} 与 ${pct(high)} 之间，且更接近 ${pct(near)}`,
    [
      `介于 ${pct(low)} 与 ${pct(high)} 之间，且更接近 ${pct(bigIsA ? r2 : r1)}`,
      `高于 ${pct(high)}`,
      `低于 ${pct(low)}`,
    ],
    `混合增长率一定**介于两部分增速之间**，且**偏向体量大的一方**（这里是${nearName}，量更大，所以更接近 ${pct(near)}）。这是定性题，不需要精算——先比大小，再看谁体量大。`,
  );
}

/** ⑧ 年均增长量 */
function genAnnualAmount(r: Rng): QuestionDraft {
  const region = r.pick(REGIONS);
  const [metric, unit] = r.pick(METRICS);
  const y = yearOf(r);
  const span = r.integer(3, 5);
  const a = baseAmount(r);
  const b = a + r.integer(30, 260) * 10;
  return buildFormula(
    r,
    "formula-annual-amount",
    `${region}${metric} ${y} 年为 ${a} ${unit}，${y + span} 年为 ${b} ${unit}。`,
    `材料中，求 ${y}—${y + span} 年该地区${metric}的年均增长量（间隔 ${span} 年），下列算式正确的是？`,
    `(${b}−${a})÷${span}`,
    [`(${b}−${a})÷${span + 1}`, `${b}÷${a}`, `(${b}−${a})×${span}`],
    `年均增长量＝(末期量−初期量)÷**间隔年数**。这里 ${y} 到 ${y + span} 是 ${span} 年，就除以 ${span}——按"年份个数"（${span + 1}）去除是最常见的错。`,
  );
}

/** ⑨ 年均增长率 */
function genAnnualRate(r: Rng): QuestionDraft {
  const region = r.pick(REGIONS);
  const [metric, unit] = r.pick(METRICS);
  const y = yearOf(r);
  const span = r.integer(3, 5);
  const a = baseAmount(r);
  const b = a + r.integer(30, 260) * 10;
  return buildFormula(
    r,
    "formula-annual-rate",
    `${region}${metric} ${y} 年为 ${a} ${unit}，${y + span} 年为 ${b} ${unit}。`,
    `材料中，求 ${y}—${y + span} 年该地区${metric}的年均增长率，下列算式正确的是？`,
    `(${b}÷${a})开 ${span} 次方−1`,
    [
      `(${b}−${a})÷${a}÷${span}`,
      `${b}÷${a}−1`,
      `(${b}÷${a})÷${span}`,
    ],
    `年均增长率是**复利**口径：末期量＝初期量×(1+r)ⁿ，所以要先开 ${span} 次方再减 1。把总增速除以年数（(${b}−${a})÷${a}÷${span}）只是算术平均，会高估。`,
  );
}

/** ⑩ 比重与整体量 */
function genRatioBasic(r: Rng): QuestionDraft {
  const y = yearOf(r);
  const [part, whole, unit] = r.pick(PART_WHOLE);
  const w = baseAmount(r) * 3;
  const p = r.integer(8, 88);
  const a = Math.round((w * p) / 100);
  return buildFormula(
    r,
    "formula-ratio-basic",
    `${y} 年，某市${whole}为 ${w} ${unit}，其中${part}为 ${a} ${unit}。`,
    `材料中，求 ${y} 年该市${part}占${whole}的比重，下列算式正确的是？`,
    `${a}÷${w}`,
    [`${w}÷${a}`, `${a}÷${w - a}`, `(${w}−${a})÷${w}`],
    `比重＝部分量÷整体量（${a}÷${w}）。分子是"其中的那一项"，分母是"能包含它的总口径"——颠倒过来是最常见的错。`,
  );
}

/** ⑪ 部分量 */
function genPartQuantity(r: Rng): QuestionDraft {
  const y = yearOf(r);
  const [part, whole, unit] = r.pick(PART_WHOLE);
  const w = baseAmount(r) * 3;
  const p = r.integer(8, 88);
  return buildFormula(
    r,
    "formula-part-quantity",
    `${y} 年，某市${whole}为 ${w} ${unit}，其中${part}占 ${pct(p)}。`,
    `材料中，求 ${y} 年该市${part}，下列算式正确的是？`,
    `${w}×${pct(p)}`,
    [`${w}÷${pct(p)}`, `${w}×(1−${pct(p)})`, `${pct(p)}÷${w}`],
    `部分量＝整体量×比重＝${w}×${pct(p)}。注意别用 (1−占比) 算成"其余部分"，也别把除法方向搞反。`,
  );
}

/** ⑫ 平均数基础 */
function genAverageBasic(r: Rng): QuestionDraft {
  const [metric, unit] = r.pick(TOTALS);
  const y = yearOf(r);
  const [counter, , lo, hi] = r.pick(COUNTERS);
  const n = r.integer(lo, hi);
  const total = r.integer(200, 9800) * 10;
  return buildFormula(
    r,
    "formula-average-basic",
    `${y} 年，某市完成${metric} ${total} ${unit}，全市共有 ${n} 个${counter}。`,
    `材料中，求 ${y} 年该市平均每个${counter}完成的${metric}，下列算式正确的是？`,
    `${total}÷${n}`,
    [`${n}÷${total}`, `${total}×${n}`, `${total}÷(${n}−1)`],
    `平均数＝总量÷份数＝${total}÷${n}。判断"这是平均数还是比重"，看分母是不是"份数"（${counter}）——带单位个数就是平均数。`,
  );
}

/** ⑬ 基期比重 */
function genBaseRatio(r: Rng): QuestionDraft {
  const y = yearOf(r);
  const [part, whole, unit] = r.pick(PART_WHOLE);
  const [r1, r2] = twoRates(r);
  const wb = baseAmount(r) * 3;
  const wc = currentOf(wb, r2);
  const p = r.integer(10, 80);
  const ab = Math.round((wb * p) / 100);
  const ac = currentOf(ab, r1);
  return buildFormula(
    r,
    "formula-base-ratio",
    `${y} 年，某市${part}为 ${ac} ${unit}，比上年增长 ${pct(r1)}；${whole}为 ${wc} ${unit}，比上年增长 ${pct(r2)}。`,
    `材料中，求 ${y - 1} 年该市${part}占${whole}的比重，下列算式正确的是？`,
    `(${ac}÷(1+${pct(r1)}))÷(${wc}÷(1+${pct(r2)}))`,
    [
      `${ac}÷${wc}`,
      `(${ac}÷(1+${pct(r1)}))÷(${wc}×(1+${pct(r2)}))`,
      `(${ac}×(1+${pct(r1)}))÷(${wc}÷(1+${pct(r2)}))`,
    ],
    `基期比重要**分子分母各自还原到基期**：部分÷(1+r₁)、整体÷(1+r₂)，再相除。直接拿现期比重（${ac}÷${wc}）是经典错项——两边的增速不同，比重会变。`,
  );
}

/** ⑭ 两期比重差 */
function genRatioChange(r: Rng): QuestionDraft {
  const y = yearOf(r);
  const [part, whole, unit] = r.pick(PART_WHOLE);
  const [r1, r2] = twoRates(r);
  const wb = baseAmount(r) * 3;
  const wc = currentOf(wb, r2);
  const p = r.integer(10, 80);
  const ab = Math.round((wb * p) / 100);
  const ac = currentOf(ab, r1);
  return buildFormula(
    r,
    "formula-ratio-change",
    `${y} 年，某市${part}为 ${ac} ${unit}，比上年增长 ${pct(r1)}；${whole}为 ${wc} ${unit}，比上年增长 ${pct(r2)}。`,
    `材料中，求 ${y} 年该市${part}占${whole}的比重与上年相比的变化，下列算式正确的是？`,
    `(${ac}÷${wc})×(${pct(r1)}−${pct(r2)})÷(1+${pct(r1)})`,
    [
      `(${ac}÷${wc})×(${pct(r1)}−${pct(r2)})`,
      `${pct(r1)}−${pct(r2)}`,
      `(${ac}÷${wc})×(${pct(r2)}−${pct(r1)})÷(1+${pct(r1)})`,
    ],
    `两期比重差＝现期比重×(部分增速−整体增速)÷(1+部分增速)。它问的是"几个**百分点**"；漏掉 ÷(1+r₁) 是常见近似错法，直接答"${pct(r1)}−${pct(r2)}"则混淆了百分点与百分数。`,
  );
}

/** ⑮ 平均数增长率 */
function genAverageRate(r: Rng): QuestionDraft {
  const [metric, unit] = r.pick(TOTALS);
  const y = yearOf(r);
  const [counter, , lo, hi] = r.pick(COUNTERS);
  const n = r.integer(lo, hi);
  const total = r.integer(200, 9800) * 10;
  const [a, b] = twoRates(r);
  return buildFormula(
    r,
    "formula-average-rate",
    `${y} 年，某市${metric}为 ${total} ${unit}，比上年增长 ${pct(a)}；全市共有 ${n} 个${counter}，比上年增长 ${pct(b)}。`,
    `材料中，求 ${y} 年该市平均每个${counter}的${metric}的同比增速，下列算式正确的是？`,
    `(${pct(a)}−${pct(b)})÷(1+${pct(b)})`,
    [`(${pct(a)}−${pct(b)})÷(1+${pct(a)})`, `${pct(a)}−${pct(b)}`, `(${pct(a)}+${pct(b)})÷(1+${pct(b)})`],
    `平均数增长率＝(总量增速−份数增速)÷(1+份数增速)，分母是**份数**那一项（b=${pct(b)}）。它问的是"百分之几"，不是百分点。`,
  );
}

/** ⑯ 差值增长率 */
function genDiffRate(r: Rng): QuestionDraft {
  const y = yearOf(r);
  const [part, whole, unit] = r.pick(PART_WHOLE);
  const wb = baseAmount(r) * 4;
  const R = ratePositive(r);
  const wc = currentOf(wb, R);
  const p = r.integer(20, 60);
  const ab = Math.round((wb * p) / 100);
  const rr = ratePositive(r);
  const ac = currentOf(ab, rr);
  return buildFormula(
    r,
    "formula-diff-rate",
    `${y} 年，某市${whole}为 ${wc} ${unit}，比上年增长 ${pct(R)}；其中${part}为 ${ac} ${unit}，比上年增长 ${pct(rr)}。`,
    `材料中，求 ${y} 年该市"${whole}减去${part}"这一部分的同比增速，下列算式正确的是？`,
    `(${wc}×${pct(R)}−${ac}×${pct(rr)})÷(${wc}−${ac})`,
    [`${pct(R)}−${pct(rr)}`, `(${pct(R)}+${pct(rr)})÷2`, `(${wc}×${pct(R)}+${ac}×${pct(rr)})÷(${wc}−${ac})`],
    `差值（整体−部分）的增速＝(整体增量−部分增量)÷整体的基期量近似值。**不能直接用两个增速相减**（${pct(R)}−${pct(rr)}）——那是两个不同分母的比率，不能这样比。`,
  );
}

/** ⑰ 增长贡献率 */
function genContributionRate(r: Rng): QuestionDraft {
  const y = yearOf(r);
  const [part, whole, unit] = r.pick(PART_WHOLE);
  const wb = baseAmount(r) * 4;
  const db = r.integer(40, 180) * 10;
  const da = Math.round(db * (r.integer(20, 75) / 100));
  return buildFormula(
    r,
    "formula-contribution-rate",
    `${y} 年，某市${whole}为 ${wb + db} ${unit}，比上年增加 ${db} ${unit}；其中${part}比上年增加 ${da} ${unit}。`,
    `材料中，求 ${y} 年该市${part}对${whole}增长的贡献率，下列算式正确的是？`,
    `${da}÷${db}`,
    [`${db}÷${da}`, `${da}÷${wb}`, `${da}÷(${db}−${da})`],
    `增长贡献率＝部分增量÷**整体增量**＝${da}÷${db}。注意分母是整体"增量"；若换成整体基期量，那就成了拉动增长率。`,
  );
}

/** ⑱ 拉动增长率 */
function genPullGrowth(r: Rng): QuestionDraft {
  const y = yearOf(r);
  const [part, whole, unit] = r.pick(PART_WHOLE);
  const wb = baseAmount(r) * 4;
  const db = r.integer(40, 180) * 10;
  const da = Math.round(db * (r.integer(20, 75) / 100));
  return buildFormula(
    r,
    "formula-pull-growth",
    `${y} 年，某市${whole}为 ${wb + db} ${unit}，比上年增加 ${db} ${unit}；其中${part}比上年增加 ${da} ${unit}。`,
    `材料中，求 ${y} 年该市${part}对${whole}增长的拉动增长率，下列算式正确的是？`,
    `${da}÷${wb}`,
    [`${da}÷${db}`, `${db}÷${wb}`, `${da}×${wb}`],
    `拉动增长率＝部分增量÷**整体基期量**＝${da}÷${wb}。它和增长贡献率只差一个分母：贡献率除以整体"增量"，拉动率除以整体"基期量"。`,
  );
}

/* ────────────────────────── 注册表 ────────────────────────── */

/**
 * 18 个「资料概念」的列式生成器，id 与速算轨道的模块同名，
 * 因此知识库可以直接共用（不做二次维护）。
 */
export const FORMULA_MODELS: Record<FormulaTopicId, (r: Rng) => QuestionDraft> = {
  "formula-growth-rate": genGrowthRate,
  "formula-growth-amount": genGrowthAmount,
  "formula-base-amount": genBaseAmount,
  "formula-multiples": genMultiples,
  "formula-base-difference": genBaseDifference,
  "formula-interval-growth": genIntervalGrowth,
  "formula-mixed-growth": genMixedGrowth,
  "formula-annual-amount": genAnnualAmount,
  "formula-annual-rate": genAnnualRate,
  "formula-ratio-basic": genRatioBasic,
  "formula-part-quantity": genPartQuantity,
  "formula-average-basic": genAverageBasic,
  "formula-base-ratio": genBaseRatio,
  "formula-ratio-change": genRatioChange,
  "formula-average-rate": genAverageRate,
  "formula-diff-rate": genDiffRate,
  "formula-contribution-rate": genContributionRate,
  "formula-pull-growth": genPullGrowth,
};
