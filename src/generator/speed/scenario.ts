/**
 * 真题化场景重写：为 加法/减法/多项求和/多项求差/乘法平方/除法估算 的高难度“实战”题，
 * 一键改写为贴合真实资料的题干问法与配套材料（行业语境 + 表格 + 柱状图），
 * 避免“不使用计算器，计算 X”这类干瘪问法与“数值一/二/三”标签。
 */
import type { MaterialSpec, QuestionDraft } from "../types";

type Scenario = { stem: string; material: MaterialSpec };

const QUARTERS = ["一季度", "二季度", "三季度", "四季度"];
const HALVES = ["上半年", "下半年"];
const MONTHS = ["1 月", "2 月", "3 月", "4 月", "5 月", "6 月"];

/**
 * 带符号的项：46478-37179 → [{46478,+1},{37179,-1}]。
 * 注意不能直接用 `/-?\d+/` 取数——那样减号会被吃进数字里，"2747-1955" 会解析出 -1955，
 * 于是题干和材料里出现「2023 年为 -1955 亿元」这种负数（这个坑真踩过）。
 */
function termsFromExpression(expression: string) {
  return (expression.match(/[+-]?\s*\d+(?:\.\d+)?/g) ?? []).map((token) => ({
    value: Math.abs(Number(token)),
    sign: token.trim().startsWith("-") ? (-1 as const) : (1 as const),
  }));
}

function arithmeticScenario(templateId: string, params: Record<string, number | string>): Scenario | null {
  const expression = String(params.expression ?? "");
  const terms = termsFromExpression(expression);
  /** 只用于展示的数值：全部取正，符号交给 terms.sign */
  const values = terms.map((term) => term.value);
  const unit = "亿元";
  if (values.length < 2) return null;
  // 多项求差·连减：总量减去各部分，问「其余」（真题里叫其余支出/其他类）
  if (templateId.startsWith("diff-chain")) {
    const [total, ...parts] = values;
    const labels = ["教育支出", "社会保障和就业支出", "交通运输支出", "农林水支出"];
    const remainder = total - parts.reduce((sum, value) => sum + value, 0);
    return {
      stem: `2024 年某市一般公共预算支出 ${total} 亿元，其中${parts
        .map((value, index) => `${labels[index] ?? `第 ${index + 1} 项`} ${value} 亿元`)
        .join("、")}。则其余支出为多少亿元？`,
      material: buildMaterial(
        "2024 年某市一般公共预算支出（单位：亿元）",
        [
          ["支出合计", String(total)],
          ...parts.map((value, index) => [labels[index] ?? `第 ${index + 1} 项`, String(value)]),
        ],
        unit,
        [{ label: "支出合计", value: total }, ...parts.map((value, index) => ({ label: labels[index] ?? "其他", value }))],
        `2024 年某市一般公共预算支出合计 ${total} 亿元，其中教育、社会保障、交通运输等为主要支出项。`,
      ),
    };
  }
  // 多项求差·两组和相减：现期两组和 − 基期两组和（同比增加量）
  if (templateId.startsWith("diff-pairs")) {
    const [a, b, c, d] = values;
    return {
      stem: `2024 年某市一、二季度财政收入分别为 ${a}、${b} 亿元，2023 年同期分别为 ${c}、${d} 亿元。则 2024 年上半年比上年同期增加多少亿元？`,
      material: buildMaterial(
        "某市财政收入（单位：亿元）",
        [
          ["2024 年上半年", String(a + b)],
          ["2024 年一季度", String(a)],
          ["2024 年二季度", String(b)],
          ["2023 年上半年", String(c + d)],
        ],
        unit,
        [
          { label: "2024 年一季度", value: a },
          { label: "2024 年二季度", value: b },
        ],
        `2024 年某市上半年财政收入分季度为 ${a}、${b} 亿元，2023 年同期为 ${c}、${d} 亿元。`,
      ),
    };
  }
  // 减法（两项）：同比增加量。逐年数值都取正展示，算式里的减号不进材料。
  if (templateId.includes("subtract") && values.length === 2) {
    const [current, previous] = [values[0], values[1]];
    const rows = [
      ["2024 年", String(current)],
      ["2023 年", String(previous)],
    ];
    return {
      stem: `2024 年某市一般公共预算收入为 ${current} 亿元，2023 年为 ${previous} 亿元。则 2024 年比上年增加了多少亿元？`,
      material: buildMaterial("某市一般公共预算收入（单位：亿元）", rows, unit, [
        { label: "2024 年", value: current },
        { label: "2023 年", value: previous },
      ], `2023—2024 年某市一般公共预算收入。`),
    };
  }
  // 求和（分阶段合计 / 多项合计）：2 项→上/下半年、3~4 项→季度、5 项→1—5 月各月
  const useMonths = values.length >= 5;
  const labels = useMonths
    ? MONTHS.slice(0, values.length)
    : values.length === 2
      ? HALVES
      : QUARTERS.slice(0, values.length);
  const rows = values.map((value, index) => [labels[index], String(value)]);
  const scope = useMonths ? " 1—5 月各月" : "分阶段";
  return {
    stem: `2024 年某地区${scope}完成规模以上工业增加值如下（单位：亿元）：${labels
      .map((label, index) => `${label} ${values[index]}`)
      .join("、")}。则该地区${useMonths ? " 1—5 月合计" : "全年合计"}为多少亿元？`,
    material: buildMaterial(
      `某地区 2024 年${scope}完成指标（单位：亿元）`,
      rows,
      unit,
      labels.map((label, index) => ({ label, value: values[index] })),
      `某地区 2024 年${scope}完成指标，共 ${values.length} 项。`,
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

/** 真题化重写入口：命中 加减/多项求和求差/乘除 时返回新题干与材料 */
export function rephraseDraft(
  draft: QuestionDraft,
  topicId: string,
): { stem: string; material: MaterialSpec } | null {
  if (
    topicId === "addition" ||
    topicId === "subtraction" ||
    topicId === "sum-many" ||
    topicId === "diff-many"
  )
    return arithmeticScenario(draft.templateId, draft.params);
  if (topicId === "multiply") return multiplyScenario(draft.templateId, draft.params);
  if (topicId === "divide") return divideScenario(draft.params);
  return null;
}
