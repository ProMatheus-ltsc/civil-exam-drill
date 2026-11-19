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

type RouteSpec = {
  template: string;
  pattern: RegExp;
  stemIncludes?: RegExp;
  /** 覆盖 topic 级的 crossForbidden：问法不同（如「多少倍」vs「增长率」）时互为干扰项才是考点 */
  crossForbidden?: boolean;
};
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
      {
        // 速算公式（拆 1 法）：因子拆成「1 + (b−a)÷(1+a)」，修正量可心算
        template: "formula-base-ratio-fast",
        pattern: shape(`\\(${P}÷${P}\\)×\\(1[+−]${P}%÷\\(1[+−]${P}%\\)\\)`),
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
    label: "平均数增长率（增长率两种写法 / 问「多少倍」）",
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
      {
        // 问「是原来的多少倍」：倍数＝增长率＋1。增长率本身在这里是**合法干扰项**，放行
        template: "formula-average-rate-multiple",
        pattern: shape(`\\(1\\+${P}%\\)÷\\(1\\+${P}%\\)`),
        stemIncludes: /的多少倍/,
        crossForbidden: false,
      },
    ],
  },
  {
    topic: "formula-base-amount",
    label: "基期量（给增速 / 给增长量两条入口）",
    // 两条入口对应两种材料，不是同一题的等价写法，各自成题
    crossForbidden: false,
    routes: [
      {
        template: "formula-base-amount",
        pattern: shape(`${P}÷\\(1[+−]${P}%\\)`),
      },
      {
        template: "formula-base-amount-diff",
        pattern: shape(`${P}[+−]${P}`),
      },
    ],
  },
  {
    topic: "formula-interval-growth",
    label: "间隔增长率（正向复合 / 反解两种写法）",
    // 正向问「求累计增速」、反解问「求其中一期增速」，问法相反，互为干扰项是考点；
    // 但反解的两条写法（差值式 / 倍数式）恒等，选项里不许互相出现
    crossForbidden: false,
    routes: [
      {
        template: "formula-interval-growth",
        pattern: shape(`${P}%\\+${P}%\\+${P}%×${P}%`),
        stemIncludes: /比 \d{4} 年的增速/,
      },
      {
        template: "formula-interval-growth-back",
        pattern: shape(`\\(${P}%−${P}%\\)÷\\(1\\+${P}%\\)`),
        stemIncludes: /的同比增速/,
        crossForbidden: true,
      },
      {
        template: "formula-interval-growth-back-ratio",
        pattern: shape(`\\(1\\+${P}%\\)÷\\(1\\+${P}%\\)−1`),
        stemIncludes: /的同比增速/,
        crossForbidden: true,
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

        if (route!.crossForbidden ?? spec.crossForbidden) {
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
        const route = spec.routes.find((item) => item.template === question.templateId);
        if (route?.crossForbidden ?? spec.crossForbidden) {
          expect(
            question.explanation,
            `解析没交代等价写法：${question.explanation}`,
          ).toMatch(/另一种写法|另两种等价写法|另三种等价写法|还有两种写法/);
        }
      }
    });
  }
});

describe("基期比重的速算公式（拆 1 法）", () => {
  /**
   * 速算公式是第四条写法，也是最容易被写成「近似」的一条：
   * 因子拆成 1+(b−a)÷(1+a) 是**恒等**变形，把 ÷(1+a) 省掉才是近似。
   * 这里直接把标答代回材料验算——列式题如果式子本身算不回答案，练的就不是公式了。
   */
  it("标答恒等于定义式，修正量就是 b−a、分母就是 1+a", () => {
    const fast = samples("formula-base-ratio", 240).filter(
      (question) => question.templateId === "formula-base-ratio-fast",
    );
    expect(fast.length, "速算公式一路没有出题").toBeGreaterThan(20);
    for (const question of fast) {
      const text = question.material?.paragraphs[0] ?? "";
      const material = text.match(
        /为 (\d+) \S+，比上年增长 ([\d.]+)%；.+?为 (\d+) \S+，比上年增长 ([\d.]+)%。/,
      );
      expect(material, `材料格式变了：${text}`).toBeTruthy();
      const part = Number(material![1]);
      const a = Number(material![2]);
      const whole = Number(material![3]);
      const b = Number(material![4]);

      const answer = question.options[question.answerIndex];
      const matched = answer.match(
        /^\((\d+)÷(\d+)\)×\(1([+−])([\d.]+)%÷\(1\+([\d.]+)%\)\)$/,
      );
      expect(matched, `标答不像拆 1 法：${answer}`).toBeTruthy();
      expect(Number(matched![1]), `标答分子不是部分量：${answer}`).toBe(part);
      expect(Number(matched![2]), `标答分母不是整体量：${answer}`).toBe(whole);
      // 修正量的分母必须是「部分的增速因子」1+a
      expect(Number(matched![5]), `修正量除的不是 1+a：${answer}`).toBe(a);
      // 修正量就是 b−a（符号带方向）
      const diff = (matched![3] === "+" ? 1 : -1) * Number(matched![4]);
      expect(Math.abs(diff - (b - a)), `修正量不是 b−a：${answer}`).toBeLessThan(0.06);

      // 代回材料验算：拆 1 法与定义式必须给出同一个数
      const viaFast = (part / whole) * (1 + diff / 100 / (1 + a / 100));
      const viaDefinition = part / (1 + a / 100) / (whole / (1 + b / 100));
      expect(viaFast, `拆 1 法算不回定义式：${answer} @ ${text}`).toBeCloseTo(viaDefinition, 6);
    }
  });
});

describe("两期比重差：解析讲清「判方向 → |a−b| 卡上限 → 估算」三步", () => {
  /**
   * 这一关只有两条恒等写法（现期比重×(a−b)÷(1+a)、现期比重−基期比重），
   * 没有第三条式子；真正的「速算」是三步口诀，所以解析里必须点到——
   * 只给一个式子，等于把「有上限、可以先估」这个考场主力丢了。
   */
  it("两条路线的解析都点到卡上限与估算", () => {
    for (const question of samples("formula-ratio-change", 80)) {
      expect(question.explanation, `缺「卡上限」：${question.explanation}`).toContain("卡上限");
      expect(question.explanation, `缺「估算」：${question.explanation}`).toContain("估");
    }
  });
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

describe("间隔增长率：反解出来的那一期增速必须能复原累计增速", () => {
  /**
   * 反解最容易被写成「直接相减」（R−r₁）——它看起来很像，但漏掉了「两个增速基数不同」这一步。
   * 这里把标答按字面算出来，再代回 R＝r₁+r₂+r₁×r₂：只有真正反解对了，才能复原材料给的 R。
   */
  it("标答卷子代回 1+R=(1+r₁)(1+r₂)，误差不超过 R 的一位小数舍入", () => {
    const samples = Array.from({ length: 200 }, (_, index) =>
      generateQuestion({
        topicId: "formula-interval-growth",
        difficulty: "medium",
        excludedFingerprints: [],
        randomSeed: `interval-back-${index}`,
      }),
    ).filter((question) => question.templateId.startsWith("formula-interval-growth-back"));
    expect(samples.length, "反解一路没有出题").toBeGreaterThan(40);

    for (const question of samples) {
      const text = question.material?.paragraphs[0] ?? "";
      const material = text.match(/增长 ([\d.]+)%，比 \d{4} 年增长 ([\d.]+)%。/);
      expect(material, `材料格式变了：${text}`).toBeTruthy();
      const r1 = Number(material![1]);
      const total = Number(material![2]);

      const answer = question.options[question.answerIndex];
      // 两种写法分别解析：差值式 (R−r₁)÷(1+r₁) / 倍数式 (1+R)÷(1+r₁)−1
      const diffForm = answer.match(/^\(([\d.]+)%−([\d.]+)%\)÷\(1\+([\d.]+)%\)$/);
      const ratioForm = answer.match(/^\(1\+([\d.]+)%\)÷\(1\+([\d.]+)%\)−1$/);
      let recovered: number;
      if (diffForm) {
        expect(Number(diffForm![1]), `分子不是累计增速：${answer}`).toBe(total);
        expect(Number(diffForm![2]), `减数不是当年增速：${answer}`).toBe(r1);
        // 分母必须是 1+r₁（该年的基数），不是 1+R
        expect(Number(diffForm![3]), `分母不是 1+r₁：${answer}`).toBe(r1);
        recovered = (total - r1) / (1 + r1 / 100);
      } else if (ratioForm) {
        expect(Number(ratioForm![1]), `分子不是 1+R：${answer}`).toBe(total);
        expect(Number(ratioForm![2]), `分母不是 1+r₁：${answer}`).toBe(r1);
        recovered = ((1 + total / 100) / (1 + r1 / 100) - 1) * 100;
      } else {
        throw new Error(`标答形态不认识：${answer}`);
      }
      // 代回 R＝r₁+r₂+r₁×r₂，误差只允许来自 R 保留一位小数的舍入
      // （recovered 已经是百分点：分母折回的是 1+r₁，不是量级）
      const rebuilt = r1 + recovered + (r1 * recovered) / 100;
      expect(Math.abs(rebuilt - total), `反解算不回累计增速：${answer} @ ${text}`).toBeLessThan(0.2);
    }
  });
});
