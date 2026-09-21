/**
 * 申论闯关的通关规则（纯函数）。
 *
 * 单独成文件的原因：训练页需要「实时预览能得几星」，服务端需要「按同一规则判星」，
 * 两边必须用同一份实现；而题库（bank.ts）与关卡文案（training.ts）只有服务端用得到，
 * 客户端不该跟着打包进去。
 *
 * 星级口径（客观题 + 自评清单的加权总分）：
 *   - 客观题：每题 2 分（客观可验证，权重更高），答对比例不足 80% 直接不通关；
 *   - 自评清单：每条 1 分（校验「任务真的做了」）；
 *   - 满分 = 题数 × 2 + 清单条数（5 题 + 10 条 = 20 分），≥80% 一星通关、≥90% 二星、满分三星。
 * 与专项训练（一局 10 题的准确率）保持同一套分界：都是 80/90/100。
 */

/** 客观题每题的分值 */
export const ESSAY_QUIZ_WEIGHT = 2;

/** 客观题及格线：答对比例 ≥80%（5 题即至少 4 题）才可能通关 */
export function essayQuizPassLine(total: number): number {
  return Math.ceil(total * 0.8);
}

export interface EssayOutcome {
  correct: number;
  quizTotal: number;
  checked: number;
  checklistTotal: number;
}

export function essayStars({
  correct,
  quizTotal,
  checked,
  checklistTotal,
}: EssayOutcome): 0 | 1 | 2 | 3 {
  if (quizTotal <= 0 || checklistTotal <= 0) return 0;
  // 客观题是硬门槛：要点没记住，清单勾得再满也不算通关
  if (correct < essayQuizPassLine(quizTotal)) return 0;
  const score = correct * ESSAY_QUIZ_WEIGHT + checked;
  const full = quizTotal * ESSAY_QUIZ_WEIGHT + checklistTotal;
  const rate = score / full;
  if (rate >= 1) return 3;
  if (rate >= 0.9) return 2;
  if (rate >= 0.8) return 1;
  return 0;
}
