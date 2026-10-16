/**
 * 「数据定位」生成器：练习「由问题 → 找到那个数」的检索能力。**只练找数，不含运算。**
 *
 * 四类题型（对齐粉笔「资料找数」的考法）：
 * - locate-value   取数题：给指标 → 找数值（选项是数，干扰项取自同篇同类的其它数）
 * - locate-number  数值反查：给数值 → 找指标（选项是指标名，必须真读材料才能答）
 * - locate-forward 正向定位：给问法 → 选所在段落/行列
 * - locate-reverse 反向定位：给位置 → 选对应的数据项
 *
 * ⚠️ 本模块刻意**不设**任何需要计算（加减/乘除）的题型——计算属于「列式训练」与
 * 「资料速算」两条链的职责，混进来会稀释"找数"这一项单一技能的练习密度。
 */
import type { QuestionDraft, Rng } from "../types";
import type { MaterialEntry, MaterialIndicator } from "./types";
import { pickEntry, shuffle, withMaterial } from "./helpers";
import { MATERIALS } from "./data/materials";

/** 带数值的指标（取数题 / 数值反查题的原子） */
type NumericIndicator = MaterialIndicator & { value: number };

function numericOf(entry: MaterialEntry): NumericIndicator[] {
  return entry.indicators.filter(
    (ind): ind is NumericIndicator => typeof ind.value === "number",
  );
}

/** 全库数值指标（同单位干扰项不足时跨篇补） */
const GLOBAL_NUMERIC = MATERIALS.flatMap((entry) =>
  numericOf(entry).map((ind) => ({ entry, ind })),
);

/** 材料年份（"2023 年·同比" → "2023 年"） */
function yearOf(entry: MaterialEntry): string {
  return entry.calibrated.match(/\d{4}\s*年/)?.[0] ?? "";
}

function show(value: number): string {
  return String(value);
}

/** 数值的展示形态（带单位；百分比不加空格） */
function withUnit(value: number, unit?: string): string {
  if (unit === "%") return `${value}%`;
  return unit ? `${value} ${unit}` : String(value);
}

/** 同数量级的近似值（干扰项兜底，保证不出现离谱量级） */
function perturb(value: number, factor: number): number {
  const raw = value * factor;
  const ref = Math.abs(value);
  return Number.isInteger(ref) ? Math.round(raw) : Math.round(raw * 10) / 10;
}

/**
 * 取数题的干扰项：**优先取同篇同单位的真实数值**——这正是真题干扰项的来源
 * （把材料里另一个指标的数塞进选项，如问"存款增加"却给"贷款增加"的数）。
 * 不足 3 个再跨篇同单位补（按量级接近度排序），最后用同数量级近似值兜底。
 */
function valueDistractors(entry: MaterialEntry, target: NumericIndicator): string[] {
  const picked: number[] = [];
  const push = (value: number) => {
    if (value === target.value || picked.includes(value)) return;
    picked.push(value);
  };

  numericOf(entry)
    .filter((ind) => ind.unit === target.unit)
    .forEach((ind) => push(ind.value));

  if (picked.length < 3) {
    const ref = Math.abs(target.value) || 1;
    GLOBAL_NUMERIC.filter(
      (row) => row.entry.id !== entry.id && row.ind.unit === target.unit,
    )
      .map((row) => row.ind.value)
      .sort((a, b) => Math.abs(Math.abs(a) - ref) - Math.abs(Math.abs(b) - ref))
      .forEach((value) => {
        if (picked.length < 3) push(value);
      });
  }

  for (const factor of [0.72, 1.28, 0.55, 1.62]) {
    if (picked.length >= 3) break;
    push(perturb(target.value, factor));
  }
  return picked.slice(0, 3).map(show);
}

/** 取数题：给指标 → 找数值 */
function valueQuestion(r: Rng, entry: MaterialEntry): QuestionDraft | null {
  const pool = numericOf(entry);
  if (pool.length < 2) return null;
  const target = r.pick(pool);
  const distractors = valueDistractors(entry, target);
  if (distractors.length < 3) return null;

  const { options, answerIndex } = shuffle(show(target.value), distractors, r.random);
  const unit = target.unit ?? "";
  const year = yearOf(entry);
  const lead = year ? `${year}，` : "";
  // 题干里单位紧跟括号（「（ ）亿元」）；解析里数值与单位之间留空格（「460 亿元」）
  const qTail = unit === "%" ? "" : unit;
  const eTail = unit === "%" ? "%" : unit ? ` ${unit}` : "";
  // 三种问法轮换，避免"题干千篇一律"带来的记忆效应
  const stem = r.pick([
    `${lead}${target.name}为（ ）${qTail}。`,
    `${lead}材料中${target.name}是（ ）${qTail}。`,
    `材料给出的${target.name}为（ ）${qTail}。`,
  ]);

  return withMaterial(entry, {
    templateId: "locate-value",
    params: { materialId: entry.id, indicator: target.name, answer: show(target.value) },
    stem,
    options,
    answerIndex,
    explanation: `「${target.name}」在${target.where}，数值为 ${show(target.value)}${eTail}。其余选项取自材料中同类的其它数值，做题时务必先认准主体与单位，别被相邻指标带偏。`,
  });
}

/** 数值反查题：给数值 → 找指标（比正向取数更难，必须真的读到那个数） */
function numberQuestion(r: Rng, entry: MaterialEntry): QuestionDraft | null {
  const pool = numericOf(entry);
  if (!pool.length || entry.indicators.length < 4) return null;
  const target = r.pick(pool);
  const distractors = entry.indicators
    .filter((ind) => ind.name !== target.name)
    .map((ind) => ind.name)
    .slice(0, 3);
  if (distractors.length < 3) return null;

  const { options, answerIndex } = shuffle(target.name, distractors, r.random);
  const shown = withUnit(target.value, target.unit);
  return withMaterial(entry, {
    templateId: "locate-number",
    params: { materialId: entry.id, value: target.value, answer: target.name },
    stem: `材料中「${shown}」这个数据，对应的是（ ）。`,
    options,
    answerIndex,
    explanation: `${shown} 对应「${target.name}」，数据在${target.where}。反过来从数找指标，要先看量级和单位缩小范围，再回材料核对主体——只凭"数字眼熟"最容易认错。`,
  });
}

/** 备用位置标签（当材料内不同位置不足 4 处时补位，保证选项互异且像"真实位置"） */
const LOCATION_POOL = ["第一段", "第二段", "第三段", "表格首列", "表格末行", "图表标题", "脚注说明"];

function locations(entry: MaterialEntry, exclude: string): string[] {
  const own = [...new Set(entry.indicators.map((i) => i.where))].filter((w) => w !== exclude);
  const filler = LOCATION_POOL.filter((w) => w !== exclude && !own.includes(w));
  return [...own, ...filler].slice(0, 3);
}

/** 正向：问法 → 位置 */
function forward(r: Rng, entry: MaterialEntry): QuestionDraft | null {
  const target = r.pick(entry.indicators);
  const { options, answerIndex } = shuffle(target.where, locations(entry, target.where), r.random);
  return withMaterial(entry, {
    templateId: "locate-forward",
    params: { materialId: entry.id, indicator: target.name, answer: target.where },
    stem: `题干要求「${target.ask}」，相关数据应在材料中（ ）查找？`,
    options,
    answerIndex,
    explanation: `「${target.name}」的数据出现在${target.where}；定位时先抓"主体+指标+时间"三个关键词，再去对应段落或表格行列，可避免来回通读。`,
  });
}

/** 反向：位置 → 数据项。只在**位置唯一**时出题，否则"某段提供的数据"会有多个正确答案 */
function reverse(r: Rng, entry: MaterialEntry): QuestionDraft | null {
  const counts = new Map<string, number>();
  entry.indicators.forEach((i) => counts.set(i.where, (counts.get(i.where) ?? 0) + 1));
  const uniqueWhere = entry.indicators.filter((i) => counts.get(i.where) === 1);
  if (!uniqueWhere.length) return null;

  const target = r.pick(uniqueWhere);
  // 干扰项必须来自**别的位置**，否则同样构成歧义
  const distractors = entry.indicators
    .filter((i) => i.name !== target.name && i.where !== target.where)
    .map((i) => i.name)
    .slice(0, 3);
  if (distractors.length < 3) return null;

  const { options, answerIndex } = shuffle(target.name, distractors, r.random);
  return withMaterial(entry, {
    templateId: "locate-reverse",
    params: { materialId: entry.id, where: target.where, answer: target.name },
    stem: `材料中「${target.where}」提供的数据是？`,
    options,
    answerIndex,
    explanation: `「${target.where}」只给出「${target.name}」这一项（口径${target.caliber ?? "—"}），其余选项都在别的位置。做题时把"位置 → 数据项"的对应关系先扫一遍，找数会快很多。`,
  });
}

type LocateModel = (r: Rng, entry: MaterialEntry) => QuestionDraft | null;

export function generateDataLocating(r: Rng): QuestionDraft | null {
  const entry = pickEntry(r);
  if (entry.indicators.length < 2) return null;

  // 分档：简单正向取数；中等正向/定位混合；困难以"从数回推"为主（更难）
  const models: LocateModel[] =
    r.level === 1
      ? [valueQuestion, forward]
      : r.level === 3
        ? [numberQuestion, reverse, valueQuestion, forward]
        : [valueQuestion, forward, numberQuestion, reverse];

  // 以随机起点轮转，逐个尝试；第一个出得来的题型即为本题（保证确定性）
  const start = Math.floor(r.random() * models.length);
  for (let step = 0; step < models.length; step += 1) {
    const question = models[(start + step) % models.length](r, entry);
    if (question) return question;
  }
  return null;
}
