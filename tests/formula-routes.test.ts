/**
 * 列式关的「一条式子还是几条式子」回归。
 *
 * 背景：这些概念在教材里都有两三种**恒等**写法，但生成器一度只出其中一种——
 * 练十道等于练一道，考场上换个写法就不认识。这里按「一个考点一组路线」锁四件事：
 *   1. 每组路线都出得到（各占约 1/3，不能退化成只出其中一条）；
 *   2. 标答形态与该路线的写法一致（防止「换了标签还是那条式子」）；
 *   3. 互为等价写法的几条路线，**选项里不许互相出现**——另一个写法同样正确，
 *      混进选项就把「认出公式」变成了「猜出题人」；
 *   4. 四项互异、没有「其它（n）」占位（占位说明某条干扰项与标答撞了）。
 *
 * 问法不同、式子不等的（"是几倍" vs "多几倍"、"求比重" vs "求整体"）不算等价，
 * 它们互为干扰项反而是考点，所以 crossForbidden=false。
 */
import { describe, expect, it } from "vitest";
import { generateQuestion } from "../src/generator";
import type { TopicId } from "../src/generator/catalog";
import type { QuestionDraft } from "../src/generator/types";

const P = String.raw`\d+(?:\.\d+)?`;
const shape = (body: string) => new RegExp(`^${body}$`);

type RouteSpec = { template: string; pattern: RegExp; stemIncludes?: RegExp };
type TopicSpec = {
  topic: TopicId;
  label: string;
  routes: RouteSpec[];
  /** true＝这些路线是同一个答案的不同写法，选项里不许互相出现 */
  crossForbidden: boolean;
};

const TOPICS: TopicSpec[] = [
  {
    topic: "formula-growth-rate",
    label: "增长率",
    crossForbidden: true,
    routes: [
      // 分母必须**等于基期那个数**（反向引用），否则「现期作分母」这种同形错项也会被当成等价写法
      { template: "formula-growth-rate", pattern: shape(String.raw`\((\d+)−(\d+)\)÷\2`) },
      { template: "formula-growth-rate-multiple", pattern: shape(String.raw`(\d+)÷(\d+)−1`) },
    ],
  },
  {
    topic: "formula-growth-amount",
    label: "增长量",
    crossForbidden: true,
    routes: [
      {
        template: "formula-growth-amount",
        pattern: shape(`${P}×${P}%÷\\(1[+−]${P}%\\)`),
      },
      {
        template: "formula-growth-amount-diff",
        pattern: shape(`${P}−${P}÷\\(1[+−]${P}%\\)`),
      },
    ],
  },
  {
    topic: "formula-multiples",
    label: "倍数（是几倍 / 多几倍）",
    // 两个问法的答案本就不同，互为干扰项是考点
    crossForbidden: false,
    routes: [
      { template: "formula-multiples", pattern: shape(`${P}÷${P}`), stemIncludes: /的多少倍/ },
      {
        template: "formula-multiples-more",
        pattern: shape(`${P}÷${P}−1`),
        stemIncludes: /多了多少倍/,
      },
    ],
  },
  {
    topic: "formula-average-basic",
    label: "平均数基础（求平均数 / 求总量 / 求份数）",
    // 三问的答案各不相同，互为干扰项是考点
    crossForbidden: false,
    routes: [
      {
        template: "formula-average-basic",
        pattern: shape(`${P}÷${P}`),
        stemIncludes: /平均每个.*的/,
      },
      {
        template: "formula-average-basic-total",
        pattern: shape(`${P}×${P}`),
        stemIncludes: /的总量/,
      },
      {
        template: "formula-average-basic-count",
        pattern: shape(`${P}÷${P}`),
        stemIncludes: /的个数/,
      },
    ],
  },
  {
    topic: "formula-ratio-basic",
    label: "比重与整体量（求比重 / 求整体）",
    crossForbidden: false,
    routes: [
      { template: "formula-ratio-basic", pattern: shape(`${P}÷${P}`) },
      { template: "formula-ratio-basic-whole", pattern: shape(`${P}÷${P}%`) },
    ],
  },
  {
    topic: "formula-base-ratio",
    label: "基期比重",
    crossForbidden: true,
    routes: [
      {
        template: "formula-base-ratio",
        pattern: shape(`\\(${P}÷\\(1\\+${P}%\\)\\)÷\\(${P}÷\\(1\\+${P}%\\)\\)`),
      },
      {
        template: "formula-base-ratio-product",
        pattern: shape(`\\(${P}÷${P}\\)×\\(1\\+${P}%\\)÷\\(1\\+${P}%\\)`),
      },
      {
        template: "formula-base-ratio-shift",
        pattern: shape(`\\(${P}÷${P}\\)−\\(${P}÷${P}\\)×\\(${P}%−${P}%\\)÷\\(1\\+${P}%\\)`),
      },
    ],
  },
  {
    topic: "formula-ratio-change",
    label: "两期比重差",
    crossForbidden: true,
    routes: [
      {
        template: "formula-ratio-change",
        pattern: shape(`\\(${P}÷${P}\\)×\\(${P}%−${P}%\\)÷\\(1\\+${P}%\\)`),
      },
      {
        template: "formula-ratio-change-sub",
        pattern: shape(
          `\\(${P}÷${P}\\)−\\(${P}÷${P}\\)×\\(1\\+${P}%\\)÷\\(1\\+${P}%\\)`,
        ),
      },
    ],
  },
  {
    topic: "formula-average-rate",
    label: "平均数增长率",
    crossForbidden: true,
    routes: [
      {
        template: "formula-average-rate",
        pattern: shape(`\\(${P}%−${P}%\\)÷\\(1\\+${P}%\\)`),
      },
      {
        template: "formula-average-rate-ratio",
        pattern: shape(`\\(1\\+${P}%\\)÷\\(1\\+${P}%\\)−1`),
      },
    ],
  },
  {
    topic: "formula-diff-rate",
    label: "差值增长率（只有一条正确写法：两期差值相减再除基期差）",
    crossForbidden: false,
    routes: [
      {
        template: "formula-diff-rate",
        pattern: shape(
          `\\(\\(${P}−${P}\\)−\\(${P}÷\\(1\\+${P}%\\)−${P}÷\\(1\\+${P}%\\)\\)\\)÷\\(${P}÷\\(1\\+${P}%\\)−${P}÷\\(1\\+${P}%\\)\\)`,
        ),
      },
    ],
  },
];

function samples(topic: TopicId, count = 150): QuestionDraft[] {
  return Array.from({ length: count }, (_, index) =>
    generateQuestion({
      topicId: topic,
      difficulty: "medium",
      excludedFingerprints: [],
      randomSeed: `routes-${topic}-${index}`,
    }),
  );
}

describe("列式关：一个考点的多条写法都要练到", () => {
  for (const spec of TOPICS) {
    it(`${spec.label}：${spec.routes.length} 条路线都出得到`, () => {
      const tally = new Map<string, number>();
      for (const question of samples(spec.topic)) {
        tally.set(question.templateId, (tally.get(question.templateId) ?? 0) + 1);
      }
      expect(
        [...tally.keys()].filter((id) => !spec.routes.some((route) => route.template === id)),
        `${spec.label} 出现了未登记的模板：${[...tally.keys()].join(", ")}`,
      ).toEqual([]);
      for (const route of spec.routes) {
        const hits = tally.get(route.template) ?? 0;
        if (spec.routes.length === 1) {
          // 只有一条正确写法时，150 题应当全归它
          expect(hits, `${spec.label} 未出题（实际 ${hits}）`).toBe(150);
          continue;
        }
        // 150 题里两路各约 75、三路各约 50；只拦「某一路被饿死」与「某一路吃满」
        expect(hits, `${spec.label} 的 ${route.template} 出题数异常（实际 ${hits}）`).toBeGreaterThan(15);
        expect(hits, `${spec.label} 的 ${route.template} 出题过多（实际 ${hits}）`).toBeLessThan(140);
      }
    });

    it(`${spec.label}：标答形态与路线一致，选项里没有第二条等价写法`, () => {
      for (const question of samples(spec.topic, 200)) {
        const route = spec.routes.find((item) => item.template === question.templateId);
        expect(route, `未登记的模板：${question.templateId}`).toBeTruthy();
        const answer = question.options[question.answerIndex];
        expect(route!.pattern.test(answer), `${question.templateId} 标答形态不符：${answer}`).toBe(true);
        if (route!.stemIncludes) {
          expect(question.stem, `${question.templateId} 的题干与路线问法不符`).toMatch(route!.stemIncludes);
        }

        if (spec.crossForbidden) {
          for (const other of spec.routes) {
            if (other.template === question.templateId) continue;
            const leaked = question.options.filter(
              (option) => option !== answer && other.pattern.test(option),
            );
            expect(
              leaked,
              `${question.templateId} 的选项里混入了 ${other.template} 的等价写法`,
            ).toEqual([]);
          }
        }

        expect(new Set(question.options).size, `选项重复：${question.options.join(" / ")}`).toBe(4);
        expect(question.options.join(" / ")).not.toContain("其它（");
      }
    });

    it(`${spec.label}：解析点名错项、并交代另一种写法`, () => {
      for (const question of samples(spec.topic, 60)) {
        expect(question.explanation.length, `解析过短：${question.explanation}`).toBeGreaterThan(50);
        expect(question.explanation, `解析没有点名错项：${question.explanation}`).toMatch(/错法|错项/);
        if (spec.crossForbidden) {
          expect(
            question.explanation,
            `解析没交代等价写法：${question.explanation}`,
          ).toMatch(/另一种写法|另两种等价写法|还有两种写法/);
        }
      }
    });
  }
});

describe("列式关：差值增长率的标答必须是精确式", () => {
  /**
   * 踩过的坑：这里曾把「现期×增速当增量、现期差当基期差」的小增速近似式当成了标答，
   * 两个近似叠起来，r 稍大就差好几个百分点。这一关问的是"该怎么列式"，不能教近似。
   */
  it("标答含两次基期还原、且分母是基期差", () => {
    for (const question of samples("formula-diff-rate", 80)) {
      const answer = question.options[question.answerIndex];
      expect([...answer.matchAll(/÷\(1\+\d+(?:\.\d+)?%\)/g)].length).toBe(4);
      expect(answer.startsWith("(("), `标答不像「(本期差值−基期差值)÷基期差值」：${answer}`).toBe(true);
      // 近似式必须降级成错项：出现时解析要点明它只在小增速下敢用
      const approximate = question.options.find((option) =>
        new RegExp(`^\\(${P}×${P}%−${P}×${P}%\\)÷\\(${P}−${P}\\)$`).test(option),
      );
      if (approximate) {
        expect(question.explanation).toContain("近似");
      }
    }
  });
});
