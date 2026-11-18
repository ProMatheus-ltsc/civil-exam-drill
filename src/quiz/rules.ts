/**
 * 闯关判定的纯规则：前后端共用。
 *
 * 抽出来的直接原因：答题改成「本地判分 + 后台异步上报」后，结算页不能再等服务端算完
 * 才显示星级——网络一抖用户就卡在「正在结算」。同一套规则放在这里，前端算出来与服务端
 * 落库的口径必然一致；服务端上报回来若结果不同，以服务端为准（防篡改）。
 */
import { difficultyBudgetMs, topicById, type TopicId } from "../generator/catalog";

export const RUN_LENGTH = 10;
export const RUN_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type RunDifficulty = (typeof RUN_DIFFICULTIES)[number];

/** 难度局 key：topicId|difficulty */
export const diffKey = (topicId: string, difficulty: RunDifficulty) =>
  `${topicId}|${difficulty}`;

/** 单局判定：完整 10 题、答对 ≥8、总用时不超过该难度局预算 */
export function runStars(agg: {
  topicId: string;
  difficulty: RunDifficulty;
  total: number;
  correct: number;
  durationMs: number;
}): number {
  if (agg.total < RUN_LENGTH) return 0;
  const topic = topicById.get(agg.topicId as TopicId);
  if (topic && agg.durationMs > difficultyBudgetMs(topic, agg.difficulty)) return 0;
  const accuracy = agg.correct / agg.total;
  if (accuracy >= 1) return 3;
  if (accuracy >= 0.9) return 2;
  if (accuracy >= 0.8) return 1;
  return 0;
}

/** 结算页需要的本局成绩（本地先算，服务端回包再覆盖） */
export type RunSummary = {
  finished: boolean;
  difficulty: RunDifficulty;
  total: number;
  correct: number;
  accuracy: number;
  durationMs: number;
  passed: boolean;
  stars: number;
};

export function summarizeRun(agg: {
  topicId: string;
  difficulty: RunDifficulty;
  total: number;
  correct: number;
  durationMs: number;
}): RunSummary {
  const stars = runStars(agg);
  return {
    finished: agg.total >= RUN_LENGTH,
    difficulty: agg.difficulty,
    total: agg.total,
    correct: agg.correct,
    accuracy: agg.total ? agg.correct / agg.total : 0,
    durationMs: agg.durationMs,
    passed: stars > 0,
    stars,
  };
}
