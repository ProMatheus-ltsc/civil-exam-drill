/**
 * 知识库讲解文档的链接工具。
 *
 * 详情页是 HashRouter 路由（`#/knowledge/:id`，见 KnowledgePage 的 KnowledgeDocPage），
 * 所以浏览器地址就是 `origin + pathname + #/knowledge/<id>`——用它可以拼出能直接
 * 在浏览器里打开、也能在新标签页里打开的链接。
 *
 * 为什么统一走新标签页：讲解是“查资料”的旁支动作，在训练页点进去不该丢掉当前进度
 * （关卡列表的展开态、答题中途的题面都只存在内存里，路由一跳就没了）。
 */
export function knowledgeDocHref(docId: string) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/knowledge/${encodeURIComponent(docId)}`;
}

/** 在新标签页打开讲解文档，当前页面（含交互状态）保持不变 */
export function openKnowledgeDoc(docId: string) {
  window.open(knowledgeDocHref(docId), "_blank", "noopener,noreferrer");
}
