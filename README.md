# 公考加油站 · 知识库维护指南

本项目是行测 / 申论练习站（React + Vite + Hono + Cloudflare Pages）。知识库以 **Markdown 源文件** 为唯一内容来源，经构建管线生成索引 JSON，前端在聚合页面中自动展示——**新增一篇文档不需要新增页面文件**。

```
content/knowledge/          # 知识库 Markdown 源（唯一内容来源）
  data_analysis/            # 资料分析
  verbal/                   # 言语理解
  judgment/                 # 判断推理
  common_sense/             # 常识判断
  quantitative/             # 数量关系
  essay/                    # 申论（独立页面展示）
scripts/content/
  lib.mjs                   # 元数据 schema、校验规则、HTML 白名单（构建共享逻辑）
  validate.mjs              # npm run content:validate
  build.mjs                 # npm run content:build
src/generated/knowledge/    # 构建产物 index/entries/search-index.json（.gitignore，不入库）
functions/api/[[path]].ts   # API：知识列表/详情、速算、规范词卡片、错题等
```

## 一、文档格式规范

每个主题一个文件：`content/knowledge/<模块>/<英文slug>.md`。

### frontmatter 字段

| 字段 | 规则 |
|---|---|
| `id` | 小写英文 slug（`^[a-z0-9]+(-[a-z0-9]+)*$`），**必须与文件名一致**、全库唯一；发布后不要改名（详情链接与历史数据会失效） |
| `module` | 枚举：`data_analysis` / `verbal` / `judgment` / `common_sense` / `quantitative` / `essay`，且必须与所在目录一致 |
| `category` | 分组用，建议沿用同模块既有取值（见下）；无前端映射时页面原样显示 |
| `title` | 中文标题，1-100 字符 |
| `summary` | 列表卡片摘要，1-200 字符。手写文章写描述性语句；saduck 全文风格文章用模板「{标题}的完整知识要点与方法说明。」（该模板同时作为构建校验的豁免标记） |
| `order` | 非负整数，同模块内排序（人工文章约 1-100 按 10 步进，给插入留空间） |
| `updatedAt` | 日期字符串或 ISO 时间 |

示例：

```yaml
---
id: growth-basics
module: data_analysis
category: growth
title: 增长四量关系
summary: 所有基础增长题都可以从两条关系推出……
order: 20
updatedAt: 2026-09-02
---
```

### 正文规范

- 首行放 `# 标题`（与 `title` 一致）；内容支持标准 Markdown（标题、列表、表格、代码块、引用、加粗等）。
- **禁止书写 raw HTML**（校验拒绝含 `<script>` 等标签的内容）。
- 图片：`![说明](assets/…/x.png)` 引用允许写在源文件，但渲染白名单不含 `<img>`，**图片不会在页面显示**（属既有系统限制）。
- 全库排版约定：中文与数字之间不加空格（如「增长30%」「1.5倍」）。
- 手写的数量关系（`quantitative`）方法论文章，需含三个二级标题 `## 例题`、`## 答案`、`## 讲解`——详情页据此展示例题卡片，构建校验强制（saduck 全文风格文件豁免）。
- 从外部资料导入的全文可用编号章节结构（`## 一、…`、`### …`）。

## 二、category 取值参考（沿用同模块既有值）

| 模块 | 现行取值 |
|---|---|
| data_analysis | `methods` `foundation` `growth` `proportion` `average` `multiple` `pitfalls` `application` |
| verbal | `reading` `cloze` `expression` `foundation` |
| judgment | `graphics` `definition` `analogy` `logic` `science_reasoning` |
| common_sense | `methods` `science` `politics` `management` + 中文篇目（`人文篇` `历史篇` `法律篇` `科技篇` `经济篇` 等） |
| quantitative | `methods` `sequences` `geometry` `counting` `mixture` `engineering` `travel` `profit` `sets` |
| essay | `writing` `questions` `foundation` `standard-terms` |

英文 key 的中文展示名映射在 `src/pages/KnowledgePage.tsx` 的 `categoryLabels`；新增分类可加一行映射，未映射的 key 会原样显示（中文 key 直接显示中文）。

## 三、添加一篇新文档

1. 按上文规范在对应模块目录新建 `<slug>.md`（slug 取主题英文语义名，如 `fraction-sequences.md`）。
2. 校验：`npm run content:validate` —— 通过则输出 `Validated N knowledge entries.`，失败会逐条列出原因。
3. 重建索引：`npm run content:build` —— 生成 `src/generated/knowledge/{index,entries,search-index}.json`（构建产物，不会被提交）。
4. 本地预览：
   - 终端 A 启动 API mock：`node scripts/dev-api-server.mjs`（监听 4174，每次请求实时读 entries.json，无需重启）
   - 终端 B 启动页面：`npm run dev`（http://localhost:5173 ，`/api` 代理到 4174）
5. 验证展示位置（见下节），确认后即可提交源码。

## 四、文档如何出现在页面

| 文章位置 | 页面入口 | 分组依据 |
|---|---|---|
| 行测 5 模块（非 essay） | `/#/knowledge` | 顶部模块按钮（前端硬编码 5 个）；组内按 `category` 分组 |
| `essay` 模块 | `/#/essay` →「申论知识」 | 按 `category` 分组 |
| `essay` + `category: standard-terms` | `/#/essay` →「规范词卡片」 | 见下方卡片规则 |

- **搜索**：列表页搜索框对标题 / summary / 正文全文检索（`search-index.json`），无需额外配置。
- **详情**：点击条目后经 `/api/knowledge/:id` 返回渲染，无独立路由。
- **规范词卡片**：`standard-terms` 文章正文中的 Markdown 表格会被解析为记忆卡片（正面「材料信号」、背面「规范表达」、提示列可选），表头行含「材料信号」时自动跳过。卡片复习进度存数据库，标题格式建议 `规范词：<主题>`：

```markdown
## 高频转换

| 材料信号 | 规范表达 | 使用提示 |
|---|---|---|
| 多个部门都管，却说不清谁负责 | 权责边界不清 | 若互相推脱可写"推诿扯皮" |
```

## 五、新增独立页面（真正需要新入口时）

只有内容形态与现有页面差异足够大时才需要：

1. 在 `src/pages/` 新建页面组件；
2. `src/App.tsx` 的 `<Routes>` 中加 `<Route path="/xxx" …>`，并在 `SignedIn` 的 `nav` 数组加导航项（图标取自 lucide-react）；
3. 如需新接口，在 `functions/api/[[path]].ts`（Hono）添加路由；本地开发时同步扩展 `scripts/dev-api-server.mjs` 的 mock。

## 六、常用命令

| 命令 | 作用 |
|---|---|
| `npm run content:validate` | 校验 frontmatter / 命名 / 结构（CI 与 prebuild 都会执行） |
| `npm run content:build` | 重建索引 JSON |
| `npm run build` | 先 `content:validate` + `content:build`，再类型检查 + 打包（`prebuild` 钩子自动完成前两步） |
| `npm test` | 单元测试 |
| `npm run dev` | 本地开发（需先起 mock API，见第三节） |
| `npx wrangler pages deploy dist --project-name civil-exam-drill` | 部署到 Cloudflare Pages |

推送 `main` 后不会自动触发部署：`workspace/.github/workflows/deploy.yml` 只是示例（GitHub Actions 只识别仓库根的 `.github/workflows/`，当前位于项目 workspace 内）。如需 CI 自动部署，将其移至仓库根并修正相对路径。

## 七、已知限制与注意事项

- 列表接口单次最多返回 100 条（生产 `functions/api` 的 limit 上限；本地 mock 无此限制）。文章总数超过 100 后，生产环境的「全部行测」视图会截断，需要调大上限或做分页。
- `src/generated/knowledge/*.json` 是构建产物（已被 .gitignore 忽略），提交代码无需也不应包含；克隆后首次 `npm run build` 会经 `prebuild` 自动生成。
- `id` 一经发布不要修改：详情接口、搜索索引、错题与复习记录都以 id 为键；本项目曾一次性将 101 个 `saduck-NNN` 编号文件迁移为语义 id，属于一次性数据迁移，日常维护不应再做。
