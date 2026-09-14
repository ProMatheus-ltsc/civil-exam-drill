/**
 * 专项训练关卡 ↔ 知识库讲解的关联校验。
 *
 * catalog.ts 里每个关卡的 docId 是手写字符串，指向 content/knowledge 下的一篇文档。
 * 文档被删掉或改名时，前端不会报任何错——只是点「查看知识讲解」进了一个打不开的详情页。
 * 这个坑真的踩过：data_analysis/direct-division.md 被删后，「除法估算」关卡一直指着它。
 * 所以把关联写死在测试里：docId 必须能落到真实文档上，且文档模块要和轨道对得上。
 */
import { describe, expect, it } from "vitest";
import { loadEntries } from "../scripts/content/lib.mjs";
import { topics } from "../src/generator/catalog";
import type { TrackId } from "../src/generator/catalog";

/** 轨道 → 该轨道关卡的讲解文档所在的知识库模块（跨模块挂链接一定是写错了） */
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
});
