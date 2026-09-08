/** 训练关卡目录（单一事实源：前端关卡图/API 校验/生成器/测试共用） */
import type { Difficulty } from "./types";

export type TopicId =
  // 资料速算轨道
  | "arithmetic"
  | "multiply"
  | "divide"
  | "sensitive"
  | "decimal"
  | "growth-rate"
  | "growth-amount"
  | "base-amount"
  | "multiples"
  | "base-difference"
  | "interval-growth"
  | "mixed-growth"
  | "annual-amount"
  | "annual-rate"
  | "ratio-basic"
  | "part-quantity"
  | "average-basic"
  | "base-ratio"
  | "ratio-change"
  | "average-rate"
  | "diff-rate"
  | "contribution-rate"
  | "pull-growth"
  // 数字推理轨道
  | "seq-basic"
  | "seq-multilevel"
  | "seq-multiple"
  | "seq-periodic"
  | "seq-power"
  | "seq-recursive"
  | "seq-fraction"
  | "seq-split"
  | "seq-factor";

export type TrackId = "speed" | "sequence";

/** 题目难度预算档：tool=纯心算 / concept=资料概念 / material=带短材料 / sequence=数字推理（秒/题） */
export type BudgetClass = "tool" | "concept" | "material" | "sequence";

export interface TrainingTopic {
  id: TopicId;
  track: TrackId;
  title: string;
  description: string;
  /** 难度档 1=基础 2=进阶 3=高阶；决定关卡内难度阶梯 */
  rating: 1 | 2 | 3;
  /** 是否单题带短材料（高阶实战） */
  material: boolean;
  /** 前置关卡：全部通过后本关解锁 */
  unlock: TopicId[];
  /** 知识库讲解文章 id（深链 /knowledge/:docId） */
  docId?: string;
  ladder: Difficulty[];
  budgetClass: BudgetClass;
}

export const LADDERS: Record<1 | 2 | 3, Difficulty[]> = {
  // 先难度提升：关内 10 题按 easy→medium→hard 递进
  1: ["easy", "easy", "easy", "easy", "medium", "medium", "medium", "hard", "hard", "hard"],
  2: ["easy", "easy", "medium", "medium", "medium", "medium", "hard", "hard", "hard", "hard"],
  3: ["medium", "medium", "hard", "hard", "hard", "hard", "hard", "hard", "hard", "hard"],
};

/** 每题时间预算（秒）初值：按预算档×难度；可按实测在单点微调 */
export const BUDGET_SECONDS: Record<BudgetClass, Record<Difficulty, number>> = {
  tool: { easy: 15, medium: 22, hard: 30 },
  concept: { easy: 25, medium: 40, hard: 60 },
  material: { easy: 45, medium: 60, hard: 85 },
  sequence: { easy: 45, medium: 65, hard: 85 },
};

/**
 * 难度局语义：模块内区分 低/中/高 三个难度局，每题同难度、共 10 题。
 * - 难度高低取决于：题干数字复杂度（档位越高数值越非整、多步换算）+ 选项接近程度；
 * - 资料速算的高难度局为“实战难度”：题目一律附文字/表格/图表短材料；
 * - 模块通关 = 通过本模块“高难度局”（数字推理高局仍为纯数列，仅提高复杂度与区分度）。
 */
export const difficultyRuns: Array<{
  id: Difficulty;
  label: string;
  short: string;
  description: string;
}> = [
  {
    id: "easy",
    label: "低难度",
    short: "低",
    description: "选项差异大、数字简洁，掌握基本算法",
  },
  {
    id: "medium",
    label: "中难度",
    short: "中",
    description: "选项更接近、数字更复杂，需要两步换算",
  },
  {
    id: "hard",
    label: "高难度 · 实战",
    short: "高",
    description: "贴近实战：资料速算附文字/表格/图表材料，选项接近、数字复杂",
  },
];

/** 资料速算高难度局材料化的读题加时（秒/题） */
const MATERIAL_READ_SECONDS: Partial<Record<BudgetClass, number>> = {
  tool: 12,
  concept: 15,
};

/** 指定难度局的单题预算（秒）；资料速算高局自动叠加材料读题时间 */
export function perQuestionBudgetSeconds(
  topic: Pick<TrainingTopic, "budgetClass" | "track">,
  difficulty: Difficulty,
) {
  const base = BUDGET_SECONDS[topic.budgetClass][difficulty];
  if (topic.track === "speed" && difficulty === "hard") {
    return base + (MATERIAL_READ_SECONDS[topic.budgetClass] ?? 0);
  }
  return base;
}

/** 难度局总时间预算（毫秒）：10 题 × 单题预算 */
export function difficultyBudgetMs(
  topic: Pick<TrainingTopic, "budgetClass" | "track">,
  difficulty: Difficulty,
) {
  return perQuestionBudgetSeconds(topic, difficulty) * 10 * 1000;
}

function topic(
  id: TopicId,
  rating: 1 | 2 | 3,
  track: TrackId,
  material: boolean,
  budgetClass: BudgetClass,
  unlock: TopicId[],
  title: string,
  description: string,
  docId?: string,
): TrainingTopic {
  return {
    id,
    track,
    title,
    description,
    rating,
    material,
    unlock,
    ...(docId ? { docId } : {}),
    ladder: LADDERS[rating],
    budgetClass,
  };
}

/** 关卡总时间预算（毫秒）——历史阶梯口径（r1=4易3中3难、r2=2易4中4难、r3=2中8难），保留用于展示/兼容 */
export function topicBudget(t: TrainingTopic) {
  return t.ladder.reduce(
    (sum, difficulty) => sum + perQuestionBudgetSeconds(t, difficulty) * 1000,
    0,
  );
}

export const topics: TrainingTopic[] = [
  // ===== 资料速算轨道（先计算功底，再增长线/比重线，高阶综合带材料） =====
  topic("arithmetic", 1, "speed", false, "tool", [], "加减与多项求和", "多位加减、多数求和与凑整", "quick-calculation"),
  topic("multiply", 1, "speed", false, "tool", ["arithmetic"], "乘法与平方", "两位数乘法与常见平方（选项末两位一致，尾数法失效）"),
  topic("divide", 1, "speed", false, "tool", ["multiply"], "除法估算", "直除首位、除数倍数与商值范围", "direct-division"),
  topic("sensitive", 2, "speed", false, "tool", ["multiply"], "敏感数与百化分", "分数、百分数与份数关系的快速转换", "growth-basics"),
  topic("decimal", 2, "speed", false, "tool", ["arithmetic", "multiply"], "小数速算", "小数对齐、凑整与移位技巧", "quick-calculation"),
  topic("growth-rate", 1, "speed", false, "concept", ["divide"], "增长率", "由基期与现期（或增长量）求同比增速", "growth-basics"),
  topic("growth-amount", 1, "speed", false, "concept", ["growth-rate"], "增长量", "百化分求增量、现期×r÷(1+r)", "growth-amount"),
  topic("base-amount", 2, "speed", false, "concept", ["growth-rate"], "基期量", "现期÷(1+r)、现期−增量求基期", "growth-basics"),
  topic("multiples", 2, "speed", false, "concept", ["growth-rate", "divide"], "倍数与翻番", "现期÷基期、翻番与“增长多少倍”口径", "multiple"),
  topic("base-difference", 3, "speed", true, "material", ["base-amount"], "基期差", "两对象基期之差/和与现基期比较（材料实战）", "common-traps"),
  topic("interval-growth", 2, "speed", false, "concept", ["growth-rate"], "间隔增长率", "R=r₁+r₂+r₁×r₂ 与逆向求次期增速", "interval-growth"),
  topic("mixed-growth", 3, "speed", true, "material", ["interval-growth"], "混合增长率", "整体增速介于部分之间并偏向体量大的一方（材料实战）", "mixed-growth"),
  topic("annual-amount", 2, "speed", false, "concept", ["growth-amount"], "年均增长量", "间隔口径下的年均增量与总量推算", "growth-amount-advanced"),
  topic("annual-rate", 3, "speed", true, "material", ["multiples"], "年均增长率", "(1+r)ⁿ 复合增长与区间反推（材料实战）", "growth-rate-advanced"),
  topic("ratio-basic", 2, "speed", false, "concept", ["sensitive", "divide"], "比重与整体量", "占比求整体/整体求占比与百分点表述", "proportion"),
  topic("part-quantity", 2, "speed", false, "concept", ["ratio-basic"], "部分量", "整体×占比求部分，含基期口径换算", "proportion"),
  topic("average-basic", 1, "speed", false, "concept", ["divide"], "平均数基础", "平均=总量÷份数，三量互求", "average"),
  topic("base-ratio", 3, "speed", true, "material", ["part-quantity", "base-amount"], "基期比重", "现期占比×整体与部分增速比（材料实战）", "proportion"),
  topic("ratio-change", 3, "speed", true, "material", ["base-ratio"], "两期比重差", "方向判断 + 幅度上限/估算（材料实战）", "proportion-advanced"),
  topic("average-rate", 3, "speed", true, "material", ["average-basic", "growth-rate"], "平均数增长率", "(a−b)÷(1+b) 比值型增速（材料实战）", "average-advanced"),
  topic("diff-rate", 3, "speed", true, "material", ["base-difference", "part-quantity"], "差值增长率", "总量与部分增速已知，求差值（如顺差/逆差）的同比增速（材料实战）", "proportion-advanced"),
  topic("contribution-rate", 3, "speed", true, "material", ["growth-amount", "part-quantity"], "增长贡献率", "部分增量÷整体增量（材料实战）", "growth-amount-advanced"),
  topic("pull-growth", 3, "speed", true, "material", ["contribution-rate"], "拉动增长率", "部分增量÷整体基期量，与贡献率区分（材料实战）", "growth-amount-advanced"),
  // ===== 数字推理轨道 =====
  topic("seq-basic", 1, "sequence", false, "sequence", [], "基础数列", "等差/等比/质数合数", "basic-sequences"),
  topic("seq-multilevel", 1, "sequence", false, "sequence", ["seq-basic"], "多级数列", "一阶/多阶作差，差列再成规律", "multilevel-sequences"),
  topic("seq-multiple", 2, "sequence", false, "sequence", ["seq-basic"], "多重数列", "项数较多：奇偶交叉、两两分组", "multiple-sequences"),
  topic("seq-periodic", 2, "sequence", false, "sequence", ["seq-multilevel"], "周期数列", "显式循环、作差周期、隔项周期", "basic-sequences"),
  topic("seq-power", 2, "sequence", false, "sequence", ["seq-basic"], "幂次数列", "平方立方直接幂次与幂次修正", "power-sequences"),
  topic("seq-recursive", 3, "sequence", false, "sequence", ["seq-multilevel", "seq-power"], "递推数列", "和差倍积递推与递推修正", "recursive-sequences"),
  topic("seq-fraction", 3, "sequence", false, "sequence", ["seq-power"], "分数数列", "分子分母分列、通分约分与化整", "fraction-sequences"),
  topic("seq-split", 3, "sequence", false, "sequence", ["seq-periodic", "seq-power"], "机械划分", "数位拆分后各位独立成列、拼接型", "special-sequences"),
  topic("seq-factor", 3, "sequence", false, "sequence", ["seq-split"], "因数分解", "常数×质数列、相邻质数积的乘积拆分", "special-sequences"),
];

export const topicById = new Map(topics.map((t) => [t.id, t]));

export const difficulties: Array<{ id: Difficulty; label: string; description: string }> = [
  { id: "easy", label: "简单", description: "整洁数值，一步计算" },
  { id: "medium", label: "中等", description: "数值变化，两步换算" },
  { id: "hard", label: "困难", description: "更大范围，干扰项更接近" },
];

/** 历史遗留 topicId（旧版综合模块被拆分前产生的错题/统计数据展示用） */
export const legacyTopics: Array<{ id: string; title: string }> = [
  { id: "growth", title: "增长率/增长量（旧版综合）" },
  { id: "ratio", title: "比重/盐水/平均数（旧版综合）" },
  { id: "annual", title: "年平均量/年均增长率（旧版综合）" },
];

/** 训练页轨道展示元数据 */
export const tracks: Array<{ id: TrackId; title: string; description: string }> = [
  { id: "speed", title: "资料速算", description: "计算功底 → 增长 → 比重与平均数 → 实战高阶" },
  { id: "sequence", title: "数字推理", description: "按数字排列规律与难度划分的 9 类数列" },
];

export function titleOf(topicId: string): string {
  return topicById.get(topicId as TopicId)?.title ??
    legacyTopics.find((t) => t.id === topicId)?.title ??
    topicId;
}
