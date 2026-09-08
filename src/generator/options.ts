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
