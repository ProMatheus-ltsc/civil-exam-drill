/**
 * 申论 21 天闯关的关卡定义守卫。
 *
 * 关卡是「一次定义、多处消费」：关卡图（前端）、接口校验（functions）、进度表（level_id）都吃这份定义。
 * 这里钉住的是内容结构与解锁链——漏一关、清单少一条、docId 写错、星级口径改错，都会在这里暴露，
 * 而不是等到页面上出现一个点不开的「查看讲解」或者永远打不开的关卡才发现。
 */
import { describe, expect, it } from "vitest";
import { loadEntries } from "../scripts/content/lib.mjs";
import {
  ESSAY_LEVELS,
  ESSAY_STAGES,
  essayMinutes,
  essayPreviousLevel,
  essayStars,
  essayUnlocked,
} from "../src/essay/training";

describe("申论 21 天闯关：关卡定义", () => {
  it("恰好 21 关，Day 1~21 各一关且顺序一致", () => {
    expect(ESSAY_LEVELS).toHaveLength(21);
    expect(ESSAY_LEVELS.map((level) => level.day)).toEqual(
      Array.from({ length: 21 }, (_, index) => index + 1),
    );
  });

  it("id 唯一、形如 essay-dayNN，且与 Day 对应", () => {
    const ids = ESSAY_LEVELS.map((level) => level.id);
    expect(new Set(ids).size).toBe(ids.length);
    const wrong = ESSAY_LEVELS.filter(
      (level) => level.id !== `essay-day${String(level.day).padStart(2, "0")}`,
    ).map((level) => `${level.id}（Day ${level.day}）`);
    expect(wrong).toEqual([]);
  });

  it("六个阶段连续覆盖 Day 1~21", () => {
    expect(ESSAY_STAGES.map((stage) => stage.id)).toEqual([
      "cognition",
      "reading",
      "core",
      "article",
      "document",
      "sprint",
    ]);
    let cursor = 1;
    for (const stage of ESSAY_STAGES) {
      expect(stage.from, `${stage.title} 起点应接上一阶段`).toBe(cursor);
      cursor = stage.to + 1;
    }
    expect(cursor - 1).toBe(21);
    // 每关都落在某个阶段的天数区间里
    const orphan = ESSAY_LEVELS.filter(
      (level) =>
        !ESSAY_STAGES.some(
          (stage) => stage.id === level.stage && level.day >= stage.from && level.day <= stage.to,
        ),
    ).map((level) => level.id);
    expect(orphan).toEqual([]);
  });

  it("每关都有训练目标、核心要点、实操任务与 10 条自评清单", () => {
    const problems = ESSAY_LEVELS.flatMap((level) => {
      const issues: string[] = [];
      if (level.goal.trim().length < 12) issues.push("目标太短");
      if (level.points.length < 4) issues.push("要点少于 4 条");
      if (level.tasks.length < 2) issues.push("任务少于 2 个");
      if (level.tasks.some((task) => !task.title.trim() || !task.output.trim() || task.minutes <= 0))
        issues.push("任务缺标题/交付物/用时");
      // 10 条清单：星级阈值（80%/90%/100%）才有干净的整数分界
      if (level.checklist.length !== 10) issues.push(`清单 ${level.checklist.length} 条`);
      if (level.checklist.some((item) => item.trim().length < 6)) issues.push("清单项太短");
      if (new Set(level.checklist).size !== level.checklist.length) issues.push("清单有重复项");
      return issues.map((issue) => `${level.id}：${issue}`);
    });
    expect(problems).toEqual([]);
  });

  it("docId 都指向 essay 知识库里真实存在的文档", async () => {
    const { entries, errors } = await loadEntries();
    expect(errors).toEqual([]);
    const essayDocs = new Map(
      entries.filter((entry) => entry.module === "essay").map((entry) => [entry.id, entry]),
    );
    const broken = ESSAY_LEVELS.filter((level) => !essayDocs.has(level.docId)).map(
      (level) => `${level.id} → ${level.docId}`,
    );
    expect(broken).toEqual([]);
  });

  it("难度档只增不减（循序渐进）", () => {
    const drops = ESSAY_LEVELS.filter(
      (level, index) => index > 0 && level.rating < ESSAY_LEVELS[index - 1].rating,
    ).map((level) => `Day ${level.day}`);
    expect(drops).toEqual([]);
    expect(ESSAY_LEVELS[0].rating).toBe(1);
    expect(ESSAY_LEVELS[ESSAY_LEVELS.length - 1].rating).toBe(3);
  });

  it("预计用时等于各任务用时之和", () => {
    for (const level of ESSAY_LEVELS) {
      const sum = level.tasks.reduce((total, task) => total + task.minutes, 0);
      expect(essayMinutes(level), level.id).toBe(sum);
      expect(essayMinutes(level), level.id).toBeGreaterThan(30);
    }
  });

  it("解锁链：首关是入口，其余关卡要求上一关通关", () => {
    const never = () => 0;
    expect(essayUnlocked("essay-day01", never)).toBe(true);
    expect(
      ESSAY_LEVELS.slice(1).filter((level) => essayUnlocked(level.id, never)),
    ).toEqual([]);
    // 第 N 关只认第 N-1 关的星级
    const stars = new Map([["essay-day01", 1]]);
    const starsOf = (id: string) => stars.get(id) ?? 0;
    expect(essayUnlocked("essay-day02", starsOf)).toBe(true);
    expect(essayUnlocked("essay-day03", starsOf)).toBe(false);
    expect(essayPreviousLevel(ESSAY_LEVELS[0])).toBeNull();
    expect(essayPreviousLevel(ESSAY_LEVELS[1])?.id).toBe("essay-day01");
  });

  it("星级口径：≥80% 一星通关、≥90% 二星、全中三星", () => {
    expect(essayStars(0, 10)).toBe(0);
    expect(essayStars(7, 10)).toBe(0);
    expect(essayStars(8, 10)).toBe(1);
    expect(essayStars(9, 10)).toBe(2);
    expect(essayStars(10, 10)).toBe(3);
    expect(essayStars(0, 0)).toBe(0);
  });
});
