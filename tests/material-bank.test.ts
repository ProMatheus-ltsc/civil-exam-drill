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

  it("数值型指标足够支撑取数题与差值题（每篇 ≥3 个、全库配对 ≥5 组）", () => {
    const TOTAL_WORDS = /总额|合计|总产量|总支出|总量|余额|全体|全国|一般/;
    let pairCount = 0;
    for (const entry of MATERIALS) {
      const nums = entry.indicators.filter((i) => typeof i.value === "number");
      expect(nums.length, `${entry.id} 数值型指标不足`).toBeGreaterThanOrEqual(3);

      const pool = nums.filter((i) => i.unit && i.unit !== "%" && !TOTAL_WORDS.test(i.name));
      for (let a = 0; a < pool.length; a += 1) {
        for (let b = a + 1; b < pool.length; b += 1) {
          const sameTable = pool[a].where.includes("表格") && pool[b].where.includes("表格");
          if (pool[a].unit === pool[b].unit && (pool[a].where === pool[b].where || sameTable)) {
            pairCount += 1;
          }
        }
      }
    }
    expect(pairCount, "可配对（差值题）的指标组太少").toBeGreaterThanOrEqual(5);
  });

  // ── 生成的题目：标答必须可由材料校验（防止"找数题答非所料"）──────────
  const numbersIn = (text: string) =>
    [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const asMoney = (value: number) => Math.round(value * 100) / 100;

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

  it("差值题的标答等于材料中某两个数之差", () => {
    let checked = 0;
    for (const difficulty of ["medium", "hard"] as const) {
      for (let seed = 0; seed < 30; seed += 1) {
        const question = generateQuestion({
          topicId: "data-locating",
          difficulty,
          excludedFingerprints: [],
          randomSeed: `diff-${difficulty}-${seed}`,
        });
        if (question.templateId !== "locate-diff") continue;
        const material = question.material!;
        const numbers = numbersIn(materialText(material));
        const answer = Number(question.options[question.answerIndex]);
        const derivable = numbers.some((hi) =>
          numbers.some((lo) => asMoney(hi - lo) === asMoney(answer)),
        );
        expect(derivable, `标答 ${answer} 无法由材料推出：${question.stem}`).toBe(true);
        // 干扰项里应当摆着"两个主体各自的数"（专治取错主体）
        const inMaterial = question.options.filter((option) =>
          numbers.includes(Number(option)),
        ).length;
        expect(inMaterial, `差值题缺少"取错主体"干扰项：${question.stem}`).toBeGreaterThanOrEqual(2);
        checked += 1;
      }
    }
    expect(checked, "没有抽样到差值题").toBeGreaterThan(0);
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

  it("差值题与取数题都产出 4 个互异选项与可读解析", () => {
    let checked = 0;
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      for (let seed = 0; seed < 40; seed += 1) {
        const question = generateQuestion({
          topicId: "data-locating",
          difficulty,
          excludedFingerprints: [],
          randomSeed: `quality-${difficulty}-${seed}`,
        });
        if (question.templateId !== "locate-diff" && question.templateId !== "locate-value") continue;
        expect(new Set(question.options).size, `选项重复：${question.stem}`).toBe(4);
        expect(question.explanation.length).toBeGreaterThanOrEqual(25);
        expect(question.material, "数值题缺材料").toBeTruthy();
        checked += 1;
      }
    }
    expect(checked, "没有抽样到数值题").toBeGreaterThan(0);
  });
});
