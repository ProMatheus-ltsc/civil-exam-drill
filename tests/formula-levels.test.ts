/**
 * 列式 18 关的「难度梯度」与「下降场景」回归。
 *
 * 背景：这三档难度最初只是同一个生成逻辑换了个 difficulty 参数，
 * r.level 从未参与运算，所以 easy / medium / hard 出的题完全同质；
 * 而且 rateOf 恒为正，等于所有材料都只有增长、没有下降。
 * 这里把两条约定锁死，防止以后又退化。
 */
import { describe, expect, it } from "vitest";
import { generateQuestion } from "../src/generator";
import type { QuestionDraft } from "../src/generator/types";

/** 材料里直接写「增长/下降 x%」的模块——用文字即可判定方向 */
const VERBAL_TOPICS = [
  "formula-growth-amount",
  "formula-base-amount",
  "formula-base-difference",
] as const;

/** 材料只给两年数值的模块——靠数值大小判定方向 */
const NUMERIC_TOPICS = ["formula-growth-rate", "formula-multiples"] as const;

const DIFFS = ["easy", "medium", "hard"] as const;

function materialOf(q: QuestionDraft): string {
  return q.material?.paragraphs.join("") ?? "";
}

/** growth-amount / base-amount / base-difference：材料直接写「下降」 */
function isVerbalDecline(q: QuestionDraft): boolean {
  return materialOf(q).includes("下降");
}

/**
 * growth-rate：材料顺序是「基期 → 现期」，现期小于基期即下降；
 * multiples：顺序是「现期 → 基期」，基期小于现期才是增长，方向相反。
 */
function isNumericDecline(topicId: string, q: QuestionDraft): boolean {
  const nums = [...materialOf(q).matchAll(/(\d{3,6})\s*(?:亿元|万吨|亿千瓦时|万人|元)/g)].map(
    (m) => Number(m[1]),
  );
  if (nums.length < 2) return false;
  return topicId === "formula-growth-rate" ? nums[1] < nums[0] : nums[0] < nums[1];
}

function declineRate(topicId: string, difficulty: (typeof DIFFS)[number], n = 200): number {
  let hit = 0;
  for (let i = 0; i < n; i += 1) {
    const q = generateQuestion({
      topicId: topicId as never,
      difficulty,
      excludedFingerprints: [],
      randomSeed: `decline-${topicId}-${difficulty}-${i}`,
    });
    const declined =
      topicId === "formula-growth-rate" || topicId === "formula-multiples"
        ? isNumericDecline(topicId, q)
        : isVerbalDecline(q);
    if (declined) hit += 1;
  }
  return hit / n;
}

describe("列式关：难度梯度", () => {
  it.each([...VERBAL_TOPICS])("%s 的下降率随难度递增（easy < medium < hard）", (topicId) => {
    const easy = declineRate(topicId, "easy");
    const medium = declineRate(topicId, "medium");
    const hard = declineRate(topicId, "hard");
    expect(easy, `easy 下降率异常：${easy}`).toBeGreaterThan(0.03);
    expect(medium, `medium 应高于 easy（${easy} → ${medium}）`).toBeGreaterThan(easy);
    expect(hard, `hard 应高于 medium（${medium} → ${hard}）`).toBeGreaterThan(medium);
  });

  it("easy 档的增长率是整数百分比（不出现 5.5% 这种）", () => {
    for (const topicId of VERBAL_TOPICS) {
      for (let i = 0; i < 80; i += 1) {
        const q = generateQuestion({
          topicId: topicId as never,
          difficulty: "easy",
          excludedFingerprints: [],
          randomSeed: `int-${topicId}-${i}`,
        });
        const matched = [...materialOf(q).matchAll(/(增长|下降)\s*(\d+(?:\.\d+)?)%/g)];
        expect(matched.length, `${topicId} 材料缺少增长率`).toBeGreaterThan(0);
        for (const m of matched) {
          expect(m[2], `easy 档出现了小数增长率：${m[0]}`).not.toContain(".");
        }
      }
    }
  });

  it("hard 档的增长率精度高于 easy（出现一位小数）", () => {
    for (const topicId of VERBAL_TOPICS) {
      let decimal = 0;
      for (let i = 0; i < 80; i += 1) {
        const q = generateQuestion({
          topicId: topicId as never,
          difficulty: "hard",
          excludedFingerprints: [],
          randomSeed: `dec-${topicId}-${i}`,
        });
        if (/(增长|下降)\s*\d+\.\d%/.test(materialOf(q))) decimal += 1;
      }
      expect(decimal, `${topicId} hard 档未出现小数增长率`).toBeGreaterThan(0);
    }
  });
});

describe("列式关：下降场景", () => {
  it("材料写「下降」时，标答一律用 (1−降幅)，绝不能出现 (1+降幅)", () => {
    for (const topicId of VERBAL_TOPICS) {
      let checked = 0;
      for (const difficulty of DIFFS) {
        for (let i = 0; i < 100; i += 1) {
          const q = generateQuestion({
            topicId: topicId as never,
            difficulty,
            excludedFingerprints: [],
            randomSeed: `sign-${topicId}-${difficulty}-${i}`,
          });
          if (!isVerbalDecline(q)) continue;
          const answer = q.options[q.answerIndex];
          expect(answer, `${topicId} 下降题标答无 (1−：${q.stem}`).toContain("(1−");
          // 基期差有两个增速，允许同时出现一正一负；其余模块不允许出现 (1+
          if (topicId !== "formula-base-difference") {
            expect(answer, `${topicId} 下降题标答混入了 (1+：${answer}`).not.toContain("(1+");
          }
          checked += 1;
        }
      }
      expect(checked, `${topicId} 未抽到下降题`).toBeGreaterThan(0);
    }
  });

  it("growth-rate / multiples 也会出现「现期低于基期」的题", () => {
    for (const topicId of NUMERIC_TOPICS) {
      const rate = declineRate(topicId, "hard");
      expect(rate, `${topicId} 完全没有下降场景`).toBeGreaterThan(0.1);
      expect(rate, `${topicId} 下降率过高（可能方向判定或取值有误）`).toBeLessThan(0.9);
    }
  });

  it("下降题的解析会点明「下降」，不只讲增长", () => {
    for (const topicId of VERBAL_TOPICS) {
      let hit = 0;
      for (let i = 0; i < 100 && hit < 3; i += 1) {
        const q = generateQuestion({
          topicId: topicId as never,
          difficulty: "hard",
          excludedFingerprints: [],
          randomSeed: `expl-${topicId}-${i}`,
        });
        if (!isVerbalDecline(q)) continue;
        expect(q.explanation.length, `${topicId} 解析过短`).toBeGreaterThanOrEqual(25);
        hit += 1;
      }
    }
  });
});
