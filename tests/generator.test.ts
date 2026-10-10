import { describe, expect, it } from "vitest";
import { round } from "../src/generator/random";
import {
  difficulties,
  generateQuestion,
  perQuestionBudgetSeconds,
  topicById,
  topics,
  titleOf,
} from "../src/generator";
import type { TopicId, TrainingTopic } from "../src/generator";

describe("question generator", () => {
  /**
   * 计算功底的解锁链（设计意图，改链条时这里要一起改）：
   *   加法（入口）→ 减法 | 多项求和 →（减法之后）多项求差、（求和之后）乘法与平方 →（乘法之后）多项连加
   */
  it("计算功底解锁链：加法 → 减法/多项求和 → 多项求差/乘法与平方 → 多项连加", () => {
    const unlockOf = (id: TopicId) => topicById.get(id)?.unlock ?? [];
    expect(unlockOf("addition")).toEqual([]);
    expect(unlockOf("subtraction")).toEqual(["addition"]);
    expect(unlockOf("sum-many")).toEqual(["addition"]);
    expect(unlockOf("diff-many")).toEqual(["subtraction"]);
    expect(unlockOf("multiply")).toEqual(["sum-many"]);
    // 连加的解法用到「基准 × 项数」的乘法，所以排在乘法与平方之后
    expect(unlockOf("sum-long")).toEqual(["multiply"]);
    // 下游不受影响：除法与敏感数仍挂在乘法上
    expect(unlockOf("divide")).toEqual(["multiply"]);
    expect(unlockOf("sensitive")).toEqual(["multiply"]);
  });

  /**
   * 审计过的前置（原则：前置必须是「不会 A 就做不了 B」的真依赖，而不是把同族题型串成一条线）。
   * 这几条都是查过专文后定的，改链条时这里要一起改：
   *   - 混合增长率靠的是「盐水加权」，与间隔增长率的两年复合公式无关 → 前置增长率；
   *   - 分数数列核心是分子分母分列成规律 → 前置多级数列；
   *   - 机械划分（拆位后配合幂次/质数）、因数分解（乘积拆分）→ 前置幂次数列。
   */
  it("审计过的前置：数字推理的两条腿与混合增长率", () => {
    const unlockOf = (id: TopicId) => topicById.get(id)?.unlock ?? [];
    expect(unlockOf("mixed-growth")).toEqual(["growth-rate"]);
    expect(unlockOf("seq-basic")).toEqual([]);
    expect(unlockOf("seq-multilevel")).toEqual(["seq-basic"]);
    expect(unlockOf("seq-power")).toEqual(["seq-basic"]);
    expect(unlockOf("seq-fraction")).toEqual(["seq-multilevel"]);
    expect(unlockOf("seq-split")).toEqual(["seq-power"]);
    expect(unlockOf("seq-factor")).toEqual(["seq-power"]);
    expect(unlockOf("seq-recursive")).toEqual(["seq-multilevel", "seq-power"]);
  });

  it("解锁前置都真实存在、同轨道，且不构成环", () => {
    const known = new Map(topics.map((topic) => [topic.id, topic]));
    // 前置 id 写错（改名/删关卡后的残留）会让这一关永远锁死，页面上只显示灰按钮
    const dangling = topics
      .flatMap((topic) =>
        topic.unlock.filter((prereq) => !known.has(prereq)).map((prereq) => `${topic.id} → ${prereq}`),
      )
      .filter(Boolean);
    expect(dangling).toEqual([]);
    const crossTrack = topics
      .filter((topic) =>
        topic.unlock.some((prereq) => known.get(prereq)?.track !== topic.track),
      )
      .map((topic) => topic.id);
    expect(crossTrack).toEqual([]);
    // 列表顺序要在前置之后：否则地图上会看到「锁着的关卡排在它自己的前置上方」，读起来是反的
    const orderOf = new Map(topics.map((topic, index) => [topic.id, index]));
    const outOfOrder = topics
      .filter((topic) =>
        topic.unlock.some(
          (prereq) => (orderOf.get(prereq) ?? -1) > (orderOf.get(topic.id) ?? -1),
        ),
      )
      .map((topic) => topic.id);
    expect(outOfOrder).toEqual([]);
    // 有环 = 互等对方通关，两边都解不开
    const cyclic: string[] = [];
    for (const topic of topics) {
      const stack = [...topic.unlock];
      const seen = new Set<string>();
      while (stack.length > 0) {
        const current = stack.pop() as TopicId;
        if (current === topic.id) {
          cyclic.push(topic.id);
          break;
        }
        if (seen.has(current)) continue;
        seen.add(current);
        stack.push(...(known.get(current)?.unlock ?? []));
      }
    }
    expect(cyclic).toEqual([]);
  });

  /**
   * 项数越多不能反而更赶：多项连加的每题预算必须不低于多项求和（同难度档逐个对比）。
   * 时间预算是「逼你用方法而不是硬算」的杠杆，某一档写少了会让这一关变成不可通关。
   */
  it("多项连加每档的每题预算 ≥ 多项求和（项数多就该给加时）", () => {
    const sumMany = topicById.get("sum-many") as TrainingTopic;
    const sumLong = topicById.get("sum-long") as TrainingTopic;
    for (const difficulty of difficulties) {
      const where = `sum-long/${difficulty.id}`;
      expect(perQuestionBudgetSeconds(sumLong, difficulty.id), where).toBeGreaterThanOrEqual(
        perQuestionBudgetSeconds(sumMany, difficulty.id),
      );
    }
  });

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

  /**
   * 乘法模块对齐资料分析真题后是三档混合出题，测试按「题型」而非「难度」验证：
   * - 估算题（主体）：选项按 ≥5% 相对刻度铺开，考的是有效数字估算；
   * - 精算题（少数派）：选项尾位全锁（尾数法失效），必须算准；
   * - 平方题：凑整十展开，选项互异即可。
   * 同时统计三档的题型分布，确保「精算只是少数派、估算才是主线」。
   */
  it("multiply 三档均为混合出题：估算为主、精算为辅、选项刻度可分辨", () => {
    const count = { estimate: 0, exact: 0, square: 0 };
    for (let seed = 0; seed < 80; seed += 1) {
      for (const difficulty of difficulties) {
        const question = generateQuestion({
          topicId: "multiply",
          difficulty: difficulty.id,
          excludedFingerprints: [],
          randomSeed: `mix-${difficulty.id}-${seed}`,
        });
        const nums = question.options.map((option) => Number(option));
        expect(new Set(question.options).size).toBe(4);
        expect(nums[question.answerIndex]).toBeGreaterThan(0);

        if (question.templateId.startsWith("multiply-square")) {
          count.square += 1;
        } else if (question.templateId.startsWith("multiply-exact")) {
          // 精算题：尾位全锁
          const units = question.options.map((option) => option.slice(-1));
          expect(new Set(units).size).toBe(1);
          count.exact += 1;
        } else {
          expect(question.templateId.startsWith("multiply-estimate")).toBe(true);
          // 估算题：相邻刻度差距 ≥5.5%（生成器保证 ≥6%，这里留出取整余量），题干点明「最接近」
          const sorted = [...nums].sort((x, y) => x - y);
          for (let index = 1; index < sorted.length; index += 1) {
            const gap = (sorted[index] - sorted[index - 1]) / sorted[index];
            expect(gap).toBeGreaterThanOrEqual(0.055);
          }
          expect(question.stem).toContain("最接近");
          count.estimate += 1;
        }
        // 乘法全题型共同约束：四项末位必须完全一致，杜绝尾数法秒杀
        const lastDigits = new Set(question.options.map((option) => option.slice(-1)));
        expect(lastDigits.size).toBe(1);
      }
    }
    // 估算题：被标记的答案必须确实是「离精确乘积最近」的那个选项
    for (let seed = 0; seed < 200; seed += 1) {
      const question = generateQuestion({
        topicId: "multiply",
        difficulty: difficulties[seed % difficulties.length].id,
        excludedFingerprints: [],
        randomSeed: `closest-${seed}`,
      });
      if (!question.templateId.startsWith("multiply-estimate")) continue;
      const a = Number((question.stem.match(/估算\s*(\d+)/) ?? [])[1]);
      const b = Number((question.stem.match(/×(\d+)/) ?? [])[1]);
      if (!a || !b) continue;
      const truth = a * b;
      const nums = question.options.map((option) => Number(option));
      const closest = nums.reduce((best, value) =>
        Math.abs(value - truth) < Math.abs(best - truth) ? value : best,
      );
      expect(nums[question.answerIndex]).toBe(closest);
    }
    // 估算必须是主体（>50%），精算必须明显是少数（<30%）
    const total = count.estimate + count.exact + count.square;
    expect(count.estimate / total).toBeGreaterThan(0.5);
    expect(count.exact / total).toBeLessThan(0.3);
    // 精算题在三档都要出现，做到「每档 1~2 道」
    for (const difficulty of difficulties) {
      let exactInLevel = 0;
      for (let seed = 0; seed < 80; seed += 1) {
        const question = generateQuestion({
          topicId: "multiply",
          difficulty: difficulty.id,
          excludedFingerprints: [],
          randomSeed: `mix-${difficulty.id}-${seed}`,
        });
        if (question.templateId.startsWith("multiply-exact")) exactInLevel += 1;
      }
      expect(exactInLevel).toBeGreaterThan(0);
    }
  });

  /**
   * 加法/减法/多项求和/多项连加/多项求差是纯算数题：题干里的算式就是答案本身，
   * 这一条不变量比「选项互异」硬得多——取值区间写错（比如减数大于被减数）、
   * 选项出现负数、把答案和选项写岔了，都会在这里暴露。
   */
  it("计算功底五关：答案等于算式本身，且选项里没有负数", () => {
    const evaluate = (expression: string) =>
      (expression.match(/[+-]?\s*\d+(?:\.\d+)?/g) ?? []).reduce(
        (sum, token) => sum + Number(token.replace(/\s+/g, "")),
        0,
      );
    for (const topicId of [
      "addition",
      "subtraction",
      "sum-many",
      "sum-long",
      "diff-many",
    ] as const) {
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
          // 加法允许一位/两位小数，浮点累加后按两位小数对齐再比较
          expect(Number(question.params.answer), where).toBe(round(answer, 2));
          expect(Number(question.options[question.answerIndex]), where).toBe(round(answer, 2));
          expect(question.options.every((option) => /^\d+(?:\.\d+)?$/.test(option)), where).toBe(true);
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
    for (const topicId of [
      "addition",
      "subtraction",
      "sum-many",
      "sum-long",
      "diff-many",
    ] as const) {
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
        if (topicId === "addition" || topicId === "sum-many" || topicId === "sum-long") {
          const terms = String(question.params.expression).split("+").length;
          const where = `${topicId} seed=${seed}（${terms} 项）`;
          expect(question.material?.table?.rows.length, where).toBe(terms);
          expect(question.material?.chart?.categories.length, where).toBe(terms);
          // 5~6 项要走「1—N 月各月」框架：写死「1—5 月」时 6 项的第 6 个标签会缺失
          if (terms >= 5) {
            expect(question.material?.table?.rows[terms - 1]?.[0], where).toBe(
              `${terms} 月`,
            );
            expect(question.stem).toContain(`1—${terms} 月合计`);
          }
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
