/**
 * 知识库口径守卫：**方法必须能口算解决，需要动笔的算法只能作为「参考」出现**。
 *
 * 踩过的坑：`estimation-strategies`（秒算合集）里写着「用计算器精确计算前期B＝459.5」
 * ——一份讲秒算的文档教人按计算器；同篇的「✏️常规法」块也没标明它只是参考。
 *
 * 约束范围是资料分析与数字推理两个知识库（数字推理用 category=sequences 圈定，
 * quantitative 下还有数量关系的其它家族，不在这条口径内）。
 * 口径说明见 README「正文规范」，两条总纲：quick-calculation / number-sequences。
 */
import { describe, expect, it } from "vitest";
import { loadEntries } from "../scripts/content/lib.mjs";

const inScope = (entry: { module: string; category: string }) =>
  entry.module === "data_analysis" ||
  (entry.module === "quantitative" && entry.category === "sequences");

async function scoped() {
  const { entries, errors } = await loadEntries();
  expect(errors).toEqual([]);
  return entries.filter(inScope);
}

describe("知识库方法口径：口算优先，笔算只作参考", () => {
  it("不把「按计算器」当做法（题目里的「不使用计算器」除外）", async () => {
    const offenders: string[] = [];
    for (const entry of await scoped()) {
      for (const line of entry.markdown.split(/\r?\n/)) {
        if (line.includes("不使用计算器")) continue;
        if (/用计算器|按计算器|拿计算器/.test(line))
          offenders.push(`${entry.id} → ${line.trim().slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("标了 ✏️ 的动笔算法必须写明它只是「参考」", async () => {
    const unlabeled: string[] = [];
    for (const entry of await scoped()) {
      for (const line of entry.markdown.split(/\r?\n/)) {
        if (!line.includes("✏️")) continue;
        if (!line.includes("参考"))
          unlabeled.push(`${entry.id} → ${line.trim().slice(0, 50)}`);
      }
    }
    expect(unlabeled).toEqual([]);
  });

  it("两条总纲都写明了「口算优先、笔算只作参考」", async () => {
    const { entries } = await loadEntries();
    const index = new Map(entries.map((entry) => [entry.id, entry]));
    for (const id of ["quick-calculation", "number-sequences"]) {
      const entry = index.get(id);
      expect(entry, `缺少总纲文档 ${id}`).toBeTruthy();
      expect(entry?.markdown, `${id} 应写明口算优先`).toMatch(/口算/);
      expect(entry?.markdown, `${id} 应写明动笔的只作参考`).toMatch(/参考/);
    }
  });
});
