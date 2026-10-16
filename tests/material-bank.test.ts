/** 「资料实战」材料库 schema 校验：保证每篇材料都能被三个生成器安全消费 */
import { describe, expect, it } from "vitest";
import { MATERIALS, materialById } from "../src/generator/material/data/materials";
import { kindFromMaterial } from "../src/generator/material/helpers";
import { generateQuestion } from "../src/generator";
import type { MaterialSpec } from "../src/generator/types";

/** 材料全文（正文 + 表 + 图 + 脚注），用于校验"数值确实写在材料里" */
function materialText(spec: MaterialSpec): string {
  const { paragraphs, table, chart, footnote } = spec;
  return [
    ...paragraphs,
    footnote ?? "",
    table ? [table.caption ?? "", ...table.headers, ...table.rows.flat()].join(" ") : "",
    chart ? [chart.unit, ...chart.categories, ...chart.series.flatMap((s) => [s.label, ...s.values.map(String)])].join(" ") : "",
  ].join(" ");
}

describe("资料实战材料库", () => {
  it("id 唯一且可作为查询键", () => {
    const ids = MATERIALS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(materialById.size).toBe(MATERIALS.length);
  });

  it("材料库足够支撑三个模块出题（≥8 篇）", () => {
    expect(MATERIALS.length).toBeGreaterThanOrEqual(8);
  });

  it.each(MATERIALS.map((m) => [m.id, m] as const))("%s 结构完整", (_id, entry) => {
    // 材料正文
    expect(entry.material.paragraphs.length).toBeGreaterThan(0);
    expect(entry.material.paragraphs.join("").length).toBeGreaterThan(20);
    expect(entry.source.length).toBeGreaterThan(0);
    expect(entry.topic.length).toBeGreaterThan(0);
    expect(entry.calibrated.length).toBeGreaterThan(0);

    // kind 必须与材料实际结构一致（否则「呈现形式」题会给出错误标答）
    expect(entry.kind, `${entry.id} 的 kind 与材料结构不符`).toBe(kindFromMaterial(entry.material));

    // 指标（材料阅读 + 数据定位）
    expect(entry.indicators.length).toBeGreaterThanOrEqual(2);
    for (const ind of entry.indicators) {
      expect(ind.name.length).toBeGreaterThan(0);
      expect(ind.where.length).toBeGreaterThan(0);
      expect(ind.ask.length).toBeGreaterThan(0);
    }

    // 可求量（列式训练）：每个都有 1 个正确算式 + 3 个互异且不等于正确的干扰
    expect(entry.computables.length).toBeGreaterThanOrEqual(1);
    for (const c of entry.computables) {
      expect(c.ask.length).toBeGreaterThan(0);
      expect(c.answer.length).toBeGreaterThan(0);
      expect(c.distractors).toHaveLength(3);
      expect(new Set(c.distractors).size).toBe(3);
      expect(c.distractors).not.toContain(c.answer);
      expect(c.basis.length).toBeGreaterThan(5);
    }

    // 干扰池（材料阅读）
    expect(entry.externalIndicators.length).toBeGreaterThanOrEqual(1);
    expect(entry.similarTopics.length).toBeGreaterThanOrEqual(3);
  });

  it.each(MATERIALS.map((m) => [m.id, m] as const))("%s 干扰项与正确项拼出 4 个互异选项", (_id, entry) => {
    for (const c of entry.computables) {
      const options = new Set([c.answer, ...c.distractors]);
      expect(options.size).toBe(4);
    }
    const topics = new Set([entry.topic, ...entry.similarTopics.slice(0, 3)]);
    expect(topics.size).toBe(4);
    const indicators = new Set([entry.externalIndicators[0], ...entry.indicators.slice(0, 3).map((i) => i.name)]);
    expect(indicators.size).toBe(4);
  });

  // ── 数值类指标（取数题 / 差值题的标答来源）────────────────────────────
  it.each(MATERIALS.map((m) => [m.id, m] as const))(
    "%s 的指标数值必须原文出现在材料中",
    (_id, entry) => {
      const text = materialText(entry.material);
      for (const ind of entry.indicators) {
        if (typeof ind.value !== "number") continue;
        expect(
          text.includes(String(ind.value)),
          `${entry.id}「${ind.name}」的 value=${ind.value} 未出现在材料里 → 会出现"标答与材料对不上"的错题`,
        ).toBe(true);
      }
    },
  );

  it.each(MATERIALS.map((m) => [m.id, m] as const))("%s 同篇指标数值互不重复", (_id, entry) => {
    const values = entry.indicators
      .filter((i) => typeof i.value === "number")
      .map((i) => i.value as number);
    expect(new Set(values).size, `${entry.id} 存在重复的指标数值`).toBe(values.length);
  });

  const VALID_CALIBERS = new Set(["同比", "环比", "累计", "年均"]);

  it("所有指标的时间口径都合法（不能是「占比」「差值」这类问法类型）", () => {
    for (const entry of MATERIALS) {
      for (const ind of entry.indicators) {
        if (!ind.caliber) continue;
        expect(
          VALID_CALIBERS.has(ind.caliber),
          `${entry.id}「${ind.name}」的口径非法：${ind.caliber}`,
        ).toBe(true);
      }
    }
  });

  it("口径题的标答必须是时间口径", () => {
    let checked = 0;
    for (let seed = 0; seed < 80; seed += 1) {
      const question = generateQuestion({
        topicId: "material-reading",
        difficulty: "hard",
        excludedFingerprints: [],
        randomSeed: `caliber-${seed}`,
      });
      if (question.templateId !== "material-caliber") continue;
      const answer = question.options[question.answerIndex];
      expect(VALID_CALIBERS.has(answer), `口径题标答非法：${question.stem} → ${answer}`).toBe(true);
      checked += 1;
    }
    expect(checked, "没有抽样到口径题").toBeGreaterThan(0);
  });

  it("每篇材料的数值型指标 ≥3 个（取数题 / 数值反查题的基础）", () => {    for (const entry of MATERIALS) {
      const nums = entry.indicators.filter((i) => typeof i.value === "number");
      expect(nums.length, `${entry.id} 数值型指标不足`).toBeGreaterThanOrEqual(3);
    }
  });

  it("材料库规模足够（≥20 篇，避免同一关内反复撞同一篇）", () => {
    expect(MATERIALS.length).toBeGreaterThanOrEqual(20);
  });

  // ── 生成的题目：标答必须可由材料校验（防止"找数题答非所料"）──────────
  it("取数题的标答直接来自材料原文", () => {
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      for (let seed = 0; seed < 12; seed += 1) {
        const question = generateQuestion({
          topicId: "data-locating",
          difficulty,
          excludedFingerprints: [],
          randomSeed: `bank-${difficulty}-${seed}`,
        });
        if (question.templateId !== "locate-value") continue;
        const material = question.material;
        expect(material, "locate-value 缺材料").toBeTruthy();
        const text = materialText(material!);
        const answer = question.options[question.answerIndex];
        expect(text.includes(answer), `标答 ${answer} 未出现在材料中：${question.stem}`).toBe(true);
      }
    }
  });

  it("数值反查题不给多解（该数值在本篇只对应一个指标）", () => {
    let checked = 0;
    for (const difficulty of ["medium", "hard"] as const) {
      for (let seed = 0; seed < 40; seed += 1) {
        const question = generateQuestion({
          topicId: "data-locating",
          difficulty,
          excludedFingerprints: [],
          randomSeed: `num-${difficulty}-${seed}`,
        });
        if (question.templateId !== "locate-number") continue;
        const entry = materialById.get(String(question.params.materialId))!;
        const value = Number(question.params.value);
        const answer = question.options[question.answerIndex];
        const sameValue = entry.indicators
          .filter((i) => i.value === value)
          .map((i) => i.name);
        expect(sameValue, `数值 ${value} 在本篇对应多个指标，题干会有多解`).toEqual([answer]);
        expect(new Set(question.options).size).toBe(4);
        checked += 1;
      }
    }
    expect(checked, "没有抽样到数值反查题").toBeGreaterThan(0);
  });

  it("「数据定位」的全部题型都不含运算（纯找数）", () => {
    const ALLOWED = new Set(["locate-value", "locate-number", "locate-forward", "locate-reverse"]);
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      for (let seed = 0; seed < 60; seed += 1) {
        const question = generateQuestion({
          topicId: "data-locating",
          difficulty,
          excludedFingerprints: [],
          randomSeed: `pure-${difficulty}-${seed}`,
        });
        expect(ALLOWED.has(question.templateId), `出现非找数题型：${question.templateId}`).toBe(true);
      }
    }
  });

  it("反向定位题的位置唯一（题干不会出现多个正确答案）", () => {
    let checked = 0;
    for (const difficulty of ["medium", "hard"] as const) {
      for (let seed = 0; seed < 40; seed += 1) {
        const question = generateQuestion({
          topicId: "data-locating",
          difficulty,
          excludedFingerprints: [],
          randomSeed: `rev-${difficulty}-${seed}`,
        });
        if (question.templateId !== "locate-reverse") continue;
        const entry = materialById.get(String(question.params.materialId))!;
        const where = String(question.params.where);
        const answer = question.options[question.answerIndex];
        const atWhere = entry.indicators.filter((i) => i.where === where).map((i) => i.name);
        expect(atWhere, `「${where}」有多个指标，题干会有多个正确答案`).toEqual([answer]);
        checked += 1;
      }
    }
    expect(checked, "没有抽样到反向定位题").toBeGreaterThan(0);
  });

  it("数值题（取数 / 反查）都产出 4 个互异选项与可读解析", () => {
    let checked = 0;
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      for (let seed = 0; seed < 40; seed += 1) {
        const question = generateQuestion({
          topicId: "data-locating",
          difficulty,
          excludedFingerprints: [],
          randomSeed: `quality-${difficulty}-${seed}`,
        });
        if (question.templateId !== "locate-value" && question.templateId !== "locate-number") continue;
        expect(new Set(question.options).size, `选项重复：${question.stem}`).toBe(4);
        expect(question.explanation.length).toBeGreaterThanOrEqual(25);
        expect(question.material, "数值题缺材料").toBeTruthy();
        checked += 1;
      }
    }
    expect(checked, "没有抽样到数值题").toBeGreaterThan(0);
  });
});
