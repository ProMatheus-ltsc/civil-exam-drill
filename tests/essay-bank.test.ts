/**
 * 申论客观题库与通关规则的守卫。
 *
 * 题库是「一次定义、两处消费」：关卡下发（接口）与判分（服务端）。这里的守卫分三层：
 *   1. 内容结构——每关都有题、四选一、答案合法、解析齐备（写漏一关、选项手滑都会红）；
 *   2. 下发口径——只发题干选项不发答案、题序与选项顺序打乱但确定、key 是原始下标（判分只认 key）；
 *   3. 判分与星级——完整性校验、对错判定、客观题硬门槛（答对不足 80% 时清单勾满也不通关）。
 */
import { describe, expect, it } from "vitest";
import {
  ESSAY_QUESTIONS,
  ESSAY_QUIZ_SIZE,
  essayPoolOf,
  essayQuestionById,
  essayQuizIds,
  essayQuizIssue,
  essayQuizOf,
  gradeEssayQuiz,
} from "../src/essay/bank";
import { ESSAY_LEVELS } from "../src/essay/training";
import { essayQuizPassLine, essayStars } from "../src/essay/rules";

const LEVEL = "essay-day01";

describe("申论客观题库：内容结构", () => {
  it("21 关每关都有题，且不存在孤儿题目", () => {
    const missing = ESSAY_LEVELS.filter((level) => essayPoolOf(level.id).length === 0).map(
      (level) => level.id,
    );
    expect(missing).toEqual([]);
    const known = new Set(ESSAY_LEVELS.map((level) => level.id));
    const orphans = [...new Set(ESSAY_QUESTIONS.map((question) => question.levelId))].filter(
      (levelId) => !known.has(levelId),
    );
    expect(orphans).toEqual([]);
  });

  it("每关至少 5 道（下发量），本库统一 6 道", () => {
    const thin = ESSAY_LEVELS.filter(
      (level) => essayPoolOf(level.id).length < ESSAY_QUIZ_SIZE,
    ).map((level) => `${level.id}：${essayPoolOf(level.id).length} 道`);
    expect(thin).toEqual([]);
  });

  it("id 唯一、形如 essay-dayNN-qN，且与所属关卡对应", () => {
    const ids = ESSAY_QUESTIONS.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
    const wrong = ESSAY_LEVELS.flatMap((level) =>
      essayPoolOf(level.id)
        .map((question, index) => (question.id === `${level.id}-q${index + 1}` ? null : question.id))
        .filter((id): id is string => Boolean(id)),
    );
    expect(wrong).toEqual([]);
    expect(ESSAY_QUESTIONS.every((question) => essayQuestionById.get(question.id) === question)).toBe(
      true,
    );
  });

  it("四选一、选项非空且组内不重复、答案下标合法", () => {
    const problems = ESSAY_QUESTIONS.flatMap((question) => {
      const issues: string[] = [];
      if (question.options.length !== 4) issues.push(`选项 ${question.options.length} 个`);
      if (question.options.some((option) => !option.trim())) issues.push("有空选项");
      if (new Set(question.options).size !== question.options.length) issues.push("选项重复");
      if (
        !Number.isInteger(question.answer) ||
        question.answer < 0 ||
        question.answer >= question.options.length
      )
        issues.push(`答案下标 ${question.answer} 越界`);
      return issues.map((issue) => `${question.id}：${issue}`);
    });
    expect(problems).toEqual([]);
  });

  it("题干、考点标签与解析都写全了", () => {
    const problems = ESSAY_QUESTIONS.flatMap((question) => {
      const issues: string[] = [];
      if (question.stem.trim().length < 8) issues.push("题干太短");
      if (!question.tag.trim()) issues.push("缺考点标签");
      // 解析要讲清为什么，两三个字的「见教材」不算
      if (question.explanation.trim().length < 15) issues.push("解析太短");
      return issues.map((issue) => `${question.id}：${issue}`);
    });
    expect(problems).toEqual([]);
  });

  it("同一关内题干不重复", () => {
    const duplicated = ESSAY_LEVELS.flatMap((level) => {
      const stems = essayPoolOf(level.id).map((question) => question.stem);
      return new Set(stems).size === stems.length ? [] : [level.id];
    });
    expect(duplicated).toEqual([]);
  });
});

describe("申论客观题库：下发口径", () => {
  it("每次下发 5 道，且都属本关", () => {
    for (const level of ESSAY_LEVELS) {
      const quiz = essayQuizOf(level.id);
      expect(quiz, level.id).toHaveLength(ESSAY_QUIZ_SIZE);
      expect(quiz.every((item) => essayQuestionById.get(item.id)?.levelId === level.id)).toBe(true);
      expect(new Set(quiz.map((item) => item.id)).size).toBe(quiz.length);
      expect(essayQuizIds(level.id)).toEqual(quiz.map((item) => item.id));
    }
  });

  it("题面与选项顺序打乱但确定：同关两次下发完全一致", () => {
    for (const level of ESSAY_LEVELS) {
      expect(JSON.stringify(essayQuizOf(level.id))).toBe(JSON.stringify(essayQuizOf(level.id)));
    }
  });

  it("选项 key 是原始下标的排列，因此打乱不影响判分", () => {
    const shuffledSomewhere = ESSAY_LEVELS.some((level) =>
      essayQuizOf(level.id).some((item) => {
        const raw = essayQuestionById.get(item.id) as { options: string[] };
        return item.options.some((option, index) => option.key !== index || option.text !== raw.options[option.key]);
      }),
    );
    expect(shuffledSomewhere).toBe(true);
    const bad = essayQuizOf(LEVEL).filter((item) => {
      const keys = item.options.map((option) => option.key).sort((a, b) => a - b);
      return JSON.stringify(keys) !== JSON.stringify([0, 1, 2, 3]);
    });
    expect(bad).toEqual([]);
  });

  it("下发数据里不含答案与解析（作弊面为零）", () => {
    for (const level of ESSAY_LEVELS) {
      const text = JSON.stringify(essayQuizOf(level.id));
      expect(text, level.id).not.toContain("answer");
      expect(text, level.id).not.toContain("explanation");
      expect(text, level.id).not.toContain("解析");
    }
  });
});

describe("申论客观题库：完整性校验与判分", () => {
  const full = (levelId: string, key: (id: string) => number) =>
    essayQuizOf(levelId).map((item) => ({ id: item.id, key: key(item.id) }));

  it("少答、重复、跨关、越界都会被挡下", () => {
    const served = essayQuizOf(LEVEL);
    expect(essayQuizIssue(LEVEL, [])).toContain("未作答");
    expect(essayQuizIssue(LEVEL, [{ id: served[0].id, key: 0 }])).toContain("未作答");
    const ok = full(LEVEL, () => 0);
    expect(essayQuizIssue(LEVEL, ok)).toBeNull();
    expect(essayQuizIssue(LEVEL, [...ok, ok[0]])).toBe("同一道题重复作答");
    expect(essayQuizIssue(LEVEL, [...ok.slice(1), { id: "essay-day02-q1", key: 0 }])).toContain(
      "不属于本关",
    );
    expect(essayQuizIssue(LEVEL, [...ok.slice(1), { id: ok[0].id, key: 9 }])).toContain("越界");
  });

  it("判分：按原始下标比对，答错/漏答都算错", () => {
    // 先故意全答 0，拿到每题的正确下标
    const probe = gradeEssayQuiz(LEVEL, full(LEVEL, () => 0));
    expect(probe.total).toBe(ESSAY_QUIZ_SIZE);
    expect(probe.marks).toHaveLength(ESSAY_QUIZ_SIZE);
    expect(probe.marks.every((mark) => mark.explanation.trim().length > 0)).toBe(true);

    // 用回传的正确答案下标作答 → 满分（说明「提交原始下标」这条口径是自洽的）
    const perfect = gradeEssayQuiz(
      LEVEL,
      full(LEVEL, (id) => (probe.marks.find((mark) => mark.id === id) as { answerKey: number }).answerKey),
    );
    expect(perfect.correct).toBe(ESSAY_QUIZ_SIZE);
    expect(perfect.marks.every((mark) => mark.correct)).toBe(true);

    // 全答同一个选项：至少错若干道，且不会误判成满分
    if (new Set(probe.marks.map((mark) => mark.answerKey)).size > 1) {
      const wrong = gradeEssayQuiz(LEVEL, full(LEVEL, () => 0));
      expect(wrong.correct).toBeLessThan(ESSAY_QUIZ_SIZE);
      expect(wrong.marks.filter((mark) => !mark.correct).length).toBeGreaterThan(0);
    }

    // 漏答即错（不提交就等于没答对）
    expect(gradeEssayQuiz(LEVEL, []).correct).toBe(0);
  });
});

describe("申论通关规则：客观题权重与硬门槛", () => {
  it("客观题及格线是 80%（5 题即 4 题）", () => {
    expect(essayQuizPassLine(5)).toBe(4);
    expect(essayQuizPassLine(10)).toBe(8);
  });

  it("客观题答对不足 80%，清单勾满也不通关", () => {
    expect(essayStars({ correct: 3, quizTotal: 5, checked: 10, checklistTotal: 10 })).toBe(0);
    expect(essayStars({ correct: 3, quizTotal: 5, checked: 0, checklistTotal: 10 })).toBe(0);
  });

  it("加权总分 80/90/100% → 1/2/3 星", () => {
    // 满分 20：客观题每题 2 分 + 清单每条 1 分
    expect(essayStars({ correct: 4, quizTotal: 5, checked: 7, checklistTotal: 10 })).toBe(0); // 15/20
    expect(essayStars({ correct: 4, quizTotal: 5, checked: 8, checklistTotal: 10 })).toBe(1); // 16/20
    expect(essayStars({ correct: 5, quizTotal: 5, checked: 8, checklistTotal: 10 })).toBe(2); // 18/20
    expect(essayStars({ correct: 4, quizTotal: 5, checked: 10, checklistTotal: 10 })).toBe(2); // 18/20
    expect(essayStars({ correct: 5, quizTotal: 5, checked: 10, checklistTotal: 10 })).toBe(3); // 20/20
  });

  it("题数或清单数为 0 时不给星（避免除以 0 造成全员三星）", () => {
    expect(essayStars({ correct: 0, quizTotal: 0, checked: 10, checklistTotal: 10 })).toBe(0);
    expect(essayStars({ correct: 5, quizTotal: 5, checked: 10, checklistTotal: 0 })).toBe(0);
  });
});
