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

/**
 * ① 增长率：由基期与现期求增速（**两种写法**）
 *   ① 增长率＝增长量÷基期量＝(现期−基期)÷基期
 *   ② 增长率＝现期÷基期−1（先算倍数再减 1）
 * 两式恒等，真题解析里两种都在用，只练一种等于只认一张脸。
 */
function genGrowthRate(r: Rng): QuestionDraft {
  const region = r.pick(REGIONS);
  const [metric, unit] = r.pick(METRICS);
  const y = yearOf(r);
  const base = baseAmount(r);
  const rate = rateOf(r);
  const current = currentOf(base, rate);
  const materialLine = `${region} ${y} 年${metric}为 ${base} ${unit}，${y + 1} 年为 ${current} ${unit}。`;
  const stem = `材料中，求 ${y + 1} 年该地区${metric}的同比增速，下列算式正确的是？`;
  const declineNote =
    rate < 0 ? `本题现期低于基期，结果是**负数**（${rate}%）；若题干问“降幅”，答绝对值。` : "";
  if (r.integer(0, 1) === 0) {
    return buildFormula(
      r,
      "formula-growth-rate",
      materialLine,
      stem,
      `(${current}−${base})÷${base}`,
      [`(${current}−${base})÷${current}`, `${current}÷${base}`, `(${base}−${current})÷${base}`],
      `增长率＝增长量÷基期量＝(${current}−${base})÷${base}，分母永远是**基期**（${base}）。错项：用现期作分母会把结果压向 0；只写"现期÷基期"得到的是倍数、还差一个减 1；把基期减现期则方向反了。同一个答案的另一种写法：现期÷基期−1＝${current}÷${base}−1，两种都算对。${declineNote}`,
    );
  }
  return buildFormula(
    r,
    "formula-growth-rate-multiple",
    materialLine,
    stem,
    `${current}÷${base}−1`,
    [`${current}÷${base}`, `(${current}−${base})÷${current}`, `${base}÷${current}−1`],
    `先算倍数再减 1：增长率＝现期÷基期−1＝${current}÷${base}−1。错项：只写 ${current}÷${base} 得到的是**倍数**（没减 1，不是增速）；分母用成现期会把结果压小；把基期当分子相除，方向整个反了。同一个答案的另一种写法：(现期−基期)÷基期，两种都算对。${declineNote}`,
  );
}

/** ② 增长量（**两种写法**） */
function genGrowthAmount(r: Rng): QuestionDraft {
  const region = r.pick(REGIONS);
  const [metric, unit] = r.pick(METRICS);
  const y = yearOf(r);
  const base = baseAmount(r);
  const rate = rateOf(r);
  const current = currentOf(base, rate);
  const materialLine = `${region} ${y} 年${metric}为 ${current} ${unit}，比上年${trend(rate)} ${pctAbs(rate)}。`;
  const stem = `材料中，求 ${y} 年该地区${metric}的同比${rate >= 0 ? "增量" : "减少量"}，下列算式正确的是？`;
  const label = rate >= 0 ? "增长率" : "降幅";
  const baseForm = `${current}÷${factor(rate)}`;
  const declineNote = rate < 0 ? "注意：下降时分母是 (1−降幅)，不是 (1+降幅)。" : "";
  if (r.integer(0, 1) === 0) {
    return buildFormula(
      r,
      "formula-growth-amount",
      materialLine,
      stem,
      `${current}×${pctAbs(rate)}÷${factor(rate)}`,
      [`${current}×${pctAbs(rate)}`, baseForm, `${current}×${pctAbs(rate)}×${factor(rate)}`],
      `${rate >= 0 ? "增长量" : "减少量"}＝现期×${label}÷${factor(rate)}。错项：**绝不能用「现期×${label}」**——那个比率是相对基期算的，拿现期直接乘会把基数放大一档；只写 ${baseForm} 得到的是基期量；再乘一次 (1±r) 则重复修正了两次。同一个答案的另一种写法：现期−基期＝${current}−${baseForm}，两种都算对。${declineNote}`,
    );
  }
  return buildFormula(
    r,
    "formula-growth-amount-diff",
    materialLine,
    stem,
    `${current}−${baseForm}`,
    [`${current}+${baseForm}`, baseForm, `${current}×${pctAbs(rate)}`],
    `${rate >= 0 ? "增长量" : "减少量"}＝现期−基期，基期＝现期÷${factor(rate)}，所以＝${current}−${baseForm}。错项：写成加法是把方向搞反了（那不是现期＋基期）；只写 ${baseForm} 得到的是基期量本身；现期×${pctAbs(rate)} 是经典错法——它把"相对基期的比率"乘到了现期上。同一个答案的另一种写法：现期×${label}÷${factor(rate)}，两种都算对。${declineNote}`,
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

/**
 * ④ 倍数与翻番（**两种问法都考**）
 *   "是几倍"＝现期÷基期、"多几倍（增长了几倍）"＝现期÷基期−1。
 * 以前只问"是几倍"，"多几倍"永远只当干扰项出现——可它同样是标准问法，
 * 差的就是那一个 −1，考生练不到就会在真考里多算一倍。
 */
function genMultiples(r: Rng): QuestionDraft {
  const region = r.pick(REGIONS);
  const [metric, unit] = r.pick(METRICS);
  const y = yearOf(r);
  const base = baseAmount(r);
  const rate = rateOf(r);
  const current = currentOf(base, rate);
  const materialLine = `${region} ${y} 年${metric}为 ${current} ${unit}，${y - 1} 年为 ${base} ${unit}。`;
  // 「增长了几倍」只在正增长时成立（下降时说"增长了几倍"是病句）
  if (rate > 0 && r.integer(0, 1) === 1) {
    return buildFormula(
      r,
      "formula-multiples-more",
      materialLine,
      `材料中，求 ${y} 年该地区${metric}比 ${y - 1} 年多了多少倍，下列算式正确的是？`,
      `${current}÷${base}−1`,
      [`${current}÷${base}`, `(${current}−${base})÷${current}`, `${current}÷${base}+1`],
      `"多几倍"＝增长了几倍＝增长量÷基期量＝现期÷基期−1＝${current}÷${base}−1。错项：只写 ${current}÷${base} 是"是几倍"（含本身，多算了 1 倍）；再加 1 就更远了；分母用成现期会把结果压小。同一个答案的另一种写法：(现期−基期)÷基期，两种都算对。`,
    );
  }
  return buildFormula(
    r,
    "formula-multiples",
    materialLine,
    `材料中，求 ${y} 年该地区${metric}是 ${y - 1} 年的多少倍，下列算式正确的是？`,
    `${current}÷${base}`,
    [`${base}÷${current}`, `(${current}−${base})÷${base}`, `(${current}−${base})÷${current}`],
    `"是几倍"＝现期÷基期，直接相除即可。错项：基期÷现期把分子分母颠倒；用现期作分母会把结果压小；另外"多几倍/增长了几倍"是另一个问法（要再减 1），别混进来。${rate < 0 ? "本题现期低于基期，倍数小于 1，属正常（问的是倍数不是增速）。" : ""}`,
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

/**
 * ⑩ 比重与整体量（**三量互求里的两问都考**）
 *   求比重＝部分÷整体；求整体＝部分÷比重。
 * 以前只考求比重，"求整体"这一问在三量互求里从未作为答案出现过，
 * 而它是最容易把除法方向搞反的一问。
 */
function genRatioBasic(r: Rng): QuestionDraft {
  const y = yearOf(r);
  const [part, whole, unit] = r.pick(PART_WHOLE);
  const w = baseAmount(r) * 3;
  const p = r.integer(8, 88);
  const a = Math.round((w * p) / 100);
  if (r.integer(0, 1) === 0) {
    return buildFormula(
      r,
      "formula-ratio-basic",
      `${y} 年，某市${whole}为 ${w} ${unit}，其中${part}为 ${a} ${unit}。`,
      `材料中，求 ${y} 年该市${part}占${whole}的比重，下列算式正确的是？`,
      `${a}÷${w}`,
      [`${w}÷${a}`, `${a}÷${w - a}`, `(${w}−${a})÷${w}`],
      `比重＝部分量÷整体量（${a}÷${w}）。分子是"其中的那一项"，分母是"能包含它的总口径"。错项：颠倒分子分母（${w}÷${a}）是最常见的错；除以"其余部分"、或算其余部分的占比，都是把对象换掉了。`,
    );
  }
  return buildFormula(
    r,
    "formula-ratio-basic-whole",
    `${y} 年，某市${part}为 ${a} ${unit}，占${whole}的 ${pct(p)}。`,
    `材料中，求 ${y} 年该市${whole}，下列算式正确的是？`,
    `${a}÷${pct(p)}`,
    [`${a}×${pct(p)}`, `${a}÷(1−${pct(p)})`, `${pct(p)}÷${a}`],
    `求整体用除法：整体＝部分÷比重＝${a}÷${pct(p)}。错项：写成乘法是把"已知整体求部分"的式子拿反了；除以 (1−占比) 算的是"其余部分"对应的整体，跟本题要的整体不是一回事；把比重除以部分，方向整个颠倒。`,
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

/**
 * ⑫ 平均数基础（**三量互求的三问都考**）
 *   求平均数＝总量÷份数；求总量＝平均数×份数；求份数＝总量÷平均数。
 * 以前只考求平均数，另两问从未作为答案出现过——而"谁是总量、谁是份数"
 * 恰恰是这一节的考点，只考一问等于只练半个基本功。
 */
function genAverageBasic(r: Rng): QuestionDraft {
  const [metric, unit] = r.pick(TOTALS);
  const y = yearOf(r);
  const [counter, , lo, hi] = r.pick(COUNTERS);
  const n = r.integer(lo, hi);
  // 先定份数与平均值、再回算总量：保证三量自洽，材料里怎么读都对得上
  const avg = Math.max(5, Math.round((r.integer(200, 9800) * 10) / n));
  const total = avg * n;
  const way = r.integer(0, 2);
  if (way === 0) {
    return buildFormula(
      r,
      "formula-average-basic",
      `${y} 年，某市完成${metric} ${total} ${unit}，全市共有 ${n} 个${counter}。`,
      `材料中，求 ${y} 年该市平均每个${counter}完成的${metric}，下列算式正确的是？`,
      `${total}÷${n}`,
      [`${n}÷${total}`, `${total}×${n}`, `${total}÷(${n}−1)`],
      `平均数＝总量÷份数＝${total}÷${n}。错项：颠倒成分数÷总量是把对象换了；乘起来不是平均数；分母减 1 是把"间隔年数"的习惯误搬过来。判断"这是平均数还是比重"，看分母是不是"份数"（${counter}）——带个数单位就是平均数。`,
    );
  }
  if (way === 1) {
    return buildFormula(
      r,
      "formula-average-basic-total",
      `${y} 年，某市平均每个${counter}完成${metric} ${avg} ${unit}，全市共有 ${n} 个${counter}。`,
      `材料中，求 ${y} 年该市${metric}的总量，下列算式正确的是？`,
      `${avg}×${n}`,
      [`${avg}÷${n}`, `${n}÷${avg}`, `${avg}+${n}`],
      `总量＝平均数×份数＝${avg}×${n}。错项：除以份数是"反过来求每个分到多少"；用份数除以平均数则方向整个颠倒；平均数和份数相加没有任何口径含义。三量互求只用一条总公式回推：平均数＝总量÷份数，已知哪两个就求第三个。`,
    );
  }
  return buildFormula(
    r,
    "formula-average-basic-count",
    `${y} 年，某市完成${metric} ${total} ${unit}，平均每个${counter}完成 ${avg} ${unit}。`,
    `材料中，求 ${y} 年该市${counter}的个数，下列算式正确的是？`,
    `${total}÷${avg}`,
    [`${avg}÷${total}`, `${total}×${avg}`, `${total}−${avg}`],
    `份数＝总量÷平均数＝${total}÷${avg}。错项：颠倒分子分母是最常见的错（那算出来是"每个单位量的倒数"，不是个数）；相乘、相减都不成口径。三量互求先认出谁是总量、谁是份数，再用"平均数＝总量÷份数"回推。`,
  );
}

/**
 * ⑬ 基期比重（**四种写法都要考**）
 *
 * 同一个量有四种列法，真题里四种都出现过，而这一关以前只出第一种：
 *   ① 定义式：分子分母各自还原到基期 —— (A÷(1+a))÷(B÷(1+b))
 *   ② 原始公式（连乘）：先算现期比重再乘增速因子 —— (A÷B)×(1+b)÷(1+a)
 *   ③ 变形公式（差值）：现期比重 − 两期比重差 —— (A÷B)−(A÷B)×(a−b)÷(1+a)
 *   ④ 速算公式（拆 1 法）：因子拆成「1 + 小量」—— (A÷B)×(1+(b−a)÷(1+a))
 * 四式恒等，区别只在「要不要精确值、愿不愿意算两次除法、修正量好不好口算」。
 *
 * ⚠️ 同一题的选项里**绝不能**出现另一条等价写法：它同样正确，会被当成错项，
 * 等于把「认出公式」练成「猜出题人想要哪一种」。干扰项只取真错法。
 * ④ 尤其要注意：拆 1 法的干扰项只能是「符号写反 / 修正量除以 1+b」，不能是连乘式/差值式。
 */
function genBaseRatio(r: Rng): QuestionDraft {
  const y = yearOf(r);
  const [part, whole, unit] = r.pick(PART_WHOLE);
  const [a, bRaw] = twoRates(r); // a 部分增速、b 整体增速
  // 两增速至少要差 1.5 个百分点：差太小时基期比重与现期比重几乎相等，
  // 四种写法算出来是同一个数，「方向」「修正量」这些都考不出来。
  const b = Math.abs(bRaw - a) >= 1.5 ? bRaw : round1(a + (bRaw > a ? 1.5 : -1.5));
  const wb = baseAmount(r) * 3;
  const wc = currentOf(wb, b);
  const p = r.integer(10, 80);
  const ab = Math.round((wb * p) / 100);
  const ac = currentOf(ab, a);
  const materialLine = `${y} 年，某市${part}为 ${ac} ${unit}，比上年增长 ${pct(a)}；${whole}为 ${wc} ${unit}，比上年增长 ${pct(b)}。`;
  const stem = `材料中，求 ${y - 1} 年该市${part}占${whole}的比重，下列算式正确的是？`;
  /** 现期比重（四种写法的公共起点，也是最常见的错项） */
  const share = `${ac}÷${wc}`;
  const bigger = b > a; // 整体增速更快 → 基期比重比现期比重大
  const route = r.integer(0, 3);

  if (route === 0) {
    // ① 定义式：分子分母各自还原到基期
    return buildFormula(
      r,
      "formula-base-ratio",
      materialLine,
      stem,
      `(${ac}÷(1+${pct(a)}))÷(${wc}÷(1+${pct(b)}))`,
      [
        share,
        `(${ac}÷(1+${pct(a)}))÷(${wc}×(1+${pct(b)}))`,
        `(${ac}×(1+${pct(a)}))÷(${wc}÷(1+${pct(b)}))`,
      ],
      `定义式＝**分子分母各自还原到基期**：部分 ${ac}÷(1+${pct(a)})、整体 ${wc}÷(1+${pct(b)})，再相除。选项里另外三个都是错法：只写 ${share} 是现期比重（没折回基期）；把整体的增速因子写成乘号、或把部分的写成乘号，是把「还原到基期只能除、不能乘」记反了。同一个答案另三种等价写法——连乘式 ${share}×(1+${pct(b)})÷(1+${pct(a)})、差值式「现期比重−两期比重差」、速算公式（拆 1 法：因子拆成 1+(b−a)÷(1+a)），四式恒等，按选项精度挑一条即可。`,
    );
  }
  if (route === 1) {
    // ② 原始公式（连乘）：一次除法算出现期比重，再乘增速因子
    return buildFormula(
      r,
      "formula-base-ratio-product",
      materialLine,
      stem,
      `(${share})×(1+${pct(b)})÷(1+${pct(a)})`,
      [
        share,
        `(${share})×(1+${pct(a)})÷(1+${pct(b)})`,
        `(${share})×(1+${pct(a)}−${pct(b)})`,
      ],
      `原始公式（连乘）＝先算现期比重，再乘增速因子：${share}×${factor(b)}÷${factor(a)}。整体增速 ${pct(b)} ${bigger ? "快于" : "慢于"}部分增速 ${pct(a)}，因子${bigger ? "大于 1（基期比重比现期比重大）" : "小于 1（基期比重比现期比重小）"}——方向顺带就判掉了。错法：${share} 是现期比重；把因子写成 ${factor(a)}÷${factor(b)} 是增速比颠倒；写成 1+(${pct(a)}−${pct(b)}) 是把「增速比」当成了「1+增速差」，两者只在增速很小时才近似。另三种等价写法：定义式（各自还原）、差值式（现期比重−两期比重差）、速算公式（拆 1 法：因子拆成 1+(b−a)÷(1+a)）。`,
    );
  }
  if (route === 2) {
    // ③ 变形公式（差值）：现期比重 − 两期比重差
    return buildFormula(
      r,
      "formula-base-ratio-shift",
      materialLine,
      stem,
      `(${share})−(${share})×(${pct(a)}−${pct(b)})÷(1+${pct(a)})`,
      [
        share,
        `(${share})−(${pct(a)}−${pct(b)})`,
        `(${share})−(${share})×(${pct(a)}−${pct(b)})`,
      ],
      `变形公式＝现期比重减去两期比重差：两期比重差 ${share}×(${pct(a)}−${pct(b)})÷(1+${pct(a)})，绝对值恒小于 |a−b|。整体增速 ${pct(b)} ${bigger ? "快于" : "慢于"}部分增速 ${pct(a)}，所以基期比重比现期比重${bigger ? "大" : "小"}，用「方向 + |a−b| 卡上限」就能先框住区间。错法：${share} 是现期比重（没折回基期）；${share}−(${pct(a)}−${pct(b)}) 直接把百分点差当比重差，漏乘现期比重；${share}−${share}×(${pct(a)}−${pct(b)}) 漏掉 ÷(1+${pct(a)})——比重差永远小于缩放前的那个乘积。另三种等价写法：定义式、连乘式、速算公式（拆 1 法）。`,
    );
  }
  // ④ 速算公式（拆 1 法）：把增速因子拆成「1 + 一个小量」，修正量可以心算
  const diff = round1(b - a); // b−a，可正可负
  const sign = diff >= 0 ? "+" : "−";
  const absDiff = Math.abs(diff);
  const small = round1(diff / (1 + a / 100)); // 修正量（带符号）
  // 再省一步（把 ÷(1+a) 也省掉）的误差：现期比重×a(b−a)/(1+a)，单位百分点
  const approxErr = round1(Math.abs(((ac / wc) * a * diff) / (100 * (1 + a / 100))));
  return buildFormula(
    r,
    "formula-base-ratio-fast",
    materialLine,
    stem,
    `(${share})×(1${sign}${absDiff}%÷${factor(a)})`,
    [
      `(${share})×(1${diff >= 0 ? "−" : "+"}${absDiff}%÷${factor(a)})`,
      `(${share})×(1${sign}${absDiff}%÷${factor(b)})`,
      share,
    ],
    `速算公式（拆 1 法）＝把增速因子拆成「1 + 一个小量」：${factor(b)}÷${factor(a)}＝1+(${pct(b)}−${pct(a)})÷${factor(a)}＝1${sign}${absDiff}%÷${factor(a)}，所以基期比重＝现期比重×这个因子＝${share}×(1${sign}${absDiff}%÷${factor(a)})。修正量只有约 ${Math.abs(small)}%，心算「现期比重 ＋ 现期比重×小量」一步就出结果，不用真做两次除法；方向也顺带判掉——修正量${diff >= 0 ? "为正，基期比重比现期比重大" : "为负，基期比重比现期比重小"}。错法：把 b−a 写成 a−b 是方向反了；修正量的分母写成 ${factor(b)}，是把「除以 1+a」记成了「除以 1+b」；只写 ${share} 是现期比重。另三种等价写法：定义式（各自还原）、连乘式 ${share}×${factor(b)}÷${factor(a)}、差值式（现期比重−两期比重差）。选项差距大、|a−b| 又小时还能再省一步：把 ${absDiff}%÷${factor(a)} 近似成 ${absDiff}%，此时误差约 现期比重×a(b−a)/(1+a)≈${approxErr} 个百分点，增速越小心算越准。`,
  );
}

/**
 * ⑭ 两期比重差（**两种写法**）
 *   ① 现期比重×(a−b)÷(1+a)  —— 考场主力，一步算完
 *   ② 现期比重 − 基期比重    —— 定义式，最不容易记错
 * 两式恒等（把①里的乘积减掉就是②），但列式时的起手完全不同。
 */
function genRatioChange(r: Rng): QuestionDraft {
  const y = yearOf(r);
  const [part, whole, unit] = r.pick(PART_WHOLE);
  const [a, b] = twoRates(r); // a 部分增速、b 整体增速
  const wb = baseAmount(r) * 3;
  const wc = currentOf(wb, b);
  const p = r.integer(10, 80);
  const ab = Math.round((wb * p) / 100);
  const ac = currentOf(ab, a);
  const materialLine = `${y} 年，某市${part}为 ${ac} ${unit}，比上年增长 ${pct(a)}；${whole}为 ${wc} ${unit}，比上年增长 ${pct(b)}。`;
  const stem = `材料中，求 ${y} 年该市${part}占${whole}的比重与上年相比的变化，下列算式正确的是？`;
  const share = `${ac}÷${wc}`;
  if (r.integer(0, 1) === 0) {
    return buildFormula(
      r,
      "formula-ratio-change",
      materialLine,
      stem,
      `(${share})×(${pct(a)}−${pct(b)})÷(1+${pct(a)})`,
      [
        `(${share})×(${pct(a)}−${pct(b)})`,
        `${pct(a)}−${pct(b)}`,
        `(${share})×(${pct(b)}−${pct(a)})÷(1+${pct(a)})`,
      ],
      `两期比重差＝现期比重×(部分增速−整体增速)÷(1+部分增速)。它问的是"几个**百分点**"；漏掉 ÷(1+${pct(a)}) 是常见近似错法，直接答"${pct(a)}−${pct(b)}"则混淆了百分点与百分数，减反了则方向错。同一个答案的另一种写法：现期比重−基期比重，两种都算对。`,
    );
  }
  return buildFormula(
    r,
    "formula-ratio-change-sub",
    materialLine,
    stem,
    `(${share})−(${share})×(1+${pct(b)})÷(1+${pct(a)})`,
    [
      `(${share})−(${share})×(1+${pct(a)})÷(1+${pct(b)})`,
      `${pct(a)}−${pct(b)}`,
      `(${share})×(1+${pct(b)})÷(1+${pct(a)})`,
    ],
    `两期比重差＝现期比重−基期比重，而基期比重＝${share}×(1+${pct(b)})÷(1+${pct(a)})，相减即可。错项：把增速因子写反的那一项（(1+${pct(a)})÷(1+${pct(b)})）算错的是基期比重；只算出基期比重、忘了减现期比重的那一项，答案就停在基期上；直接答"${pct(a)}−${pct(b)}"则混了百分点与百分数。同一个答案的另一种写法：现期比重×(a−b)÷(1+a)，两种都算对。`,
  );
}

/**
 * ⑮ 平均数增长率（**两种写法**）
 *   ① (a−b)÷(1+b)          —— 口诀式：增速差除以（1+份数增速）
 *   ② (1+a)÷(1+b)−1        —— 定义式：现期平均数÷基期平均数−1
 * 两式恒等（①就是②通分的结果），考场上先写①，记不牢时用②推。
 */
function genAverageRate(r: Rng): QuestionDraft {
  const [metric, unit] = r.pick(TOTALS);
  const y = yearOf(r);
  const [counter, , lo, hi] = r.pick(COUNTERS);
  const n = r.integer(lo, hi);
  const total = r.integer(200, 9800) * 10;
  const [a, b] = twoRates(r); // a 总量（分子）增速、b 份数（分母）增速
  const materialLine = `${y} 年，某市${metric}为 ${total} ${unit}，比上年增长 ${pct(a)}；全市共有 ${n} 个${counter}，比上年增长 ${pct(b)}。`;
  const stem = `材料中，求 ${y} 年该市平均每个${counter}的${metric}的同比增速，下列算式正确的是？`;
  if (r.integer(0, 1) === 0) {
    return buildFormula(
      r,
      "formula-average-rate",
      materialLine,
      stem,
      `(${pct(a)}−${pct(b)})÷(1+${pct(b)})`,
      [`(${pct(a)}−${pct(b)})÷(1+${pct(a)})`, `${pct(a)}−${pct(b)}`, `(${pct(a)}+${pct(b)})÷(1+${pct(b)})`],
      `平均数增长率＝(总量增速−份数增速)÷(1+份数增速)，分母是**份数**那一项（b=${pct(b)}），不是总量那一项。错项：分母换成总量增速（那是两期比重差的分母，两回事）；直接相减 ${pct(a)}−${pct(b)} 漏掉了 ÷(1+b)；加减号写反则连方向都不对。同一个答案的另一种写法：(1+a)÷(1+b)−1，两种都算对。`,
    );
  }
  return buildFormula(
    r,
    "formula-average-rate-ratio",
    materialLine,
    stem,
    `(1+${pct(a)})÷(1+${pct(b)})−1`,
    [`(1+${pct(b)})÷(1+${pct(a)})−1`, `(1+${pct(a)})×(1+${pct(b)})−1`, `${pct(a)}−${pct(b)}`],
    `定义式：增长后的平均数÷原来的平均数−1。分子是总量的增速因子 (1+${pct(a)})，分母是份数的增速因子 (1+${pct(b)})——分母放的是**份数**，因为平均数＝总量÷份数。错项：分子分母放反、或把两个因子相乘都会算错；直接相减 ${pct(a)}−${pct(b)} 漏掉了 ÷(1+份数增速)。同一个答案的另一种写法：(a−b)÷(1+b)，两种都算对。`,
  );
}

/**
 * ⑯ 差值增长率
 *
 * ⚠️ 这里修过一处错：原来标答是 `(现期×R − 现期×r)÷(现期差)`，那是小增速下的**近似**——
 * 分子把「增量」写成了「现期×增速」（真增量是现期÷(1+r)×r），分母把「基期差」写成了「现期差」。
 * 两个近似叠起来，r 稍大就会差出好几个百分点，而这一关问的恰恰是「该怎么列式」，不能教近似。
 * 现在标答是标准的两步法：先分别还原两期差值，再 (本期差值−基期差值)÷基期差值；
 * 那个近似式降级成错项，解析里点明它为什么只在小增速时才敢用。
 */
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
  const baseWhole = `${wc}÷(1+${pct(R)})`;
  const basePart = `${ac}÷(1+${pct(rr)})`;
  const baseDiff = `${baseWhole}−${basePart}`;
  return buildFormula(
    r,
    "formula-diff-rate",
    `${y} 年，某市${whole}为 ${wc} ${unit}，比上年增长 ${pct(R)}；其中${part}为 ${ac} ${unit}，比上年增长 ${pct(rr)}。`,
    `材料中，求 ${y} 年该市"${whole}减去${part}"这一部分的同比增速，下列算式正确的是？`,
    `((${wc}−${ac})−(${baseDiff}))÷(${baseDiff})`,
    [
      `${pct(R)}−${pct(rr)}`,
      `(${wc}×${pct(R)}−${ac}×${pct(rr)})÷(${wc}−${ac})`,
      `(${wc}×${pct(R)}−${ac}×${pct(rr)})÷(${baseDiff})`,
    ],
    `差值（整体−部分）的增速要走两步：先各自还原基期，整体基期 ${wc}÷(1+${pct(R)})、部分基期 ${ac}÷(1+${pct(rr)})，基期差值＝${baseDiff}；再用 (本期差值−基期差值)÷基期差值。错法一：直接相减 "${pct(R)}−${pct(rr)}"——两个比率的分母不同，不能这样比；错法二：把"现期×增速"当增量、把"现期差"当基期差（那是增速很小时的近似，本题增速不算小，会差出好几个点）；错法三：分子用现期×增速、分母却用基期差，两头口径不一致。`,
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
