/** 短材料与方向类选项的公共构造工具（纯结构化数据，前端渲染） */
import type { MaterialSpec } from "../types";

/** 数值型材料（表格行已格式化好的字符串行） */
export function tableBlock(
  caption: string,
  headers: string[],
  rows: string[][],
): NonNullable<MaterialSpec["table"]> {
  return { caption, headers, rows };
}

export function chartBlock(
  kind: "bar" | "line",
  unit: string,
  categories: string[],
  series: { label: string; values: number[] }[],
): NonNullable<MaterialSpec["chart"]> {
  return { kind, unit, categories, series };
}

/** 方向/结论类选择题（非数值选项），4 项洗牌 */
export function directionOptions(
  answer: string,
  distractors: string[],
  random: () => number,
): { options: [string, string, string, string]; answerIndex: 0 | 1 | 2 | 3 } {
  const values = [...new Set([answer, ...distractors])].slice(0, 4);
  while (values.length < 4) values.push(`其它(${values.length + 1})`);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [values[index], values[target]] = [values[target], values[index]];
  }
  return {
    options: values as [string, string, string, string],
    answerIndex: values.indexOf(answer) as 0 | 1 | 2 | 3,
  };
}