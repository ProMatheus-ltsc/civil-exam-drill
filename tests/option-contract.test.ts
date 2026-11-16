/**
 * 选项与解析的硬约束（回归测试）
 *
 * 背景：`part-quantity` 的高难题曾同时踩两个坑，且都只有做题的人才知道：
 *  1. 干扰项之间代数恒等（`wholeCurrent×share` 与 `partBase×(1+rate)` 恒等）→
 *     `options()` 去重后不足 4 项 → 自动补一个 `answer×1.05` 的凑数项，
 *     它既不是常见错解，解析里也没有它；
 *  2. 题干三个名词互不搭：总产值当整体、地区生产总值当比重分母、增加值当部分，
 *     严格按字面无解。
 *
 * 这里用三条约束钉住：选项必须自己凑够 4 项、解析必须逐项点名、名词必须引用同一组常量。
 */
import { describe, expect, it } from "vitest";
import { difficulties, generateQuestion, topics } from "../src/generator";
import { collectOptionDiagnostics } from "../src/generator/options";
import type { GeneratedQuestion } from "../src/generator";

const SEEDS = Array.from({ length: 24 }, (_, index) => `audit-${index}`);

/**
 * 已知仍会触发自动补数的模板（历史欠账冻结清单）。
 *
 * **只许删不许加**：新写的模板必须自己给出 3 个互异的干扰项。
 * 每修好一个就划掉一个，删空后连同这段说明一起删。
 * 清单按上面 24 个种子实测得出；换种子可能多冒出几个概率型碰撞，届时补进清单即可。
 */
const PADDING_DEBT = new Set([
  "amount-drop-rate-v2",
  "average-rate-v3",
  "base-diff-v2",
  "base-sum-v2",
  "decimal-multiply-split-v2",
  "interval-growth-back-v3",
  "interval-growth-v3",
  "multiples-is-times-v2",
  "multiples-times-v2",
  "ratio-change-exact-v3",
  "sensitive-fraction-to-whole-v2",
  "sensitive-growth-shares-v2",
  "sensitive-share-v2",
  "share-percent-v2",
]);

/** 选项文本里的数值（去掉「 亿元」「%」这类后缀） */
const numbersOf = (question: GeneratedQuestion) => question.options.map((text) => text.replace(/[^\d.]/g, ""));

/** 抽指定模板的样本（同一次生成里顺带拿到选项诊断） */
function samplesOf(templateId: string, topicId: string, seeds = SEEDS) {
  const out: { question: GeneratedQuestion; padded: boolean }[] = [];
  for (const difficulty of difficulties) {
    for (const randomSeed of seeds) {
      const { result, items } = collectOptionDiagnostics(() =>
        generateQuestion({ topicId, difficulty: difficulty.id, excludedFingerprints: [], randomSeed }),
      );
      if (result.templateId !== templateId) continue;
      out.push({ question: result, padded: items.some((item) => item.deduped < 4) });
    }
  }
  return out;
}

/**
 * 单个模板的「干净选项」底线：不补数、四项互异、没有非正数、解析逐项点名。
 *
 * 这三条一起抓的是同一类事故：`options()` 的自动补数会造出一个既不是常见错解、
 * 解析也解释不了的凑数项（C 类），以及解析把干扰项归因写错（D 类）。
 */
function assertCleanOptions(samples: { question: GeneratedQuestion; padded: boolean }[], label: string) {
  expect(samples.length, `没抽到 ${label} 的样本`).toBeGreaterThan(5);
  for (const { question, padded } of samples) {
    expect(padded, `${label} 干扰项去重后不足 4 项：${question.stem}`).toBe(false);
    expect(new Set(question.options).size, `${label} 选项有重复：${question.options.join(" / ")}`).toBe(4);
    // numbersOf 会把负号一起剥掉，所以负数要按原文判
    for (const text of question.options) {
      expect(text.includes("-"), `${label} 出现负数选项 ${text}：${question.stem}`).toBe(false);
    }
    const numbers = numbersOf(question);
    expect(numbers).toHaveLength(4);
    for (const [index, value] of numbers.entries()) {
      // 资料分析里给负数选项等于白送分，必须一律排除
      expect(Number(value), `${label} 出现非正数选项 ${value}：${question.stem}`).toBeGreaterThan(0);
      if (index === question.answerIndex) continue;
      expect(
        question.explanation.includes(value),
        `${label} 解析没有解释选项 ${value}：${question.explanation}`,
      ).toBe(true);
    }
  }
}

describe("选项与解析的硬约束", () => {
  it("不许靠自动补数凑选项：干扰项去重后必须已经够 4 项（欠账只减不增）", () => {
    const offenders = new Set<string>();
    for (const topic of topics) {
      for (const difficulty of difficulties) {
        for (const randomSeed of SEEDS) {
          const { result, items } = collectOptionDiagnostics(() =>
            generateQuestion({ topicId: topic.id, difficulty: difficulty.id, excludedFingerprints: [], randomSeed }),
          );
          // deduped < 4：模板给的干扰项里有重复/代数恒等项，options() 已经自动补数
          if (items.some((item) => item.deduped < 4)) offenders.add(result.templateId);
        }
      }
    }
    const unexpected = [...offenders].filter((id) => !PADDING_DEBT.has(id)).sort();
    expect(unexpected, `这些模板的干扰项去重后不够 4 项，只能靠 options() 补数：${unexpected.join(", ")}`).toEqual([]);
  });

  it("part-quantity 高难题：整体=地区生产总值、部分=工业增加值，比重分母与整体同名", () => {
    const samples = samplesOf("part-base-v3", "part-quantity");
    expect(samples.length).toBeGreaterThan(10);
    for (const { question } of samples) {
      expect(question.stem).not.toContain("总产值");
      // 题干句式钉死：整体名词出现两次（数据 + 比重分母），所问指标即部分名词
      expect(question.stem).toMatch(
        /^某县本年地区生产总值 \d+ 亿元，同比增长 \d+%；工业增加值占地区生产总值的比重为 \d+%，与上年持平。上年该县工业增加值约为多少亿元？$/,
      );
    }
  });

  it("part-quantity 高难题：四项互异不补数，且每个干扰项都在解析里点名", () => {
    const samples = samplesOf("part-base-v3", "part-quantity");
    expect(samples.length).toBeGreaterThan(10);
    for (const { question, padded } of samples) {
      expect(padded, `干扰项去重后不足 4 项：${question.stem}`).toBe(false);
      expect(new Set(question.options).size).toBe(4);
      const numbers = numbersOf(question);
      expect(numbers).toHaveLength(4);
      const answer = numbers[question.answerIndex];
      // 答案 = 上年整体 × 占比
      const expected = Math.round((Number(question.params.wholeBase) * Number(question.params.share)) / 100);
      expect(String(expected)).toBe(answer);
      for (const [index, value] of numbers.entries()) {
        if (index === question.answerIndex) continue;
        expect(
          question.explanation.includes(value),
          `解析没有解释选项 ${value}：${question.explanation}`,
        ).toBe(true);
      }
    }
  });

  /**
   * 以下三条对应 2026-11-16 修掉的三个邻近模板缺陷：
   * 单位错配（题干万吨/选项亿元）、负数干扰项、纯凑数的「总量减份数」。
   */
  it("growth-amount 求增产：题干与选项单位统一为万吨", () => {
    const samples = samplesOf("amount-base-rate-v3", "growth-amount");
    expect(samples.length).toBeGreaterThan(5);
    for (const { question } of samples) {
      expect(question.stem).toContain("万吨");
      for (const option of question.options) {
        expect(option.endsWith(" 万吨"), `选项单位不是万吨：${option}`).toBe(true);
      }
      expect(question.explanation).not.toContain("亿元");
    }
    assertCleanOptions(samples, "amount-base-rate-v3");
  });

  it("part-quantity 求现期部分：选项无负数，解析逐项点名", () => {
    assertCleanOptions(samplesOf("part-current-v3", "part-quantity"), "part-current-v3");
  });

  it("average-basic 求平均数：干扰项都有出处，解析逐项点名", () => {
    assertCleanOptions(samplesOf("average-value-v4", "average-basic"), "average-value-v4");
  });

  /**
   * 基期比重：原始公式（A/B×(1+b)/(1+a) 出精确值）与变形公式（现期比重 − 两期比重差）
   * 必须都练到。只有前者时，考场上「判方向 + |a−b| 卡上限」的秒杀路线根本没被训练过。
   */
  it("base-ratio：两条公式路线都在出题，不是只练原始公式", () => {
    const templates = new Set<string>();
    for (const difficulty of difficulties) {
      for (const randomSeed of SEEDS) {
        const question = generateQuestion({ topicId: "base-ratio", difficulty: difficulty.id, excludedFingerprints: [], randomSeed });
        templates.add(question.templateId);
      }
    }
    expect(templates.has("base-ratio-v3"), `原始公式题缺失，实际模板：${[...templates].join(", ")}`).toBe(true);
    expect(templates.has("base-ratio-bypass-v4"), `变形公式题缺失，实际模板：${[...templates].join(", ")}`).toBe(true);
  });

  it("base-ratio 变形公式题：方向 + |a−b| 卡上限能唯一锁定答案", () => {
    const samples = samplesOf("base-ratio-bypass-v4", "base-ratio");
    assertCleanOptions(samples, "base-ratio-bypass-v4");
    for (const { question } of samples) {
      const share = Number(question.params.share);
      const span = Number(question.params.span);
      const numbers = numbersOf(question).map(Number);
      const answer = numbers[question.answerIndex];
      // 答案必须落进开区间：方向对（不等于现期比重）、幅度小于 |a−b|
      expect(answer, `答案不在 (现期比重 ± |a−b|) 内：${question.explanation}`).not.toBe(share);
      expect(Math.abs(answer - share), `答案幅度越界：${question.explanation}`).toBeLessThan(span + 1e-9);
      // 且是唯一一个落进区间的选项——否则「卡上限」这一步推不出答案
      const inside = numbers.filter((value) => value !== share && Math.abs(value - share) < span);
      expect(inside, `区间内不止一个选项：${question.options.join(" / ")}`).toEqual([answer]);
      // 解析要把两条路线的关系讲清楚，而不是只报一个数
      expect(question.explanation).toContain("两期比重差");
      expect(question.explanation).toContain("|a−b|");
    }
  });

  it("base-ratio 原始公式题：分母分子各自还原到基期，解析同时给出变形路线", () => {
    const samples = samplesOf("base-ratio-v3", "base-ratio");
    assertCleanOptions(samples, "base-ratio-v3");
    for (const { question } of samples) {
      const basePart = Number(question.params.basePart);
      const baseWhole = Number(question.params.baseWhole);
      // 答案来自「基期部分 ÷ 基期整体」，与材料给的现期量、增速自洽
      const expected = Math.round((basePart / baseWhole) * 100 * 100) / 100;
      const answer = Number(numbersOf(question)[question.answerIndex]);
      expect(Math.abs(answer - expected), `答案与「基期部分÷基期整体」不符：${question.explanation}`).toBeLessThan(0.02);
      // 解析必须给出还原过程的两个中间量，否则「原始公式」只是嘴上说说
      expect(question.explanation).toContain(String(basePart));
      expect(question.explanation).toContain(String(baseWhole));
      // 同时点出更快的变形路线，否则做题人只会硬算
      expect(question.explanation).toContain("两期比重差");
    }
  });

  it("base-ratio 逆向题：材料不出现占比，否则本年占比可直接由量相除读出", () => {
    const samples = samplesOf("base-ratio-current-v3", "base-ratio");
    assertCleanOptions(samples, "base-ratio-current-v3");
    for (const { question } of samples) {
      const paragraphs = question.material?.paragraphs ?? [];
      for (const text of paragraphs) {
        expect(text, `材料泄漏了占比：${text}`).not.toContain("占比");
      }
    }
  });
});
