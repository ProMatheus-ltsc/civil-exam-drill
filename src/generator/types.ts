/** 训练题生成器共享类型 */

export type Difficulty = "easy" | "medium" | "hard";

/** 单题短材料：文字段落 + 小型表格/图表（纯结构化数据，前端自行渲染，无 raw HTML） */
export interface MaterialSpec {
  paragraphs: string[];
  table?: {
    caption?: string;
    headers: string[];
    rows: string[][];
  };
  chart?: {
    kind: "bar" | "line";
    unit: string;
    categories: string[];
    series: { label: string; values: number[] }[];
  };
  footnote?: string;
}

export interface GeneratedQuestion {
  templateId: string;
  templateVersion: number;
  params: Record<string, number | string>;
  fingerprint: string;
  stem: string;
  options: [string, string, string, string];
  answerIndex: 0 | 1 | 2 | 3;
  explanation: string;
  material?: MaterialSpec | null;
}

/** 生成草稿（未含 fingerprint/templateVersion） */
export type QuestionDraft = Omit<
  GeneratedQuestion,
  "fingerprint" | "templateVersion"
>;

/** 生成上下文：按 seed+attempt 派生的随机工具与难度档 */
export interface Rng {
  level: number;
  random(): number;
  integer(min: number, max: number): number;
  pick<T>(values: readonly T[]): T;
}
