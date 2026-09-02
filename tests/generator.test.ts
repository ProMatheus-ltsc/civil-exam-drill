import { describe, expect, it } from "vitest";
import { difficulties, generateQuestion, topics } from "../src/generator";

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
      });
    }
  }

  it("skips a recent duplicate", () => {
    const first = generateQuestion({
      topicId: "growth",
      difficulty: "hard",
      excludedFingerprints: [],
      randomSeed: "fixed",
    });
    const next = generateQuestion({
      topicId: "growth",
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
    expect(
      generated.every((question) => question.explanation.length >= 25),
    ).toBe(true);
  });
});
