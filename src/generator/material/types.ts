/**
 * 「资料实战」轨道的材料库类型。
 *
 * 与 speed / sequence 轨道的「程序生成」不同，本轨道基于**真题材料**：
 * 材料是静态内容（文字/表格/图表），题目从材料**派生**（阅读/定位/列式）。
 * 材料库放在 src/ 下（不打进 content/ 构建产物），因为题目由服务端生成、
 * 需要随 Worker bundle 一起打包（见 functions/api/[[path]].ts 直接 import src/generator）。
 */
import type { MaterialSpec } from "../types";

/** 时间口径（用于「口径识别」题与解析） */
export type Caliber = "同比" | "环比" | "累计" | "年均" | "占比" | "差值";

/** 列式题型（决定干扰项从哪里取） */
export type FormulaKind =
  | "growth-rate" // 增长率 r =(现-基)/基
  | "base-amount" // 基期量 = 现/(1+r)
  | "growth-amount" // 增长量 = 现×r/(1+r)
  | "ratio" // 比重 = 部分/整体
  | "average" // 平均数 = 总量/份数
  | "ratio-change" // 两期比重差（百分点）
  | "average-rate" // 平均数增长率 =(a-b)/(1+b)
  | "contribution" // 增长贡献率 = 部分增量/整体增量
  | "pull"; // 拉动增长率 = 部分增量/整体基期量

/** 材料中的一个指标：定位题与解析的原子 */
export interface MaterialIndicator {
  /** 指标名（出现在材料正文/表格中） */
  name: string;
  /** 数据所在位置（用于定位题的正确项与解析） */
  where: string;
  /** 单位（可选）；为 "%" 表示该指标本身是一个增速 */
  unit?: string;
  /** 该指标的典型问法（定位题题干用） */
  ask: string;
  /** 口径 */
  caliber?: Caliber;
  /**
   * 指标的主数值——「取数题」与「差值题」的标答来源。
   *
   * ⚠️ 必须**原文出现在材料正文/表格中**（由 material-bank 测试断言），
   * 否则会出现「标答与材料对不上」的错题（见 commit 171baf5 的教训）。
   * 图表类指标（如「各月接收诉求量」是整条序列）可省略，省略后不参与数值题。
   */
  value?: number;
}

/** 材料中一个「可求量」：列式题的原子 */
export interface MaterialComputable {
  /** 设问句，如「求 2022 年货物进出口总额」 */
  ask: string;
  /** 正确算式（文字算式，不含具体数值也可） */
  answer: string;
  /** 3 个易错干扰算式 */
  distractors: [string, string, string];
  /** 题型 */
  kind: FormulaKind;
  /** 依据/解析要点 */
  basis: string;
  /** 对应指标名（用于解析与定位联动） */
  indicator: string;
}

/** 一篇真题材料 */
export interface MaterialEntry {
  id: string;
  /** 出处标注（展示在材料页脚） */
  source: string;
  /** 材料主题（阅读题正确项） */
  topic: string;
  /** 材料呈现形式 */
  kind: "text" | "table" | "chart" | "mixed";
  /** 结构化材料（复用 speed 轨道的 MaterialSpec） */
  material: MaterialSpec;
  /** 时间口径概览 */
  calibrated: string;
  /** 材料涉及的指标 */
  indicators: MaterialIndicator[];
  /** 可从材料求出的量（列式题） */
  computables: MaterialComputable[];
  /** 同类但材料**未涉及**的指标（"下列哪项未涉及"题的正确答案） */
  externalIndicators: string[];
  /** 相似主题（主题题干扰项） */
  similarTopics: string[];
}
