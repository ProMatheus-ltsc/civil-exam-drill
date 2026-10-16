/** 「资料实战」材料库 schema 校验：保证每篇材料都能被三个生成器安全消费 */
import { describe, expect, it } from "vitest";
import { MATERIALS, materialById } from "../src/generator/material/data/materials";

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
});
