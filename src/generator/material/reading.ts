/**
 * 「材料阅读」生成器：不给问题，考察对材料**结构与口径**的把握。
 * 低难度：材料主题 / 呈现形式；中难度：指标清单 / 单位；高难度：时间口径。
 */
import type { QuestionDraft, Rng } from "../types";
import { pickEntry, kindOptions, unitOptions, caliberOptions, shuffle, withMaterial } from "./helpers";

export function generateMaterialReading(r: Rng): QuestionDraft | null {
  const entry = pickEntry(r);
  if (!entry.indicators.length) return null;

  if (r.level === 1) {
    return r.random() < 0.5 ? topicQuestion(r, entry) : kindQuestion(r, entry);
  }
  if (r.level === 2) {
    return r.random() < 0.5 ? indicatorsQuestion(r, entry) : unitQuestion(r, entry);
  }
  return caliberQuestion(r, entry);
}

/** 材料主题 */
function topicQuestion(r: Rng, entry: ReturnType<typeof pickEntry>): QuestionDraft {
  const distractors = entry.similarTopics.slice(0, 3);
  const { options, answerIndex } = shuffle(entry.topic, distractors, r.random);
  return withMaterial(entry, {
    templateId: "material-topic",
    params: { materialId: entry.id, answer: entry.topic },
    stem: "这段材料主要围绕下列哪一主题展开？",
    options,
    answerIndex,
    explanation: `通读材料可见，全篇数据均围绕「${entry.topic}」展开；其余选项只是同类主题，材料并未涉及，属于脱离材料的干扰项。`,
  });
}

/** 呈现形式 */
function kindQuestion(r: Rng, entry: ReturnType<typeof pickEntry>): QuestionDraft {
  const { options, answerIndex } = kindOptions(entry, r.random);
  return withMaterial(entry, {
    templateId: "material-kind",
    params: { materialId: entry.id, kind: entry.kind },
    stem: "该材料的数据呈现形式是？",
    options,
    answerIndex,
    explanation: `材料由${entry.material.paragraphs.length}段文字${entry.material.table ? "、一张表格" : ""}${entry.material.chart ? "、一张图表" : ""}组成，属于${entry.kind === "mixed" ? "文字+图表综合型" : entry.kind === "text" ? "文字型" : entry.kind === "table" ? "表格型" : "图表型"}，先看形式再定位数据能显著提速。`,
  });
}

/** 未涉及的指标 */
function indicatorsQuestion(r: Rng, entry: ReturnType<typeof pickEntry>): QuestionDraft | null {
  const external = entry.externalIndicators[0];
  if (!external) return null;
  const inside = entry.indicators.map((i) => i.name).slice(0, 3);
  const { options, answerIndex } = shuffle(external, inside, r.random);
  return withMaterial(entry, {
    templateId: "material-indicators",
    params: { materialId: entry.id, answer: external },
    stem: "下列指标中，材料中未涉及的是？",
    options,
    answerIndex,
    explanation: `材料中出现的是${inside.map((n) => `「${n}」`).join("、")}等指标；「${external}」在全篇均未提及，属于同类但材料之外的干扰项。`,
  });
}

/** 单位识别 */
function unitQuestion(r: Rng, entry: ReturnType<typeof pickEntry>): QuestionDraft | null {
  const withUnit = entry.indicators.filter((i) => i.unit && i.unit !== "%");
  if (!withUnit.length) return null;
  const target = r.pick(withUnit);
  const { options, answerIndex } = unitOptions(target.unit as string, r.random);
  return withMaterial(entry, {
    templateId: "material-unit",
    params: { materialId: entry.id, indicator: target.name, answer: target.unit as string },
    stem: `材料中「${target.name}」的数据单位是？`,
    options,
    answerIndex,
    explanation: `「${target.name}」位于${target.where}，其数值单位为${target.unit}；读材料时先记住单位，可避免把不同口径的数据混用。`,
  });
}

/** 时间口径识别 */
function caliberQuestion(r: Rng, entry: ReturnType<typeof pickEntry>): QuestionDraft | null {
  const withCaliber = entry.indicators.filter((i) => i.caliber);
  if (!withCaliber.length) return null;
  const target = r.pick(withCaliber);
  const { options, answerIndex } = caliberOptions(target.caliber as string, r.random);
  return withMaterial(entry, {
    templateId: "material-caliber",
    params: { materialId: entry.id, indicator: target.name, answer: target.caliber as string },
    stem: `材料中「${target.name}」对应数据的时间口径是？`,
    options,
    answerIndex,
    explanation: `「${target.name}」在${target.where}，其口径为${target.caliber}（本材料整体口径：${entry.calibrated}）。口径认错是资料分析最常见的失分点。`,
  });
}
