/** 数字推理 · 进阶类：幂次数列/递推数列/分数数列/机械划分/因数分解 */
import { buildSequence, PRIMES } from "./helpers";
import type { QuestionDraft, Rng } from "../types";

export function generateSeqPower(r: Rng): QuestionDraft {
  const { level, integer, random } = r;
  const variant = integer(0, 3);
  const base = integer(level === 1 ? 2 : 3, level === 3 ? 8 : level === 2 ? 9 : 6);
  if (variant === 0) {
    // 连续平方
    const terms = Array.from({ length: 6 }, (_, i) => (base + i) ** 2);
    const shown = terms.slice(0, 5);
    const answer = terms[5];
    return buildSequence(
      {
        templateId: "seq-power-square-v1",
        params: { base },
        shown,
        answer,
        distractors: [(base + 6) ** 2, terms[4] + (base + 5), (base + 4) ** 2],
        explanation: `各项是连续整数 ${base}～${base + 4} 的平方：${shown.map((v, i) => `${base + i}²=${v}`).join("，")}，括号中=${base + 5}²=${answer}。干扰项 (${base + 6})² 是位置看多了一位。`,
      },
      random,
    );
  }
  if (variant === 1) {
    // 连续立方
    const b = integer(2, level === 3 ? 6 : 5);
    const terms = Array.from({ length: 6 }, (_, i) => (b + i) ** 3);
    const shown = terms.slice(0, 5);
    const answer = terms[5];
    return buildSequence(
      {
        templateId: "seq-power-cube-v1",
        params: { base: b },
        shown,
        answer,
        distractors: [(b + 6) ** 3, terms[4] + (b + 5) ** 2, (b + 4) ** 3],
        explanation: `各项是连续整数 ${b}～${b + 4} 的立方：${shown.map((v, i) => `${b + i}³=${v}`).join("，")}，括号中=${b + 5}³=${answer}。`,
      },
      random,
    );
  }
  if (variant === 2) {
    // 平方修正 ±c
    const c = integer(1, 3) * (random() > 0.5 ? 1 : -1);
    const terms = Array.from({ length: 6 }, (_, i) => (base + i) ** 2 + c);
    const shown = terms.slice(0, 5);
    const answer = terms[5];
    return buildSequence(
      {
        templateId: "seq-power-correction-v1",
        params: { base, c },
        shown,
        answer,
        distractors: [(base + 5) ** 2, (base + 6) ** 2 + c, terms[4] + (base + 5) * 2 + 1],
        explanation: `数值接近平方数 → 幂次修正：${shown.map((v, i) => `${base + i}²${c > 0 ? "+" : "−"}${Math.abs(c)}=${v}`).join("，")}。括号中=${base + 5}²${c > 0 ? "+" : "−"}${Math.abs(c)}=${answer}。干扰项 (${base + 5})²=${(base + 5) ** 2} 是漏掉修正项。`,
      },
      random,
    );
  }
  // 平方/立方交错
  const b = integer(2, 4);
  const terms = Array.from({ length: 7 }, (_, i) => {
    const k = Math.floor(i / 2);
    return i % 2 === 0 ? (b + k) ** 2 : (b + k) ** 3;
  });
  const shown = terms.slice(0, 6);
  const answer = terms[6];
  return buildSequence(
    {
      templateId: "seq-power-alternate-v1",
      params: { base: b },
      shown,
      answer,
      distractors: [terms[5] * (b + 2), (b + 2) ** 2, (b + 1) ** 3],
      explanation: `奇偶位分别是平方与立方交错：${shown.map((v, i) => `${b + Math.floor(i / 2)}${i % 2 === 0 ? "²" : "³"}=${v}`).join("，")}。括号（第 7 项）为平方位：${b + 3}²=${answer}。`,
    },
    random,
  );
}

export function generateSeqRecursive(r: Rng): QuestionDraft {
  const { level, integer, random } = r;
  const variant = integer(0, 3);
  const a = integer(1, level === 1 ? 5 : 8);
  const b = integer(1, level === 1 ? 5 : 8);
  const terms: number[] = [a, b];
  let templateId = "";
  let rule = "";
  if (variant === 0) {
    // 和递推
    for (let i = 0; i < 5; i += 1) terms.push(terms[i] + terms[i + 1]);
    templateId = "seq-recursive-sum-v1";
    rule = `前两项之和等于第三项`;
  } else if (variant === 1) {
    // 和递推 + 修正 k
    const k = integer(1, 2) * (random() > 0.4 ? 1 : -1);
    terms.push(a + b + k);
    for (let i = 1; i < 5; i += 1) terms.push(terms[i] + terms[i + 1] + k);
    templateId = "seq-recursive-sum-k-v1";
    rule = `前两项之和${k > 0 ? `再加 ${k}` : `再减 ${Math.abs(k)}`}等于第三项`;
  } else if (variant === 2) {
    // 倍和递推：a_{n+2}=2·a_{n+1}+a_n
    for (let i = 0; i < 5; i += 1) terms.push(2 * terms[i + 1] + terms[i]);
    templateId = "seq-recursive-scale-v1";
    rule = `第三项=前项×2+再前一项（${b}×2+${a}=${terms[2]}，逐项验证）`;
  } else {
    // 差递推：a_{n+2}=a_{n+1}−a_n
    for (let i = 0; i < 5; i += 1) terms.push(terms[i + 1] - terms[i]);
    templateId = "seq-recursive-diff-v1";
    rule = `第三项=第二项−第一项`;
  }
  const shown = terms.slice(0, 6);
  const answer = terms[6];
  const last = shown[5];
  const d = last - shown[4];
  return buildSequence(
    {
      templateId,
      params: { a, b },
      shown,
      answer,
      distractors: [answer + d, answer - d, shown[5] + (shown[5] - shown[4]) + 1],
      explanation: `${rule}：回代验证 ${shown[2]}=${shown[0]}+${shown[1]}、${shown[3]}=${shown[1]}+${shown[2]}…，故括号中=${shown[4]}${variant === 3 ? "−" : "+"}${last}=${answer}。`,
    },
    random,
  );
}

export function generateSeqFraction(r: Rng): QuestionDraft {
  const { level, integer, random } = r;
  const variant = integer(0, 3);
  const span = level === 1 ? 4 : 9;
  const frac = (num: number, den: number) => `${num}/${den}`;
  if (variant === 0) {
    // 分子分母分别等差
    const n0 = integer(1, span);
    const nd = integer(1, 2);
    const d0 = integer(Math.max(2, n0), span + 4);
    const dd = integer(1, 2);
    const shown = Array.from({ length: 5 }, (_, i) => frac(n0 + nd * i, d0 + dd * i));
    const answerNum = n0 + nd * 5;
    const answerDen = d0 + dd * 5;
    return buildSequence(
      {
        templateId: "seq-fraction-columns-v1",
        params: { n0, nd, d0, dd },
        shown,
        answer: frac(answerNum, answerDen),
        distractors: [frac(answerNum + nd, answerDen), frac(answerNum, answerDen + dd), frac(answerNum - nd, answerDen)],
        explanation: `分数数列先拆分子分母：分子 ${shown.map((s) => s.split("/")[0]).join("、")} 为公差 ${nd} 的等差，分母 ${shown.map((s) => s.split("/")[1]).join("、")} 为公差 ${dd} 的等差。括号中=${answerNum}/${answerDen}。`,
      },
      random,
    );
  }
  if (variant === 1) {
    // 斐波那契型：分母=下一项分子
    const fib = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
    const shift = integer(0, 2);
    const shown = Array.from({ length: 5 }, (_, i) => frac(fib[i + 1 + shift], fib[i + 2 + shift]));
    const answer = frac(fib[6 + shift], fib[7 + shift]);
    const wrong = frac(fib[7 + shift], fib[8 + shift]);
    return buildSequence(
      {
        templateId: "seq-fraction-fib-v1",
        params: { shift },
        shown,
        answer,
        distractors: [wrong, frac(fib[5 + shift], fib[7 + shift]), frac(fib[6 + shift], fib[6 + shift] + fib[7 + shift] + 1)],
        explanation: `分子分母各自成斐波那契列且分子=前项分母：${shown.join("、")}（1、1、2、3、5、8、13…每隔一项）。括号中=${answer}。干扰项 ${wrong} 是分子分母各推两格（把分母同时用作下一项分子时位置多推了）。`,
      },
      random,
    );
  }
  if (variant === 2) {
    // 分子等差、分母=分子+常数偏移
    const n0 = integer(1, 3);
    const nd = integer(1, 2);
    const off = integer(2, 4);
    const shown = Array.from({ length: 5 }, (_, i) => frac(n0 + nd * i, n0 + nd * i + off));
    const answerNum = n0 + nd * 5;
    return buildSequence(
      {
        templateId: "seq-fraction-offset-v1",
        params: { n0, nd, off },
        shown,
        answer: frac(answerNum, answerNum + off),
        distractors: [frac(answerNum, answerNum + off + 1), frac(answerNum + nd, answerNum + off), frac(answerNum - nd, answerNum + off)],
        explanation: `分子 ${shown.map((s) => s.split("/")[0]).join("、")} 等差（公差 ${nd}），分母始终比分子大 ${off}（先约分验证是否已最简）。括号中=${answerNum}/(${answerNum}+${off})=${frac(answerNum, answerNum + off)}。`,
      },
      random,
    );
  }
  // 分子质数、分母合数（互质设计）
  const composites = COMPOSITE_START();
  const maxStart = Math.max(0, Math.min(PRIMES.length - 12, composites.length - 7));
  const p0 = integer(0, maxStart);
  const primes = PRIMES.filter((p) => p > 2).slice(p0, p0 + 6);
  const denoms = composites.slice(p0, p0 + 6);
  const shown = Array.from({ length: 5 }, (_, i) => frac(primes[i], denoms[i]));
  const answer = frac(primes[5], denoms[5]);
  return buildSequence(
    {
      templateId: "seq-fraction-prime-composite-v1",
      params: { p0 },
      shown,
      answer,
      distractors: [frac(primes[5], denoms[5] + 1), frac(primes[4], denoms[5]), frac(primes[5], denoms[5] + 2)],
      explanation: `分子为质数列：${shown.map((s) => s.split("/")[0]).join("、")}；分母为合数列：${shown.map((s) => s.split("/")[1]).join("、")}。括号中=${answer}（写答案前先看分子分母能否约分）。`,
    },
    random,
  );
}

/** 生成可用的合数片段（与质数下标配合，保证首项互质校验由调用侧设计数据） */
function COMPOSITE_START() {
  const list: number[] = [];
  for (let n = 4; n <= 40; n += 1) if (!PRIMES.includes(n)) list.push(n);
  return list;
}

function digitsOk(terms: number[], maxDigits: number) {
  return terms.every((v) => String(v).length <= maxDigits && v >= 0);
}

export function generateSeqSplit(r: Rng): QuestionDraft {
  const { integer, random } = r;
  const variant = integer(0, 2);
  if (variant === 0) {
    // 两位项：十位、个位各自成等差（可反向）
    let tens: number[] = [];
    let units: number[] = [];
    for (let attempt = 0; attempt < 20 && !digitsOk(tens, 1); attempt += 1) {
      const st = integer(3, 5);
      const su = integer(3, 5);
      const dt = random() > 0.5 ? 1 : -1;
      const du = random() > 0.5 ? 1 : -1;
      tens = Array.from({ length: 7 }, (_, i) => st + dt * i);
      units = Array.from({ length: 7 }, (_, i) => su + du * i);
    }
    const terms = tens.map((t, i) => t * 10 + units[i]);
    const shown = terms.slice(0, 6);
    const answer = terms[6];
    const nextT = tens[6];
    const nextU = units[6];
    return buildSequence(
      {
        templateId: "seq-split-two-v1",
        params: { nextT, nextU },
        shown,
        answer,
        distractors: [(nextT + 1) * 10 + nextU, nextT * 10 + nextU + 1, shown[4]],
        explanation: `各项位数拆开看：十位 ${tens.slice(0, 6).join("、")}（公差 ${tens[1] - tens[0]}），个位 ${units.slice(0, 6).join("、")}（公差 ${units[1] - units[0]}）。括号中十位 ${nextT}、个位 ${nextU}，即 ${answer}。干扰项是只沿其中一列推进的错位值。`,
      },
      random,
    );
  }
  if (variant === 1) {
    // 逐位拼接：1、12、123、1234…
    const terms: string[] = [];
    for (let i = 1; i <= 6; i += 1) terms.push(Array.from({ length: i }, (_, k) => k + 1).join(""));
    const shownList = terms.slice(0, 5);
    const answerText = terms[5];
    return buildSequence(
      {
        templateId: "seq-split-concat-v1",
        params: { n: 6 },
        shown: shownList,
        answer: answerText,
        distractors: [Array.from({ length: 7 }, (_, k) => k + 1).join(""), terms[4] + "0", "123451"],
        explanation: `位数逐项 +1，且每一位依次从 1 开始连续写：${shownList.join("、")} → 第 6 项为 6 位数 ${answerText}。这类“拼接型”不要当作整体数值运算，按位数拆分观察。`,
      },
      random,
    );
  }
  // 三位项：百/十/个位三列各成等差
  let hundreds: number[] = [];
  let tens: number[] = [];
  let units: number[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const sh = integer(2, 4);
    const st = integer(3, 5);
    const su = integer(4, 6);
    const dh = random() > 0.4 ? 1 : -1;
    const dt = random() > 0.4 ? 1 : -1;
    const du = random() > 0.4 ? 1 : -1;
    hundreds = Array.from({ length: 7 }, (_, i) => sh + dh * i);
    tens = Array.from({ length: 7 }, (_, i) => st + dt * i);
    units = Array.from({ length: 7 }, (_, i) => su + du * i);
    if (digitsOk([...hundreds, ...tens, ...units], 1)) break;
  }
  const terms = hundreds.map((h, i) => h * 100 + tens[i] * 10 + units[i]);
  const shown = terms.slice(0, 6);
  const answer = terms[6];
  const next = { h: hundreds[6], t: tens[6], u: units[6] };
  return buildSequence(
    {
      templateId: "seq-split-three-v1",
      params: { ...next },
      shown,
      answer,
      distractors: [
        (next.h + 1) * 100 + next.t * 10 + next.u,
        next.h * 100 + (next.t + 1) * 10 + next.u,
        shown[5] + 1,
      ],
      explanation: `三位数拆分：百位 ${hundreds.slice(0, 6).join("、")}、十位 ${tens.slice(0, 6).join("、")}、个位 ${units.slice(0, 6).join("、")} 各成等差。括号中=${answer}（每一位分别推进后再拼回）。`,
    },
    random,
  );
}

export function generateSeqFactor(r: Rng): QuestionDraft {
  const { integer, random } = r;
  const variant = integer(0, 2);
  if (variant === 0) {
    // 常数因子 × 连续质数
    const c = integer(3, 8);
    const start = integer(0, Math.max(0, PRIMES.length - 7));
    const slice = PRIMES.slice(start, start + 6);
    const terms = slice.map((p) => c * p);
    const shown = terms.slice(0, 5);
    const answer = terms[5];
    const nextP = slice[5];
    return buildSequence(
      {
        templateId: "seq-factor-const-prime-v1",
        params: { c, pStart: start },
        shown,
        answer,
        distractors: [(c + 1) * nextP, c * (PRIMES[start + 6] ?? nextP + 2), c * slice[4]],
        explanation: `各项都有公因子 ${c}：${shown.join("、")}÷${c}=${slice.slice(0, 5).join("、")}，是连续质数列。括号中=${c}×${nextP}=${answer}。干扰项 (${c + 1})×${nextP} 是漏提公因子后继续加 c。`,
      },
      random,
    );
  }
  if (variant === 1) {
    // 相邻质数之积
    const start = integer(0, Math.max(0, PRIMES.length - 9));
    const slice = PRIMES.slice(start, start + 8);
    const terms = Array.from({ length: 6 }, (_, i) => slice[i] * slice[i + 1]);
    const shown = terms.slice(0, 5);
    const answer = terms[5];
    const [p1, p2] = [slice[5], slice[6]];
    return buildSequence(
      {
        templateId: "seq-factor-adjacent-prime-v1",
        params: { pStart: start },
        shown,
        answer,
        distractors: [slice[5] * slice[7], slice[6] * slice[7], slice[4] * slice[5]],
        explanation: `每项=相邻两个质数相乘：${shown.map((v, i) => `${slice[i]}×${slice[i + 1]}=${v}`).join("，")}。括号中=${p1}×${p2}=${answer}（跳过一对或多乘一位均为干扰）。`,
      },
      random,
    );
  }
  // 常数因子 × 连续整数
  const c = integer(4, 9);
  const k0 = integer(2, 6);
  const terms = Array.from({ length: 6 }, (_, i) => c * (k0 + i));
  const shown = terms.slice(0, 5);
  const answer = terms[5];
  return buildSequence(
    {
      templateId: "seq-factor-consecutive-v1",
      params: { c, k0 },
      shown,
      answer,
      distractors: [(c + 1) * (k0 + 5), c * (k0 + 6), c * (k0 + 4)],
      explanation: `公因子 ${c}：${shown.join("、")}÷${c}=${Array.from({ length: 5 }, (_, i) => k0 + i).join("、")}，为连续整数。括号中=${c}×${k0 + 5}=${answer}。`,
    },
    random,
  );
}
