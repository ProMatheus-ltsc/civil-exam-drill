/**
 * 资料速算「高难度·实战」语境材料注入：
 * 对生成时为纯计算/概念式的速算题目，按其参数自动包装成文字+表格+图表的短材料，
 * 使高难度局任一资料速算模块的题目都贴近实战材料题。
 * （数字推理高局维持纯数列，不注入材料。）
 */
import type { MaterialSpec, QuestionDraft } from "../types";
import { fmt } from "../random";

const KEY_LABELS: Record<string, string> = {
  a: "指标 A",
  b: "指标 B",
  base: "基期量",
  current: "现期量",
  rate: "同比增速",
  growth: "增长量",
  amount: "绝对增量",
  part: "部分量",
  whole: "整体量",
  share: "占比",
  partBase: "上年部分量",
  partCurrent: "现期部分量",
  wholeBase: "上年整体量",
  wholeCurrent: "现期整体量",
  left: "较大数",
  right: "较小数",
  dividend: "被除数",
  divisor: "除数",
  quotient: "商",
  count: "份数",
  average: "平均数",
  total: "总量",
  n: "年份间隔",
  r1: "首年增速",
  r2: "次年增速",
  multiplier: "倍数",
  start: "起点",
  year: "年份",
};

/** 各主题数值单位（用于表格与图表轴） */
const UNITS: Record<string, string> = {
  arithmetic: "",
  multiply: "",
  divide: "",
  sensitive: "亿元",
  decimal: "",
  "growth-rate": "亿元",
  "growth-amount": "亿元",
  "base-amount": "亿元",
  multiples: "万元",
  "interval-growth": "%",
  "mixed-growth": "亿元",
  "annual-amount": "亿元",
  "annual-rate": "亿元",
  "ratio-basic": "亿元",
  "part-quantity": "亿元",
  "average-basic": "亿元",
  "base-ratio": "亿元",
  "ratio-change": "亿元",
  "average-rate": "万元",
  "diff-rate": "亿美元",
  "contribution-rate": "亿元",
  "pull-growth": "亿元",
};

function numericEntries(
  draft: QuestionDraft,
): Array<{ label: string; value: number }> {
  const entries: Array<{ label: string; value: number }> = [];
  const keys = Object.keys(draft.params);
  const skip = new Set(["answer"]);
  for (const key of keys) {
    if (skip.has(key)) continue;
    const value = draft.params[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      entries.push({ label: KEY_LABELS[key] ?? key, value });
    }
  }
  if (entries.length === 0 && typeof draft.params.expression === "string") {
    const numbers =
      (draft.params.expression as string)
        .match(/-?\d+(?:\.\d+)?/g)
        ?.map(Number)
        .filter(Number.isFinite) ?? [];
    numbers.forEach((value, index) =>
      entries.push({ label: `第 ${index + 1} 项数值`, value }),
    );
  }
  return entries;
}

function unitOf(draft: QuestionDraft) {
  const first = draft.templateId.split("-")[0] as string;
  const key = first === "square" ? "multiply" : first;
  return (
    UNITS[key] ??
    UNITS[draft.templateId.split("-").slice(0, 2).join("-")] ??
    ""
  );
}

/** 为纯计算/概念式速算题附加语境材料；已有材料或非速算主题返回 null */
export function contextMaterial(draft: QuestionDraft): MaterialSpec | null {
  const entries = numericEntries(draft);
  const unit = unitOf(draft);
  const caption = unit ? `题干数据（单位：${unit}）` : "题干数据";
  const rows = entries.map((entry) => [
    entry.label,
    entry.value % 1 === 0 ? String(entry.value) : fmt(entry.value, 2),
  ]);
  if (rows.length === 0) return null;
  const values = entries.map((entry) => entry.value);
  const material: MaterialSpec = {
    paragraphs: [
      `材料：以下为该题涉及的数据与口径说明。请结合表格信息与题干要求完成计算${unit ? `（数值单位：${unit}）` : ""}。`,
    ],
    table: { caption, headers: ["指标", "数值"], rows },
  };
  const positive = values.filter((value) => value > 0 && value < 1e9);
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
