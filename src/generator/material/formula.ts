/**
 * 「列式训练」生成器：**只给问题与材料，不给算式**，考察「题型 → 公式」的判断。
 * 正确项是算式，干扰项是最常见的列式错误（现期/基期颠倒、增长量用现期乘、分母漏项等）。
 *
 * 按**公式族**拆成三关，每关只考一条主线（原来一个模块混着 9 种公式，练不出密度）：
 * - generateFormulaBase   基期与增速：base-amount / growth-rate
 * - generateFormulaRatio  比重与百分点：ratio / ratio-change
 * - generateFormulaAmount 增长量与平均数：growth-amount / average
 */
import type { QuestionDraft, Rng } from "../types";
import type { FormulaKind, MaterialComputable, MaterialEntry } from "./types";
import { shuffle, withMaterial } from "./helpers";
import { MATERIALS } from "./data/materials";

/** 全库「算式 → 所属材料」索引：先按公式族筛题，再定位到材料，避免抽到没有该族题目的材料 */
const ALL_COMPUTABLES: { entry: MaterialEntry; item: MaterialComputable }[] = MATERIALS.flatMap(
  (entry) => entry.computables.map((item) => ({ entry, item })),
);

function formulaGenerator(kinds: readonly FormulaKind[]) {
  return function generate(r: Rng): QuestionDraft | null {
    const pool = ALL_COMPUTABLES.filter(({ item }) => kinds.includes(item.kind));
    if (!pool.length) return null;
    const { entry, item } = r.pick(pool);
    const { options, answerIndex } = shuffle(item.answer, [...item.distractors], r.random);
    return withMaterial(entry, {
      templateId: `formula-${item.kind}`,
      params: { materialId: entry.id, indicator: item.indicator, answer: item.answer },
      stem: `${item.ask}，下列算式正确的是？`,
      options,
      answerIndex,
      explanation: `${item.basis}（对应指标：「${item.indicator}」，材料口径：${entry.calibrated}）。列式前先判题型，再套公式，比先算再猜快且准。`,
    });
  };
}

/** 第一关：已知现期求过去（基期量）、已知两期求增速 */
export const generateFormulaBase = formulaGenerator(["base-amount", "growth-rate"]);

/** 第二关：部分与整体的比重、两期比重变化（百分点） */
export const generateFormulaRatio = formulaGenerator(["ratio", "ratio-change"]);

/** 第三关：增长多少（增长量）、平均多少（平均数） */
export const generateFormulaAmount = formulaGenerator(["growth-amount", "average"]);
