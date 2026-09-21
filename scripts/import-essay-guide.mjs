/**
 * 把《申论 21 天深度操作指南》的 21 天，导入成知识库里的 21 篇延伸讲解（essay-dayNN）。
 *
 * 用法：node scripts/import-essay-guide.mjs [指南路径]
 *   （默认读桌面那份；指南或整合映射改了之后重跑即可，输出幂等）
 *
 * 三件事：
 *   1. 指南 → 正文主干：逐字搬运当天的「学习目标 / 核心知识点 / 实操任务 / 课后作业」，
 *      只做结构规范化（`**1. xx**` 升成 `###`、分钟写法、引号、层级），保证不漏内容、不掺改写误差；
 *   2. 知识库既有专文 → 按节整合：老文档与指南的逐字重复率只有 0~1%，属于「很有差异」的内容，
 *      所以按主题整节搬家（不重写、不摘编），只丢掉重复的开篇语、推广语与图片占位；
 *   3. 按阶段分组：category = `training-<阶段 id>`，由 src/essay/training.ts 的 ESSAY_STAGES 派生，
 *      申论知识页因此会按六个阶段分开显示（守卫见 tests/essay-training.test.ts）。
 *
 * 输出：content/knowledge/essay/essay-dayNN.md（id = 关卡 id，一一对应）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const GUIDE = process.argv[2] ?? "C:/Users/liyunfei/Desktop/申论21天深度操作指南 (1).md";
const OUT_DIR = resolve(process.cwd(), "content/knowledge/essay");
const UPDATED_AT = "2026-09-21";

const { ESSAY_STAGES } = await import(new URL("../src/essay/training.ts", import.meta.url).href);

/**
 * 从老文档整合进各关的节（按标题片段匹配，取整节子树，按源文档顺序拼回）。
 * 只列「这一关该有、而指南没写」的内容；重复的开篇语与推广语由 DROP / STOP_AT 去掉。
 */
const INTEGRATIONS = {
  "essay-day01": [{ from: "overview", take: ["一、试卷结构", "二、题型分布", "三类职位分别考什么能力"] }],
  "essay-day03": [{ from: "overview", take: ["答题卡与作答格式的 12 条硬要求"] }],
  "essay-day05": [
    { from: "material-reading", take: ["底层逻辑之核心要素", "二、阅读技巧", "三、真题演示", "三遍处理法"] },
  ],
  "essay-day06": [{ from: "material-reading", take: ["合并与规范化原则"] }],
  "essay-day07": [
    {
      from: "summarization",
      take: ["概括问题", "概括对策", "概括影响", "概括变化", "其他", "二、随笔练习", "作答小结"],
    },
  ],
  "essay-day08": [{ from: "summarization", take: ["概括原因"] }],
  "essay-day09": [{ from: "normative-words", take: ["申论规范词 方法论"] }],
  "essay-day10": [{ from: "comprehensive-analysis", take: ["一、题型概述", "二、解题技巧", "易错点"] }],
  "essay-day11": [
    {
      from: "proposals",
      take: [
        "一、对策找取",
        "二、答案表述",
        "三、对策的针对性",
        "四、对策的可行性",
        "五、重视审题",
        "六、积累常见对策",
        "七、随笔练习",
        "表达自查",
      ],
    },
  ],
  "essay-day12": [{ from: "official-writing", take: ["14、提纲", "二、总结", "易错点"] }],
  "essay-day13": [{ from: "article-writing", take: ["一、评分标准参考"] }],
  "essay-day14": [{ from: "article-writing", take: ["五、文章分论点的论证"] }],
  "essay-day15": [
    { from: "article-writing", take: ["二、文章的布局", "三、标题", "四、文章的开头", "六、文章结尾"] },
  ],
  "essay-day16": [{ from: "article-writing", take: ["成文质量检查"] }],
  "essay-day18": [{ from: "official-writing", take: ["1、通知", "2、通告"] }],
  "essay-day19": [
    {
      from: "official-writing",
      take: [
        "3、报道",
        "4、建议书",
        "5、工作建议",
        "6、倡议书",
        "7、宣传稿",
        "8、讲话稿",
        "9、简报",
        "10、短评",
        "11、公开信",
        "12、编者按",
        "13、导言",
        "15、调研报告",
        "16、推荐材料",
        "17、摘要",
      ],
    },
  ],
};

/** 丢掉的行（推广语、字数统计、图片占位、空标题） */
const DROP = [/关注公众号/, /^\s*【图片】\s*$/, /^\s*字数:.*时长:/, /^\s*[🏛⚖🧠🌾📈💼⚙🇨🇳♻🤖📖👀️]+\s*$/];
/** 从这里开始的内容整段丢弃（规范词那篇末尾的九类卡片统计，卡片本身在「规范词卡片」页） */
const STOP_AT = [/^\s*(行政执法|思想认识|城乡发展|经济生活|政府管理|社会民生|文化自信|生态环境|科技创新)类\s*$/];

/** 保留的素材库文档（它们与指南没有重合，独立成篇） */
const FURTHER_READING = {
  9: [["规范词卡片", "按行政执法、思想认识、城乡发展等九类整理的规范词对照表（见「规范词卡片」页）"]],
  13: [["作文写作模板", "按主题分类的标题与开头范式"]],
  14: [
    ["名言积累", "道理/引用论证可用的名言素材"],
    ["人物素材", "举例论证可用的人物事例"],
  ],
  15: [["作文写作模板", "标题篇、开头篇的成文范式"]],
  16: [
    ["名言积累", "论证可用的名言素材"],
    ["人物素材", "论证可用的人物事例"],
    ["作文写作模板", "可对照的成文范式"],
  ],
  17: [["作文写作模板", "标题与开头的范式，便于对照打磨"]],
  21: [
    ["名言积累", "政策话语与名言素材"],
    ["人物素材", "人物事例素材"],
    ["规范词卡片", "考前一天再过一遍规范表达（见「规范词卡片」页）"],
  ],
};

const spacedMinutes = (line) => line.replace(/（(\d+)分钟）/g, "（$1 分钟）");
const tidyQuotes = (line) => line.replace(/"([^"]{1,20})"/g, "「$1」");

/* ---------- 指南解析 ---------- */

const text = readFileSync(GUIDE, "utf8").split(/\r?\n/).join("\n");
const pieces = text.split(/^##\s+Day\s+/m).slice(1);
if (pieces.length !== 21) throw new Error(`指南里应有 21 天，实际 ${pieces.length}`);

function sectionBody(piece, ordinal) {
  const pattern = new RegExp(
    `^###\\s*${ordinal}、[^\\n]*\\n([\\s\\S]*?)(?=^###\\s*[一二三四]、|$(?![\\s\\S]))`,
    "m",
  );
  const match = piece.match(pattern);
  if (!match) throw new Error(`找不到「${ordinal}」小节`);
  return match[1].replace(/\n*---\s*$/, "").trim();
}

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

/* ---------- 老文档解析与整节提取 ---------- */

/** 把一篇文档切成「节」：每个标题带上它的整棵子树（直到同级或更高级标题） */
function splitBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const heads = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(#{2,4})\s+(.*)$/);
    if (match) heads.push({ level: match[1].length, text: match[2].trim(), index });
  });
  return heads.map((head, order) => {
    let end = lines.length;
    for (let next = order + 1; next < heads.length; next += 1) {
      if (heads[next].level <= head.level) {
        end = heads[next].index;
        break;
      }
    }
    return { level: head.level, text: head.text, lines: lines.slice(head.index, end) };
  });
}

function cleanLines(lines, drop, stopAt) {
  const result = [];
  for (const line of lines) {
    if (stopAt.some((pattern) => pattern.test(line))) break;
    if (drop.some((pattern) => pattern.test(line))) continue;
    result.push(line);
  }
  // 去掉尾部空行
  while (result.length && !result[result.length - 1].trim()) result.pop();
  return result;
}

const docCache = new Map();
function loadDoc(docId) {
  if (!docCache.has(docId)) {
    const file = `${OUT_DIR}/${docId}.md`;
    if (!existsSync(file)) throw new Error(`老文档不存在：${docId}`);
    docCache.set(docId, readFileSync(file, "utf8").replace(/^---[\s\S]*?---\n/, ""));
  }
  return docCache.get(docId);
}

/** 取一篇文档里的若干节（按标题片段匹配），按源文档顺序返回原始行 */
function takeSections(docId, requests) {
  const blocks = splitBlocks(loadDoc(docId));
  const picked = [];
  for (const request of requests) {
    const block = blocks.find((item) => item.text.includes(request));
    if (!block) throw new Error(`${docId} 里找不到「${request}」`);
    if (!picked.includes(block)) picked.push(block);
  }
  picked.sort((a, b) => blocks.indexOf(a) - blocks.indexOf(b));
  const out = [];
  for (const block of picked) {
    // 选中的是孤儿 h3（父 h2 没被选）→ 升成 h2，避免挂到上一篇的小节下面
    const parentSelected = picked.some(
      (item) => item.level < block.level && item.lines[0] && blocks.indexOf(item) < blocks.indexOf(block),
    );
    const raw = block.lines[0];
    if (block.level === 3 && !parentSelected) {
      const heading = block.text.replace(/^\d+、/, "");
      out.push(`## ${heading}`, ...block.lines.slice(1));
    } else {
      out.push(raw, ...block.lines.slice(1));
    }
  }
  return cleanLines(out, DROP, STOP_AT);
}

/* ---------- 生成 ---------- */

const written = [];
for (const piece of pieces) {
  const head = piece.match(/^(\d+)：(.+)$/m);
  const day = Number(head[1]);
  const padded = String(day).padStart(2, "0");
  const levelId = `essay-day${padded}`;
  const title = `Day ${day} · ${tidyQuotes(head[2].trim())}`;

  const goal = sectionBody(piece, "一").split("\n")[0].trim();
  const summary = goal.split(/(?<=[。；])/)[0].trim().slice(0, 200) || goal.slice(0, 200);
  const points = normalizeBody(sectionBody(piece, "二"), "point");
  const tasks = normalizeBody(sectionBody(piece, "三"), "task");
  const homework = sectionBody(piece, "四")
    .split("\n")
    .map((line) => spacedMinutes(tidyQuotes(line)))
    .join("\n")
    .trim();

  // 知识库整合进来的节
  const integrated = (INTEGRATIONS[levelId] ?? []).flatMap(({ from, take }) => [
    `> 以下内容整合自知识库既有专文，是这一关在指南之外的补充。`,
    "",
    ...takeSections(from, take),
    "",
  ]);

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

  const stage = ESSAY_STAGES.find((item) => day >= item.from && day <= item.to);
  if (!stage) throw new Error(`Day ${day} 没有落在任何阶段里`);

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
    ...(integrated.length ? ["", ...integrated] : []),
    readingBlock,
    "",
  ].join("\n");

  const front = [
    "---",
    `id: ${levelId}`,
    "module: essay",
    `category: training-${stage.id}`,
    `title: ${JSON.stringify(title)}`,
    `summary: ${JSON.stringify(summary)}`,
    `order: ${day}`,
    `updatedAt: ${UPDATED_AT}`,
    "---",
    "",
  ].join("\n");

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/${levelId}.md`, front + body);
  written.push({
    levelId,
    stage: stage.title,
    title,
    chars: body.replace(/\s/g, "").length,
    extra: integrated.length ? takeSectionsSources(levelId) : "",
  });
}

function takeSectionsSources(levelId) {
  return (INTEGRATIONS[levelId] ?? []).map((item) => item.from).join("+");
}

const total = written.reduce((sum, item) => sum + item.chars, 0);
for (const item of written) {
  console.log(
    `${item.levelId} | ${String(item.chars).padStart(5)}字 | ${item.stage.padEnd(6)} | ${item.extra || "（仅指南）"}`,
  );
}
console.log(`共 ${written.length} 篇，合计 ${total} 字（去空白）`);
