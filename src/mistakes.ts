export const MISTAKE_CAUSES = [
  { id: "misread", label: "审题偏差", hint: "看错问法或单位" },
  { id: "formula", label: "公式记错", hint: "列式或公式选错" },
  { id: "calculation", label: "计算失误", hint: "会做但算错" },
  { id: "locate", label: "资料定位错误", hint: "找错数据或时间口径" },
  { id: "concept", label: "概念不清", hint: "定义、口径没掌握" },
  { id: "time", label: "时间不够", hint: "会做但来不及" },
] as const;

export type MistakeCauseId = (typeof MISTAKE_CAUSES)[number]["id"];

export const MISTAKE_CAUSE_IDS = MISTAKE_CAUSES.map(
  (cause) => cause.id,
) as [MistakeCauseId, ...MistakeCauseId[]];

export function mistakeCauseLabel(id: string | null | undefined) {
  return MISTAKE_CAUSES.find((cause) => cause.id === id)?.label ?? "";
}
