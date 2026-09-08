import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import { BookOpen, Brain, FileText, History, RotateCcw } from "lucide-react";
import { EmptyState } from "@shared/core/components/EmptyState";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import SearchBar from "@shared/core/components/SearchBar";
import { ResponsiveGrid } from "@shared/core/components/responsive/ResponsiveGrid";
import { Stack } from "@shared/core/components/responsive/Stack";
import { StatCard } from "@shared/core/components/stats/StatCard";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { isReviewDue } from "../essay/queue";

type KnowledgeItem = {
  id: string;
  module: string;
  category: string;
  title: string;
  summary: string;
};
type KnowledgeDetail = { html: string };
type CardProgress = {
  repetitions: number;
  intervalDays: number;
  dueAt: string;
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

export function KnowledgePage({ essay = false }: { essay?: boolean }) {
  const [items, setItems] = useState<KnowledgeItem[]>([]),
    [query, setQuery] = useState(""),
    [module, setModule] = useState("data_analysis"),
    [entry, setEntry] = useState<KnowledgeDetail | null>(null);
  const { busy, run } = useAsync();
  useEffect(() => {
    let ignore = false;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: "100" });
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
  if (entry)
    return (
      <article className="panel">
        <button className="back" onClick={() => setEntry(null)}>
          ← 返回{essay ? "申论" : "行测"}知识库
        </button>
        <div
          className="knowledge-article"
          dangerouslySetInnerHTML={{ __html: entry.html }}
        />
      </article>
    );
  return (
    <><section className="panel">
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
        <div className="chips">
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
              <div className="group-heading"><h3>{categoryLabels[category] ?? category}</h3><span>{categoryItems.length} 篇</span></div>
              <ResponsiveGrid minItemWidth="230px" gap="0.875rem">
                {categoryItems.map((item) => (
                  <button key={item.id} className="entry" onClick={() => run(async () => setEntry(await api<KnowledgeDetail>(`/knowledge/${item.id}`)))}>
                    <small>{essay ? "申论" : modules.find((moduleItem) => moduleItem[0] === item.module)?.[1]}</small>
                    <strong>{item.title}</strong>
                    <span>{item.summary}</span>
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
    </section></>
  );
}

function EssayCards() {
  const [cards, setCards] = useState<EssayCard[]>([]),
    [summary, setSummary] = useState<CardSummary | null>(null),
    [categories, setCategories] = useState<string[]>([]),
    [category, setCategory] = useState(""),
    [flipped, setFlipped] = useState(false),
    [history, setHistory] = useState<ReviewHistory[]>([]),
    [todayCount, setTodayCount] = useState(0);
  const { busy, run } = useAsync();
  const refresh = async () => {
    const [data, records]: [CardsResponse, HistoryResponse] = await Promise.all([
      api<CardsResponse>("/essay/cards"),
      api<HistoryResponse>("/essay/reviews/history?limit=12"),
    ]);
    setCards(data.cards);
    setSummary(data.summary);
    setCategories(data.categories);
    setHistory(records.items);
    setTodayCount(records.todayCount);
  };
  useEffect(() => {
    void run(refresh);
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
  const review = (rating: "forgot" | "hard" | "remembered") => {
    if (!card) return;
    void run(async () => {
      await api("/essay/reviews", {
        method: "POST",
        body: JSON.stringify({
          termId: card.termId,
          rating,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setFlipped(false);
      await refresh();
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
      </div>
      {card ? (
        <>
          <button
            className={`memory-card ${flipped ? "is-flipped" : ""}`}
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
              <button
                className="forgot"
                disabled={busy}
                onClick={() => review("forgot")}
              >
                1 忘记<span>1 天后</span>
              </button>
              <button
                className="hard"
                disabled={busy}
                onClick={() => review("hard")}
              >
                2 模糊<span>短期巩固</span>
              </button>
              <button
                className="remembered"
                disabled={busy}
                onClick={() => review("remembered")}
              >
                3 记住<span>按曲线安排</span>
              </button>
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
            先尝试概括材料，再翻面核对。系统会根据掌握程度安排复习。
          </p>
          <EssayCards />
        </section>
      )}
    </>
  );
}
