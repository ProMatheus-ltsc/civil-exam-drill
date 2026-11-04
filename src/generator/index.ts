/** 训练题生成器统一入口（双轨：资料速算 + 数字推理） */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { topicById, topics, difficulties, legacyTopics, tracks, topicBudget, titleOf, difficultyRuns, difficultyBudgetMs, perQuestionBudgetSeconds } from "./catalog";
import type { Difficulty, QuestionDraft, Rng, GeneratedQuestion } from "./types";
import { makeRng, canonical } from "./random";
import type { TopicId } from "./catalog";
// 资料速算
import {
  generateAddition,
  generateSubtraction,
  generateSumMany,
  generateSumLong,
  generateDiffMany,
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
// 资料实战（真实材料 + 程序生成的列式题）
import { generateMaterialReading } from "./material/reading";
import { generateDataLocating } from "./material/locate";
import { FORMULA_MODELS } from "./material/formula";

export type { TopicId } from "./catalog";
export type { GeneratedQuestion, Difficulty, MaterialSpec } from "./types";
export { topics, difficulties, legacyTopics, tracks, topicBudget, titleOf, topicById, difficultyRuns, difficultyBudgetMs, perQuestionBudgetSeconds };

type Generator = (r: Rng) => QuestionDraft | null;

const generators: Record<TopicId, Generator> = {
  addition: generateAddition,
  subtraction: generateSubtraction,
  "sum-many": generateSumMany,
  "sum-long": generateSumLong,
  "diff-many": generateDiffMany,
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
  "material-reading": generateMaterialReading,
  "data-locating": generateDataLocating,
  ...FORMULA_MODELS,
};

export function isCatalogTopic(id: string): id is TopicId {
  return topicById.has(id as TopicId);
}

/**
 * 标答是否被抄进了题干或材料。
 *
 * 只比「数字本体」：题干写「1240 亿元」、选项写「1240」不算泄漏（那本来就是已知量），
 * 所以判断依据是 **材料表格里是否有一格恰好等于答案**，或题干里出现「每项/每份/平均…= 答案」这类直给。
 * 阈值 2 位：10、25 这种小数字当已知量太常见，容易出现假阳性。
 */
function leaksAnswer(draft: QuestionDraft): boolean {
  if (!draft.material) return false;
  const answerText = draft.options[draft.answerIndex] ?? "";
  const answer = Number(answerText.replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(answer) || Math.abs(answer) < 10) return false;
  const same = (cell: string) => {
    const value = Number(String(cell).replace(/[^\d.-]/g, ""));
    return Number.isFinite(value) && value === answer;
  };
  return (draft.material.table?.rows ?? []).some((row) => row.some(same));
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
    // 硬校验：标答不能出现在题干/材料里。
    // 踩过的坑：divide 高难度材料把「每项 = 商」「余数」直接列进表格，等于把答案印在题面上；
    // 这类泄漏在生成器里静默通过，只有选手做题时才发现「不用算」。
    if (input.difficulty === "hard" && leaksAnswer(draft)) continue;
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
