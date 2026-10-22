import { describe, expect, it } from "vitest";
import {
  WRITING_PROMPTS,
  gradeWriting,
  writingPromptById,
} from "../src/essay/writing";

const prompt = writingPromptById.get("grassroots")!;

const goodEssay = `本文认为，把群众的小事办实，关键在于站稳群众立场，把每一件具体事落到可执行的行动上，用群众的获得感检验治理成效。

把小事办实，首先要听懂群众的真实诉求。材料中，有的社区在加装电梯前挨家挨户听意见，再请居民代表共同商定方案，原本分歧很大的事情逐渐形成共识。这说明，很多所谓的“小事”并不小，背后连着不同群体的利益。只有把意见听全、把情况摸透，服务才能真正对得上群众的需要。

把小事办实，需要建立闭环落实机制。群众反映的问题，如果只是记在本子上、挂在墙上，时间一长就会消耗信任。应当建立清单化管理机制，明确责任人、办理时限和反馈方式，做到件件有着落、事事有回音。

把小事办实，还要用好群众评价这把尺子。服务好不好，不能只看材料写得多漂亮，而要看群众办事是否更方便、生活是否更舒心。可以通过回访、议事会和满意度调查等方式，把群众意见纳入考核。

与此同时，要把小事办实，也必须尊重规律、量力而行。民生诉求多种多样，资源却是有限的。既要尽力而为，也要实事求是，分清轻重缓急，先把最急最盼的事项办好，再逐步补齐短板。

总之，群众的“小事”，就是治理的“大事”。唯有把群众满意作为出发点和落脚点，把听意见、抓落实、问效果贯通起来，才能把一件件小事办到群众心坎上。`;

describe("申论整篇批改规则", () => {
  it("按四个维度给出 0—100 分与逐段点评", () => {
    const result = gradeWriting(prompt, "把小事办实 把民心暖热", goodEssay);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.dimensions).toHaveLength(4);
    expect(result.dimensions.map((item) => item.id)).toEqual([
      "idea",
      "structure",
      "argument",
      "language",
    ]);
    expect(result.paragraphs).toHaveLength(6);
    expect(result.paragraphs[0].feedback.length).toBeGreaterThan(0);
    expect(result.summary).toContain(result.grade);
  });

  it("正文重复标题时不计入段落，也不误判开头", () => {
    const withTitle = `把小事办实 把民心暖热\n\n${goodEssay}`;
    const result = gradeWriting(
      prompt,
      "把小事办实 把民心暖热",
      withTitle,
    );
    expect(result.paragraphs).toHaveLength(6);
    expect(result.paragraphs[0].text.startsWith("本文认为")).toBe(true);
    expect(result.issues).not.toContain("开头没有明显亮出中心论点。");
  });

  it("对字数不足、跑题和结构缺失给出明确修正项", () => {
    const result = gradeWriting(
      prompt,
      "随便写写",
      "这是一个很短的开头。\n\n这里只有两段话，没有展开分析，也没有回扣材料。",
    );
    expect(result.score).toBeLessThan(55);
    expect(result.grade).toBe("四类文");
    expect(result.issues.some((issue) => issue.includes("低于题目要求"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("至少写出 5 段"))).toBe(true);
    expect(result.missingKeywords.length).toBeGreaterThan(0);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("逐段点评最多返回 12 段", () => {
    const long = Array.from({ length: 20 }, (_, index) => `第${index + 1}段，围绕群众小事展开分析，并提出具体可行的落实办法。`).join("\n\n");
    const result = gradeWriting(prompt, "把小事办实", long);
    expect(result.paragraphs).toHaveLength(12);
  });

  it("内置题目覆盖大作文且都有评分关键词", () => {
    expect(WRITING_PROMPTS.length).toBeGreaterThanOrEqual(4);
    for (const item of WRITING_PROMPTS) {
      expect(item.type).toBe("大作文");
      expect(item.keywords.length).toBeGreaterThanOrEqual(5);
      expect(item.targetWords.min).toBeGreaterThan(0);
    }
  });
});
