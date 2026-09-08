/** 资料速算 · 比重/平均数/综合高阶模块（含材料实战题） */
import { fmt, round } from "../random";
import { options } from "../options";
import { directionOptions, tableBlock, chartBlock } from "./material";
import type { MaterialSpec, QuestionDraft, Rng } from "../types";

const pct = (value: number) => `${fmt(value, 1)}%`;

/** 现期部分/整体数据集合（比重线共用）：由现期整体与占比反推，保证整数 */
function shareNumbers(r: Rng, level: number) {
  const whole = r.integer(12, 40) * (level === 1 ? 100 : level === 2 ? 50 : 25) * 10;
  const share = r.pick([10, 15, 20, 25, 30, 40, 50]);
  const part = Math.round((whole * share) / 100);
  return { whole, share, part };
}

/** 简单文字材料：一行题干句 + 表格 + 柱图 */
function miniMaterial(
  caption: string,
  intro: string,
  headers: string[],
  rows: string[][],
  unit: string,
  chart: { categories: string[]; series: { label: string; values: number[] }[] },
): MaterialSpec {
  return {
    paragraphs: [intro],
    table: tableBlock(caption, headers, rows),
    chart: chartBlock("bar", unit, chart.categories, chart.series),
  };
}

export function generateRatioBasic(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const { whole, share, part } = shareNumbers(r, level);
  const variant = integer(0, 2);
  if (variant === 0) {
    const set = options(share, [round(100 - share, 1), round(part / whole * 1000, 1), round(share + (level === 3 ? 5 : 10), 1)], "%", random, 1);
    return {
      templateId: "share-percent-v2",
      params: { whole, part, share },
      stem: `某市全年财政支出 ${whole} 亿元，其中教育支出 ${part} 亿元。教育支出占比约为多少？`,
      ...set,
      explanation: `占比=部分÷整体=${part}÷${whole}=${share}%。选项 ${100 - share}% 是“除教育外其余支出占比”，先看问的是不是教育本身。`,
    };
  }
  if (variant === 1) {
    const set = options(whole, [Math.round((part * share) / 100), whole - part, whole + part], " 亿元", random);
    return {
      templateId: "share-whole-v2",
      params: { whole, share, part },
      stem: `某市民营企业出口额为 ${part} 亿元，占该市出口总额的 ${share}%。出口总额约为多少亿元？`,
      ...set,
      explanation: `整体=部分÷占比=${part}÷${share}%=${whole} 亿元。先确认问整体，避免误乘（${fmt((part * share) / 100)} 是把占比当乘数）。`,
    };
  }
  const gap = pick([2, 3, 5]);
  const last = share - gap;
  const set = options(last, [share + gap, share, round(share - gap * 0.5, 1)], "%", random, 1);
  return {
    templateId: "share-gap-last-v2",
    params: { whole, share, gap, part, last },
    stem: `某地服务业占比 ${share}%，比上年提高 ${gap} 个百分点。上年服务业占比约为多少？`,
    ...set,
    explanation: `“提高”说明上年更小：上年占比=${share}%−${gap} 个百分点=${last}%。百分点直接加减即可，不要把“个百分点”再换算成比例。`,
  };
}

export function generatePartQuantity(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const base = integer(20, 80) * (level === 1 ? 20 : level === 2 ? 10 : 5) * 10;
  const rate = pick([5, 10, 15, 20]);
  const wholeCurrent = Math.round(base * (1 + rate / 100));
  const share = pick([12, 15, 20, 25, 30]);
  const variant = integer(0, 1);
  if (variant === 0) {
    const part = Math.round((wholeCurrent * share) / 100);
    const set = options(part, [Math.round((wholeCurrent * (100 - share)) / 100), Math.round(wholeCurrent / share), part - wholeCurrent], " 亿元", random);
    return {
      templateId: "part-current-v2",
      params: { wholeCurrent, share, part },
      stem: `某省全年生产总值 ${wholeCurrent} 亿元，其中高技术产业增加值占 ${share}%。高技术产业增加值约为多少亿元？`,
      ...set,
      explanation: `部分量=整体×占比=${wholeCurrent}×${share}%=${part} 亿元。干扰项 ${fmt((wholeCurrent * (100 - share)) / 100)} 是“其余部分”，注意占比的对象是谁。`,
    };
  }
  const wholeBase = base;
  const partBase = Math.round((wholeBase * share) / 100);
  const set = options(partBase, [Math.round((wholeCurrent * share) / 100), Math.round(partBase * (1 + rate / 100)), Math.round((wholeBase * share) / 100 / 2)], " 亿元", random);
  return {
    templateId: "part-base-v2",
    params: { wholeCurrent, wholeBase, share, rate, partBase },
    stem: `某县本年工业总产值 ${wholeCurrent} 亿元，同比增长 ${rate}%；工业占地区生产总值的比重为 ${share}%。上年该县工业增加值约为多少亿元？`,
    ...set,
    explanation: `上年整体=${wholeCurrent}÷(1+${rate}%)=${wholeBase}；上年工业=上年整体×占比=${wholeBase}×${share}%=${partBase}。干扰项 ${fmt((wholeCurrent * share) / 100)} 用现期整体乘占比（口径混淆：占比是本年口径还是上年口径，先判清）。`,
  };
}

export function generateAverageBasic(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const count = pick([4, 5, 8, 10, 12]);
  const average = integer(8 * level, 24 * level) * 10;
  const total = average * count;
  const variant = integer(0, 2);
  if (variant === 0) {
    const set = options(total, [Math.round(average / count), total - average, total + count], " 亿元", random);
    return {
      templateId: "average-total-v3",
      params: { count, average, total },
      stem: `某地区 ${count} 个园区平均每个完成投资 ${average} 亿元，合计完成投资约多少亿元？`,
      ...set,
      explanation: `总量=平均数×份数=${average}×${count}=${total} 亿元。看到“平均每个”同时锁定单位数 ${count}；${fmt(average / count)} 是把除法方向搞反。`,
    };
  }
  if (variant === 1) {
    const set = options(average, [total - count, Math.round(total / (count - 1)), Math.round(average / 10)], " 亿元", random);
    return {
      templateId: "average-value-v3",
      params: { count, average, total },
      stem: `某市 ${count} 家园区合计完成投资 ${total} 亿元，平均每家完成投资约多少亿元？`,
      ...set,
      explanation: `平均数=总量÷份数=${total}÷${count}=${average} 亿元。选项 ${total - count} 是“总量减份数”的无效换算。`,
    };
  }
  const set = options(count, [count - 1, Math.round(total / (average + 10)), Math.round(average / 10)], " 个", random);
  return {
    templateId: "average-count-v3",
    params: { count, average, total },
    stem: `某专项资金共 ${total} 亿元，按每个项目平均 ${average} 亿元分配，可支持约多少个项目？`,
    ...set,
    explanation: `份数=总量÷平均数=${total}÷${average}=${count} 个。单位项与总量、平均数的单位对齐后再除，避免用错量级。`,
  };
}

/** 部分/整体 + 增速数据集（材料）：部分现期、整体现期、增速 a/b、基期占比 */
function growthShareSet(r: Rng) {
  const b = r.integer(4, 18);
  const a = r.pick([b + 2, b + 4, b - 2, b - 4].filter((v) => v >= 1 && v <= 24));
  const whole = r.integer(40, 200) * 10;
  const share = r.pick([12, 15, 20, 25, 30, 35]);
  const part = Math.round((whole * share) / 100);
  const baseWhole = Math.round(whole / (1 + b / 100));
  const basePart = Math.round(part / (1 + a / 100));
  const baseShare = round((basePart / baseWhole) * 100, 2);
  return { b, a, whole, share, part, baseWhole, basePart, baseShare, year: 2024 };
}

function growthShareMaterial(d: ReturnType<typeof growthShareSet>, metricPart: string, metricWhole: string, unit: string): MaterialSpec {
  return miniMaterial(
    `${d.year} 年主要指标`,
    `${d.year} 年，${metricWhole}实现 ${unit}${fmt(d.whole)}，同比增长 ${fmt(d.b)}%；其中${metricPart}完成 ${unit}${fmt(d.part)}，同比增长 ${fmt(d.a)}%，占比 ${fmt(d.share)}%。`,
    ["指标", `${d.year} 年${unit}`, "同比增速"],
    [
      [metricWhole, fmt(d.whole), pct(d.b)],
      [metricPart, fmt(d.part), pct(d.a)],
    ],
    unit,
    { categories: [metricWhole, metricPart], series: [{ label: `${d.year} 年`, values: [d.whole, d.part] }] },
  );
}

export function generateBaseRatio(r: Rng): QuestionDraft {
  const { integer, random } = r;
  const d = growthShareSet(r);
  const metricWhole = r.pick(["规上工业增加值", "社会消费品零售总额", "出口总额"]);
  const metricPart = r.pick(["高技术制造业增加值", "网上零售额", "机电产品出口"]);
  const unit = metricWhole.includes("零售") ? "亿元" : metricWhole.includes("出口") ? "亿美元" : "亿元";
  const material = growthShareMaterial(d, metricPart, metricWhole, unit);
  const variant = integer(0, 1);
  if (variant === 0) {
    const answer = d.baseShare;
    const set = options(answer, [d.share, round((d.share * (100 + d.a)) / (100 + d.b), 2), round(d.share + Math.abs(d.a - d.b) * 0.5, 2)], "%", random, 2);
    return {
      templateId: "base-ratio-v3",
      params: { share: d.share, a: d.a, b: d.b, baseShare: d.baseShare },
      stem: `根据材料，${d.year - 1} 年${metricPart}占${metricWhole}的比重约为多少？`,
      ...set,
      material,
      explanation: `基期比重=现期占比×(1+整体增速)÷(1+部分增速)=${fmt(d.share)}%×${100 + d.b}÷${100 + d.a}=${answer}%。不能直接取现期占比 ${fmt(d.share)}%（漏掉增速差），也不能把 (1+b)/(1+a) 写成反比（${fmt((d.share * (100 + d.a)) / (100 + d.b), 2)}%）。`,
    };
  }
  const answer = round((d.baseShare * (100 + d.a)) / (100 + d.b), 2);
  const set = options(answer, [d.share, d.baseShare, round(d.share - Math.abs(d.a - d.b), 2)], "%", random, 2);
  return {
    templateId: "base-ratio-current-v3",
    params: { share: d.share, a: d.a, b: d.b, baseShare: d.baseShare },
    stem: `若 ${d.year - 1} 年${metricPart}占比为 ${fmt(d.baseShare)}%，在增速条件不变的情况下，${d.year} 年占比约为多少？`,
    ...set,
    material,
    explanation: `现期比重=基期占比×(1+部分增速)÷(1+整体增速)=${fmt(d.baseShare)}%×${100 + d.a}÷${100 + d.b}=${answer}%。${d.a > d.b ? "部分快于整体，比重上升" : "部分慢于整体，比重回落"}。`,
  };
}

export function generateRatioChange(r: Rng): QuestionDraft {
  const { integer, pick, random } = r;
  const d = growthShareSet(r);
  const metricWhole = r.pick(["全国规模以上工业增加值", "全社会固定资产投资", "社会消费品零售总额"]);
  const metricPart = r.pick(["高技术产业投资", "民间投资", "乡村消费品零售额"]);
  const unit = metricWhole.includes("零售") ? "亿元" : "亿元";
  const material = growthShareMaterial(d, metricPart, metricWhole, unit);
  const diff = d.a - d.b;
  const upper = Math.abs(diff);
  const variant = integer(0, 1);
  if (variant === 0) {
    const dir = diff > 0 ? "上升" : "下降";
    const opp = diff > 0 ? "下降" : "上升";
    const abs = Math.abs(diff);
    const bigVal = round(Math.max(upper + 1, upper * 2.2), 1);
    const strs = directionOptions(
      `${dir}（不足 ${upper} 个百分点）`,
      [`${opp}（不足 ${upper} 个百分点）`, `${dir} ${bigVal} 个百分点`, `${opp} ${bigVal} 个百分点`],
      random,
    );
    return {
      templateId: "ratio-change-direction-v3",
      params: { share: d.share, a: d.a, b: d.b, upper },
      stem: `根据材料，${metricPart}占${metricWhole}的比重与上年相比：`,
      ...strs,
      material,
      explanation: `部分增速（${fmt(d.a)}%）${diff > 0 ? "高于" : "低于"}整体增速（${fmt(d.b)}%），比重${dir}；且变化幅度必小于 |a−b|=${upper} 个百分点（两期比重差 |Δ|<|a−b|），凡给出 ≥${upper} 个百分点的选项均可排除。`,
    };
  }
  const exact = round((d.share * diff) / (100 + d.a), 2);
  const wrongDenom = round((d.share * diff) / (100 + d.b), 2);
  const dir = diff > 0 ? "上升" : "下降";
  const set = options(Math.abs(exact), [Math.abs(wrongDenom), Math.abs(diff) - Math.abs(exact), Math.abs(exact) + 0.5], " 个百分点", random, 2);
  return {
    templateId: "ratio-change-exact-v3",
    params: { share: d.share, a: d.a, b: d.b, exact },
    stem: `根据材料，${d.year} 年${metricPart}占${metricWhole}的比重比上年约${dir}多少个百分点？`,
    ...set,
    material,
    explanation: `比重差=现期占比×(部分增速−整体增速)÷(1+部分增速)=${fmt(d.share)}%×(${fmt(diff)}%)÷(1+${fmt(d.a)}%)=${fmt(Math.abs(exact), 2)} 个百分点，方向${dir}。干扰项 ${fmt(Math.abs(wrongDenom), 2)} 把分母错用成整体增速口径。`,
  };
}

function avgRateNumbers(r: Rng) {
  const b = r.integer(4, 14); // 分母（人数/面积）增速
  const R = r.pick([-4, -2, 2, 4, 6, 8]); // 平均数增长率
  // a = R + b + R·b/100
  const a = round(R + b + (R * b) / 100, 1);
  const whole = r.integer(80, 300) * 10;
  const count = Math.round(whole / (1 + a / 100));
  return { a, b, R, whole, count };
}

export function generateAverageRate(r: Rng): QuestionDraft {
  const { integer, random } = r;
  const { a, b, R, whole, count } = avgRateNumbers(r);
  const theme = r.pick([
    { total: "营业总收入", count: "从业人员", avg: "人均营业收入", unit: "万元" },
    { total: "粮食总产量", count: "播种面积", avg: "单位面积产量", unit: "万吨" },
  ]);
  const material = miniMaterial(
    `${theme.avg}材料`,
    `2024 年，某企业${theme.total}${fmt(whole)}${theme.unit}，${theme.count}为 ${count} 万人，同比增速分别约为 ${pct(a)} 与 ${pct(b)}。`,
    ["指标", "2024 年数值", "同比增速"],
    [
      [theme.total, `${fmt(whole)}${theme.unit}`, pct(a)],
      [theme.count, `${count}万人`, pct(b)],
    ],
    theme.unit,
    { categories: [theme.total, theme.count], series: [{ label: "2024 年", values: [whole, count] }] },
  );
  const variant = integer(0, 1);
  if (variant === 0) {
    const naive = round(a - b, 1);
    const set = options(R, [naive, round((a - b) / (1 + a / 100), 1), b], "%", random, 1);
    return {
      templateId: "average-rate-v3",
      params: { a, b, R },
      stem: `根据材料，${theme.avg}同比增长约多少？`,
      ...set,
      material,
      explanation: `平均数增长率=(分子增速−分母增速)÷(1+分母增速)=(${fmt(a)}%−${fmt(b)}%)÷(1+${fmt(b)}%)=${fmt(R)}%。${naive}% 是直接相减（漏掉 ÷(1+b)），b 是分母自身的增速。`,
    };
  }
  // 求分子增速：a = R + b + R·b/100
  const set = options(a, [R + b, round((R + b) * (1 + b / 100), 1), round(R - b, 1)], "%", random, 1);
  return {
    templateId: "average-rate-back-v3",
    params: { a, b, R },
    stem: `若${theme.avg}同比增长 ${fmt(R)}%、${theme.count}增速为 ${fmt(b)}%，则${theme.total}的同比增速约为多少？`,
    ...set,
    material,
    explanation: `由 R=(a−b)÷(1+b) 反解：a=R+b+R×b=${fmt(R)}%+${fmt(b)}%+${fmt(round((R * b) / 100, 2))}%≈${fmt(a)}%（干扰项 ${fmt(R + b)}% 漏掉交叉乘积项）。`,
  };
}

/** 差值（顺差/逆差）数据集：出口 A / 进口 B */
function diffSet(r: Rng) {
  const year = 2023;
  const A0 = r.integer(60, 160) * 10;
  const B0 = r.integer(30, 90) * 10;
  const rA = r.integer(2, 24);
  const rB = r.integer(2, 24);
  const A1 = Math.round(A0 * (1 + rA / 100));
  const B1 = Math.round(B0 * (1 + rB / 100));
  // 保证符号稳定：差量基数明显大于增量差的一半
  const D0 = A0 - B0;
  const D1 = A1 - B1;
  if (D0 === 0 || D1 === 0 || Math.sign(D0) !== Math.sign(D1)) return null;
  const surplus = D0 > 0;
  const M0 = Math.abs(D0);
  const M1 = Math.abs(D1);
  const RM = round(((M1 - M0) / M0) * 100, 1);
  if (Math.abs(RM) > 160) return null;
  return { year, A0, B0, A1, B1, rA, rB, D0, D1, surplus, M0, M1, RM };
}

function diffMaterial(d: NonNullable<ReturnType<typeof diffSet>>): MaterialSpec {
  const labelA = "出口额";
  const labelB = "进口额";
  return miniMaterial(
    `${d.year + 1} 年进出口情况`,
    `${d.year + 1} 年，某省货物${labelA}${fmt(d.A1)}亿美元，同比增长 ${fmt(d.rA)}%；货物${labelB}${fmt(d.B1)}亿美元，同比增长 ${fmt(d.rB)}%。`,
    ["指标", `${d.year + 1} 年(亿美元)`, "同比增速"],
    [
      [labelA, fmt(d.A1), pct(d.rA)],
      [labelB, fmt(d.B1), pct(d.rB)],
      ["贸易顺差(+)/逆差(−)", `${d.surplus ? "+" : "−"}${fmt(d.M1)}`, "—"],
    ],
    "亿美元",
    { categories: [labelA, labelB], series: [{ label: `${d.year + 1} 年`, values: [d.A1, d.B1] }] },
  );
}

export function generateDiffRate(r: Rng): QuestionDraft | null {
  const { integer, random } = r;
  const d = diffSet(r);
  if (!d) return null;
  const material = diffMaterial(d);
  const term = d.surplus ? "顺差" : "逆差";
  const variant = integer(0, 1);
  if (variant === 0) {
    const set = options(d.RM, [round(d.rA - d.rB, 1), round(d.M1 - d.M0, 1), round(d.RM * 2, 1)], "%", random, 1);
    return {
      templateId: "diff-rate-v3",
      params: { ...d, surplus: d.surplus ? 1 : 0 },
      stem: `根据材料，${d.year + 1} 年该省货物贸易${term}同比约增长多少？`,
      ...set,
      material,
      explanation: `先算基期进出口：出口基期=${fmt(d.A0)}、进口基期=${fmt(d.B0)}；${term}基期=${fmt(d.M0)}、现期=${fmt(d.M1)}。${term}增速=(现期−基期)÷基期=(${fmt(d.M1)}−${fmt(d.M0)})÷${fmt(d.M0)}=${fmt(d.RM)}%。不能直接相减两边增速（${fmt(d.rA - d.rB, 1)}% 未考虑进出口的基数差）。`,
    };
  }
  const dir = d.M1 > d.M0 ? "扩大" : "收窄";
  const opp = d.M1 > d.M0 ? "收窄" : "扩大";
  const strs = directionOptions(`${term}${dir}`, [`${term}${opp}`, "由顺差转为逆差", "由逆差转为顺差"], random);
  return {
    templateId: "diff-rate-direction-v3",
    params: { ...d, surplus: d.surplus ? 1 : 0 },
    stem: `根据材料，与上年相比该省货物贸易${term}：`,
    ...strs,
    material,
    explanation: `${term}变化量=出口增量−进口增量=(${d.A1 - d.A0})−(${d.B1 - d.B0})=${fmt(d.M1 - d.M0)}${d.M1 >= d.M0 ? "＞0" : "＜0"}，故${term}${dir}。只看“谁增速高”不充分：须把增速作用到各自的基数（出口基数 ${fmt(d.A0)}、进口基数 ${fmt(d.B0)}）再比较增量。`,
  };
}

/** 整体+部分增量数据集（贡献率/拉动共用） */
function contributionSet(r: Rng) {
  const T0 = r.integer(100, 300) * 10;
  const rT = r.integer(4, 10);
  const share0 = r.pick([8, 12, 15, 20, 25, 30]);
  const S0 = Math.round((T0 * share0) / 100);
  const rS = r.integer(rT + 3, 30);
  const T1 = Math.round(T0 * (1 + rT / 100));
  const S1 = Math.round(S0 * (1 + rS / 100));
  const dT = T1 - T0;
  const dS = S1 - S0;
  const contribution = round((dS / dT) * 100, 1);
  if (dT <= 0 || dS <= 0 || contribution <= 0 || contribution >= 100) return null;
  const pull = round((dS / T0) * 100, 2);
  return { T0, T1, S0, S1, rT, rS, dT, dS, contribution, pull, year: 2024 };
}

function contributionMaterial(d: NonNullable<ReturnType<typeof contributionSet>>, partName: string, wholeName: string, otherName: string): MaterialSpec {
  const other0 = d.T0 - d.S0;
  const other1 = d.T1 - d.S1;
  return miniMaterial(
    `${d.year} 年 ${wholeName}`,
    `${d.year} 年，${wholeName}实现 ${fmt(d.T1)} 亿元，同比增长 ${fmt(d.rT)}%。其中${partName}完成 ${fmt(d.S1)} 亿元，同比增长 ${fmt(d.rS)}%。`,
    ["指标", `${d.year} 年(亿元)`, "同比增速"],
    [
      [wholeName, fmt(d.T1), pct(d.rT)],
      [partName, fmt(d.S1), pct(d.rS)],
      [otherName, fmt(other1), "—"],
    ],
    "亿元",
    { categories: [partName, otherName], series: [{ label: `${d.year} 年`, values: [d.S1, other1] }, { label: `${d.year - 1} 年`, values: [d.S0, other0] }] },
  );
}

export function generateContributionRate(r: Rng): QuestionDraft | null {
  const { integer, random } = r;
  const d = contributionSet(r);
  if (!d) return null;
  const partName = r.pick(["高技术制造业", "网上零售", "新能源汽车产业"]);
  const wholeName = r.pick(["全部工业", "社会消费品零售总额", "全部产业"]);
  const otherName = "其他部分";
  const material = contributionMaterial(d, partName, wholeName, otherName);
  const variant = integer(0, 1);
  if (variant === 0) {
    const set = options(d.contribution, [d.pull, round((d.rS - d.rT) * 10, 1), round((d.S1 - d.S0) / (d.T1 - d.S1) * 100, 1)], "%", random, 1);
    return {
      templateId: "contribution-rate-v3",
      params: { ...d },
      stem: `根据材料，${partName}对${wholeName}增长的贡献率约为多少？`,
      ...set,
      material,
      explanation: `贡献率=部分增量÷整体增量=(${fmt(d.S1)}−${fmt(d.S0)})÷(${fmt(d.T1)}−${fmt(d.T0)})=${fmt(d.dS)}÷${fmt(d.dT)}=${fmt(d.contribution)}%。干扰项 ${fmt(d.pull)}% 是拉动增长率（分母用整体基期），两者分母不同不可混用。`,
    };
  }
  // 与另一部分比较：给两行业增量，求贡献更大的（材料含两行增速与现期）
  const otherName2 = r.pick(["传统产业", "批发零售", "房地产"]); 
  const otherS0 = Math.max(20, Math.round((d.T0 - d.S0) * r.pick([0.2, 0.3, 0.4])));
  const otherS1 = Math.round(otherS0 * (1 + r.integer(0, 8) / 100));
  const otherD = otherS1 - otherS0;
  const table = tableBlock(
    `${d.year} 年分行业增加值`,
    ["行业", `${d.year} 年(亿元)`, "同比增速", "增量(亿元)"],
    [
      [partName, fmt(d.S1), pct(d.rS), fmt(d.dS)],
      [otherName2, fmt(otherS1), "—", fmt(otherD)],
    ],
  );
  const material2: MaterialSpec = {
    paragraphs: material.paragraphs,
    table,
  };
  const answer = d.dS > otherD ? partName : otherName2;
  const loser = d.dS > otherD ? otherName2 : partName;
  const strs = directionOptions(
    answer,
    [loser, `${partName}与${otherName2}持平`, "无法比较"],
    random,
  );
  return {
    templateId: "contribution-rate-compare-v3",
    params: { ...d, otherD },
    stem: `根据材料，${d.year} 年对${wholeName}增长贡献更大的是：`,
    ...strs,
    material: material2,
    explanation: `贡献率比大小等价于比较两部分的增量（分母同为整体增量）：${partName}增量=${fmt(d.dS)}、${otherName2}增量=${fmt(otherD)}，故${answer}贡献更大。只看增速快慢（${partName}${d.rS}%）不能直接定论，还要看体量。`,
  };
}

export function generatePullGrowth(r: Rng): QuestionDraft | null {
  const { integer, random } = r;
  const d = contributionSet(r);
  if (!d) return null;
  const partName = r.pick(["新能源汽车产业", "高技术制造业", "网上零售"]);
  const wholeName = r.pick(["全部工业增加值", "地区生产总值", "社会消费品零售总额"]);
  const otherName = "其他部分";
  const material = contributionMaterial(d, partName, wholeName, otherName);
  const variant = integer(0, 1);
  if (variant === 0) {
    const set = options(d.pull, [d.contribution, round((d.S1 - d.S0) / d.T1 * 100, 2), round(d.pull * 2, 2)], " 个百分点", random, 2);
    return {
      templateId: "pull-growth-v3",
      params: { ...d },
      stem: `根据材料，${partName}拉动${wholeName}增长约多少个百分点？`,
      ...set,
      material,
      explanation: `拉动增长率=部分增量÷整体基期量=(${fmt(d.S1)}−${fmt(d.S0)})÷${fmt(d.T0)}=${fmt(d.dS)}÷${fmt(d.T0)}=${fmt(d.pull)} 个百分点。干扰项 ${fmt(d.contribution)}% 是贡献率（分母是整体增量），二者分母不同。`,
    };
  }
  // 逆向：已知拉动百分点与整体基期，求部分增量
  const set = options(d.dS, [d.dT, Math.round((d.pull / 100) * d.T1), Math.round(d.dS / 2)], " 亿元", random);
  return {
    templateId: "pull-growth-back-v3",
    params: { ...d },
    stem: `若${wholeName}上年为 ${fmt(d.T0)} 亿元，${partName}对其增长的拉动为 ${fmt(d.pull)} 个百分点，则${partName}增量约为多少亿元？`,
    ...set,
    material,
    explanation: `部分增量=拉动×整体基期=${fmt(d.pull)}%×${fmt(d.T0)}=${fmt(d.dS)} 亿元。注意用整体基期量而非整体增量（整体增量=${fmt(d.dT)} 是贡献率的分母）。`,
  };
}
