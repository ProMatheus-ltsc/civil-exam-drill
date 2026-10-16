/**
 * 「数据定位」生成器：练习「由问题 → 数据在哪」的检索能力。
 * 正向：给问法 → 选所在段落/行列；反向：给位置 → 选对应的数据项。
 */
import type { QuestionDraft, Rng } from "../types";
import type { MaterialEntry } from "./types";
import { pickEntry, shuffle, withMaterial } from "./helpers";

/** 备用位置标签（当材料内不同位置不足 4 处时补位，保证选项互异且像"真实位置"） */
const LOCATION_POOL = ["第一段", "第二段", "第三段", "表格首列", "表格末行", "图表标题", "脚注说明"];

function locations(entry: MaterialEntry, exclude: string): string[] {
  const own = [...new Set(entry.indicators.map((i) => i.where))].filter((w) => w !== exclude);
  const filler = LOCATION_POOL.filter((w) => w !== exclude && !own.includes(w));
  return [...own, ...filler].slice(0, 3);
}

export function generateDataLocating(r: Rng): QuestionDraft | null {
  const entry = pickEntry(r);
  if (entry.indicators.length < 2) return null;
  // 反向题需要 ≥4 个指标才能凑出 4 个互异选项，否则退回正向
  const useReverse = r.level !== 1 && r.random() < 0.6 && entry.indicators.length >= 4;
  return useReverse ? reverse(r, entry) : forward(r, entry);
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

/** 反向：位置 → 数据项 */
function reverse(r: Rng, entry: MaterialEntry): QuestionDraft | null {
  const target = r.pick(entry.indicators);
  const distractors = entry.indicators
    .filter((i) => i.name !== target.name)
    .map((i) => i.name)
    .slice(0, 3);
  const { options, answerIndex } = shuffle(target.name, distractors, r.random);
  return withMaterial(entry, {
    templateId: "locate-reverse",
    params: { materialId: entry.id, where: target.where, answer: target.name },
    stem: `材料中「${target.where}」提供的数据是？`,
    options,
    answerIndex,
    explanation: `${target.where}对应的是「${target.name}」（口径${target.caliber ?? "—"}）。做题时把"位置 → 数据项"的对应关系先扫一遍，找数会快很多。`,
  });
}
