/** 选项构造工具 */
import { fmt, round } from "./random";

export type OptionSet = {
  options: [string, string, string, string];
  answerIndex: 0 | 1 | 2 | 3;
};

/**
 * 通用数值选项：answer + 干扰项 → 去重 → 洗牌。
 * 干扰项不足 3 个时自动补（基于 answer 的步进），保证永远 4 个互异选项。
 */
export function options(
  answer: number,
  distractors: number[],
  suffix: string,
  random: () => number,
  digits = 2,
): OptionSet {
  const values = [answer, ...distractors].map((value) => round(value, digits));
  const unique = [...new Set(values)];
  const step = Math.max(10 ** -digits, Math.abs(answer) * 0.05);
  while (unique.length < 4) unique.push(round(answer + step * unique.length, digits));
  for (let index = unique.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [unique[index], unique[target]] = [unique[target], unique[index]];
  }
  const answerIndex = unique.indexOf(round(answer, digits)) as 0 | 1 | 2 | 3;
  return {
    options: unique.map((value) => `${fmt(value, digits)}${suffix}`) as [
      string,
      string,
      string,
      string,
    ],
    answerIndex,
  };
}

/** 整数选项（数字推理等无后缀场景） */
export function integerOptions(
  answer: number,
  distractors: number[],
  random: () => number,
): OptionSet {
  return options(answer, distractors, "", random, 0);
}

/**
 * 「尾位锁定」选项构建器：全部选项与答案末位一致（尾数法失效）；
 * 答案较大（量级带内可容纳 ±100·k）时自动升级为与答案末两位一致。
 * 自适应：先按答案量级选步长（10 或 100），不足 3 个干扰项时逐步放宽量级带。
 */
export function tailLockedOptions(answer: number, random: () => number): OptionSet {
  if (!Number.isFinite(answer) || answer < 0) throw new Error("INVALID_TAIL_ANSWER");
  const step = answer >= 2400 ? 100 : 10;
  let band = Math.max(answer * 0.18, step * 4.5);
  let pool: number[] = [];
  for (let widen = 0; widen < 4 && pool.length < 3; widen += 1) {
    pool = [];
    const maxK = Math.max(1, Math.floor(band / step));
    for (let k = 1; k <= maxK; k += 1) {
      const up = answer + step * k;
      const down = answer - step * k;
      pool.push(up);
      if (down >= 0) pool.push(down);
    }
    // 大数时保证与答案末两位相同的干扰项优先入选
    if (step === 100) pool.sort((x, y) => (x % 100 === answer % 100 ? -1 : 0) - (y % 100 === answer % 100 ? -1 : 0));
    pool = [...new Set(pool)];
    band *= 1.7;
  }
  // 随机抽取 3 个互异干扰项
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [pool[index], pool[target]] = [pool[target], pool[index]];
  }
  const distractors = pool.slice(0, 3);
  const values = [answer, ...distractors];
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [values[index], values[target]] = [values[target], values[index]];
  }
  return {
    options: values.map(String) as [string, string, string, string],
    answerIndex: values.indexOf(answer) as 0 | 1 | 2 | 3,
  };
}

export function tailLockInfo(optionsSet: OptionSet) {
  const tails = optionsSet.options.map((text) => text.slice(-2));
  const lastDigitSame = new Set(optionsSet.options.map((text) => text.slice(-1))).size === 1;
  const lastTwoSame = new Set(tails).size === 1;
  return { lastDigitSame, lastTwoSame, tails };
}

/**
 * 「估算刻度」选项构建器：用于资料分析类的乘法估算题。
 *
 * 资料分析真题里选项差距通常 ≥5%，只要估到「数量级 + 首位有效数字」就能定答案，
 * 因此四个选项围绕答案按同一相对刻度铺开（差距可分辨、量级一致）。
 *
 * **两条硬约束**（否则估算能力根本没被考到）：
 * 1. **四选项尾数必须完全一致**——否则尾数法秒杀；
 * 2. **正确答案也必须写成「整齐的估计值」**——否则只有答案是个"丑数字"，
 *    考生一眼就能反推出它，比尾数法还快。
 *
 * 做法：按答案量级取一个刻度粒度 grain，把答案与全部干扰项都对齐到 grain 的整数倍，
 * 于是四项同尾（对齐到十位则尾位全 0、对齐到百位则末两位全 00），
 * 且都是"整齐数"；正确项即"最接近精确值的那个整齐数"。
 *
 * @param answer 题目真实计算结果（用于派生正确项与干扰项）
 * @param spread 相对间距，0.06 表示相邻选项相差约 6%
 * @param random 洗牌随机源
 * @param digits 结果保留小数位（估算题通常为 0）
 */
export function estimateOptions(
  answer: number,
  spread: number,
  random: () => number,
  digits = 0,
): OptionSet {
  if (!Number.isFinite(answer) || answer <= 0) throw new Error("INVALID_ESTIMATE_ANSWER");
  const rounded = round(answer, digits);
  // 对齐粒度：答案量级的 1/100（如 5 位数 → 1000、6 位数 → 10000），
  // 保证四项同尾且刻度明显可分辨。
  const magnitude = Math.floor(Math.log10(rounded));
  const grain = 10 ** Math.max(1, magnitude - 1);
  // 正确项 = 最接近精确值的整齐数
  const correct = Math.round(rounded / grain) * grain;
  // 单个刻度：向上取整到 grain 的整数倍，并保证相邻选项相对差距 ≥6%。
  // grain 取整可能让间距缩水（如 answer=4.7M、grain=100k、spread=6% → 步长 300k，
  // 但实际相邻选项差 300k/4.4M ≈ 6.8%，最小处可能低于 6%），
  // 所以这里迭代放大步长直到「最小间距 / 最大选项」也满足 6%。
  let stepCount = Math.max(1, Math.round((rounded * spread) / grain));
  while (stepCount * grain < rounded * 0.06 * 1.05) stepCount += 1;
  const step = stepCount * grain;
  const candidates = [correct, correct + step, correct - step, correct + 2 * step];
  const unique = [...new Set(candidates)].filter((value) => value > 0);
  for (let k = 3; unique.length < 4; k += 1) {
    const candidate = correct + k * step;
    if (candidate > 0 && !unique.includes(candidate)) unique.push(candidate);
  }
  for (let index = unique.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [unique[index], unique[target]] = [unique[target], unique[index]];
  }
  return {
    options: unique.map((value) => fmt(value, digits)) as [
      string,
      string,
      string,
      string,
    ],
    answerIndex: unique.indexOf(correct) as 0 | 1 | 2 | 3,
  };
}

/**
 * 有效数字乘法（「看三位、取两位」）：两数各自保留前两位有效数字，第三位决定取舍。
 * 返回缺失舍入后的两个乘数与估算结果，供解析逐步展示。
 *
 * 取舍规则（与公考培训机构口径一致）：
 * - 全舍：两数第三位都在 0/1/2 → 全部舍去；
 * - 全进：两数第三位都在 8/9 → 全部进位；
 * - 一进一舍：前两位有效数字较小的一方四舍五入，较大的一方反向变化。
 */
export function significantPair(a: number, b: number): {
  approxA: number;
  approxB: number;
  estimate: number;
  rule: "舍" | "进" | "一进一舍";
} {
  const split = (value: number) => {
    const magnitude = Math.floor(Math.log10(Math.abs(value)));
    const scale = 10 ** (magnitude - 1);
    const firstTwo = Math.floor(Math.abs(value) / scale);
    const third = Math.floor((Math.abs(value) / scale) * 10) % 10;
    return { scale, firstTwo, third, sign: Math.sign(value) || 1 };
  };
  const sa = split(a);
  const sb = split(b);
  const build = (part: ReturnType<typeof split>, rounded: number) =>
    part.sign * Math.round(rounded) * part.scale;

  let rule: "舍" | "进" | "一进一舍";
  let roundedA: number;
  let roundedB: number;
  if (sa.third <= 2 && sb.third <= 2) {
    rule = "舍";
    roundedA = sa.firstTwo;
    roundedB = sb.firstTwo;
  } else if (sa.third >= 8 && sb.third >= 8) {
    rule = "进";
    roundedA = sa.firstTwo + 1;
    roundedB = sb.firstTwo + 1;
  } else {
    rule = "一进一舍";
    const aIsSmaller = sa.firstTwo < sb.firstTwo;
    const roundHalfUp = (third: number) => (third >= 5 ? 1 : 0);
    if (aIsSmaller) {
      roundedA = sa.firstTwo + roundHalfUp(sa.third);
      roundedB = sb.firstTwo + (roundHalfUp(sa.third) === 1 ? 0 : 1);
    } else {
      roundedB = sb.firstTwo + roundHalfUp(sb.third);
      roundedA = sa.firstTwo + (roundHalfUp(sb.third) === 1 ? 0 : 1);
    }
  }
  const approxA = build(sa, roundedA);
  const approxB = build(sb, roundedB);
  return { approxA, approxB, estimate: approxA * approxB, rule };
}
