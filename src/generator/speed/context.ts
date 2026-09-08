/**
 * 资料速算「高难度·实战」语境材料（语义化版）：
 * 为生成时为纯计算/概念式的速算题，按参数附加中文语义化的文字+表格+图表材料，
 * 杜绝"数值一/二/三""指标 A/B"这类无意义标签。（加减/乘法平方/除法估算由 scenario.ts 提供真题问法与材料）
 */
import type { MaterialSpec, QuestionDraft } from "../types";
import { fmt } from "../random";

/** 速算 tool/概念模块可能出现的参数 → 中文指标名 */
const KEY_LABELS: Record<string, string> = {
  // 乘/除/小数
  a: "数量",
  b: "单价",
  dividend: "总额",
  divisor: "份数",
  quotient: "每份值",
  remainder: "余数",
  left: "较大值",
  right: "较小值",
  // 百分化/敏感数
  denominator: "总份数",
  numerator: "所占份数",
  percent: "占比",
  // 增长类
  base: "基期量",
  current: "现期量",
  rate: "同比增速",
  growth: "增长量",
  amount: "绝对增量",
  step: "年均增量",
  n: "年份间隔",
  totalGrow: "总增量",
  r1: "首年增速",
  r2: "次年增速",
  back: "次年增速",
  times: "增长倍数",
  // 比重/平均数
  whole: "整体量",
  part: "部分量",
  share: "占比",
  gap: "提高个百分点",
  last: "上年占比",
  wholeBase: "上年整体量",
  wholeCurrent: "现期整体量",
  partBase: "上年部分量",
  partCurrent: "现期部分量",
  count: "份数",
  average: "平均数",
  total: "总量",
};

/** 主题单位 */
const UNITS: Record<string, string> = {
  sensitive: "亿元",
  decimal: "",
  "growth-rate": "亿元",
  "growth-amount": "亿元",
  "base-amount": "亿元",
  multiples: "万元",
  "interval-growth": "%",
  "annual-amount": "亿元",
  "ratio-basic": "亿元",
  "part-quantity": "亿元",
  "average-basic": "亿元",
};

function unitOf(draft: QuestionDraft) {
  const first = draft.templateId.split("-")[0] as string;
  const key = first === "square" ? "multiply" : first;
  return UNITS[key] ?? "";
}

/** 语义化抽取参数：跳过无意义键；未映射的键直接忽略，避免泄漏原始参数名 */
function semanticEntries(
  draft: QuestionDraft,
): Array<{ label: string; value: number }> {
  const skip = new Set([
    "answer",
    "operation",
    "digits",
    "unit",
    "multiplier",
    "expression",
    "params",
  ]);
  const entries: Array<{ label: string; value: number }> = [];
  for (const [key, value] of Object.entries(draft.params)) {
    if (skip.has(key)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const label = KEY_LABELS[key];
    if (!label) continue;
    entries.push({ label, value });
  }
  return entries;
}

/** 为语义化参数附语境材料；无可用参数或非速算主题返回 null（加减/乘/除由 scenario 专用处理） */
export function contextMaterial(draft: QuestionDraft): MaterialSpec | null {
  const entries = semanticEntries(draft);
  const unit = unitOf(draft);
  if (entries.length === 0) return null;
  const caption = unit ? `题干数据（单位：${unit}）` : "题干数据";
  const rows = entries.map((entry) => [
    entry.label,
    entry.value % 1 === 0 ? String(entry.value) : fmt(entry.value, 2),
  ]);
  const positive = entries
    .map((entry) => entry.value)
    .filter((value) => value > 0 && value < 1e9);
  const material: MaterialSpec = {
    paragraphs: [
      `材料：下表为该题所涉及的数据${unit ? `（单位：${unit}）` : ""}，请据此完成下列计算。`,
    ],
    table: { caption, headers: ["指标", "数值"], rows },
  };
  if (positive.length >= 2 && positive.length <= 6) {
    material.chart = {
      kind: "bar",
      unit: unit || "",
      categories: rows.slice(0, positive.length).map((row) => row[0]),
      series: [{ label: "数值", values: positive }],
    };
  }
  return material;
}
