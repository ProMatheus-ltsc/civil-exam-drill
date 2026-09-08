/** 资料速算 · 增长线模块：增长率/增长量/基期量/倍数翻番/基期差/间隔/混合/年均 */
import { fmt, round } from "../random";
import { options } from "../options";
import { directionOptions, tableBlock, chartBlock } from "./material";
import type { MaterialSpec, QuestionDraft, Rng } from "../types";

const pct = (value: number) => `${fmt(value, 1)}%`;

function rateSet(answer: number, random: () => number) {
  return options(answer, [answer + 2, answer - 1, round(answer / 2, 1)], "%", random, 1);
}

/** 两个对象的基期/现期数据集合（材料题共用） */
function pairDataset(r: Rng, level: number) {
  const scale = level >= 3 ? 100 : level === 2 ? 50 : 20;
  const rA = r.integer(level === 3 ? 8 : level === 2 ? 6 : 3, level === 3 ? 26 : level === 2 ? 20 : 14);
  const rB = r.integer(2, Math.max(1, rA - (level === 3 ? 4 : 2)));
  const baseA = r.integer(10, 30) * scale;
  const baseB = r.integer(4, Math.max(5, Math.round(baseA * 0.5))) * (scale / 5 >= 1 ? Math.max(1, Math.round(scale / 5)) : 1);
  const A0 = baseA;
  const B0 = Math.max(10, baseB);
  const A1 = Math.round(A0 * (1 + rA / 100));
  const B1 = Math.round(B0 * (1 + rB / 100));
  const year = r.pick([2022, 2023]);
  return { A0, A1, B0, B1, rA, rB, year };
}

export function generateGrowthRate(r: Rng): QuestionDraft {
  const { level, integer, random } = r;
  const rate = r.pick(level === 1 ? [10, 20, 25, 50] : level === 2 ? [8, 15, 30, 40] : [6, 12, 18, 35]);
  const base = integer(8, 40) * (level >= 3 ? 50 : 10);
  const current = base + Math.round((base * rate) / 100);
  const variant = integer(0, 1);
  if (variant === 0) {
    const answer = rate;
    const set = rateSet(answer, random);
    return {
      templateId: "rate-from-base-current-v2",
      params: { base, current, answer },
      stem: `某地去年产值为 ${base} 亿元，今年增至 ${current} 亿元，同比增长约多少？`,
      ...set,
      explanation: `增长率=(现期−基期)÷基期=(${current}−${base})÷${base}=${current - base}÷${base}=${answer}%。选项 ${round((current - base) / 100, 1)}%（把增量当百分数）与 ${current}%（把倍率当百分数）均属口径错误。`,
    };
  }
  const growth = current - base;
  const answer = rate;
  const set = rateSet(answer, random);
  return {
    templateId: "rate-from-amount-v2",
    params: { base, growth, answer },
    stem: `某地去年产值为 ${base} 亿元，今年比去年增加 ${growth} 亿元，同比增长约多少？`,
    ...set,
    explanation: `增长率=增长量÷基期量=${growth}÷${base}=${answer}%。注意分母用基期 ${base}，不是现期 ${current}。`,
  };
}

/** 百化分说明：rate% ≈ 1/n 时增量≈现期÷(n+1) */
function fractionHint(rate: number): string | null {
  const table: Record<number, string> = {
    5: "5%=1/20", 8: "8%≈1/12.5", 10: "10%=1/10", 12.5: "12.5%=1/8",
    15: "15%≈1/6.7", 20: "20%=1/5", 25: "25%=1/4", 33.3: "33.3%≈1/3",
  };
  return table[rate] ?? (Math.abs(rate - 12.5) < 0.1 ? "12.5%=1/8" : null);
}

export function generateGrowthAmount(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const rate = pick(level === 1 ? [10, 20, 25] : level === 2 ? [5, 10, 12.5, 20, 25] : [8, 12.5, 15, 25]);
  const base = integer(5 * level, 18 * level) * 100;
  const growth = Math.round((base * rate) / 100);
  const current = base + growth;
  const variant = integer(0, 2);
  const hint = fractionHint(rate) ? `（${fractionHint(rate)}）` : "";
  if (variant === 0) {
    const set = options(growth, [Math.round((current * rate) / 100), base, current - growth], " 亿元", random);
    return {
      templateId: "amount-current-rate-v2",
      params: { base, rate, growth, current },
      stem: `某产业增加值为 ${current} 亿元，同比增长 ${rate}%${hint}。其同比增量约为多少亿元？`,
      ...set,
      explanation: `题干给现期，增量=现期×r÷(1+r)。${fractionHint(rate) ? `把 ${rate}%≈1/${Math.round(100 / rate)}：` : ""}增量≈${current}÷${Math.round(100 / rate) + 1}=${fmt(round(current / (Math.round(100 / rate) + 1)))}≈${growth} 亿元（精确式 ${current}×${rate}%÷${1 + rate / 100}）。不能直接用现期乘增长率（${Math.round((current * rate) / 100)} 是错的）。`,
    };
  }
  if (variant === 1) {
    const set = options(growth, [current - growth, Math.round((current * rate) / 100), Math.round(growth / 2)], " 亿元", random);
    return {
      templateId: "amount-base-rate-v2",
      params: { base, rate, growth, current },
      stem: `某地上年产量为 ${base} 万吨，今年同比增长 ${rate}%。今年增产多少万吨？`,
      ...set,
      explanation: `增量=基期×增长率=${base}×${rate}%=${growth} 万吨（百化分${hint}心算更快）。干扰项 ${current}−${base}=${current - base} 出现在现期口径题干中才用。`,
    };
  }
  const set = options(growth, [Math.round((current * rate) / 100), Math.round(base * 0.05), Math.round(growth * 1.5)], " 亿元", random);
  return {
    templateId: "amount-drop-rate-v2",
    params: { base, rate, growth, current },
    stem: `某行业收入由 ${current} 亿元降至 ${base} 亿元，降幅 ${rate}%。其减少额约为多少亿元？`,
    ...set,
    explanation: `下降时减少量=现期×d÷(1−d)=${current}×${rate}%÷(1−${rate}%)=${growth} 亿元。分母是 1−d（≈0.${String(100 - rate).padStart(2, "0")}），不能套用正增长口径的 1+d。`,
  };
}

export function generateBaseAmount(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const rate = pick(level === 2 ? [5, 10, 12.5, 20] : [8, 15, 25, 30]);
  const base = integer(6 * level, 30 * level) * 100;
  const current = Math.round(base * (1 + rate / 100));
  const variant = integer(0, 1);
  if (variant === 0) {
    const set = options(base, [Math.round(current * (1 - rate / 100)), Math.round((current * rate) / 100), current + base], " 亿元", random);
    return {
      templateId: "base-from-current-rate-v2",
      params: { base, rate, current },
      stem: `某地本年零售额为 ${current} 亿元，同比增长 ${rate}%。上年零售额约是多少亿元？`,
      ...set,
      explanation: `基期=现期÷(1+r)=${current}÷${1 + rate / 100}=${base} 亿元。选项 ${fmt(current * (1 - rate / 100))} 是错误地直接乘 (1−r)，增速小且题目近时两者接近，务必先判断口径再列式。`,
    };
  }
  const amount = current - base;
  const set = options(base, [current, amount, Math.round(current / 2)], " 亿元", random);
  return {
    templateId: "base-minus-amount-v2",
    params: { base, rate, amount, current },
    stem: `某地本年销售额为 ${current} 亿元，比上年增加 ${amount} 亿元。上年销售额是多少亿元？`,
    ...set,
    explanation: `基期=现期−增长量=${current}−${amount}=${base} 亿元。题干给的是“绝对增长量”而非增速，直接用减法，勿引入 (1+r)。`,
  };
}

export function generateMultiples(r: Rng): QuestionDraft {
  const { level, pick, integer, random } = r;
  const n = pick(level === 1 ? [1, 2] : level === 2 ? [2, 3] : [3, 4]);
  const base = integer(10, 50) * 10;
  const factor = 2 ** n;
  const current = base * factor;
  const variant = integer(0, 2);
  if (variant === 0) {
    const set = options(n, [n - 1, n + 1, n + 0.5], " 番", random, 1);
    return {
      templateId: "multiples-fan-v2",
      params: { base, current, n },
      stem: `某企业利润从 ${base} 万元增至 ${current} 万元，相当于翻了多少番？`,
      ...set,
      explanation: `${current}÷${base}=${factor}=2^${n}，翻了 ${n} 番。翻 1 番=×2、翻 n 番=×2ⁿ；n±1 与半番是常见干扰（翻番数取对数，不能用除法比例直接写）。`,
    };
  }
  if (variant === 1) {
    const times = factor - 1;
    const set = options(times, [times + 1, Math.max(0, times - 1), Math.round(factor / 2)], "", random, 0);
    return {
      templateId: "multiples-times-v2",
      params: { base, current, times },
      stem: `某企业利润从 ${base} 万元增至 ${current} 万元，增长了多少倍？`,
      ...set,
      explanation: `增长了=(现期−基期)÷基期=(${current}−${base})÷${base}=${times} 倍。注意“增长了多少倍”要减 1，“是基期的多少倍”才不减（干扰项 ${times + 1}）。`,
    };
  }
  const times = factor - 1;
  const set = options(factor, [times, factor * 2, Math.round(factor / 2)], " 倍", random);
  return {
    templateId: "multiples-is-times-v2",
    params: { base, current, times },
    stem: `2024 年某县粮食产量为 ${current} 万吨，2014 年为 ${base} 万吨。2024 年产量是 2014 年的多少倍？`,
    ...set,
    explanation: `“是……的多少倍”=现期÷基期=${current}÷${base}=${factor} 倍；若问“增长了多少倍”则答案应为 ${times} 倍，注意题干措辞。`,
  };
}

function buildPairMaterial(
  labelA: string,
  labelB: string,
  year: number,
  dataset: { A0: number; A1: number; B0: number; B1: number; rA: number; rB: number },
  unit: string,
): MaterialSpec {
  return {
    paragraphs: [
      `${year + 1} 年，${labelA}完成 ${unit}${fmt(dataset.A1)}，同比增长 ${fmt(dataset.rA)}%；${labelB}完成 ${unit}${fmt(dataset.B1)}，同比增长 ${fmt(dataset.rB)}%。`,
    ],
    table: tableBlock(
      `${year + 1} 年主要指标`,
      ["指标", `${year + 1} 年${unit}`, `同比增速`],
      [
        [labelA, fmt(dataset.A1), pct(dataset.rA)],
        [labelB, fmt(dataset.B1), pct(dataset.rB)],
      ],
    ),
    chart: chartBlock("bar", unit, [labelA, labelB], [
      { label: `${year + 1} 年`, values: [dataset.A1, dataset.B1] },
      { label: `${year} 年`, values: [dataset.A0, dataset.B0] },
    ]),
  };
}

export function generateBaseDifference(r: Rng): QuestionDraft | null {
  const { level, integer, random } = r;
  const labelA = r.pick(["东部地区投资", "甲省出口额", "城镇零售额", "货物出口"]);
  const labelB = r.pick(["中部地区投资", "乙省出口额", "乡村零售额", "货物进口"]);
  const unit = labelA.includes("投资") ? "亿元" : labelA.includes("零售") ? "亿元" : "亿美元";
  const dataset = pairDataset(r, level);
  const d0 = dataset.A0 - dataset.B0;
  if (d0 <= 0) return null;
  const d1 = dataset.A1 - dataset.B1;
  const diffGrowth = Math.round(((d1 - d0) / d0) * 100);
  const material = buildPairMaterial(labelA, labelB, dataset.year, dataset, unit);
  const variant = integer(0, 2);
  if (variant === 0) {
    const set = options(d0, [d1, Math.round(d0 * (1 + (dataset.rA - dataset.rB) / 100)), Math.round(d1 / 2)], ` ${unit}`, random);
    return {
      templateId: "base-diff-v2",
      params: { ...dataset, d0, d1 },
      stem: `根据材料，${dataset.year} 年两者之差约为多少${unit}？`,
      ...set,
      material,
      explanation: `基期差=两部分别还原到 ${dataset.year} 年再作差：${labelA}基期=${fmt(dataset.A1)}÷(1+${dataset.rA}%)=${fmt(dataset.A0)}，${labelB}基期=${fmt(dataset.B1)}÷(1+${dataset.rB}%)=${fmt(dataset.B0)}；基期差=${fmt(dataset.A0)}−${fmt(dataset.B0)}=${d0}。干扰项 ${d1} 是现期差（未还原年份），${Math.round(d0 * (1 + (dataset.rA - dataset.rB) / 100))} 是误用增速差直接折算基期差。`,
    };
  }
  if (variant === 1) {
    const set = options(dataset.A0 + dataset.B0, [dataset.A1 + dataset.B1, Math.round((dataset.A1 + dataset.B1) / (1 + (dataset.rA + dataset.rB) / 200)), dataset.A0 + dataset.B1], ` ${unit}`, random);
    return {
      templateId: "base-sum-v2",
      params: { ...dataset, d0, d1 },
      stem: `根据材料，${dataset.year} 年两者合计约为多少${unit}？`,
      ...set,
      material,
      explanation: `基期合计=${labelA}基期+${labelB}基期=${fmt(dataset.A0)}+${fmt(dataset.B0)}=${dataset.A0 + dataset.B0}。干扰项 ${dataset.A1 + dataset.B1} 是现期直接相加（口径错误）；更不能拿两个增速简单平均折算（增速的平均不等于合计的增速）。`,
    };
  }
  const answer = d1 > d0 ? "扩大" : "收窄";
  const wrongOthers = d1 > d0 ? ["收窄", "不变", "由差转盈"] : ["扩大", "不变", "由差转亏"];
  const dir = directionOptions(answer, wrongOthers, random);
  return {
    templateId: "base-diff-direction-v2",
    params: { ...dataset, d0, d1 },
    stem: `根据材料，${labelA}与${labelB}的现期差相比 ${dataset.year} 年的基期差：`,
    ...dir,
    material,
    explanation: `现期差=${fmt(d1)}，基期差=${fmt(d0)}。比较两侧增量：${labelA}增量=${dataset.A1 - dataset.A0}，${labelB}增量=${dataset.B1 - dataset.B0}，前者更大，故差值${answer}（不能只凭“谁增速高”下结论，还要看基数；本题基期量级使增速差传导为差值的实际变化）。`,
  };
}

export function generateIntervalGrowth(r: Rng): QuestionDraft {
  const { level, integer, random } = r;
  const minR = level === 1 ? 3 : level === 2 ? 5 : 8;
  const maxR = level === 1 ? 12 : level === 2 ? 25 : 35;
  const r1 = integer(minR, maxR);
  const r2 = integer(minR, maxR);
  const product = round((r1 * r2) / 100, 2);
  const answer = round(r1 + r2 + product, 2);
  const r1Desc = `${r1}%`;
  const r2Desc = `${r2}%`;
  const variant = integer(0, 1);
  if (variant === 0) {
    const set = options(answer, [round(r1 + r2, 2), round(product, 2), round(r1 + r2 + 2 * product, 2)], "%", random, 2);
    return {
      templateId: "interval-growth-v3",
      params: { r1, r2, answer },
      stem: `某地区去年增长 ${r1Desc}，今年增长 ${r2Desc}，两年累计增长了多少？`,
      ...set,
      explanation: `间隔增长率 R=r₁+r₂+r₁×r₂=${r1}%+${r2}%+${product}%=${answer}%。${round(r1 + r2, 2)}% 漏掉交叉乘积项；${round(r1 + r2 + 2 * product, 2)}% 把乘积项重复计算。`,
    };
  }
  const back = round((answer - r1) / (1 + r1 / 100), 2);
  const set = options(back, [round(answer - r1, 2), round(r1 + product, 2), round(answer - product, 2)], "%", random, 2);
  return {
    templateId: "interval-growth-back-v3",
    params: { r1, r2, answer, back },
    stem: `某地区去年增长 ${r1Desc}，两年累计增长 ${answer}%，则今年增速约为多少？`,
    ...set,
    explanation: `反解 r₂=(R−r₁)÷(1+r₁)=(${answer}%−${r1}%)÷${fmt(1 + r1 / 100)}=${back}%。直接相减 ${round(answer - r1, 2)}% 漏掉了基数被 r₁ 放大的影响。`,
  };
}

function buildMixedMaterial(
  labelA: string,
  labelB: string,
  partA: number,
  partB: number,
  year: number,
  unit: string,
  rA: number,
  rB: number,
): MaterialSpec {
  return {
    paragraphs: [
      `${year} 年，${labelA}实现产值 ${fmt(partA)}${unit}，同比增长 ${fmt(rA)}%；${labelB}实现产值 ${fmt(partB)}${unit}，同比增长 ${fmt(rB)}%。`,
    ],
    table: tableBlock(`${year} 年分阶段产值`, ["阶段", `产值(${unit})`, "同比增速"], [
      [labelA, fmt(partA), pct(rA)],
      [labelB, fmt(partB), pct(rB)],
    ]),
    chart: chartBlock("bar", unit, [labelA, labelB], [
      { label: `${year} 年`, values: [partA, partB] },
      { label: `${year - 1} 年`, values: [Math.round(partA / (1 + rA / 100)), Math.round(partB / (1 + rB / 100))] },
    ]),
  };
}

export function generateMixedGrowth(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const labelA = pick(["上半年", "一季度", "上半年出口"]);
  const labelB = pick(["下半年", "二季度", "下半年出口"]);
  const unit = "亿元";
  const partA = integer(6, 20) * (level === 3 ? 100 : 50);
  const partB = integer(2, Math.max(2, Math.round(partA / 3))) * (level === 3 ? 50 : 25);
  const rateA = integer(level === 3 ? 2 : 4, level === 3 ? 22 : 14);
  const rateB = integer(rateA + 3, level === 3 ? 38 : 26);
  const year = 2024;
  const material = buildMixedMaterial(labelA, labelB, partA, partB, year, unit, rateA, rateB);
  const answer = round(((partA * (1 + rateA / 100) + partB * (1 + rateB / 100)) / (partA + partB) - 1) * 100, 2);
  const variant = integer(0, 1);
  const avg = round((rateA + rateB) / 2, 2);
  if (variant === 0) {
    const set = options(answer, [avg, rateA, rateB], "%", random, 2);
    return {
      templateId: "mixed-growth-v3",
      params: { partA, partB, rateA, rateB, answer },
      stem: `根据材料，${year} 年该地区全年产值同比增长约多少？`,
      ...set,
      material,
      explanation: `全年增速是两部分按产值加权：(${fmt(partA)}×${rateA}%+${fmt(partB)}×${rateB}%)÷${fmt(partA + partB)}≈${answer}%。介于 ${rateA}%~${rateB}% 之间且偏向占比大的 ${partA > partB ? labelA : labelB}（${avg}% 直接平均忽略权重）。`,
    };
  }
  // 逆向：已知整体增速与 labelA 增速、两部分产值，求 labelB 增速
  const back = round((answer * (partA + partB) - rateA * partA) / partB, 2);
  const set = options(back, [round(answer - rateA, 2), avg, answer], "%", random, 2);
  return {
    templateId: "mixed-growth-back-v3",
    params: { partA, partB, rateA, answer, back },
    stem: `根据材料，全年产值增长 ${answer}%，${labelA}产值增长 ${rateA}%，则${labelB}产值增速约为多少？`,
    ...set,
    material,
    explanation: `由加权平均反解：${labelB}增速=[${answer}%×${fmt(partA + partB)}−${rateA}%×${fmt(partA)}]÷${fmt(partB)}=${back}%。不能直接用整体−部分增速相减（${round(answer - rateA, 2)}% 错在未按产值占比加权）。`,
  };
}

export function generateAnnualAmount(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const n = pick(level === 2 ? [3, 5] : [2, 4]);
  const step = integer(20, 80) * (level >= 2 ? 10 : 5);
  const base = integer(20, 60) * 100;
  const totalGrow = step * n;
  const current = base + totalGrow;
  const variant = integer(0, 1);
  if (variant === 0) {
    const set = options(step, [totalGrow, Math.round(totalGrow / (n + 1)), Math.round(step / 2)], " 亿元", random);
    return {
      templateId: "annual-amount-step-v2",
      params: { base, current, n, step },
      stem: `某县一般公共预算收入由 ${base} 亿元增至 ${current} 亿元，跨越 ${n} 个年份间隔。年均增长量约为多少亿元？`,
      ...set,
      explanation: `年均增长量=(现期−基期)÷年份间隔=(${current}−${base})÷${n}=${totalGrow}÷${n}=${step} 亿元。分子是总增量 ${totalGrow}，不能除以 ${n + 1}（那是年份个数，含基期口径会算小）；年份间隔按“跨越几个年度”计。`,
    };
  }
  const set = options(current, [base + step * (n + 1), Math.round((base + current) / 2), base + totalGrow * 2], " 亿元", random);
  return {
    templateId: "annual-amount-total-v2",
    params: { base, n, step, current },
    stem: `某市财政支出从 ${base} 亿元起步，年均增长 ${step} 亿元，连续增长 ${n} 年后总量约为多少亿元？`,
    ...set,
    explanation: `现期=基期+年均增量×年数=${base}+${step}×${n}=${current} 亿元。干扰项 ${base + step * (n + 1)} 把增长年数误加 1。`,
  };
}

function buildAnnualMaterial(
  years: number[],
  values: number[],
  unit: string,
  metric: string,
  base: number,
  current: number,
  startYear: number,
): MaterialSpec {
  return {
    paragraphs: [
      `${startYear}—${startYear + years.length - 1} 年，${metric}由 ${fmt(base)}${unit} 增至 ${fmt(current)}${unit}，年均增长。`,
    ],
    table: tableBlock(`${startYear}—${startYear + years.length - 1} 年 ${metric}`, ["年份", `${metric}(${unit})`], years.map((y, i) => [String(y), fmt(values[i])])),
    chart: chartBlock("line", unit, years.map(String), [{ label: metric, values }]),
  };
}

export function generateAnnualRate(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const n = pick([3, 4, 5]);
  const rate = pick([5, 8, 10, 12, 15]);
  const base = integer(5, 15) * 100;
  const factor = (1 + rate / 100) ** n;
  const current = Math.round(base * factor);
  const startYear = 2019;
  const years = Array.from({ length: n + 1 }, (_, i) => startYear + i);
  const values = Array.from({ length: n + 1 }, (_, i) => Math.round(base * (1 + rate / 100) ** i));
  const material = buildAnnualMaterial(years, values, "亿元", "一般公共预算收入", base, current, startYear);
  const variant = integer(0, 1);
  if (variant === 0) {
    const naive = round(((current / base - 1) * 100) / n, 1);
    const set = options(rate, [naive, round((current / base - 1) * 100, 1), rate + (n === 5 ? 2 : 5)], "%", random, 1);
    return {
      templateId: "annual-rate-forward-v2",
      params: { base, current, n, rate },
      stem: `根据材料，${startYear}—${startYear + n} 年该县一般公共预算收入年均增长率约为多少？`,
      ...set,
      material,
      explanation: `满足 ${current}=${base}×(1+r)^${n}。用开方估值：先算总增幅=${fmt((current / base - 1) * 100, 1)}%，再估计 (1+${rate}%)^${n}=${fmt(factor, 3)}，故 r≈${rate}%（${naive}% 是“总增幅÷年数”的算术平均，会高估真实复合增速）。`,
    };
  }
  const back = Math.round(base * factor);
  const set = options(back, [Math.round(base * (1 + (rate * n) / 100)), Math.round(base * (1 + rate / 100) ** (n - 1)), Math.round(base * (1 + (2 * rate) / 100) ** n)], " 亿元", random);
  return {
    templateId: "annual-rate-forecast-v2",
    params: { base, rate, n, back },
    stem: `若未来 ${n} 年保持年均增长 ${rate}%，以 ${startYear + n} 年（${fmt(base)} 亿元）为基期，${startYear + 2 * n} 年该收入约为多少亿元？`,
    ...set,
    material,
    explanation: `按复合增长：(1+${rate}%)^${n}=${fmt(factor, 3)}，${startYear + 2 * n} 年≈${fmt(base)}×${fmt(factor, 3)}=${fmt(back)} 亿元。干扰项 ${fmt(Math.round(base * (1 + (rate * n) / 100)))} 按单利估算，多年后复合与单利差距显著。`,
  };
}
