import { describe, expect, it } from "vitest";
import { isReviewDue } from "../src/essay/queue";

describe("essay review queue", () => {
  const now = new Date("2026-08-31T12:00:00Z");
  it("includes unseen and due cards", () => {
    expect(isReviewDue(null, now)).toBe(true);
    expect(isReviewDue({ dueAt: "2026-08-31T11:59:59Z" }, now)).toBe(true);
  });
  it("excludes future cards", () => {
    expect(isReviewDue({ dueAt: "2026-09-01T12:00:00Z" }, now)).toBe(false);
  });
});
