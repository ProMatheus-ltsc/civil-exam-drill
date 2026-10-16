/**
 * 「列式训练」生成器：**只给问题与材料，不给算式**，考察「题型 → 公式」的判断。
 * 正确项是算式，干扰项是最常见的列式错误（现期/基期颠倒、增长量用现期乘、分母漏项等）。
 */
import type { QuestionDraft, Rng } from "../types";
import { pickEntry, shuffle, withMaterial } from "./helpers";

export function generateFormulaSetup(r: Rng): QuestionDraft | null {
  const entry = pickEntry(r);
  const pool = entry.computables;
  if (!pool.length) return null;
  const target = r.pick(pool);
  const { options, answerIndex } = shuffle(target.answer, [...target.distractors], r.random);
  return withMaterial(entry, {
    templateId: `formula-${target.kind}`,
    params: { materialId: entry.id, indicator: target.indicator, answer: target.answer },
    stem: `${target.ask}，下列算式正确的是？`,
    options,
    answerIndex,
    explanation: `${target.basis}（对应指标：「${target.indicator}」，材料口径：${entry.calibrated}）。列式前先判题型，再套公式，比先算再猜快且准。`,
  });
}
