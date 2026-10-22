/**
 * 申论整篇批改：题目、评分规则与段落点评（纯函数）。
 * 规则评分不依赖外部模型，分数用于练习反馈，不等同于真实阅卷。
 */

export type WritingPrompt = {
  id: string;
  type: "大作文" | "应用文";
  title: string;
  material: string;
  question: string;
  requirements: string[];
  keywords: string[];
  targetWords: { min: number; max: number };
  suggestedMinutes: number;
};

export const WRITING_PROMPTS: WritingPrompt[] = [
  {
    id: "grassroots",
    type: "大作文",
    title: "把群众的小事办实",
    material:
      "某市老旧小区改造中，加装电梯、增设停车位、改造无障碍通道，看似都是“小事”，却直接关系居民每天的生活。推进过程中，有的社区先挨家挨户听意见，再请居民代表共同商定方案；也有社区只贴一张通知，遇到分歧便反复搁置。\n\n基层工作千头万绪，群众评判干部的标准往往不是口号响不响，而是家门口的路平不平、办事顺不顺。把小事办实，既需要耐心细致的工作方法，也需要把群众满意作为检验标准。",
    question:
      "请结合给定材料，以“把群众的小事办实”为主题，自选角度，自拟标题，写一篇议论文。",
    requirements: [
      "观点明确，立意深刻，紧扣主题",
      "结合材料但不照抄材料，联系实际展开论证",
      "结构完整，层次清晰，语言规范",
      "1000—1200 字",
    ],
    keywords: ["基层", "群众", "小事", "治理", "落实", "服务", "满意"],
    targetWords: { min: 1000, max: 1200 },
    suggestedMinutes: 50,
  },
  {
    id: "digital",
    type: "大作文",
    title: "数字政府的效率与温度",
    material:
      "某地推出“一网通办”后，企业开办时间从几个工作日压缩到半天。与此同时，一些老年人面对手机预约、扫码认证仍感到手足无措；部分窗口在推广线上办理时，线下人工服务一度减少。后来，当地保留并优化了线下帮办窗口，还组织志愿者进社区教老人使用政务应用，让“数据跑路”与“人工兜底”并行。\n\n数字化不是简单地把窗口搬到网上。技术可以提高效率，但公共服务的价值最终体现在每一个人能否方便地获得帮助。",
    question:
      "请围绕“数字政府建设既要效率也要温度”，结合材料，自拟标题，写一篇议论文。",
    requirements: [
      "观点明确，紧扣“效率与温度”的关系展开",
      "结合材料中的具体做法，联系实际论证",
      "结构完整，层次清晰，语言规范",
      "1000—1200 字",
    ],
    keywords: ["数字", "政务", "效率", "温度", "老年人", "服务", "数据"],
    targetWords: { min: 1000, max: 1200 },
    suggestedMinutes: 50,
  },
  {
    id: "business",
    type: "大作文",
    title: "营商环境也是竞争力",
    material:
      "某地招商时承诺“无事不扰、有求必应”，却在企业落地后频繁迎来多头检查；另一地则把分散在多个部门的审批事项合并办理，并建立企业诉求清单，逐项明确责任人和办结时限。两年后，前者新增企业数量下降，后者吸引了一批配套企业集聚。\n\n营商环境不是一句口号，而是由一次次审批、一次次执法、一次次回应构成的真实体验。稳定、公平、可预期的环境，才是企业敢投资、愿长期经营的基础。",
    question:
      "请以“优化营商环境就是提升竞争力”为主题，结合材料，自拟标题，写一篇议论文。",
    requirements: [
      "观点明确，能够揭示营商环境与竞争力的关系",
      "结合材料中的正反案例展开分析",
      "结构完整，层次清晰，语言规范",
      "1000—1200 字",
    ],
    keywords: ["营商", "企业", "市场", "法治", "服务", "监管", "预期"],
    targetWords: { min: 1000, max: 1200 },
    suggestedMinutes: 50,
  },
  {
    id: "ecology",
    type: "大作文",
    title: "在发展中保护，在保护中发展",
    material:
      "某河流域过去因粗放开发导致水质下降，沿河群众增收与生态保护矛盾突出。近年来，当地关停污染企业，修复湿地，同时发展生态农业和乡村旅游，村民通过合作社参与经营，收入不降反升。\n\n保护生态不等于放弃发展，关键在于找到二者相互促进的路径。既不能以牺牲环境换取短期增长，也不能脱离发展实际谈保护。",
    question:
      "请围绕“在发展中保护、在保护中发展”，结合材料，自拟标题，写一篇议论文。",
    requirements: [
      "观点明确，辩证分析发展与保护的关系",
      "结合材料中的治理路径，联系实际论证",
      "结构完整，层次清晰，语言规范",
      "1000—1200 字",
    ],
    keywords: ["生态", "绿色", "发展", "保护", "治理", "协同", "长效"],
    targetWords: { min: 1000, max: 1200 },
    suggestedMinutes: 50,
  },
];

export const writingPromptById = new Map(
  WRITING_PROMPTS.map((prompt) => [prompt.id, prompt]),
);

export type WritingDimension = {
  id: string;
  label: string;
  score: number;
  max: number;
  comment: string;
};

export type WritingParagraph = {
  index: number;
  text: string;
  chars: number;
  verdict: "good" | "warn";
  feedback: string;
};

export type WritingGrade = {
  score: number;
  grade: string;
  wordCount: number;
  dimensions: WritingDimension[];
  paragraphs: WritingParagraph[];
  matchedKeywords: string[];
  missingKeywords: string[];
  issues: string[];
  suggestions: string[];
  summary: string;
};

const THESIS_MARKERS = [
  "本文认为",
  "笔者认为",
  "关键在于",
  "核心在于",
  "必须",
  "应当",
  "需要",
  "只有",
  "归根结底",
];
const CONCLUSION_MARKERS = ["因此", "总之", "综上", "可见", "唯有", "总而言之"];
const TRANSITIONS = [
  "首先",
  "其次",
  "再次",
  "此外",
  "同时",
  "然而",
  "但是",
  "因此",
  "所以",
  "一方面",
  "另一方面",
  "不仅",
  "而且",
];
const ANALYSIS_MARKERS = [
  "因为",
  "原因",
  "根源",
  "本质",
  "意味着",
  "说明",
  "折射",
  "背后",
];
const MEASURE_MARKERS = [
  "应当",
  "需要",
  "建议",
  "完善",
  "加强",
  "推动",
  "建立",
  "健全",
  "优化",
  "落实",
];
const EXAMPLE_MARKERS = ["例如", "比如", "以.*为例", "数据显示", "材料中", "某地", "某市", "实践中"];
const MATERIAL_MARKERS = ["材料", "给定资料", "某地", "某市", "案例", "实践中"];
const INFORMAL_WORDS = ["我觉得", "超级", "特别特别", "然后然后", "东西", "搞定", "啥"];

const countChars = (text: string) =>
  (text.match(/[\u4e00-\u9fa5]|[a-zA-Z0-9]/g) ?? []).length;

const includesAny = (text: string, words: readonly string[]) =>
  words.some((word) => text.includes(word));

const countAny = (text: string, words: readonly string[]) =>
  words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);

function gradeLabel(score: number) {
  if (score >= 85) return "一类文";
  if (score >= 70) return "二类文";
  if (score >= 55) return "三类文";
  return "四类文";
}

export function gradeWriting(
  prompt: WritingPrompt,
  title: string,
  content: string,
): WritingGrade {
  const cleanTitle = title.trim();
  const paragraphs = content
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((text) => text.trim())
    .filter(Boolean);
  // 有的用户会在正文第一行再写一遍标题，判分时按标题处理，不计入段落与正文字数
  if (paragraphs[0] === cleanTitle) paragraphs.shift();
  const first = paragraphs[0] ?? "";
  const last = paragraphs.at(-1) ?? "";
  const bodyText = paragraphs.join("\n");
  const wordCount = countChars(bodyText);
  const matchedKeywords = prompt.keywords.filter((word) => bodyText.includes(word));
  const missingKeywords = prompt.keywords.filter((word) => !bodyText.includes(word));
  const transitionCount = countAny(bodyText, TRANSITIONS);
  const analysisCount = countAny(bodyText, ANALYSIS_MARKERS);
  const measureCount = countAny(bodyText, MEASURE_MARKERS);
  const materialHit = includesAny(bodyText, MATERIAL_MARKERS);
  const exampleHit = EXAMPLE_MARKERS.some((pattern) =>
    new RegExp(pattern).test(bodyText),
  );
  const thesisHit = includesAny(first, THESIS_MARKERS);
  const conclusionHit = includesAny(last, CONCLUSION_MARKERS);
  const informalHit = INFORMAL_WORDS.filter((word) => bodyText.includes(word));
  const coverage = prompt.keywords.length
    ? matchedKeywords.length / prompt.keywords.length
    : 0;

  // 立意与观点（25）
  let idea = 0;
  if (cleanTitle) idea += 4;
  if (cleanTitle.length >= 4 && cleanTitle.length <= 30) idea += 3;
  if (prompt.keywords.some((word) => cleanTitle.includes(word))) idea += 4;
  if (thesisHit) idea += 5;
  if (matchedKeywords.length >= 2) idea += 4;
  if (first.length >= 60 && first.length <= 260) idea += 5;
  idea = Math.min(25, idea);

  // 结构（25）
  let structure = 0;
  if (paragraphs.length >= 5) structure += 10;
  else if (paragraphs.length === 4) structure += 7;
  else if (paragraphs.length === 3) structure += 4;
  else if (paragraphs.length === 2) structure += 2;
  if (conclusionHit) structure += 5;
  if (transitionCount >= 4) structure += 5;
  else if (transitionCount >= 2) structure += 3;
  if (paragraphs.length >= 2 && first !== last) structure += 5;
  structure = Math.min(25, structure);

  // 论证（25）
  let argument = 0;
  if (materialHit) argument += 5;
  if (analysisCount >= 2) argument += 5;
  else if (analysisCount >= 1) argument += 3;
  if (measureCount >= 3) argument += 5;
  else if (measureCount >= 1) argument += 3;
  if (exampleHit) argument += 4;
  if (coverage >= 0.7) argument += 6;
  else if (coverage >= 0.4) argument += 4;
  else if (coverage >= 0.2) argument += 2;
  argument = Math.min(25, argument);

  // 语言与规范（25）
  let language = 0;
  const minWords = prompt.targetWords.min;
  const maxWords = prompt.targetWords.max;
  if (wordCount >= minWords && wordCount <= maxWords) language += 8;
  else if (wordCount >= minWords * 0.85 && wordCount <= maxWords * 1.15)
    language += 6;
  else if (wordCount >= minWords * 0.7 && wordCount <= maxWords * 1.3)
    language += 3;
  else language += 1;
  const average = paragraphs.length ? wordCount / paragraphs.length : 0;
  if (paragraphs.length >= 2 && average >= 80 && average <= 280) language += 5;
  else language += 2;
  if (informalHit.length === 0) language += 4;
  else if (informalHit.length <= 2) language += 2;
  if ((bodyText.match(/[。！？；：]/g) ?? []).length >= 8) language += 4;
  else language += 2;
  const starts = paragraphs.map((text) => text[0]).filter(Boolean);
  if (new Set(starts).size >= Math.ceil(starts.length * 0.6)) language += 4;
  else language += 2;
  language = Math.min(25, language);

  const dimensions: WritingDimension[] = [
    {
      id: "idea",
      label: "立意与观点",
      score: idea,
      max: 25,
      comment:
        idea >= 20
          ? "中心论点明确，标题与主题呼应较好。"
          : idea >= 14
            ? "有中心论点，但标题或开头还可以更直接地回应主题。"
            : "立意偏弱，建议在标题和开头明确亮出观点。",
    },
    {
      id: "structure",
      label: "结构层次",
      score: structure,
      max: 25,
      comment:
        structure >= 20
          ? "段落完整，起承转合清楚。"
          : structure >= 14
            ? "结构基本完整，分论点之间的衔接还可以更紧。"
            : "结构松散，建议按“开头—分论点—结尾”重新搭骨架。",
    },
    {
      id: "argument",
      label: "论证质量",
      score: argument,
      max: 25,
      comment:
        argument >= 20
          ? "能够结合材料分析，并给出较具体的对策。"
          : argument >= 14
            ? "有分析和对策，但材料细节与论证层次不足。"
            : "论证偏空，建议补充材料细节、原因分析和对策。",
    },
    {
      id: "language",
      label: "语言与规范",
      score: language,
      max: 25,
      comment:
        language >= 20
          ? "语言规范，篇幅与段落节奏合适。"
          : language >= 14
            ? "表达基本规范，注意篇幅和段落长度。"
            : "语言或篇幅问题较明显，建议先保证完整、规范。",
    },
  ];

  const score = dimensions.reduce((sum, item) => sum + item.score, 0);
  const grade = gradeLabel(score);
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (!cleanTitle) issues.push("缺少标题，申论大作文会直接失分。");
  if (wordCount < minWords)
    issues.push(`当前约 ${wordCount} 字，低于题目要求的 ${minWords} 字。`);
  if (wordCount > maxWords + 200)
    issues.push(`当前约 ${wordCount} 字，篇幅明显超出要求。`);
  if (paragraphs.length < 5)
    issues.push(`全文只有 ${paragraphs.length} 段，建议至少写出 5 段。`);
  if (!thesisHit) issues.push("开头没有明显亮出中心论点。");
  if (!conclusionHit) issues.push("结尾缺少总结收束，文章容易显得没有写完。");
  if (missingKeywords.length >= 3)
    issues.push(`材料关键词覆盖不足：${missingKeywords.slice(0, 4).join("、")}。`);
  if (!materialHit) issues.push("论证中没有回扣给定材料，容易变成脱离材料的泛泛而谈。");
  if (informalHit.length) issues.push(`出现口语化表达：${informalHit.join("、")}。`);

  if (paragraphs.length < 5)
    suggestions.push("先搭五段式骨架：开头亮观点，中间三个分论点，结尾总结升华。");
  if (!thesisHit)
    suggestions.push("开头最后一句用“本文认为/关键在于/必须”等句式明确中心论点。");
  if (!materialHit)
    suggestions.push("每个分论点后补一个材料中的具体做法，再分析其效果。");
  if (measureCount < 3)
    suggestions.push("对策段多使用“完善、健全、加强、推动”等规范动词，落到可执行动作。");
  if (coverage < 0.5)
    suggestions.push(`有意识回扣主题词：${missingKeywords.slice(0, 4).join("、")}。`);
  if (wordCount < minWords)
    suggestions.push(`再补充约 ${minWords - wordCount} 字，优先扩充分论点的分析和例子。`);
  if (!suggestions.length)
    suggestions.push("整体完成度较好，下一步可以压缩套话，让每个分论点的论据更具体。");

  const paragraphFeedback: WritingParagraph[] = paragraphs.slice(0, 12).map((text, index) => {
    const chars = countChars(text);
    const isFirst = index === 0;
    const isLast = index === paragraphs.length - 1;
    let feedback = "段落中心较清楚，论证节奏正常。";
    let verdict: "good" | "warn" = "good";
    if (chars < 60) {
      feedback = `这一段只有 ${chars} 字，观点还没展开。建议补充原因分析或具体做法。`;
      verdict = "warn";
    } else if (chars > 320) {
      feedback = `这一段约 ${chars} 字，篇幅偏长。建议按“观点—分析—例子—小结”拆成两段。`;
      verdict = "warn";
    } else if (isFirst && !thesisHit) {
      feedback = "开头还没有亮明中心论点，建议在段末补一句明确的判断句。";
      verdict = "warn";
    } else if (isLast && !conclusionHit) {
      feedback = "结尾缺少“因此/综上/唯有”等收束信号，建议补一句总结或升华。";
      verdict = "warn";
    } else if (!prompt.keywords.some((word) => text.includes(word))) {
      feedback = "这一段与主题关键词关联较弱，建议在段首或段末回扣题目。";
      verdict = "warn";
    } else if (!isFirst && !isLast && !includesAny(text, ANALYSIS_MARKERS) && !exampleHit) {
      feedback = "本段以陈述为主，可以补一句“之所以……是因为……”或材料中的细节。";
      verdict = "warn";
    }
    return { index: index + 1, text, chars, verdict, feedback };
  });

  const strongest = [...dimensions].sort((a, b) => b.score - a.score)[0];
  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
  const summary = `本文评为${grade}，规则评分 ${score} 分。${strongest.label}表现相对较好，${weakest.label}是最需要优先补强的部分。`;

  return {
    score,
    grade,
    wordCount,
    dimensions,
    paragraphs: paragraphFeedback,
    matchedKeywords,
    missingKeywords,
    issues,
    suggestions,
    summary,
  };
}
