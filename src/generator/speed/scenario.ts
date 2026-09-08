/**
 * 真题化场景重写：为 加减/乘法平方/除法估算 三个模块的高难度“实战”题，
 * 一键改写为贴合真实资料的题干问法与配套材料（行业语境 + 表格 + 柱状图），
 * 避免“不使用计算器，计算 X”这类干瘪问法与“数值一/二/三”标签。
 */
import type { MaterialSpec, QuestionDraft } from "../types";

type Scenario = { stem: string; material: MaterialSpec };

const QUARTERS = ["一季度", "二季度", "三季度", "四季度"];
const HALVES = ["上半年", "下半年"];

function numbersFromExpression(expression: string) {
  return (
    expression.match(/-?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) ?? []
  );
}

function arithmeticScenario(templateId: string, params: Record<string, number | string>): Scenario | null {
  const expression = String(params.expression ?? "");
  const values = numbersFromExpression(expression);
  const unit = "亿元";
  if (values.length < 2) return null;
  const isSubtract = templateId.includes("subtract");
  const caption = isSubtract ? "某市一般公共预算收入（单位：亿元）" : "某地区分季度完成指标（单位：亿元）";
  if (isSubtract && values.length === 2) {
    const [current, previous] = [values[0], values[1]];
    const diff = current - previous;
    const rows = [
      ["2024 年", String(current)],
      ["2023 年", String(previous)],
    ];
    return {
      stem: `2024 年某市一般公共预算收入为 ${current} 亿元，2023 年为 ${previous} 亿元。则 2024 年比上年增加了多少亿元？`,
      material: buildMaterial(caption, rows, unit, [
        { label: "2024 年", value: current },
        { label: "2023 年", value: previous },
      ], `2023—2024 年某市一般公共预算收入。`),
    };
  }
  // 求和（分阶段合计 / 多项合计）
  const labels =
    values.length === 2 ? HALVES : values.length === 3 ? QUARTERS.slice(0, 3) : QUARTERS.slice(0, 4);
  const rows = values.map((value, index) => [labels[index] ?? `第 ${index + 1} 阶段`, String(value)]);
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    stem: `2024 年某地区分阶段完成规模以上工业增加值如下（单位：亿元）：${labels
      .map((label, index) => `${label} ${values[index]}`)
      .join("、")}。则该地区全年合计为多少亿元？`,
    material: buildMaterial(
      caption,
      rows,
      unit,
      labels.map((label, index) => ({ label, value: values[index] })),
      `2024 年某地区分阶段完成指标。`,
    ),
  };
}

function multiplyScenario(templateId: string, params: Record<string, number | string>): Scenario | null {
  if (templateId.startsWith("square-")) {
    const side = Number(params.a);
    if (!Number.isFinite(side)) return null;
    const area = side * side;
    return {
      stem: `某正方形地块边长为 ${side} 米，其面积为多少平方米？`,
      material: buildMaterial(
        "正方地块（单位：米）",
        [["边长(米)", String(side)]],
        "平方米",
        [{ label: "边长", value: side }],
        `某正方形地块，边长为 ${side} 米。`,
      ),
    };
  }
  const a = Number(params.a);
  const b = Number(params.b);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const total = a * b;
  const unit = "元";
  return {
    stem: `某市场本月出货 ${b} 件商品，每件单价 ${a} 元。则本月该批商品总销售额为多少元？`,
    material: buildMaterial(
      "商品销售数据",
      [
        ["数量(件)", String(b)],
        ["单价(元/件)", String(a)],
      ],
      unit,
      [
        { label: "数量", value: b },
        { label: "单价", value: a },
      ],
      `某市场本月商品销售情况：数量 ${b} 件、单价 ${a} 元/件。`,
    ),
  };
}

function divideScenario(params: Record<string, number | string>): Scenario {
  const dividend = Number(params.dividend);
  const divisor = Number(params.divisor);
  const quotient = Number(params.quotient);
  const remainder = Number(params.remainder) || 0;
  const unit = "万元";
  return {
    stem: `某专项资金总额为 ${dividend} 万元，拟平均分配给 ${divisor} 个承办项目。每个项目约可分配多少万元？（取最接近的整数）`,
    material: buildMaterial(
      "专项资金分配数据（单位：万元）",
      [
        ["资金总额(万元)", String(dividend)],
        ["项目数(个)", String(divisor)],
        ["每项(万元)", String(quotient)],
        ["余数(万元)", String(remainder)],
      ],
      unit,
      [
        { label: "资金总额", value: dividend },
        { label: "项目数", value: divisor },
      ],
      `某专项资金共 ${dividend} 万元，拟分配至 ${divisor} 个项目。`,
    ),
  };
}

function buildMaterial(
  caption: string,
  rows: string[][],
  unit: string,
  seriesValues: { label: string; value: number }[],
  sentence: string,
): MaterialSpec {
  const material: MaterialSpec = {
    paragraphs: [sentence],
    table: { caption, headers: ["指标", "数值"], rows },
  };
  const positive = seriesValues
    .map((item) => item.value)
    .filter((value) => value > 0 && value < 1e9);
  if (positive.length >= 2) {
    material.chart = {
      kind: "bar",
      unit,
      categories: rows
        .slice(0, positive.length)
        .map((row) => row[0]),
      series: [{ label: "数值", values: positive }],
    };
  }
  return material;
}

/** 真题化重写入口：命中 加减/乘除 时返回新题干与材料 */
export function rephraseDraft(
  draft: QuestionDraft,
  topicId: string,
): { stem: string; material: MaterialSpec } | null {
  if (topicId === "arithmetic")
    return arithmeticScenario(draft.templateId, draft.params);
  if (topicId === "multiply") return multiplyScenario(draft.templateId, draft.params);
  if (topicId === "divide") return divideScenario(draft.params);
  return null;
}
