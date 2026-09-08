/** 训练题生成器统一入口（双轨：资料速算 + 数字推理） */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { topicById, topics, difficulties, legacyTopics, tracks, topicBudget, titleOf, difficultyRuns, difficultyBudgetMs, perQuestionBudgetSeconds } from "./catalog";
import type { Difficulty, QuestionDraft, Rng, GeneratedQuestion } from "./types";
import { makeRng, canonical } from "./random";
import type { TopicId } from "./catalog";
// 资料速算
import {
  generateArithmetic,
  generateMultiply,
  generateDivide,
  generateSensitive,
  generateDecimal,
} from "./speed/basic";
import {
  generateGrowthRate,
  generateGrowthAmount,
  generateBaseAmount,
  generateMultiples,
  generateBaseDifference,
  generateIntervalGrowth,
  generateMixedGrowth,
  generateAnnualAmount,
  generateAnnualRate,
} from "./speed/growth";
import {
  generateRatioBasic,
  generatePartQuantity,
  generateAverageBasic,
  generateBaseRatio,
  generateRatioChange,
  generateAverageRate,
  generateDiffRate,
  generateContributionRate,
  generatePullGrowth,
} from "./speed/proportion";
import { contextMaterial } from "./speed/context";
import { rephraseDraft } from "./speed/scenario";
// 数字推理
import {
  generateSeqBasic,
  generateSeqMultilevel,
  generateSeqMultiple,
  generateSeqPeriodic,
} from "./sequences/classic";
import {
  generateSeqPower,
  generateSeqRecursive,
  generateSeqFraction,
  generateSeqSplit,
  generateSeqFactor,
} from "./sequences/advanced";

export type { TopicId } from "./catalog";
export type { GeneratedQuestion, Difficulty, MaterialSpec } from "./types";
export { topics, difficulties, legacyTopics, tracks, topicBudget, titleOf, topicById, difficultyRuns, difficultyBudgetMs, perQuestionBudgetSeconds };

type Generator = (r: Rng) => QuestionDraft | null;

const generators: Record<TopicId, Generator> = {
  arithmetic: generateArithmetic,
  multiply: generateMultiply,
  divide: generateDivide,
  sensitive: generateSensitive,
  decimal: generateDecimal,
  "growth-rate": generateGrowthRate,
  "growth-amount": generateGrowthAmount,
  "base-amount": generateBaseAmount,
  multiples: generateMultiples,
  "base-difference": generateBaseDifference,
  "interval-growth": generateIntervalGrowth,
  "mixed-growth": generateMixedGrowth,
  "annual-amount": generateAnnualAmount,
  "annual-rate": generateAnnualRate,
  "ratio-basic": generateRatioBasic,
  "part-quantity": generatePartQuantity,
  "average-basic": generateAverageBasic,
  "base-ratio": generateBaseRatio,
  "ratio-change": generateRatioChange,
  "average-rate": generateAverageRate,
  "diff-rate": generateDiffRate,
  "contribution-rate": generateContributionRate,
  "pull-growth": generatePullGrowth,
  "seq-basic": generateSeqBasic,
  "seq-multilevel": generateSeqMultilevel,
  "seq-multiple": generateSeqMultiple,
  "seq-periodic": generateSeqPeriodic,
  "seq-power": generateSeqPower,
  "seq-recursive": generateSeqRecursive,
  "seq-fraction": generateSeqFraction,
  "seq-split": generateSeqSplit,
  "seq-factor": generateSeqFactor,
};

export function isCatalogTopic(id: string): id is TopicId {
  return topicById.has(id as TopicId);
}

export function generateQuestion(input: {
  topicId: TopicId;
  difficulty: Difficulty;
  excludedFingerprints: string[];
  randomSeed?: string;
}): GeneratedQuestion {
  const seed = input.randomSeed ?? crypto.randomUUID();
  const generate = generators[input.topicId];
  if (!generate) throw new Error("UNKNOWN_TOPIC");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const rng = makeRng(`${seed}:${attempt}`, input.difficulty);
    let draft = generate(rng);
    if (!draft) continue;
    // 高难度局·实战：资料速算任意模块的题目都包装为文字/表格/图表短材料（数推高局保持纯数列）
    if (
      input.difficulty === "hard" &&
      topicById.get(input.topicId)?.track === "speed"
    ) {
      // 加减/乘除先用真题化问法与材料（避免“计算 X”与“数值一/二/三”），其余走语义化语境
      const scenario = rephraseDraft(draft, input.topicId);
      if (scenario) {
        draft = { ...draft, stem: scenario.stem, material: scenario.material };
      } else if (!draft.material) {
        draft = { ...draft, material: contextMaterial(draft) };
      }
    }
    const materialJson = draft.material ? JSON.stringify(draft.material) : "";
    const fingerprint = bytesToHex(
      sha256(
        utf8ToBytes(
          `${input.topicId}|${input.difficulty}|${draft.templateId}|${canonical(draft.params)}|${materialJson}`,
        ),
      ),
    );
    if (!input.excludedFingerprints.includes(fingerprint))
      return {
        ...draft,
        templateVersion: 1,
        fingerprint,
        material: draft.material ?? null,
      };
  }
  throw new Error("GENERATION_FAILED");
}
