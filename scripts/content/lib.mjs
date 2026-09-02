import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";

export const root = new URL("../../", import.meta.url);
export const contentDir = new URL("../../content/knowledge/", import.meta.url);
export const outputDir = new URL(
  "../../src/generated/knowledge/",
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
      html: sanitizeHtml(marked.parse(parsed.content, { async: false }), {
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
    });
  }
  return { entries, errors };
}
