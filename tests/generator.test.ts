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
        if (["arithmetic", "multiply", "divide"].includes(topic.id)) {
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
