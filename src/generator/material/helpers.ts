/** 「资料实战」轨道公共工具：选材料、选项洗牌、标签池 */
import type { QuestionDraft, Rng } from "../types";
import type { MaterialEntry } from "./types";
import { MATERIALS } from "./data/materials";

/** 从材料库中按 rng 选一篇（确定性：同 seed 同结果） */
export function pickEntry(r: Rng): MaterialEntry {
  return r.pick(MATERIALS);
}

/**
 * 按材料的**实际结构**推导呈现形式（唯一口径，不信任手写字段）：
 * 只有文字→文字型；有表无图→表格型；有图无表→图表型；表图都有→文字图表综合型。
 */
export function kindFromMaterial(material: MaterialEntry["material"]): MaterialEntry["kind"] {
  const hasTable = !!material.table;
  const hasChart = !!material.chart;
  if (hasTable && hasChart) return "mixed";
  if (hasTable) return "table";
  if (hasChart) return "chart";
  return "text";
}

/** 材料呈现形式的中文标签 */
export function kindLabel(kind: MaterialEntry["kind"]): string {
  switch (kind) {
    case "text":
      return "文字型";
    case "table":
      return "表格型";
    case "chart":
      return "图表型";
    default:
      return "文字图表综合型";
  }
}

const KIND_POOL: MaterialEntry["kind"][] = ["text", "table", "chart", "mixed"];

/** 4 个「材料类型」选项（正确项按结构推导 + 其余三个） */
export function kindOptions(material: MaterialEntry["material"], random: () => number) {
  const actual = kindFromMaterial(material);
  const correct = kindLabel(actual);
  const others = KIND_POOL.filter((k) => k !== actual).map(kindLabel);
  return shuffle(correct, others.slice(0, 3), random);
}

const UNIT_POOL = ["亿元", "万元", "万件", "万吨", "元", "%"];
const CALIBER_POOL = ["同比", "环比", "累计", "年均"];

/** 单位选项（正确单位 + 池中其它 3 个） */
export function unitOptions(correct: string, random: () => number) {
  const others = UNIT_POOL.filter((u) => u !== correct).slice(0, 3);
  return shuffle(correct, others, random);
}

/** 时间口径选项 */
export function caliberOptions(correct: string, random: () => number) {
  const others = CALIBER_POOL.filter((c) => c !== correct).slice(0, 3);
  return shuffle(correct, others, random);
}

/** 通用：正确答案 + 3 个干扰项 → 洗牌成 4 选项（保证互异） */
export function shuffle(
  correct: string,
  distractors: string[],
  random: () => number,
): { options: [string, string, string, string]; answerIndex: 0 | 1 | 2 | 3 } {
  const values = [...new Set([correct, ...distractors])].slice(0, 4);
  let n = 1;
  while (values.length < 4) {
    values.push(`其它（${n}）`);
    n += 1;
  }
  for (let i = values.length - 1; i > 0; i -= 1) {
    const target = Math.floor(random() * (i + 1));
    [values[i], values[target]] = [values[target], values[i]];
  }
  return {
    options: values as [string, string, string, string],
    answerIndex: values.indexOf(correct) as 0 | 1 | 2 | 3,
  };
}

/** 材料题的公共外壳：统一挂 material */
export function withMaterial(
  entry: MaterialEntry,
  draft: Omit<QuestionDraft, "material">,
): QuestionDraft {
  return { ...draft, material: entry.material };
}
