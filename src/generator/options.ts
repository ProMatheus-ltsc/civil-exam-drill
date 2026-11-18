/** 选项构造工具 */
import { fmt, round } from "./random";

export type OptionSet = {
  options: [string, string, string, string];
  answerIndex: 0 | 1 | 2 | 3;
};

/** 单次选项构造的诊断记录：deduped < 4 说明干扰项去重后不够，已触发自动补数 */
export type OptionDiagnostic = { answer: number; distractors: number; deduped: number };

const diagnostics: OptionDiagnostic[] = [];
/** 只在回归测试里开启；生产常驻进程不记录，避免无限累积 */
let diagnosticsEnabled = false;

/**
 * 执行一段生成逻辑并收集期间的选项诊断。
 * 用法：`const { items } = collectOptionDiagnostics(() => generateQuestion(...))`
 */
export function collectOptionDiagnostics<T>(run: () => T): { result: T; items: OptionDiagnostic[] } {
  const previous = diagnosticsEnabled;
  diagnosticsEnabled = true;
  diagnostics.length = 0;
  try {
    return { result: run(), items: [...diagnostics] };
  } finally {
    diagnostics.length = 0;
    diagnosticsEnabled = previous;
  }
}

/**
 * 通用数值选项：answer + 干扰项 → 去重 → 洗牌。
 * 干扰项不足 3 个时自动补（基于 answer 的步进），保证永远 4 个互异选项。
 *
 * 副作用要当心：**去重后不足 4 个就等于「干扰项设计失效」**——自动补出来的是
 * answer±step×n 这种纯凑数的项，既不是常见错解，解析也没法解释它。
 * 回归测试靠 `collectOptionDiagnostics` 把这种情况抓出来。
 */
export function options(
  answer: number,
  distractors: number[],
  suffix: string,
  random: () => number,
  digits = 2,
): OptionSet {
  const values = [answer, ...distractors].map((value) => round(value, digits));
  // 干扰项可以多给（多于 3 个时后面的当备胎）：与答案撞车的会被去重，备胎顶上；
  // 这里必须截到 4，否则调用方多传一个就会出 5 个选项。
  const unique = [...new Set(values)].slice(0, 4);
  if (diagnosticsEnabled) {
    diagnostics.push({ answer, distractors: distractors.length, deduped: unique.length });
  }
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

/** 干扰项候选：`value` 是数值本身，`why` 是它在解析里的「错在哪」（解析要能逐项点名） */
export type DistractorCandidate = { value: number; why: string };

/** 选项相对差距的硬底线：低于 2% 的项一律不要 */
const MIN_RELATIVE_GAP = 0.02;
/** 舒适区：真实考试里选项大多差 5% 以上，估到首位有效数字就能定答案 */
const COMFORT_RELATIVE_GAP = 0.05;
/** 上限：差一倍以上的干扰项等于白送分（数量级都错了，不用算也能排除），只当备胎 */
const MAX_RELATIVE_GAP = 0.45;

/**
 * 按「相对差距」挑选干扰项——资料分析真题口径。
 *
 * 背景：选项挨得太近（<2%）时，估算、截位、判方向这些方法全部失效，
 * 题目退化成「精确到个位」的硬算，和「速算」这个训练目标自相矛盾；
 * 而选项离得太远（>50%）又等于白送分。这里统一按差距落位：
 *
 * - **2% 是硬底线**：低于 2% 的候选直接弃用；
 * - **5%~45% 是主力**：至少要有 2 个候选落在这里，否则返回 `null` 让调用方换数据重出；
 * - **2%~5% 只留一个**：默认不用，偶尔（约三成）替换一个宽差项，作为高难题「多看一位」的保留节目；
 * - **超过 45% 的降级为备胎**：只有主力不够 3 个时才顶上（口径错到数量级的那种错解）。
 *
 * 返回 `null` 而不是硬补数：`options()` 的自动补数是 `answer±5%·k` 这种纯凑数项，
 * 解析里没法逐项点名，等于把一个错误的干扰项塞进卷子。
 */
export function spacedDistractors(
  answer: number,
  candidates: DistractorCandidate[],
  random: () => number,
  digits = 0,
): DistractorCandidate[] | null {
  if (!Number.isFinite(answer) || answer <= 0) return null;
  const used = new Set<number>([round(answer, digits)]);
  const comfort: DistractorCandidate[] = [];
  const narrow: DistractorCandidate[] = [];
  const far: DistractorCandidate[] = [];
  for (const candidate of candidates) {
    const value = round(candidate.value, digits);
    if (!Number.isFinite(value) || value <= 0 || used.has(value)) continue;
    used.add(value);
    const gap = Math.abs(value - answer) / answer;
    if (gap < MIN_RELATIVE_GAP) continue;
    const item = { value, why: candidate.why };
    if (gap < COMFORT_RELATIVE_GAP) narrow.push(item);
    else if (gap > MAX_RELATIVE_GAP) far.push(item);
    else comfort.push(item);
  }
  // 主力项不足 2 个：这组数据的选项天生挤在一起（或只能靠数量级错解凑数），换数据重出比硬凑更诚实
  if (comfort.length < 2) return null;
  const shuffle = (list: DistractorCandidate[]) => {
    for (let index = list.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [list[index], list[target]] = [list[target], list[index]];
    }
    return list;
  };
  const picked = [...shuffle(comfort), ...shuffle(far)].slice(0, 3);
  if (picked.length < 3) {
    // 主力不够才动用窄差项，且最多一个（2%~5% 是「个别」，不能成了主力）
    picked.push(...shuffle(narrow).slice(0, 3 - picked.length));
  } else if (narrow.length > 0 && random() < 0.3) {
    picked[2] = narrow[0];
  }
  return picked.length === 3 ? picked : null;
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
