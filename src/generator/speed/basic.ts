/** 资料速算 · 计算功底模块（加减/乘法平方/除法估算/敏感数/小数） */
import { fmt, round } from "../random";
import { options, tailLockedOptions, tailLockInfo } from "../options";
import type { QuestionDraft, Rng } from "../types";

export function generateArithmetic(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const count = level === 1 ? 2 : pick([2, 3]);
  const many = level === 3 && random() > 0.5;
  const values = Array.from({ length: many ? 4 : count }, () => integer(12 * level, 99 * level));
  const subtract = !many && count === 2 && random() > 0.5;
  const left = subtract ? Math.max(...values) : values[0];
  const right = subtract ? Math.min(...values) : values[1];
  const answer = subtract ? left - right : values.reduce((sum, value) => sum + value, 0);
  const expression = subtract ? `${left}-${right}` : values.join("+");
  const set = options(answer, [answer - 10, answer + 10, answer + (subtract ? 1 : values[0] ?? 10)], "", random, 0);
  return {
    templateId: many ? "arithmetic-sum-many-v2" : subtract ? "arithmetic-subtract-v2" : `arithmetic-sum-${count}-v2`,
    params: { expression, answer },
    stem: `不使用计算器，计算 ${expression}。`,
    ...set,
    explanation: many
      ? `先把个位能凑成 10 的数配对（如 ${values[0] ?? ""}+${values[1] ?? ""}=${(values[0] ?? 0) + (values[1] ?? 0)}），再逐对相加，结果为 ${answer}。`
      : subtract
        ? `按位退位计算，并用“差+减数=被减数”验算：${answer}+${right}=${left}。`
        : `优先把个位凑整成 10 的数配对，再合并其余项：${values.join("、")} 相加为 ${answer}。`,
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
