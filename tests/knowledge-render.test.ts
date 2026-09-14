/**
 * 知识库正文渲染的守卫。
 *
 * 详情页自己会渲染一枚带样式的标题（`article-title`），而文档约定正文首行也要放 `# 标题`，
 * 两处叠加就会看到同一个标题出现两次。修法是：Markdown 源文件保持约定，
 * 生成 html 时把开头的标题行剥掉。这里守住这个行为，别让它悄悄回退。
 */
import { describe, expect, it } from "vitest";
import { loadEntries } from "../scripts/content/lib.mjs";

const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();
const firstLine = (markdown: string) =>
  squeeze(markdown.split("\n").find((line) => line.trim()) ?? "");

describe("知识库正文渲染", () => {
  it("渲染出的正文 HTML 不再以标题行（h1）开头", async () => {
    const { entries, errors } = await loadEntries();
    expect(errors).toEqual([]);
    const duplicated = entries
      .filter((entry) => /^\s*<h1[^>]*>[\s\S]*?<\/h1>/i.test(entry.html))
      .map((entry) => `${entry.id}（${entry.title}）`);
    expect(duplicated).toEqual([]);
  });

  it("剥掉标题后正文仍然有内容", async () => {
    const { entries } = await loadEntries();
    const empty = entries
      .filter((entry) => entry.html.trim() === "")
      .map((entry) => `${entry.id}（${entry.title}）`);
    expect(empty).toEqual([]);
  });

  it("Markdown 源文件依旧按约定以 `# 标题` 开头（改的是输出，不是源文件）", async () => {
    const { entries } = await loadEntries();
    const wrong = entries
      .filter((entry) => firstLine(entry.markdown) !== `# ${squeeze(entry.title)}`)
      .map((entry) => `${entry.id}: 首行「${firstLine(entry.markdown)}」`);
    expect(wrong).toEqual([]);
  });

  it("章节标题（h2/h3）保留，目录不会因为去标题而少项", async () => {
    const { entries } = await loadEntries();
    const lost = entries
      .filter((entry) => /^#{2,3}\s/m.test(entry.markdown) && !/<h[23][^>]*>/i.test(entry.html))
      .map((entry) => `${entry.id}（${entry.title}）`);
    expect(lost).toEqual([]);
  });
});
