import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BookOpen,
  Brain,
  FileText,
  History,
  ListTree,
  RotateCcw,
  X,
} from "lucide-react";
import { EmptyState } from "@shared/core/components/EmptyState";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import SearchBar from "@shared/core/components/SearchBar";
import { ResponsiveGrid } from "@shared/core/components/responsive/ResponsiveGrid";
import { Stack } from "@shared/core/components/responsive/Stack";
import { StatCard } from "@shared/core/components/stats/StatCard";
import { useToast } from "@shared/core/hooks/useToast";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { isReviewDue } from "../essay/queue";
import { initialProgress, scheduleReview } from "../essay/scheduler";

type KnowledgeItem = {
  id: string;
  module: string;
  category: string;
  title: string;
  summary: string;
};
type KnowledgeDetail = {
  html: string;
  title: string;
  module: string;
  category: string;
};
type CardProgress = {
  repetitions: number;
  intervalDays: number;
  ease: number;
  dueAt: string;
  lastReviewedAt: string | null;
  rememberedCount: number;
  forgotCount: number;
} | null;
type EssayCard = {
  termId: string;
  category: string;
  front: string;
  back: string;
  hint: string;
  progress: CardProgress;
};
type CardSummary = {
  total: number;
  new: number;
  due: number;
  learning: number;
  mastered: number;
  accuracy: number;
};
type ReviewHistory = {
  id: string;
  termId: string;
  rating: "forgot" | "hard" | "remembered";
  reviewedAt: string;
  card: { front: string } | null;
};
type CardsResponse = {
  cards: EssayCard[];
  summary: CardSummary;
  categories: string[];
};
type HistoryResponse = {
  items: ReviewHistory[];
  todayCount: number;
};
const modules = [
  ["data_analysis", "资料分析"],
  ["verbal", "言语理解"],
  ["judgment", "判断推理"],
  ["common_sense", "常识判断"],
  ["quantitative", "数量关系"],
];
const categoryLabels: Record<string, string> = {
  foundation: "基础认知",
  methods: "解题方法",
  growth: "增长专题",
  proportion: "比重专题",
  average: "平均数专题",
  multiple: "倍数专题",
  comprehensive: "综合分析",
  application: "综合应用",
  pitfalls: "常见误区",
  reading: "阅读理解",
  cloze: "逻辑填空",
  expression: "表达辨析",
  graphics: "图形推理",
  definition: "定义判断",
  logic: "逻辑判断",
  analogy: "类比推理",
  science_reasoning: "科学推理",
  law: "法律判断",
  science: "科技常识",
  sequences: "数字推理",
  travel: "行程问题",
  engineering: "工程问题",
  profit: "经济利润",
  mixture: "浓度问题",
  sets: "容斥问题",
  geometry: "几何问题",
  counting: "排列组合与概率",
  questions: "题型方法",
  writing: "文章写作",
  "standard-terms": "规范表达",
  politics: "政治理论",
  management: "管理常识",
};

function computeSummary(cards: EssayCard[], now = new Date().toISOString()): CardSummary {
  let newCount = 0;
  let due = 0;
  let learning = 0;
  let mastered = 0;
  let remembered = 0;
  let forgot = 0;
  for (const card of cards) {
    if (!card.progress) newCount += 1;
    else {
      if (card.progress.dueAt <= now) due += 1;
      if (card.progress.repetitions < 3) learning += 1;
      else mastered += 1;
      remembered += card.progress.rememberedCount;
      forgot += card.progress.forgotCount;
    }
  }
  return {
    total: cards.length,
    new: newCount,
    due,
    learning,
    mastered,
    accuracy: remembered + forgot ? remembered / (remembered + forgot) : 0,
  };
}

export function KnowledgePage({ essay = false }: { essay?: boolean }) {
  const [items, setItems] = useState<KnowledgeItem[]>([]),
    [query, setQuery] = useState(""),
    [module, setModule] = useState("data_analysis"),
    [docId, setDocId] = useState<string | null>(null);
  const { busy, run } = useAsync();
  useEffect(() => {
    let ignore = false;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: "200" });
      if (essay) params.set("module", "essay");
      else if (module) params.set("module", module);
      if (query.trim()) params.set("q", query.trim());
      void run(async () => {
        const result = await api<{ items: KnowledgeItem[] }>(
          `/knowledge?${params}`,
        );
        if (!ignore) setItems(result.items);
      });
    }, 250);
    return () => {
      ignore = true;
      window.clearTimeout(timer);
    };
  }, [essay, module, query]);
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (essay ? item.module === "essay" : item.module !== "essay") &&
          (essay || !module || item.module === module),
      ),
    [items, module, essay],
  );
  const grouped = useMemo(() => {
    const groups: Record<string, KnowledgeItem[]> = {};
    for (const item of filtered) (groups[item.category] ??= []).push(item);
    return Object.entries(groups);
  }, [filtered]);
  if (busy && !items.length) return <LoadingSpinner message="知识库加载中…" />;
  if (docId)
    return (
      <ArticleDetail
        docId={docId}
        backLabel={essay ? "申论知识库" : "行测知识库"}
        onBack={() => setDocId(null)}
      />
    );
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p className="eyebrow">{essay ? "申论学习" : "按模块浏览"}</p>
          <h2>{essay ? "申论知识库" : "行测知识库"}</h2>
        </div>
        <div className="search">
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="搜索标题、分类或正文"
          />
        </div>
      </div>
      {!essay && (
        <div className="chips chips-scroll">
          <button
            className={!module ? "active" : ""}
            onClick={() => setModule("")}
          >
            全部行测
          </button>
          {modules.map((item) => (
            <button
              key={item[0]}
              className={module === item[0] ? "active" : ""}
              onClick={() => setModule(item[0])}
            >
              {item[1]}
            </button>
          ))}
        </div>
      )}
      {filtered.length ? (
        <Stack gap="1.5rem">
          {grouped.map(([category, categoryItems]) => (
            <section className="knowledge-group" key={category}>
              <div className="group-heading">
                <h3>{categoryLabels[category] ?? category}</h3>
                <span>{categoryItems.length} 篇</span>
              </div>
              <ResponsiveGrid minItemWidth="230px" gap="0.875rem">
                {categoryItems.map((item) => (
                  <button key={item.id} className="entry" onClick={() => setDocId(item.id)}>
                    <small>
                      {essay
                        ? "申论"
                        : modules.find((moduleItem) => moduleItem[0] === item.module)?.[1]}
                    </small>
                    <strong>{item.title}</strong>
                    <span className="entry-summary">{item.summary}</span>
                  </button>
                ))}
              </ResponsiveGrid>
            </section>
          ))}
        </Stack>
      ) : (
        <EmptyState
          icon={essay ? FileText : BookOpen}
          title="没有找到相关内容"
          description="试试更换关键词或选择其他分类"
        />
      )}
    </section>
  );
}

type TocItem = { level: 2 | 3; id: string; text: string };

function slugifyHeading(text: string, used: Set<string>) {
  const base =
    text
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}-]/gu, "")
      .slice(0, 40) || "section";
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) candidate = `${base}-${index++}`;
  used.add(candidate);
  return candidate;
}

function ArticleDetail({
  docId,
  backLabel,
  onBack,
}: {
  docId: string;
  backLabel: string;
  onBack: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<KnowledgeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const { run } = useAsync();

  useEffect(() => {
    setDetail(null);
    setToc([]);
    setActiveId(null);
    let ignore = false;
    void run(async () => {
      try {
        const data = await api<KnowledgeDetail>(`/knowledge/${docId}`);
        if (!ignore) setDetail(data);
      } catch (loadError) {
        if (!ignore)
          setError(loadError instanceof Error ? loadError.message : "文章加载失败");
      }
    });
    return () => {
      ignore = true;
    };
  }, [docId]);

  // 为标题分配锚点并生成目录；表格包横向滚动容器
  useEffect(() => {
    if (!detail || !containerRef.current) return;
    const root = containerRef.current;
    const used = new Set<string>();
    const headings = Array.from(root.querySelectorAll("h2, h3")) as HTMLElement[];
    headings.forEach((heading) => {
      const level = heading.tagName === "H2" ? 2 : 3;
      const id = slugifyHeading(heading.textContent ?? "", used);
      heading.id = id;
      heading.dataset.tocLevel = String(level);
    });
    setToc(
      headings.map((heading) => ({
        level: heading.tagName === "H2" ? 2 : 3,
        id: heading.id,
        text: (heading.textContent ?? "").trim(),
      })),
    );
    root.querySelectorAll("table").forEach((table) => {
      if (!table.closest(".table-scroll")) {
        const wrapper = document.createElement("div");
        wrapper.className = "table-scroll";
        table.parentNode?.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      }
    });
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: "-72px 0px -62% 0px", threshold: 0 },
    );
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [detail]);

  const scrollTo = (id: string) => {
    const node = document.getElementById(id);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
    }
    setTocOpen(false);
  };

  if (error)
    return (
      <section className="panel">
        <button className="back" onClick={onBack}>
          ← 返回{backLabel}
        </button>
        <EmptyState
          icon={BookOpen}
          title="文章不存在或已下线"
          description={error}
        />
      </section>
    );
  if (!detail) return <LoadingSpinner message="文章加载中…" />;

  return (
    <article className="panel">
      <button className="back" onClick={onBack}>
        ← 返回{backLabel}
      </button>
      <h2 className="article-title">{detail.title}</h2>
      <div className={`article-layout ${toc.length >= 2 ? "with-toc" : ""}`}>
        <div className="article-body" ref={containerRef}>
          <div
            className="knowledge-article"
            dangerouslySetInnerHTML={{ __html: detail.html }}
          />
        </div>
        {toc.length >= 2 && (
          <aside className="article-toc" aria-label="文章目录">
            <strong>本文章节</strong>
            {toc.map((item) => (
              <button
                key={item.id}
                className={`toc-item lv${item.level} ${activeId === item.id ? "active" : ""}`}
                onClick={() => scrollTo(item.id)}
              >
                {item.text}
              </button>
            ))}
          </aside>
        )}
      </div>
      {toc.length >= 2 && (
        <>
          <button
            className="toc-fab"
            aria-label="打开目录"
            onClick={() => setTocOpen(true)}
          >
            <ListTree size={18} /> 目录
          </button>
          {tocOpen && (
            <div className="toc-sheet-mask" onClick={() => setTocOpen(false)}>
              <div
                className="toc-sheet"
                role="dialog"
                aria-label="文章目录"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="toc-sheet-head">
                  <strong>本文章节</strong>
                  <button
                    className="back"
                    aria-label="关闭目录"
                    onClick={() => setTocOpen(false)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="toc-sheet-list">
                  {toc.map((item) => (
                    <button
                      key={item.id}
                      className={`toc-item lv${item.level} ${activeId === item.id ? "active" : ""}`}
                      onClick={() => scrollTo(item.id)}
                    >
                      {item.text}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </article>
  );
}

/** 深链文章页：供训练关卡“看讲解”跳转（/#/knowledge/:id） */
export function KnowledgeDocPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  if (!id) return null;
  return (
    <ArticleDetail
      docId={id}
      backLabel="知识库"
      onBack={() => navigate("/knowledge")}
    />
  );
}

// ==================== 规范词卡片 ====================

function EssayCards() {
  const [cards, setCards] = useState<EssayCard[]>([]),
    [summary, setSummary] = useState<CardSummary | null>(null),
    [categories, setCategories] = useState<string[]>([]),
    [category, setCategory] = useState(""),
    [flipped, setFlipped] = useState(false),
    [history, setHistory] = useState<ReviewHistory[]>([]),
    [todayCount, setTodayCount] = useState(0);
  const { busy, run } = useAsync();
  const { showToast } = useToast();

  const loadAll = useCallback(async () => {
    const [data, records]: [CardsResponse, HistoryResponse] = await Promise.all([
      api<CardsResponse>("/essay/cards"),
      api<HistoryResponse>("/essay/reviews/history?limit=12"),
    ]);
    setCards(data.cards);
    setSummary(data.summary);
    setCategories(data.categories);
    setHistory(records.items);
    setTodayCount(records.todayCount);
  }, []);

  useEffect(() => {
    void run(loadAll);
  }, []);

  const filtered = useMemo(
    () =>
      cards.filter(
        (card) =>
          (!category || card.category === category) &&
          isReviewDue(card.progress),
      ),
    [cards, category],
  );
  const card = filtered[0];
  useEffect(() => setFlipped(false), [category]);

  // 评分：本地按调度算法乐观推进（与后端同源），网络提交后台执行
  const review = (rating: "forgot" | "hard" | "remembered") => {
    if (!card) return;
    const termId = card.termId;
    const nextProgress = scheduleReview(
      card.progress ?? initialProgress,
      rating,
    );
    setCards((previous) => {
      const updated = previous.map((item) =>
        item.termId === termId
          ? { ...item, progress: { ...item.progress, ...nextProgress } }
          : item,
      );
      setSummary(computeSummary(updated));
      return updated;
    });
    setFlipped(false);
    void api(`/essay/reviews`, {
      method: "POST",
      body: JSON.stringify({ termId, rating, idempotencyKey: crypto.randomUUID() }),
    })
      .then(() => setTodayCount((count) => count + 1))
      .catch(() => showToast("本次评分未同步，可点刷新按钮重试", "error"));
  };

  const refresh = () => {
    void run(async () => {
      await loadAll();
      showToast("已同步最新复习进度", "success");
    });
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!card) return;
      if (event.code === "Space") {
        event.preventDefault();
        setFlipped((value) => !value);
      }
      if (flipped && event.key === "1") review("forgot");
      if (flipped && event.key === "2") review("hard");
      if (flipped && event.key === "3") review("remembered");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [card, flipped]);

  if (busy && !cards.length)
    return <LoadingSpinner message="规范词卡片加载中…" />;
  return (
    <Stack gap="1.25rem">
      <ResponsiveGrid minItemWidth="145px" gap="0.75rem">
        <StatCard label="全部卡片" value={summary?.total ?? 0} />
        <StatCard
          label="待学习/复习"
          value={(summary?.due ?? 0) + (summary?.new ?? 0)}
        />
        <StatCard label="已掌握" value={summary?.mastered ?? 0} />
        <StatCard
          label="记忆正确率"
          value={`${Math.round((summary?.accuracy ?? 0) * 100)}%`}
        />
        <StatCard label="今日复习" value={todayCount} />
      </ResponsiveGrid>
      <div className="card-toolbar">
        <label>
          分类
          <select
            value={category}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              setCategory(event.target.value)
            }
          >
            <option value="">全部规范词</option>
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <span>
          {filtered.length ? `剩余 ${filtered.length}` : "今日已完成"}
        </span>
        <button
          className="secondary refresh-btn"
          disabled={busy}
          onClick={refresh}
        >
          <RotateCcw size={14} /> 刷新
        </button>
      </div>
      {card ? (
        <>
          <button
            className="memory-card"
            onClick={() => setFlipped((value) => !value)}
          >
            <div className="memory-label">
              {card.category} · {flipped ? "规范表达" : "材料表述"}
            </div>
            <div className="memory-answer">
              {flipped ? card.back : card.front}
            </div>
            {flipped && card.hint && (
              <div className="memory-hint">提示：{card.hint}</div>
            )}
            <div className="memory-flip">
              <RotateCcw size={16} />
              {flipped ? "根据掌握程度选择下方选项" : "点击卡片或按空格查看答案"}
            </div>
          </button>
          {flipped ? (
            <div className="review-actions">
              {(["forgot", "hard", "remembered"] as const).map((value) => (
                <button
                  key={value}
                  className={value}
                  onClick={() => review(value)}
                >
                  {value === "forgot"
                    ? "1 忘记"
                    : value === "hard"
                      ? "2 模糊"
                      : "3 记住"}
                  <span>
                    {value === "forgot"
                      ? "1 天后"
                      : value === "hard"
                        ? "短期巩固"
                        : "按曲线安排"}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <button className="primary reveal" onClick={() => setFlipped(true)}>
              显示规范表达
            </button>
          )}
        </>
      ) : (
        <EmptyState
          icon={Brain}
          title="今天的卡片已学完"
          description="当前分类没有新的或到期的卡片"
        />
      )}
      {history.length > 0 && (
        <section className="review-history">
          <h3>
            <History size={20} /> 最近复习
          </h3>
          {history.map((item) => (
            <div key={item.id}>
              <span>{item.card?.front ?? item.termId}</span>
              <strong className={item.rating}>
                {item.rating === "remembered"
                  ? "记住"
                  : item.rating === "hard"
                    ? "模糊"
                    : "忘记"}
              </strong>
              <time>
                {new Date(item.reviewedAt).toLocaleString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
          ))}
        </section>
      )}
    </Stack>
  );
}

export function EssayPage() {
  const [tab, setTab] = useState<"knowledge" | "cards">("knowledge");
  return (
    <>
      <div className="essay-tabs">
        <button
          className={tab === "knowledge" ? "active" : ""}
          onClick={() => setTab("knowledge")}
        >
          申论知识
        </button>
        <button
          className={tab === "cards" ? "active" : ""}
          onClick={() => setTab("cards")}
        >
          规范词卡片
        </button>
      </div>
      {tab === "knowledge" ? (
        <KnowledgePage essay />
      ) : (
        <section className="panel">
          <p className="eyebrow">按记忆计划复习</p>
          <h2>规范词记忆</h2>
          <p className="muted">
            先尝试概括材料，再翻面核对。评分后本地立即推进，网络提交在后台同步。
          </p>
          <EssayCards />
        </section>
      )}
    </>
  );
}
