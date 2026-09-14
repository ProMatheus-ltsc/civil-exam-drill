import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";

export const root = new URL("../../", import.meta.url);
export const contentDir = new URL("../../content/knowledge/", import.meta.url);
// V2（2026-09-03）：输出到 public/generated/knowledge/（静态资源，随 Pages 发布）。
// 原先 src/generated/knowledge 被 functions 静态 import → 11MB 打进 Worker bundle → 超 3MiB 免费限制；
// 现由 functions 经 env.ASSETS 运行时读取（静态路径 /generated/knowledge/*.json）。
export const outputDir = new URL(
  "../../public/generated/knowledge/",
  import.meta.url,
);
export const modules = [
  "data_analysis",
  "verbal",
  "judgment",
  "common_sense",
  "quantitative",
  "essay",
];

const schema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  module: z.enum(modules),
  category: z.string().min(1).max(50),
  title: z.string().min(1).max(100),
  summary: z.string().min(1).max(200),
  order: z.number().int().nonnegative(),
  updatedAt: z.union([z.string(), z.date()]),
});

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(target) : [target];
    }),
  );
  return files
    .flat()
    .filter((file) => file.endsWith(".md"))
    .sort();
}

export async function loadEntries() {
  const files = await walk(fileURLToPath(contentDir));
  const entries = [];
  const errors = [];
  const ids = new Set();

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    const parsed = matter(source);
    const result = schema.safeParse(parsed.data);
    const relative = path.relative(fileURLToPath(root), file);
    if (!result.success) {
      errors.push(
        `${relative}: ${result.error.issues.map((issue) => issue.message).join("; ")}`,
      );
      continue;
    }
    const meta = result.data;
    if (ids.has(meta.id)) errors.push(`${relative}: duplicate id ${meta.id}`);
    ids.add(meta.id);
    if (path.basename(file, ".md") !== meta.id)
      errors.push(`${relative}: filename must equal id`);
    if (!file.includes(`${path.sep}${meta.module}${path.sep}`))
      errors.push(`${relative}: module directory mismatch`);
    if (!parsed.content.trim()) errors.push(`${relative}: body is empty`);
    if (
      /<(?:script|iframe|object|embed|style|[a-z][^>]*)\b/i.test(parsed.content)
    )
      errors.push(`${relative}: raw HTML is not allowed`);
    // 已与 saduck 全文合并的 quantitative 文件采用编号章节结构（例题内嵌于各章节），不再要求三段式
    const mergedQuantitativeIds = new Set(["engineering", "inclusion-exclusion", "number-properties", "profit"])
    if (
      meta.module === "quantitative" &&
      // saduck 全文导入（含改名后的转正文件）summary 为统一模板，结构与手写短文不同，不要求三段式
      !meta.summary.endsWith("的完整知识要点与方法说明。") &&
      !mergedQuantitativeIds.has(meta.id)
    ) {
      for (const heading of ["例题", "答案", "讲解"]) {
        if (!new RegExp(`^##\\s+${heading}\\s*$`, "m").test(parsed.content))
          errors.push(`${relative}: missing ## ${heading}`);
      }
    }
    entries.push({
      ...meta,
      updatedAt:
        meta.updatedAt instanceof Date
          ? meta.updatedAt.toISOString().slice(0, 10)
          : meta.updatedAt,
      source: relative,
      markdown: parsed.content.trim(),
      html: stripLeadingTitle(
        sanitizeHtml(marked.parse(parsed.content, { async: false }), {
          allowedTags: [
            "h1",
            "h2",
            "h3",
            "p",
            "ul",
            "ol",
            "li",
            "strong",
            "em",
            "code",
            "pre",
            "blockquote",
            "table",
            "thead",
            "tbody",
            "tr",
            "th",
            "td",
            "a",
            "hr",
            "br",
          ],
          allowedAttributes: { a: ["href", "title"] },
          allowedSchemes: ["http", "https", "mailto"],
          allowProtocolRelative: false,
        }),
        meta.title,
      ),
    });
  }
  return { entries, errors };
}

/**
 * 去掉正文开头的标题行。
 * 文档约定「首行放 `# 标题`（与 title 一致）」，而详情页自己会渲染一枚带样式的标题，
 * 两处叠加就会出现同一个标题重复两次，所以渲染 HTML 时把这个开头的 h1 拿掉：
 * Markdown 源文件保持约定不变（便于直接阅读/检索），只有对外输出的 html 不带它。
 * 只在这一行确实与 title 一致时才去掉，避免误删正文里的小标题。
 */
function stripLeadingTitle(html, title) {
  const match = html.match(/^\s*<h1[^>]*>([\s\S]*?)<\/h1>\s*/i);
  if (!match) return html;
  const text = match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const expected = String(title ?? "").replace(/\s+/g, " ").trim();
  return text === expected ? html.slice(match[0].length) : html;
}
