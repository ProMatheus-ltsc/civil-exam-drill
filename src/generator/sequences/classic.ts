/** 数字推理 · 经典类：基础数列/多级数列/多重数列/周期数列 */
import { buildSequence, PRIMES, COMPOSITES } from "./helpers";
import type { QuestionDraft, Rng } from "../types";

export function generateSeqBasic(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const variant = integer(0, 3);
  const span = level === 1 ? 30 : level === 2 ? 90 : 260;
  if (variant === 0) {
    // 等差
    const d = integer(2, Math.max(3, Math.round(span / 14))) * (random() > 0.35 ? 1 : -1);
    const a0 = integer(1, span);
    const terms = Array.from({ length: 6 }, (_, i) => a0 + d * i);
    const shown = terms.slice(0, 5);
    const answer = terms[5];
    return buildSequence(
      {
        templateId: "seq-arith-v1",
        params: { a0, d },
        shown,
        answer,
        distractors: [answer + d, answer - d, answer + (Math.abs(d) >= 2 ? 1 : 3)],
        explanation: `相邻两项差恒定（公差 ${d}）：${shown.join("、")}。后项比前项${d > 0 ? "大" : "小"} ${Math.abs(d)}，括号中=${answer - d}+(${d})=${answer}。${answer + d} 是按公差的一倍而非两倍继续推的干扰值。`,
      },
      random,
    );
  }
  if (variant === 1) {
    // 等比
    const ratio = pick([2, 3, -2, 4]);
    const a0 = integer(level === 1 ? 1 : 2, 24);
    const terms = Array.from({ length: 6 }, (_, i) => a0 * ratio ** i);
    const shown = terms.slice(0, 5);
    const answer = terms[5];
    return buildSequence(
      {
        templateId: "seq-geo-v1",
        params: { a0, ratio },
        shown,
        answer,
        distractors: [answer * ratio, a0 * ratio ** 4, answer + ratio],
        explanation: `相邻两项比值恒定（公比 ${ratio}）：${shown.join("、")}。后项=前项×${ratio}，括号中=${shown[4]}×${ratio}=${answer}。${answer * ratio} 是继续再乘了一次（位置看多了一项）。`,
      },
      random,
    );
  }
  if (variant === 2) {
    // 连续质数
    const start = integer(0, Math.max(0, PRIMES.length - 7));
    const terms = PRIMES.slice(start, start + 6);
    const shown = terms.slice(0, 5);
    const answer = terms[5];
    return buildSequence(
      {
        templateId: "seq-prime-v1",
        params: { start },
        shown,
        answer,
        distractors: [answer + 2, PRIMES[start + 6] ?? answer + 4, answer - 2],
        explanation: `从小到大排列的质数列：${shown.join("、")}（只能被 1 和自身整除）。下一个质数为 ${answer}，${answer + 2} 是合数、${PRIMES[start + 6] ?? ""} 是跳了一位，均需逐个校验质数表排除。`,
      },
      random,
    );
  }
  // 连续合数
  const start = integer(0, Math.max(0, COMPOSITES.length - 7));
  const terms = COMPOSITES.slice(start, start + 6);
  const shown = terms.slice(0, 5);
  const answer = terms[5];
  const nextPrime = PRIMES.find((p) => p > answer) ?? answer + 1;
  return buildSequence(
    {
      templateId: "seq-composite-v1",
      params: { start },
      shown,
      answer,
      distractors: [nextPrime, answer + 2, answer - 1],
      explanation: `连续合数列：${shown.join("、")}。合数=大于 1 的非质数；紧跟在 ${shown[4]} 后面的 ${nextPrime} 是质数要跳过，故括号中=${answer}。易错点是把质数当合数提前截断。`,
    },
    random,
  );
}

export function generateSeqMultilevel(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const variant = integer(0, 3);
  const a0 = integer(level === 1 ? 0 : 5, 40);
  let templateId = "";
  let params: Record<string, number | string> = {};
  let terms: number[] = [a0];
  let rule = "";
  if (variant === 0) {
    // 一阶差成等差
    const d1 = integer(2, 6) * (random() > 0.4 ? 1 : -1);
    const ds = integer(1, 3) * (random() > 0.3 ? 1 : -1);
    let diff = d1;
    for (let i = 0; i < 6; i += 1) {
      terms.push(terms[i] + diff);
      diff += ds;
    }
    templateId = "seq-diff-arith-v1";
    params = { a0, d1, ds };
    rule = `一阶差为 ${terms.slice(1).map((_, i) => terms[i + 1] - terms[i]).join("、")}，是公差 ${ds} 的等差数列`;
  } else if (variant === 1) {
    // 一阶差成等比
    const d1 = integer(1, 6);
    const ratio = pick([2, -2, 3]);
    let diff = d1;
    for (let i = 0; i < 6; i += 1) {
      terms.push(terms[i] + diff);
      diff *= ratio;
    }
    templateId = "seq-diff-geo-v1";
    params = { a0, d1, ratio };
    rule = `一阶差为 ${terms.slice(1).map((_, i) => terms[i + 1] - terms[i]).join("、")}，是公比 ${ratio} 的等比数列`;
  } else if (variant === 2) {
    // 二阶差恒为等差（一阶差自身等差）
    const d1 = integer(2, 8) * (random() > 0.3 ? 1 : -1);
    const c = integer(2, 5);
    let diff = d1;
    for (let i = 0; i < 6; i += 1) {
      terms.push(terms[i] + diff);
      diff += c;
    }
    templateId = "seq-diff-second-v1";
    params = { a0, d1, c };
    rule = `一阶差为 ${terms.slice(1).map((_, i) => terms[i + 1] - terms[i]).join("、")}，二阶差恒为 ${c}`;
  } else {
    // 一阶差成质数列
    const start = integer(0, PRIMES.length - 7);
    const diffs = PRIMES.slice(start, start + 6);
    for (let i = 0; i < 6; i += 1) terms.push(terms[i] + diffs[i]);
    templateId = "seq-diff-prime-v1";
    params = { a0, pStart: start };
    rule = `一阶差为 ${diffs.join("、")}，是连续质数列`;
  }
  const answer = terms[6];
  const shown = terms.slice(0, 6);
  const nextDiff = answer - shown[5];
  const distractors = [shown[5] + nextDiff * 2, shown[5] + (shown[5] - shown[4]), shown[5] - nextDiff];
  return buildSequence(
    {
      templateId,
      params,
      shown,
      answer,
      distractors,
      explanation: `原数列起伏大，先作差：${rule}，故下一差=${nextDiff}，括号中=${shown[5]}+(${nextDiff})=${answer}。`,
    },
    random,
  );
}

export function generateSeqMultiple(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const variant = integer(0, 3);
  const span = level === 1 ? 40 : level === 2 ? 120 : 300;
  let templateId = "";
  let params: Record<string, number | string> = {};
  let shown: number[] = [];
  let answer = 0;
  let rule = "";
  if (variant === 0) {
    // 奇偶交叉：两列分别等差
    const o0 = integer(1, span);
    const od = integer(2, 6) * (random() > 0.35 ? 1 : -1);
    const e0 = integer(1, span);
    const ed = integer(2, 6) * (random() > 0.35 ? 1 : -1);
    const odd = Array.from({ length: 6 }, (_, i) => o0 + od * i);
    const even = Array.from({ length: 6 }, (_, i) => e0 + ed * i);
    for (let i = 0; i < 5; i += 1) shown.push(odd[i], even[i]);
    shown.push(odd[5]);
    answer = even[5];
    templateId = "seq-cross-arith-v1";
    params = { o0, od, e0, ed };
    rule = `奇数位（第 1、3、5、7、9、11 项）为 ${odd.join("、")}（公差 ${od}），偶数位为 ${even.join("、")}（公差 ${ed}）。括号在第 12 项（偶数位第 6 项）`;
  } else if (variant === 1) {
    // 奇项等比 + 偶项等差
    const ratio = pick([2, 3]);
    const o0 = integer(1, 6);
    const e0 = integer(20, span);
    const ed = integer(-6, -2);
    const odd = Array.from({ length: 6 }, (_, i) => o0 * ratio ** i);
    const even = Array.from({ length: 6 }, (_, i) => e0 + ed * i);
    for (let i = 0; i < 5; i += 1) shown.push(odd[i], even[i]);
    shown.push(odd[5]);
    answer = even[5];
    templateId = "seq-cross-geo-arith-v1";
    params = { ratio, o0, e0, ed };
    rule = `奇数位为 ${odd.join("、")}（公比 ${ratio}），偶数位为 ${even.join("、")}（公差 ${ed}）。括号在第 12 项（偶数位第 6 项）`;
  } else if (variant === 2) {
    // 两两分组：组内和为等差
    const s0 = integer(40, span);
    const ds = integer(2, 5) * (random() > 0.4 ? 1 : -1);
    const sums = Array.from({ length: 5 }, (_, i) => s0 + ds * i);
    for (let i = 0; i < 4; i += 1) {
      const x = integer(2, Math.max(3, Math.floor(sums[i] / 2)));
      shown.push(x, sums[i] - x);
    }
    const x5 = integer(2, Math.max(3, Math.floor(sums[4] / 2)));
    shown.push(x5);
    answer = sums[4] - x5;
    templateId = "seq-pair-sum-v1";
    params = { s0, ds, x5 };
    const pairText = Array.from({ length: 4 }, (_, i) => `(${shown[2 * i]},${shown[2 * i + 1]})`).join("、");
    rule = `两两分组 ${pairText}，各组和 ${sums.slice(0, 4).join("、")} 构成公差 ${ds} 的等差数列。第 5 组和=${sums[4]}，已知前项 ${x5}`;
  } else {
    // 两两分组：组内差为等差
    const x0 = integer(10, span);
    const d0 = integer(2, 6);
    const ds = integer(1, 3) * (random() > 0.3 ? 1 : -1);
    const dx = integer(3, 8);
    const groups: number[] = [];
    let cur = x0;
    let gap = d0;
    const gaps: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      groups.push(cur, cur + gap);
      gaps.push(gap);
      cur = cur + gap + dx;
      gap += ds;
    }
    shown.push(...groups, cur);
    answer = cur + gap;
    templateId = "seq-pair-gap-v1";
    params = { x0, d0, ds, dx };
    const pairText = Array.from({ length: 4 }, (_, i) => `(${groups[2 * i]},${groups[2 * i + 1]})`).join("、");
    rule = `两两分组 ${pairText}，组内差 ${gaps.join("、")} 构成公差 ${ds} 的等差数列，且各组首项平移 ${dx}。第 5 组内差=${gap}`;
  }
  const distractors = [answer + (span > 100 ? 3 : 1), answer - (span > 100 ? 3 : 1), shown[shown.length - 2]];
  return buildSequence(
    {
      templateId,
      params,
      shown,
      answer,
      distractors,
      explanation: `项数多、单列无规律 → 多重数列。${rule}，故括号中=${answer}。`,
    },
    random,
  );
}

export function generateSeqPeriodic(r: Rng): QuestionDraft {
  const { integer, pick, random } = r;
  const variant = integer(0, 2);
  let templateId = "";
  let params: Record<string, number | string> = {};
  let shown: number[] = [];
  let answer = 0;
  let rule = "";
  if (variant === 0) {
    // 显式循环
    const period = pick([2, 3]);
    const values = Array.from({ length: period }, (_, i) => integer(2, 15) + i);
    shown = Array.from({ length: 9 }, (_, i) => values[i % period]);
    answer = values[9 % period];
    templateId = "seq-cycle-explicit-v1";
    params = { period, values: values.join(",") };
    rule = `以 ${period} 个为一组循环：( ${values.join(", ")} ) 不断重复`;
  } else if (variant === 1) {
    // 一阶差周期
    const cycle = pick([2, 3]);
    const diffs = Array.from(
      { length: cycle },
      (_, i) => integer(2, 6) * (random() > 0.5 ? 1 : -1),
    );
    // 防退化：周期差不得形成等差（两两不同符号/幅值），允许负差使数列波动
    const terms = [integer(20, 80)];
    for (let i = 0; i < 8; i += 1) terms.push(terms[i] + diffs[i % cycle]);
    shown = terms.slice(0, 8);
    answer = terms[8];
    templateId = "seq-cycle-diff-v1";
    params = { cycle, diffs: diffs.join(","), t0: terms[0] };
    rule = `作差后一阶差 ${Array.from({ length: 7 }, (_, i) => terms[i + 1] - terms[i]).join("、")} 按 ${cycle} 项循环：${diffs.join("、")}`;
  } else {
    // 隔项各自小周期交替
    const oa = integer(1, 9);
    const ob = integer(12, 20);
    const ea = integer(21, 30);
    const eb = integer(33, 45);
    shown = Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? (i % 4 < 2 ? oa : ob) : i % 4 < 2 ? ea : eb));
    answer = 10 % 4 < 2 ? oa : ob; // 第 11 项：奇数位
    templateId = "seq-cycle-alternate-v1";
    params = { oa, ob, ea, eb };
    rule = `隔项看：奇数位 ${oa}、${ob} 交替，偶数位 ${ea}、${eb} 交替（整体周期为 4）`;
  }
  return buildSequence(
    {
      templateId,
      params,
      shown,
      answer,
      distractors: [answer + 1, answer - 1, shown[9] ?? shown[8]],
      explanation: `数列呈现波动反复 → 找周期。${rule}；括号在第 ${shown.length + 1} 项，对应组内位置值为 ${answer}。`,
    },
    random,
  );
}
