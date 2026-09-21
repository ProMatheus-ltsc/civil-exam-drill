/**
 * 把《申论 21 天深度操作指南》的 21 天，导入成知识库里的 21 篇延伸讲解（essay-dayNN）。
 *
 * 用法：node scripts/import-essay-guide.mjs [指南路径]
 *   （默认读桌面那份；指南更新后重跑即可，输出是幂等的）
 *
 *
 * 为什么用脚本而不是手抄：指南是「以内容为主」的单一事实源，逐字搬运能保证不漏内容、
 * 也不掺入我自己的改写误差；脚本负责结构规范化（层级、称谓、间距、关联阅读），
 * 我只需要维护下面这张「深入阅读」映射表。
 *
 * 输出：content/knowledge/essay/essay-dayNN.md（id = 关卡 id，一一对应）
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const GUIDE = process.argv[2] ?? "C:/Users/liyunfei/Desktop/申论21天深度操作指南 (1).md";
const OUT_DIR = resolve(process.cwd(), "content/knowledge/essay");
const UPDATED_AT = "2026-09-21";

/** 每天的补充阅读（现有知识库里指南没有覆盖、或讲得更细的部分） */
const FURTHER_READING = {
  1: [["申论试卷与作答格式", "三类职位分别考哪几项能力、2024 年真题卷面样例"]],
  2: [],
  3: [["申论试卷与作答格式", "答题卡与作答格式的 12 条硬要求"]],
  4: [],
  5: [["材料阅读与要点标记", "主体/处境/做法/结果四要素提取法与两套真题演示"]],
  6: [
    ["申论试卷与作答格式", "题型分布表与真题卷面的作答要求写法"],
    ["归纳概括", "五种概括对象的题型分类与范例"],
  ],
  7: [["归纳概括", "除段旨提取外，概括原因/影响/变化各自怎么答"]],
  8: [["归纳概括", "概括原因题的题型分类与随笔练习"]],
  9: [
    ["申论规范词", "分领域规范词对照总表"],
    ["申论规范词", "考前一天过一遍规范表达（另有九类卡片在「规范词卡片」页）"],
  ],
  10: [["综合分析", "启示/评论/阐释/比较四型的分型答法与易错点"]],
  11: [["提出对策", "对策找取、答案表述与常见对策积累"]],
  12: [["贯彻执行与应用文", "17 类文种的逐种写法与范例"]],
  13: [["申论文章写作", "评分标准参考与三种布局思路"]],
  14: [["申论文章写作", "分论点设置的三种角度与有效论证方法"]],
  15: [["申论文章写作", "标题、开头、结尾的成文样例"]],
  16: [
    ["申论文章写作", "成文质量检查清单"],
    ["名言积累", "论证可用的名言素材"],
    ["人物素材", "论证可用的人物事例"],
  ],
  17: [["申论文章写作", "论证段的分析方法与关系型结构"]],
  18: [["贯彻执行与应用文", "八类法定公文的格式细则与范文"]],
  19: [["贯彻执行与应用文", "九类事务文书的写法与范例"]],
  20: [
    ["归纳概括", "要点遗漏、照搬原文的改进方法"],
    ["提出对策", "对策空洞、缺针对性的改进方法"],
    ["贯彻执行与应用文", "公文类易错点清单"],
  ],
  21: [
    ["名言积累", "政策话语与名言素材"],
    ["人物素材", "人物事例素材"],

  ],
};

const text = readFileSync(GUIDE, "utf8").split(/\r?\n/).join("\n");
const pieces = text.split(/^##\s+Day\s+/m).slice(1);
if (pieces.length !== 21) throw new Error(`指南里应有 21 天，实际 ${pieces.length}`);

/** 把指南里的「（30分钟）」统一成「（30 分钟）」 */
const spacedMinutes = (line) => line.replace(/（(\d+)分钟）/g, "（$1 分钟）");
/** 标题里的直角引号统一成「」 */
const tidyQuotes = (line) => line.replace(/"([^"]{1,20})"/g, "「$1」");

/** 取某个小节（一/二/三/四）的正文 */
function sectionBody(piece, ordinal) {
  const pattern = new RegExp(
    `^###\\s*${ordinal}、[^\\n]*\\n([\\s\\S]*?)(?=^###\\s*[一二三四]、|$(?![\\s\\S]))`,
    "m",
  );
  const match = piece.match(pattern);
  if (!match) throw new Error(`找不到「${ordinal}」小节`);
  return match[1].replace(/\n*---\s*$/, "").trim();
}

/** 独立成行的加粗行升级成三级标题；顺带规范分钟写法 */
function normalizeBody(body, headingStyle) {
  return body
    .split("\n")
    .map((line) => {
      const bold = line.match(/^\*\*(.+?)\*\*\s*$/);
      if (bold) {
        let inner = tidyQuotes(bold[1].trim());
        if (headingStyle === "task") inner = spacedMinutes(inner);
        return `### ${inner}`;
      }
      return spacedMinutes(tidyQuotes(line));
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const written = [];
for (const piece of pieces) {
  const head = piece.match(/^(\d+)：(.+)$/m);
  const day = Number(head[1]);
  const padded = String(day).padStart(2, "0");
  const title = `Day ${day} · ${tidyQuotes(head[2].trim())}`;

  const goal = sectionBody(piece, "一").split("\n")[0].trim();
  // 摘要在列表里展示，取目标的第一句（整段目标是给正文里的「今日目标」用的）
  const summary = goal.split(/(?<=[。；])/)[0].trim().slice(0, 200) || goal.slice(0, 200);
  const points = normalizeBody(sectionBody(piece, "二"), "point");
  const tasks = normalizeBody(sectionBody(piece, "三"), "task");
  const homework = sectionBody(piece, "四")
    .split("\n")
    .map((line) => spacedMinutes(tidyQuotes(line)))
    .join("\n")
    .trim();

  const reading = FURTHER_READING[day] ?? [];
  const readingBlock = reading.length
    ? [
        "",
        "## 深入阅读",
        "",
        reading.length > 1
          ? "需要更细的展开时，翻知识库里这几篇（本篇没写的部分）："
          : "需要更细的展开时，翻知识库里这一篇（本篇没写的部分）：",
        "",
        ...reading.map(([name, why]) => `- 《${name}》：${why}`),
      ].join("\n")
    : "";

  const body = [
    `# ${title}`,
    "",
    `> **今日目标**：${goal}`,
    ">",
    "> **本关通关要求**：客观题答对 ≥4 题（共 5 题），且客观题与自评清单的加权总分 ≥80%。做完下面的实操任务、对照清单逐条自评后再交卷。",
    "",
    "## 核心知识点",
    "",
    points,
    "",
    "## 今日实操任务",
    "",
    tasks,
    "",
    "## 课后作业",
    "",
    homework,
    readingBlock,
    "",
  ].join("\n");

  const front = [
    "---",
    `id: essay-day${padded}`,
    "module: essay",
    "category: training",
    `title: ${JSON.stringify(title)}`,
    `summary: ${JSON.stringify(summary)}`,
    `order: ${day}`,
    `updatedAt: ${UPDATED_AT}`,
    "---",
    "",
  ].join("\n");

  mkdirSync(OUT_DIR, { recursive: true });
  const file = `${OUT_DIR}/essay-day${padded}.md`;
  writeFileSync(file, front + body);
  written.push({
    day,
    title,
    chars: body.replace(/\s/g, "").length,
    sections: (body.match(/^##\s+/gm) ?? []).length,
    subs: (body.match(/^###\s+/gm) ?? []).length,
  });
}

console.log(`已生成 ${written.length} 篇讲解：`);
for (const item of written) {
  console.log(
    `  essay-day${String(item.day).padStart(2, "0")} | ${String(item.chars).padStart(5)}字 | ${item.sections} 大节 / ${item.subs} 小节 | ${item.title}`,
  );
}
console.log("合计", written.reduce((sum, item) => sum + item.chars, 0), "字（去空白）");
