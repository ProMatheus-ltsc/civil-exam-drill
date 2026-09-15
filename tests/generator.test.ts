import { describe, expect, it } from "vitest";
import {
  difficulties,
  generateQuestion,
  topics,
  titleOf,
} from "../src/generator";

describe("question generator", () => {
  for (const topic of topics) {
    for (const difficulty of difficulties) {
      it(`${topic.id}/${difficulty.id} is deterministic and valid`, () => {
        const first = generateQuestion({
          topicId: topic.id,
          difficulty: difficulty.id,
          excludedFingerprints: [],
          randomSeed: "fixed",
        });
        const second = generateQuestion({
          topicId: topic.id,
          difficulty: difficulty.id,
          excludedFingerprints: [],
          randomSeed: "fixed",
        });
        expect(first).toEqual(second);
        expect(new Set(first.options).size).toBe(4);
        expect(first.answerIndex).toBeGreaterThanOrEqual(0);
        expect(first.answerIndex).toBeLessThan(4);
        expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(first.explanation.length).toBeGreaterThanOrEqual(25);
        if (topic.material) {
          expect(first.material).not.toBeNull();
          expect(first.material?.paragraphs.length).toBeGreaterThan(0);
          expect(first.material?.paragraphs.join("").length).toBeGreaterThan(10);
        }
      });
    }
  }

  it("skips a recent duplicate", () => {
    const first = generateQuestion({
      topicId: "growth-rate",
      difficulty: "hard",
      excludedFingerprints: [],
      randomSeed: "fixed",
    });
    const next = generateQuestion({
      topicId: "growth-rate",
      difficulty: "hard",
      excludedFingerprints: [first.fingerprint],
      randomSeed: "fixed",
    });
    expect(next.fingerprint).not.toBe(first.fingerprint);
  });

  it.each(topics)("$title provides multiple question models", (topic) => {
    const generated = Array.from({ length: 30 }, (_, index) =>
      generateQuestion({
        topicId: topic.id,
        difficulty: "medium",
        excludedFingerprints: [],
        randomSeed: `coverage-${index}`,
      }),
    );
    expect(
      new Set(generated.map((question) => question.templateId)).size,
    ).toBeGreaterThanOrEqual(2);
  });

  it("hard runs of every speed module ship a context material; sequences stay pure", () => {
    for (const topic of topics) {
      for (let seed = 0; seed < 12; seed += 1) {
        const question = generateQuestion({
          topicId: topic.id,
          difficulty: "hard",
          excludedFingerprints: [],
          randomSeed: `combat-${topic.id}-${seed}`,
        });
        if (topic.track === "speed") {
          expect(
            question.material?.paragraphs.length,
            `${topic.id} 高难度应附材料`,
          ).toBeGreaterThan(0);
          const materialText = [
            ...(question.material?.paragraphs ?? []),
            ...(question.material?.table?.rows.flat() ?? []),
          ].join(" ");
          // 不泄漏原始参数名/占位标签
          expect(materialText).not.toMatch(/数值一|指标 A|第 \d+ 项数值|denominator|numerator|surplus|params/);
        } else {
          expect(question.material).toBeNull();
        }
        if (
          ["addition", "subtraction", "sum-many", "diff-many", "multiply", "divide"].includes(
            topic.id,
          )
        ) {
          expect(question.stem).not.toContain("不使用计算器");
          expect(question.stem.length).toBeGreaterThanOrEqual(20);
        }
      }
    }
  });

  it("multiply questions lock the trailing digit of every option", () => {
    for (let seed = 0; seed < 60; seed += 1) {
      for (const difficulty of difficulties) {
        const question = generateQuestion({
          topicId: "multiply",
          difficulty: difficulty.id,
          excludedFingerprints: [],
          randomSeed: `tail-${difficulty.id}-${seed}`,
        });
        const units = question.options.map((option) => option.slice(-1));
        expect(new Set(units).size).toBe(1);
      }
    }
  });

  /**
   * 加法/减法/多项求和/多项求差是纯算数题：题干里的算式就是答案本身，
   * 这一条不变量比「选项互异」硬得多——取值区间写错（比如减数大于被减数）、
   * 选项出现负数、把答案和选项写岔了，都会在这里暴露。
   */
  it("计算功底四关：答案等于算式本身，且选项里没有负数", () => {
    const evaluate = (expression: string) =>
      (expression.match(/[+-]?\s*\d+(?:\.\d+)?/g) ?? []).reduce(
        (sum, token) => sum + Number(token.replace(/\s+/g, "")),
        0,
      );
    for (const topicId of ["addition", "subtraction", "sum-many", "diff-many"] as const) {
      for (const difficulty of difficulties) {
        for (let seed = 0; seed < 80; seed += 1) {
          const question = generateQuestion({
            topicId,
            difficulty: difficulty.id,
            excludedFingerprints: [],
            randomSeed: `arithmetic-${seed}`,
          });
          const expression = String(question.params.expression);
          const answer = evaluate(expression);
          const where = `${topicId}/${difficulty.id} seed=${seed}：「${expression}」`;
          expect(Number(question.params.answer), where).toBe(answer);
          expect(Number(question.options[question.answerIndex]), where).toBe(answer);
          expect(question.options.every((option) => /^\d+$/.test(option)), where).toBe(true);
        }
      }
    }
  });

  /**
   * 高难题会被真题化改写成材料题（speed/scenario.ts）。这里钉两个踩过的坑：
   * 1. 用 /-?\d+/ 解析算式会把减号吃进数字里，题干和表格出现「2023 年为 -1955 亿元」
   *    「教育支出 -142 亿元」——本地 mock 出的是假题干，页面上看不出来，只有真生成器才暴露；
   * 2. 5 项求和的材料标签只给了 4 个季度，第 5 项退化成「第 5 阶段」且柱状图少一根。
   */
  it("高难材料题：材料里不出现负数，且每一项都有标签与柱子", () => {
    for (const topicId of ["addition", "subtraction", "sum-many", "diff-many"] as const) {
      for (let seed = 0; seed < 40; seed += 1) {
        const question = generateQuestion({
          topicId,
          difficulty: "hard",
          excludedFingerprints: [],
          randomSeed: `combat-${seed}`,
        });
        const text = [
          question.stem,
          ...(question.material?.paragraphs ?? []),
          ...(question.material?.table?.rows.flat() ?? []),
        ].join(" ");
        expect(text, `${topicId} seed=${seed}：${text}`).not.toMatch(/[−-]\s*\d/);
        if (topicId === "addition" || topicId === "sum-many") {
          const terms = String(question.params.expression).split("+").length;
          const where = `${topicId} seed=${seed}（${terms} 项）`;
          expect(question.material?.table?.rows.length, where).toBe(terms);
          expect(question.material?.chart?.categories.length, where).toBe(terms);
        }
      }
    }
  });

  it("sequence topics map to knowledge docs and keep numeric stems", () => {
    for (const topic of topics.filter((t) => t.track === "sequence")) {
      expect(topic.docId).toBeTruthy();
      const question = generateQuestion({
        topicId: topic.id,
        difficulty: "medium",
        excludedFingerprints: [],
        randomSeed: "seq-check",
      });
      expect(question.stem).toContain("（ ）");
      expect(question.stem).toContain("、");
      expect(titleOf(topic.id)).toBe(topic.title);
    }
  });
});
