/**
 * 专项训练关卡 ↔ 知识库讲解的关联校验。
 *
 * catalog.ts 里每个关卡的 docId 是手写字符串（资料速算轨道的则由 track 自动取模块 id），
 * 指向 content/knowledge 下的一篇文档。文档被删掉或改名时，前端不会报任何错——只是点
 * 「查看知识讲解」进了一个打不开的详情页。这个坑真的踩过：data_analysis/direct-division.md
 * 被删后，「除法估算」关卡一直指着它。所以把关联写死在测试里：
 *   - 资料速算轨道：一个模块一篇专文，文档 id 就是模块 id、标题就是模块标题（一一对应）；
 *   - 数字推理轨道：数列专文允许一对多，但必须真实存在、且属于 quantitative；
 *   - 所有文档的 module 都要和轨道对得上（speed→data_analysis、sequence→quantitative）。
 */
import { describe, expect, it } from "vitest";
import { loadEntries } from "../scripts/content/lib.mjs";
import { topics } from "../src/generator/catalog";
import type { TrackId } from "../src/generator/catalog";

/** 轨道 → 该轨道关卡的讲解文档所在的知识库模块 */
const MODULE_OF_TRACK: Record<TrackId, string> = {
  speed: "data_analysis",
  sequence: "quantitative",
};

async function knowledgeIndex() {
  const { entries, errors } = await loadEntries();
  expect(errors).toEqual([]);
  return new Map(entries.map((entry) => [entry.id, entry]));
}

describe("专项训练关卡 ↔ 知识库讲解", () => {
  it("轨道与知识库模块的对应关系覆盖了所有轨道", () => {
    const tracksOfCatalog = [...new Set(topics.map((t) => t.track))].sort();
    expect(Object.keys(MODULE_OF_TRACK).sort()).toEqual(tracksOfCatalog);
  });

  it("每个关卡都挂了讲解文档", () => {
    const missing = topics
      .filter((t) => !t.docId)
      .map((t) => `${t.id}（${t.title}）`);
    expect(missing).toEqual([]);
  });

  it("docId 都能在知识库里找到（无死链）", async () => {
    const index = await knowledgeIndex();
    const broken = topics
      .filter((t) => t.docId && !index.has(t.docId))
      .map((t) => `${t.id} → ${t.docId}`);
    expect(broken).toEqual([]);
  });

  it("文档所属模块与关卡轨道一致", async () => {
    const index = await knowledgeIndex();
    const mismatched = topics
      .filter((t) => t.docId && index.get(t.docId)?.module !== MODULE_OF_TRACK[t.track])
      .map(
        (t) =>
          `${t.id}（${t.track}）→ ${t.docId} 属于 ${index.get(t.docId)?.module}`,
      );
    expect(mismatched).toEqual([]);
  });

  it("资料速算轨道：模块与专文一一对应（文档 id = 模块 id，标题 = 模块标题）", async () => {
    const index = await knowledgeIndex();
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const t of topics.filter((topic) => topic.track === "speed")) {
      if (t.docId !== t.id) problems.push(`${t.id} → docId=${t.docId}（应等于模块 id）`);
      if (t.docId) {
        if (seen.has(t.docId)) problems.push(`${t.id} → ${t.docId} 被多个模块共用`);
        seen.add(t.docId);
      }
      const entry = t.docId ? index.get(t.docId) : undefined;
      if (entry && entry.title !== t.title)
        problems.push(`${t.id} → 文档标题「${entry.title}」与模块标题「${t.title}」不一致`);
    }
    expect(problems).toEqual([]);
    // 资料速算模块数 = 资料分析里对应模块的专文数（总纲与其它家族的文章不算）
    expect(seen.size).toBe(topics.filter((t) => t.track === "speed").length);
  });

  it("资料分析知识库里每个模块专文都能被某个关卡引用（没有孤儿专文）", async () => {
    const index = await knowledgeIndex();
    const usedByTopic = new Set(topics.map((t) => t.docId).filter(Boolean));
    const moduleDocs = [...index.values()].filter(
      (e) => e.module === "data_analysis" && e.category !== "overview",
    );
    const orphan = moduleDocs
      .filter((e) => !usedByTopic.has(e.id))
      .map((e) => `${e.id}（${e.title}）`);
    expect(orphan).toEqual([]);
  });
});
