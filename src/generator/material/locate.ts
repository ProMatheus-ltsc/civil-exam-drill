/**
 * 「数据定位」生成器：练习「由问题 → 找到那个数」的检索能力。
 *
 * 四类题型（对齐粉笔「资料找数」的考法）：
 * - locate-value   取数题：由指标直接问**数值**（选项是数，干扰项取自同篇同类的其它数值）
 * - locate-diff    差值题：同层级两个指标相减，干扰项含"两个主体各自的数"（取错主体）
 * - locate-forward 正向定位：给问法 → 选所在段落/行列
 * - locate-reverse 反向定位：给位置 → 选对应的数据项
 *
 * 前两类是「找数」的主战场（真要读材料里的数字），后两类练"先搭地图"。
 */
import type { QuestionDraft, Rng } from "../types";
import type { MaterialEntry, MaterialIndicator } from "./types";
import { pickEntry, shuffle, withMaterial } from "./helpers";
import { MATERIALS } from "./data/materials";

/** 带数值的指标（取数题 / 差值题的原子） */
type NumericIndicator = MaterialIndicator & { value: number };

/**
 * 总量/整体类指标：不参与差值题。
 * 与分项相减会得到"另一个分项"，答案易与选项撞车，语义也怪。
 */
const TOTAL_WORDS = /总额|合计|总产量|总支出|总量|余额|全体|全国|一般/;

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

/** 同数量级的近似值（干扰项兜底，保证不出现离谱量级） */
function perturb(value: number, factor: number): number {
  const raw = value * factor;
  const ref = Math.abs(value);
  return Number.isInteger(ref) ? Math.round(raw) : Math.round(raw * 10) / 10;
}

/**
 * 取数题的干扰项：**优先取同篇同单位的真实数值**——这正是真题干扰项的来源
 * （把材料里另一个指标的数塞进选项，如问"存款增加"却给"贷款增加"的数）。
 * 不足 3 个再跨篇同单位补，最后用同数量级近似值兜底。
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

/** 取数题：这个指标的数是多少 */
function valueQuestion(r: Rng, entry: MaterialEntry): QuestionDraft | null {
  const pool = numericOf(entry);
  if (pool.length < 2) return null;
  const target = r.pick(pool);
  const distractors = valueDistractors(entry, target);
  if (distractors.length < 3) return null;

  const { options, answerIndex } = shuffle(show(target.value), distractors, r.random);
  const unit = target.unit ?? "";
  const year = yearOf(entry);
  const tail = unit === "%" ? "%" : unit ? ` ${unit}` : "";
  return withMaterial(entry, {
    templateId: "locate-value",
    params: { materialId: entry.id, indicator: target.name, answer: show(target.value) },
    stem:
      unit === "%"
        ? `${year}，${target.name}为（ ）。`
        : `${year}，${target.name}为（ ）${unit}。`,
    options,
    answerIndex,
    explanation: `「${target.name}」在${target.where}，数值为 ${show(target.value)}${tail}。其余选项取自材料中同类的其它数值，做题时务必先认准主体与单位，别被相邻指标带偏。`,
  });
}

interface IndicatorPair {
  hi: NumericIndicator;
  lo: NumericIndicator;
}

/** 同层级、同单位、可相减的指标对（同段或同表，且都不是总量） */
function pairsOf(entry: MaterialEntry): IndicatorPair[] {
  const pool = numericOf(entry).filter(
    (ind) =>
      ind.unit &&
      ind.unit !== "%" &&
      ind.caliber !== "占比" &&
      !TOTAL_WORDS.test(ind.name),
  );
  const pairs: IndicatorPair[] = [];
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const a = pool[i];
      const b = pool[j];
      if (a.unit !== b.unit || a.value === b.value) continue;
      const sameTable = a.where.includes("表格") && b.where.includes("表格");
      if (a.where !== b.where && !sameTable) continue;
      if (a.name.includes(b.name) || b.name.includes(a.name)) continue;
      pairs.push(a.value > b.value ? { hi: a, lo: b } : { hi: b, lo: a });
    }
  }
  return pairs;
}

/** 差值题：A 比 B 多多少（干扰项 = 两个主体各自的数值，专抓"取错主体"） */
function diffQuestion(r: Rng, entry: MaterialEntry): QuestionDraft | null {
  const pairs = pairsOf(entry);
  if (!pairs.length) return null;
  const { hi, lo } = r.pick(pairs);
  const unit = hi.unit ?? "";
  const diff = Math.round((hi.value - lo.value) * 100) / 100;

  const distractors = [
    ...new Set(
      [hi.value, lo.value, Math.round((hi.value + lo.value) * 100) / 100]
        .filter((value) => value !== diff)
        .map(show),
    ),
  ];
  if (distractors.length < 3) return null;

  const { options, answerIndex } = shuffle(show(diff), distractors.slice(0, 3), r.random);
  return withMaterial(entry, {
    templateId: "locate-diff",
    params: { materialId: entry.id, hi: hi.name, lo: lo.name, answer: show(diff) },
    stem: `${yearOf(entry)}，${hi.name}比${lo.name}多（ ）${unit}。`,
    options,
    answerIndex,
    explanation: `${hi.name} ${show(hi.value)}${unit} 减 ${lo.name} ${show(lo.value)}${unit}，得 ${show(diff)}${unit}。找数题最常错在"取错主体"——本题选项里就摆着这两个指标各自的数值，先认准谁减谁再动手。`,
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

  // 分档：简单练"取数"，中等四种混合，困难主练"差值/反向"（都要真读材料）
  const models: LocateModel[] =
    r.level === 1
      ? [valueQuestion, forward]
      : r.level === 3
        ? [diffQuestion, reverse, valueQuestion, forward]
        : [valueQuestion, diffQuestion, forward, reverse];

  // 以随机起点轮转，逐个尝试；第一个出得来的题型即为本题（保证确定性）
  const start = Math.floor(r.random() * models.length);
  for (let step = 0; step < models.length; step += 1) {
    const question = models[(start + step) % models.length](r, entry);
    if (question) return question;
  }
  return null;
}
