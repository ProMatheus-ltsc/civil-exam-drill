/**
 * 「资料实战 · 基期比重」三种写法都要考。
 *
 * 背景：这一关曾经只出「分子分母各自还原到基期」一种写法——练十道等于练一道，
 * 而真题里连乘式（A/B×(1+b)/(1+a)）和差值式（现期比重−两期比重差）才是主流。
 * 改成三路之后，这里锁三件事：
 *   1. 三条路线都出得到（各占约 1/3，不能退化成只出定义式）；
 *   2. 标答形态与路线一致（防止「换了标签、还是那一条式子」）；
 *   3. 选项里不出现另一条**等价且同样正确**的写法——否则这道题考的是「猜出题人」，
 *      而不是「认出公式」，做题人做对也学不到东西。
 */
import { describe, expect, it } from "vitest";
import { generateQuestion } from "../src/generator";
import type { QuestionDraft } from "../src/generator/types";

const TOPIC = "formula-base-ratio" as const;

/** 三种写法在选项里的形态（只认结构，不认具体数字） */
const SHAPES: Record<string, RegExp> = {
  // 定义式：(A÷(1+a))÷(B÷(1+b))
  "formula-base-ratio": /^\(\d+÷\(1\+\d+(?:\.\d+)?%\)\)÷\(\d+÷\(1\+\d+(?:\.\d+)?%\)\)$/,
  // 连乘式：(A÷B)×(1+b)÷(1+a)
  "formula-base-ratio-product": /^\(\d+÷\d+\)×\(1\+\d+(?:\.\d+)?%\)÷\(1\+\d+(?:\.\d+)?%\)$/,
  // 差值式：(A÷B)−(A÷B)×(a−b)÷(1+a)
  "formula-base-ratio-shift":
    /^\(\d+÷\d+\)−\(\d+÷\d+\)×\(\d+(?:\.\d+)?%−\d+(?:\.\d+)?%\)÷\(1\+\d+(?:\.\d+)?%\)$/,
};

function samples(count = 150, difficulty: "easy" | "medium" | "hard" = "medium"): QuestionDraft[] {
  return Array.from({ length: count }, (_, index) =>
    generateQuestion({
      topicId: TOPIC,
      difficulty,
      excludedFingerprints: [],
      randomSeed: `base-ratio-routes-${difficulty}-${index}`,
    }),
  );
}

describe("资料实战·基期比重：三种写法", () => {
  it("三条路线都出得到，且没有哪一条独大", () => {
    const tally = new Map<string, number>();
    for (const question of samples()) {
      tally.set(question.templateId, (tally.get(question.templateId) ?? 0) + 1);
    }
    for (const [templateId, shape] of Object.entries(SHAPES)) {
      expect(shape, `未知路线 ${templateId}`).toBeTruthy();
      const hits = tally.get(templateId) ?? 0;
      // 150 题每条约 50 题；留足余量只要求落在 20~90，能抓住「某一路被饿死」和「某一路吃满」
      expect(hits, `路线 ${templateId} 出题数异常（实际 ${hits}，全部：${[...tally]}）`).toBeGreaterThan(20);
      expect(hits, `路线 ${templateId} 出题过多（实际 ${hits}）`).toBeLessThan(90);
    }
    expect(
      [...tally.keys()].filter((id) => !(id in SHAPES)),
      `出现了未登记的模板：${[...tally.keys()].join(", ")}`,
    ).toEqual([]);
  });

  it("标答形态与路线一致，且选项里没有第二条等价写法", () => {
    for (const question of samples(200)) {
      const shape = SHAPES[question.templateId];
      expect(shape, `未知路线：${question.templateId}`).toBeTruthy();
      const answer = question.options[question.answerIndex];
      expect(shape.test(answer), `${question.templateId} 的标答形态不符：${answer}`).toBe(true);

      // 另一条等价写法一旦混进选项，就成了「也正确但被判错」的坑
      for (const [otherId, otherShape] of Object.entries(SHAPES)) {
        if (otherId === question.templateId) continue;
        const leaked = question.options.filter(
          (option) => option !== answer && otherShape.test(option),
        );
        expect(leaked, `${question.templateId} 的选项里混入了 ${otherId} 的等价写法`).toEqual([]);
      }

      // 四项互异、没有「其它（n）」占位（占位说明某条干扰项与标答撞了）
      expect(new Set(question.options).size, `选项重复：${question.options.join(" / ")}`).toBe(4);
      expect(question.options.join(" / ")).not.toContain("其它（");
    }
  });

  it("解析把三种写法的关系讲出来，并点名干扰项错在哪", () => {
    for (const question of samples(120)) {
      expect(question.explanation.length, `解析过短：${question.explanation}`).toBeGreaterThan(60);
      // 每条解析都要交代「同一个答案还有别的写法」，否则做题人以为只有一种列法
      expect(
        /(三式恒等|另两种等价写法|还有两种写法)/.test(question.explanation),
        `解析没交代三种写法的关系：${question.explanation}`,
      ).toBe(true);
      expect(question.explanation, `解析没提到错项来源：${question.explanation}`).toMatch(/错法|错项/);
    }
  });

  it("材料恒给两个增速、题干恒问基期（三种写法的题面必须是同一件事）", () => {
    for (const question of samples(120)) {
      const text = question.material?.paragraphs.join("") ?? "";
      expect([...text.matchAll(/比上年增长\s*\d+(?:\.\d+)?%/g)].length, `材料增速不足两个：${text}`).toBe(2);
      expect(question.stem).toMatch(/年该市.+占.+的比重/);
      const year = Number(question.material?.paragraphs[0]?.match(/\d{4}\s*年/)?.[0]?.replace(/\D/g, ""));
      expect(question.stem, `题干问的不是上年（基期）：${question.stem}`).toContain(String(year - 1));
    }
  });
});
