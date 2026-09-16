/** 资料速算 · 计算功底模块（加法/减法/多项求和/多项求差/乘法平方/除法估算/敏感数/小数） */
import { fmt, round } from "../random";
import { options, tailLockedOptions, tailLockInfo } from "../options";
import type { QuestionDraft, Rng } from "../types";

/** 一个数「十位以上的部分」，用于拆分说明：137 → 130 */
const tensOf = (value: number) => Math.floor(value / 10) * 10;

/**
 * 造一对个位凑十的数（两数个位相加为 10）。
 * 文档讲的「先配成整十再相加」得在题里真用得上，否则只是纸上的方法。
 */
function friendlyPair(
  integer: Rng["integer"],
  min: number,
  max: number,
): [number, number] {
  const a = integer(min, max);
  const unit = (10 - (a % 10)) % 10;
  const base = Math.floor(integer(min, max) / 10) * 10 + unit;
  return [a, Math.min(max, Math.max(min, base))];
}

/**
 * 通用整数选项，一半题按真题习惯让四个选项末位互异（尾数法可用），
 * 另一半把干扰项做成 ±10（漏进位/多退位的典型错法，末位相同 → 尾数法失效，必须算准进借位）。
 * 同时返回解析里该给哪条判断建议——方法讲在文中，也得在选项上体现出来。
 * 调用方保证答案 ≥ 15，不会出现负数选项。
 */
function numericOptions(answer: number, random: () => number) {
  const tailDecisive = random() > 0.5;
  const set = tailDecisive
    ? options(answer, [answer + 1, answer - 1, answer + 2], "", random, 0)
    : options(answer, [answer - 10, answer + 10, answer + 1], "", random, 0);
  return {
    set,
    tip: tailDecisive
      ? `四个选项末位互异，只算个位 ${answer % 10} 就能定位（尾数法）。`
      : `干扰项做成 ±10（多退位/漏进位的典型错法），末位与答案相同或相邻，尾数法难以定位，必须把进借位算准。`,
  };
}

/** 生成两个加数：decimals 0=整数（至多 1/10 凑整对） 1=一位小数 2=两位小数；均不超过三位有效数字 */
function additionOperands(
  integer: Rng["integer"],
  random: () => number,
  level: number,
  decimals: number,
): [number, number] {
  if (decimals === 1) {
    const [lo, hi] = level === 1 ? [12, 98] : [123, 987];
    return [integer(lo, hi) / 10, integer(lo, hi) / 10];
  }
  if (decimals === 2) return [integer(123, 987) / 100, integer(123, 987) / 100];
  const min = level === 1 ? 12 : level === 2 ? 106 : 118;
  const max = level === 1 ? 98 : level === 2 ? 896 : 986;
  return random() > 0.9
    ? friendlyPair(integer, min, max)
    : [integer(min, max), integer(min, max)];
}

/**
 * 加法：只出两项纯加法，不掺减法，每个加数不超过三位有效数字、可带一位/两位小数（小数点在中间）。
 * easy 两位数或一位小数；medium/hard 三位数或带小数（两位小数从 medium 起）。
 */
export function generateAddition(r: Rng): QuestionDraft {
  const { level, integer, random } = r;
  const decimals =
    random() < (level === 1 ? 0.25 : level === 2 ? 0.4 : 0.5)
      ? level >= 2 && random() < 0.5
        ? 2
        : 1
      : 0;
  const [first, second] = additionOperands(integer, random, level, decimals);
  const answer = round(first + second, decimals);
  if (decimals > 0) {
    const step = decimals === 1 ? 0.1 : 0.01;
    const set = options(
      answer,
      [round(answer + step, decimals), round(answer - step, decimals), round(answer + 1, decimals)],
      "",
      random,
      decimals,
    );
    return {
      templateId: decimals === 1 ? "addition-decimal1-v2" : "addition-decimal2-v2",
      params: { expression: `${fmt(first, decimals)}+${fmt(second, decimals)}`, answer },
      stem: `不使用计算器，计算 ${fmt(first, decimals)}+${fmt(second, decimals)}。`,
      ...set,
      explanation: `对齐小数点逐位相加：${fmt(first, decimals)}+${fmt(second, decimals)}=${fmt(answer, decimals)}。干扰项与答案只差 ${step === 0.1 ? "0.1" : "0.01"} 或 1，须保留 ${decimals} 位小数核对。`,
    };
  }
  const tensPart = tensOf(first) + tensOf(second);
  const onesPart = (first % 10) + (second % 10);
  const carry = Math.floor(onesPart / 10);
  const paired = first % 10 !== 0 && (first + second) % 10 === 0;
  const { set, tip } = numericOptions(answer, random);
  return {
    templateId: "addition-pair-v2",
    params: { expression: `${first}+${second}`, answer },
    stem: `不使用计算器，计算 ${first}+${second}。`,
    ...set,
    explanation:
      `拆分相加：${tensOf(first)}+${first % 10}、${tensOf(second)}+${second % 10}；整十部分合计 ${tensPart}、零头合计 ${onesPart}${carry > 0 ? `（向十位进 ${carry}）` : ""}，得 ${answer}。` +
      (paired
        ? `${first} 与 ${second} 的个位刚好凑成 10，先配成整十（${first + second}）再合并更快。`
        : "") +
      tip,
  };
}

/**
 * 减法：只出减法，不掺加法。三种考法——
 * borrow 退位减法（个位不够减）；round-sub 减数凑整（看成整十/整百再补回）；
 * round-minuend 整十/整百/整千被减数（连续借位，如 5000−1346）。
 */
export function generateSubtraction(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const variant =
    level === 1
      ? pick(["borrow", "round-sub"] as const)
      : pick(["borrow", "round-sub", "round-minuend"] as const);
  let minuend = 0;
  let subtrahend = 0;
  let roundBase = 0;
  if (variant === "borrow") {
    const [lo, hi, subLo] =
      level === 1 ? [42, 98, 11] : level === 2 ? [420, 986, 106] : [1650, 4980, 1005];
    minuend = Math.floor(integer(lo, hi) / 10) * 10 + integer(1, 8);
    // 减数个位比被减数大 → 一定借位；高位留余量，保证差 ≥ 16（选项不出负数）
    const high = Math.floor(integer(subLo, minuend - 25) / 10) * 10;
    subtrahend = high + integer((minuend % 10) + 1, 9);
  } else if (variant === "round-sub") {
    const [unitBase, offLo, offHi, baseHi] =
      level === 1 ? [10, 1, 9, 8] : level === 2 ? [100, 11, 39, 9] : [1000, 11, 59, 9];
    roundBase = integer(level === 1 ? 3 : 2, baseHi) * unitBase;
    subtrahend = roundBase - integer(offLo, offHi);
    minuend = integer(
      subtrahend + 16,
      level === 1 ? 99 : level === 2 ? 999 : Math.min(9999, roundBase + 899),
    );
  } else {
    const unitBase = level === 1 ? 10 : level === 2 ? 100 : 1000;
    minuend = integer(level === 1 ? 4 : 2, 9) * unitBase;
    roundBase = minuend;
    subtrahend = integer(unitBase + 5, minuend - 16);
  }
  const answer = minuend - subtrahend;
  const ones = minuend % 10;
  const borrowOnes = subtrahend % 10;
  const method =
    variant === "borrow"
      ? `按位退位：个位 ${ones} 不够减 ${borrowOnes}，从十位借 1 后 ${ones + 10}−${borrowOnes}=${ones + 10 - borrowOnes}，再算高位得 ${answer}。`
      : variant === "round-sub"
        ? `把减数凑整：${minuend}−${subtrahend}=(${minuend}−${roundBase})+${roundBase - subtrahend}=${minuend - roundBase}+${roundBase - subtrahend}。`
        : `被减数是整${level === 1 ? "十" : level === 2 ? "百" : "千"}数：先向它借 1——(${minuend - 1})−${subtrahend}+1=${minuend - 1 - subtrahend}+1，避免个位连续借位。`;
  const { set, tip } = numericOptions(answer, random);
  return {
    templateId: `subtraction-${variant}-v2`,
    params: { expression: `${minuend}-${subtrahend}`, answer },
    stem: `不使用计算器，计算 ${minuend}−${subtrahend}。`,
    ...set,
    explanation: `${method}结果为 ${answer}。验算习惯：差＋减数＝被减数，即 ${answer}+${subtrahend}=${minuend}。${tip}`,
  };
}

/**
 * 多项求和：3~5 项连加。至多 1/10 的题造出「个位凑十」的对子，
 * 让「先配对」与基准数法都是真能省事的做法；其余为普通随机数，练分位相加。
 */
export function generateSumMany(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const count = level === 1 ? 3 : level === 2 ? pick([4, 5]) : 5;
  const min = level === 1 ? 12 : level === 2 ? 106 : 118;
  const max = level === 1 ? 98 : level === 2 ? 896 : 976;
  const values: number[] = [];
  const friendly = random() > 0.9;
  while (values.length + 2 <= count) {
    const [a, b] = friendly
      ? friendlyPair(integer, min, max)
      : [integer(min, max), integer(min, max)];
    values.push(a, b);
  }
  while (values.length < count) values.push(integer(min, max));
  const answer = values.reduce((sum, value) => sum + value, 0);
  const spread = Math.max(...values) - Math.min(...values);
  const base = Math.round(answer / count / 10) * 10;
  let method: string;
  if (count >= 4 && spread <= 45 && base > 0) {
    // 基准数法：各项都挤在同一个整十附近时，比逐项相加稳
    const diffs = values.map((value) => value - base);
    method = `基准数法：以 ${base} 为基准，${values
      .map(
        (value, index) =>
          `${value}=${base}${diffs[index] >= 0 ? "+" : "−"}${Math.abs(diffs[index])}`,
      )
      .join("、")}；基准部分 ${base}×${count}=${base * count}，差值合计 ${diffs.reduce((s, d) => s + d, 0)}`;
  } else {
    const pairs: string[] = [];
    const rest: number[] = [];
    for (let index = 0; index + 1 < values.length; index += 2) {
      if ((values[index] + values[index + 1]) % 10 === 0)
        pairs.push(`${values[index]}+${values[index + 1]}=${values[index] + values[index + 1]}`);
      else rest.push(values[index], values[index + 1]);
    }
    if (values.length % 2 === 1) rest.push(values[values.length - 1]);
    const onesPart = values.reduce((sum, value) => sum + (value % 10), 0);
    const carry = Math.floor(onesPart / 10);
    method =
      pairs.length > 0
        ? `先配对凑整：${pairs.join("、")}${rest.length > 0 ? `；再加其余项 ${rest.join("+")}=${rest.reduce((s, v) => s + v, 0)}` : ""}`
        : `分位相加：整十部分合计 ${values.reduce((sum, value) => sum + tensOf(value), 0)}、零头合计 ${onesPart}${carry > 0 ? `（向十位进 ${carry}）` : ""}`;
  }
  const { set, tip } = numericOptions(answer, random);
  return {
    templateId: `sum-many-${["three", "four", "five"][count - 3]}-v2`,
    params: { expression: values.join("+"), answer },
    stem: `不使用计算器，计算 ${values.join("+")}。`,
    ...set,
    explanation: `${method}，合计 ${answer}。${tip}`,
  };
}

/**
 * 多项求差：公考里以「精确计算」出现（连减求剩余、两组和相减求增量），选项精度一致时可用尾数法。
 * chain：总量 − 各部分 = 剩余（「其余支出」类）；pairs：两组分别求和再相减（同比增加量类）。
 */
export function generateDiffMany(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const variant = pick(["chain", "pairs"] as const);
  const lo = level === 1 ? 12 : level === 2 ? 106 : 118;
  const hi = level === 1 ? 58 : level === 2 ? 486 : 886;
  if (variant === "chain") {
    const partCount = level === 1 ? 2 : 3;
    const parts = Array.from({ length: partCount }, () => integer(lo, hi));
    const partSum = parts.reduce((sum, value) => sum + value, 0);
    const remainder = integer(level === 1 ? 20 : 118, level === 1 ? 98 : hi);
    const total = partSum + remainder;
    const { set, tip } = numericOptions(remainder, random);
    return {
      templateId: "diff-chain-v2",
      params: { expression: [total, ...parts].join("-"), answer: remainder },
      stem: `不使用计算器，计算 ${[total, ...parts].join("−")}。`,
      ...set,
      explanation: `两种算法都行：① 依次连减 ${total}${parts.map((value) => `−${value}`).join("")}=${remainder}；② 先把各部分加起来（${parts.join("+")}=${partSum}），再用总量减：${total}−${partSum}=${remainder}。后者少做几次借位，更稳。${tip}`,
    };
  }
  // pairs：两组数各自求和，保证第一组更大、差值 ≥ 16
  const group = () => [integer(lo, hi), integer(lo, hi)] as [number, number];
  let first = group();
  let second = group();
  if (first[0] + first[1] < second[0] + second[1]) [first, second] = [second, first];
  const gap = first[0] + first[1] - (second[0] + second[1]);
  if (gap < 16) first = [first[0] + (16 - gap), first[1]];
  const firstSum = first[0] + first[1];
  const secondSum = second[0] + second[1];
  const answer = firstSum - secondSum;
  const { set, tip } = numericOptions(answer, random);
  return {
    templateId: "diff-pairs-v2",
    params: { expression: `${first[0]}+${first[1]}-${second[0]}-${second[1]}`, answer },
    stem: `不使用计算器，计算 ${first[0]}+${first[1]}−${second[0]}−${second[1]}。`,
    ...set,
    explanation: `两组各自求和再相减：(${first[0]}+${first[1]})−(${second[0]}+${second[1]})=${firstSum}−${secondSum}=${answer}。逐项对比更快：${first[0]}−${second[0]}=${first[0] - second[0]}、${first[1]}−${second[1]}=${first[1] - second[1]}，两个差值相加仍得 ${answer}（单项差值可能为负，只作中间量）。${tip}`,
  };
}

/** 乘法最优拆分文本：就近整十/整百拆分，返回「算式文本」 */
function roundSplit(a: number, b: number): string | null {
  // 将 a 凑到最近的 10/100 的倍数
  const candidates = [
    { base: Math.round(a / 10) * 10, near: 10 },
    { base: Math.round(a / 100) * 100, near: 100 },
  ].sort((x, y) => Math.abs(x.base - a) - Math.abs(y.base - a));
  for (const cand of candidates) {
    const d = cand.base - a;
    if (d === 0) continue;
    if (Math.abs(d) <= Math.max(3, cand.near / 5) || cand.base > 0) {
      const sign = d > 0 ? "+" : "−";
      const abs = Math.abs(d);
      const rough = cand.base * b;
      return `${a}×${b}=${cand.base}×${b}${sign}${abs}×${b}=${fmt(rough)}${sign}${fmt(abs * b)}=${fmt(a * b)}`;
    }
  }
  return null;
}

export function generateMultiply(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const square = random() > 0.62;
  let a: number;
  let b: number;
  let templateId: string;
  if (square) {
    if (level === 1) {
      a = integer(11, 30);
      templateId = "square-diff-v2";
    } else if (level === 2) {
      a = integer(26, 60);
      templateId = "square-diff-v2";
    } else {
      a = integer(61, 99);
      templateId = "square-round100-v2";
    }
    b = a;
  } else if (level === 1) {
    a = integer(12, 89);
    b = integer(2, 9);
    templateId = "multiply-round-v2";
  } else if (level === 2) {
    a = integer(11, 89);
    b = integer(11, 19);
    templateId = "multiply-round-v2";
  } else {
    a = integer(103, 999);
    b = integer(11, 49);
    templateId = "multiply-round100-v2";
  }
  const answer = a * b;
  const set = tailLockedOptions(answer, random);
  const lock = tailLockInfo(set);
  const tailTip = lock.lastTwoSame
    ? `选项末两位均为 ${String(answer).slice(-2)}，尾数法完全失效，必须完整计算。`
    : `选项末位相同，单看尾数无法定位；干扰项量级接近，需结合完整乘积判断。`;
  let method = "";
  if (square && templateId === "square-round100-v2") {
    const x = 100 - a;
    method = `${a}² 靠近 100，用补数展开：(100−${x})²=10000−200×${x}+${x}²=${fmt(10000 - 200 * x + x * x)}，即 ${answer}。`;
  } else if (square) {
    // 就近整十：d = |a − 最近的整十|
    const near = Math.round(a / 10) * 10;
    const d = Math.abs(a - near);
    if (d === 0) method = `${a}² 可按 ${a}×${a} 直乘：${answer}。`;
    else {
      const lower = a - d;
      const upper = a + d;
      method = `${a}² 用平方差变形：(a−d)(a+d)+d²=(${lower})(${upper})+${d}²=${fmt(lower * upper)}+${d * d}=${fmt(answer)}（整十数与 ${d}² 心算更快）。`;
    }
  } else {
    const split = roundSplit(a, b);
    method = split
      ? `${split}。`
      : `拆分 ${b} 后分配律：${a}×${b}=${a}×${fmt(b - 1)}+${a}=${fmt(a * (b - 1))}+${a}=${fmt(answer)}。`;
  }
  return {
    templateId,
    params: { a, b, answer },
    stem: `不使用计算器，计算 ${a}×${b}。`,
    ...set,
    explanation: `【最优解】${method} ${tailTip}`,
  };
}

export function generateDivide(r: Rng): QuestionDraft {
  const { level, integer, random } = r;
  const divisor = integer(level === 1 ? 4 : 12, level === 1 ? 9 : level === 2 ? 49 : 199);
  const quotient = integer(12, 99 * level);
  const estimate = random() > 0.5;
  const remainder = estimate ? integer(1, Math.max(1, Math.floor(divisor / 3))) : 0;
  const dividend = divisor * quotient + remainder;
  const set = options(quotient, [quotient - 1, quotient + 1, quotient + 10], "", random, 0);
  return {
    templateId: estimate ? `division-estimate-${level}-v2` : `division-exact-${level}-v2`,
    params: { dividend, divisor, quotient, remainder },
    stem: `不使用计算器，${estimate ? "估算" : "计算"} ${dividend}÷${divisor}${estimate ? "（取最接近的整数）" : ""}。`,
    ...set,
    explanation: estimate
      ? `先看 ${divisor} 的整数倍：${divisor}×${quotient}=${divisor * quotient}，余 ${remainder} 不足半个除数（${divisor}÷2≈${fmt(divisor / 2)}），因此最接近 ${quotient}。`
      : `直除首商：${divisor}×${quotient}=${dividend} 恰好整除，所以商为 ${quotient}（选项 ±1 是估算余数时的常见误判）。`,
  };
}

export function generateSensitive(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const denominator = pick(level === 1 ? [4, 5, 8, 10] : level === 2 ? [6, 8, 12, 16] : [7, 11, 13, 16]);
  const numerator = integer(1, Math.min(3, denominator - 1));
  const unit = integer(4 * level, 24 * level) * 10;
  const part = unit * numerator;
  const whole = unit * denominator;
  const percent = round((100 * numerator) / denominator, 1);
  const variant = integer(0, 2);
  if (variant === 0) {
    const set = options(whole, [part * (denominator - numerator), part * denominator, whole + unit], " 亿元", random);
    return {
      templateId: "sensitive-fraction-to-whole-v2",
      params: { denominator, numerator, part, whole },
      stem: `某地区高新技术企业实现营业收入 ${part} 亿元，占全部规上企业营业收入的 ${percent}%。全部规上企业营业收入约为多少亿元？`,
      ...set,
      explanation: `识别“部分÷占比=整体”。${percent}%≈${numerator}/${denominator}（百化分）；按份数算：${part}÷${numerator}×${denominator}=${whole} 亿元。`,
    };
  }
  if (variant === 1) {
    const answer = round((part / whole) * 100, 1);
    const set = options(answer, [round(100 / denominator, 1), round((100 * (denominator - numerator)) / denominator, 1), round(answer + 5, 1)], "%", random, 1);
    return {
      templateId: "sensitive-share-v2",
      params: { denominator, numerator, part, whole },
      stem: `某行业完成投资 ${part} 亿元，全行业投资为 ${whole} 亿元。该行业投资占比约为多少？`,
      ...set,
      explanation: `占比=部分÷整体=${part}÷${whole}=${numerator}/${denominator}≈${answer}%。先约成敏感分数再转百分数，避免长除法。`,
    };
  }
  const rate = pick([10, 20, 25]);
  const current = Math.round((unit * (100 + rate)) / 100);
  const growth = current - unit;
  const set = options(growth, [Math.round((current * rate) / 100), unit, current - growth], " 万吨", random);
  return {
    templateId: "sensitive-growth-shares-v2",
    params: { current, rate, unit, growth },
    stem: `某产品本期产量为 ${current} 万吨，同比增长 ${rate}%。按份数法估算增长量是多少万吨？`,
    ...set,
    explanation: `同比增长 ${rate}% 时基期视为 100 份、本期为 ${100 + rate} 份：基期=${current}÷${100 + rate}×100=${unit}，增长量=${current}−${unit}=${growth} 万吨。`,
  };
}

export function generateDecimal(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const digits = level === 1 ? 1 : 2;
  const factor = 10 ** digits;
  const a = integer(80 * level, 300 * level) / factor;
  const b = integer(20 * level, 90 * level) / factor;
  const variant = integer(0, 2);
  if (variant < 2) {
    const operation = variant === 0 ? "+" : "-";
    const left = operation === "-" ? Math.max(a, b) : a;
    const right = operation === "-" ? Math.min(a, b) : b;
    const answer = round(operation === "+" ? left + right : left - right, digits);
    const set = options(answer, [round(answer + 1 / factor, digits), round(answer - 1 / factor, digits), round(left + right, digits)], "", random, digits);
    return {
      templateId: `decimal-${operation === "+" ? "add" : "subtract"}-v2`,
      params: { left, right, operation, digits },
      stem: `某表两项数值分别为 ${fmt(left, digits)} 和 ${fmt(right, digits)}，求二者${operation === "+" ? "合计" : "差值"}。`,
      ...set,
      explanation: `对齐小数点逐位${operation === "+" ? "相加" : "相减"}：${fmt(left, digits)}${operation}${fmt(right, digits)}=${fmt(answer, digits)}。选项只差 ${1 / factor} 时务必保留 ${digits} 位小数核对。`,
    };
  }
  const multiplier = pick([1.1, 1.2, 1.25, 1.5]);
  const answer = round(a * multiplier, digits);
  const set = options(answer, [round(a + multiplier, digits), round(a * (multiplier - 1), digits), round(answer + 1 / factor, digits)], "", random, digits);
  return {
    templateId: "decimal-multiply-split-v2",
    params: { a, multiplier, digits },
    stem: `某指标为 ${fmt(a, digits)}，调整后为原来的 ${multiplier} 倍，调整后的数值是多少？`,
    ...set,
    explanation: `拆 ${multiplier}=1+${fmt(multiplier - 1, 2)}：${fmt(a, digits)}×${multiplier}=${fmt(a, digits)}+${fmt(round(a * (multiplier - 1), digits), digits)}=${fmt(answer, digits)}。`,
  };
}
