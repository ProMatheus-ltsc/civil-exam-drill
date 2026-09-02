import { describe, expect, it } from "vitest";
import { initialProgress, scheduleReview } from "../src/essay/scheduler";

const now = new Date("2026-08-31T00:00:00.000Z");

describe("essay spaced repetition scheduler", () => {
  it("schedules remembered cards at 1, 3, then ease-based intervals", () => {
    const first = scheduleReview(initialProgress, "remembered", now);
    const second = scheduleReview(first, "remembered", now);
    const third = scheduleReview(second, "remembered", now);
    expect([
      first.intervalDays,
      second.intervalDays,
      third.intervalDays,
    ]).toEqual([1, 3, 8]);
    expect(third.rememberedCount).toBe(3);
  });

  it("resets a forgotten card and lowers ease without going below the floor", () => {
    const result = scheduleReview(
      { ...initialProgress, repetitions: 4, intervalDays: 12, ease: 1.35 },
      "forgot",
      now,
    );
    expect(result).toMatchObject({
      repetitions: 0,
      intervalDays: 1,
      ease: 1.3,
      forgotCount: 1,
    });
  });

  it("keeps hard cards on a short interval", () => {
    const result = scheduleReview(
      { ...initialProgress, repetitions: 2, intervalDays: 3 },
      "hard",
      now,
    );
    expect(result).toMatchObject({
      repetitions: 2,
      intervalDays: 4,
      ease: 2.25,
    });
  });
});
