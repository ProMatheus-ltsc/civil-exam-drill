import { useEffect, useMemo, useState } from "react";
import { BookOpen, Brain, ChartNoAxesColumn, ListChecks } from "lucide-react";
import { EmptyState } from "@shared/core/components/EmptyState";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import { ResponsiveGrid } from "@shared/core/components/responsive/ResponsiveGrid";
import { Stack } from "@shared/core/components/responsive/Stack";
import { StatCard } from "@shared/core/components/stats/StatCard";
import { api } from "../api/client";
import { titleOf, topicById } from "../generator/catalog";
import type { TrackId } from "../generator/catalog";
import { TrendChart } from "../components/TrendChart";

type Summary = {
  activity: {
    studyDays: number;
    streak: number;
    activeToday: boolean;
    today: { quizCount: number; cardReviews: number; schulteRuns: number; retries: number };
  };
  trend30: Array<{
    date: string;
    quizCount: number;
    correct: number;
    accuracy: number;
    cardReviews: number;
    schulteRuns: number;
    retries: number;
  }>;
  quiz: {
    items: Array<{
      topicId: string;
      total: number;
      correct: number;
      accuracy: number;
      averageMs: number;
    }>;
    overall: { total: number; correct: number; accuracy: number; averageMs: number };
  };
  cards: {
    summary: {
      total: number;
      new: number;
      due: number;
      learning: number;
      mastered: number;
      accuracy: number;
    };
    today: number;
    last7: number;
  };
  mistakes: { open: number; mastered: number; retryTotal: number; retryAccuracy: number };
  schulte: { bests: Array<{ gridSize: number; variant: string; bestMs: number }>; runs30: number };
};

const variantLabel: Record<string, string> = {
  standard: "标准数字",
  hanzi: "汉字",
  color_letters: "彩色字母",
};
const ms2s = (ms: number) => (ms / 1000).toFixed(2);

function emptySummary(): Summary {
  const zeroDay = {
    quizCount: 0,
    correct: 0,
    accuracy: 0,
    cardReviews: 0,
    schulteRuns: 0,
    retries: 0,
  };
  return {
    activity: { studyDays: 0, streak: 0, activeToday: false, today: zeroDay },
    trend30: Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.now() + 8 * 3600000 - (29 - i) * 86400000)
        .toISOString()
        .slice(0, 10),
      ...zeroDay,
    })),
    quiz: { items: [], overall: { total: 0, correct: 0, accuracy: 0, averageMs: 0 } },
    cards: {
      summary: { total: 0, new: 0, due: 0, learning: 0, mastered: 0, accuracy: 0 },
      today: 0,
      last7: 0,
    },
    mistakes: { open: 0, mastered: 0, retryTotal: 0, retryAccuracy: 0 },
    schulte: { bests: [], runs30: 0 },
  };
}

export function ProfilePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void api<Summary>("/profile/summary")
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (loading && !summary) return <LoadingSpinner message="统计加载中…" />;
  const data = summary ?? emptySummary();
  return (
    <Stack gap="1.5rem">
      <section className="panel">
        <p className="eyebrow">学习记录</p>
        <h2>学习统计</h2>
        <ResponsiveGrid minItemWidth="150px" gap="0.9rem">
          <StatCard label="累计学习天数" value={`${data.activity.studyDays} 天`} />
          <StatCard
            label="连续学习"
            value={`${data.activity.streak} 天`}
          />
          <StatCard label="累计答题" value={`${data.quiz.overall.total} 题`} />
          <StatCard
            label="总正确率"
            value={`${Math.round(data.quiz.overall.accuracy * 100)}%`}
          />
          <StatCard
            label="今日完成"
            value={`${data.activity.today.quizCount + data.activity.today.cardReviews + data.activity.today.schulteRuns + data.activity.today.retries} 项`}
          />
          <StatCard label="平均每题用时" value={`${Math.round(data.quiz.overall.averageMs / 100) / 10}s`} />
        </ResponsiveGrid>
      </section>

      <section className="panel">
        <h3 className="section-title">近 30 天做题与正确率趋势</h3>
        <TrendChart
          seriesLabels={["速算/数推", "规范词复习"]}
          colors={["#17324d", "#bb623a"]}
          points={data.trend30.map((day) => ({
            date: day.date,
            bars: [day.quizCount, day.cardReviews],
            line: day.quizCount > 0 ? day.accuracy : null,
          }))}
        />
      </section>

      <QuizBreakdown items={data.quiz.items} />
      <CardsSection data={data} />
      <ExtraStats data={data} />
    </Stack>
  );
}

function QuizBreakdown({
  items,
}: {
  items: Summary["quiz"]["items"];
}) {
  const byTrack = useMemo(() => {
    const tracks = new Map<TrackId, Summary["quiz"]["items"]>();
    for (const item of items) {
      const topic = topicById.get(item.topicId as Parameters<typeof topicById.get>[0]);
      const trackId = topic?.track ?? "speed";
      const list = tracks.get(trackId) ?? [];
      list.push(item);
      tracks.set(trackId, list);
    }
    return tracks;
  }, [items]);
  const practiced = items.filter((item) => item.total >= 10);
  const weakest = [...practiced]
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 3);
  return (
    <section className="panel">
      <div className="section-head">
        <h3 className="section-title">分模块成绩（速算 / 数字推理）</h3>
        <span className="muted">{items.length} 个模块有记录</span>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={ChartNoAxesColumn}
          title="还没有训练数据"
          description="前往「专项训练」开始闯关，这里会展示每关的正确率与星级"
        />
      ) : (
        <Stack gap="1rem">
          {(["speed", "sequence"] as const).map((trackId) => {
            const list = byTrack.get(trackId) ?? [];
            if (!list.length) return null;
            return (
              <div key={trackId}>
                <p className="subtitle">
                  {trackId === "speed" ? "资料速算" : "数字推理"} · {list.length} 关有记录
                </p>
                <div className="stat-table">
                  <div className="stat-row stat-row-head">
                    <span>关卡</span>
                    <span>题量</span>
                    <span>正确率</span>
                    <span>平均用时</span>
                  </div>
                  {[...list]
                    .sort((a, b) => a.total - b.total)
                    .map((item) => (
                      <div className="stat-row" key={item.topicId}>
                        <span>{titleOf(item.topicId)}</span>
                        <span>{item.total}</span>
                        <span>{Math.round(item.accuracy * 100)}%</span>
                        <span>{Math.round(item.averageMs / 100) / 10}s</span>
                      </div>
                    ))}
                </div>
              </div>
            );
          })}
          {weakest.length > 0 && (
            <p className="weak-hint">
              相对薄弱（题量 ≥10）：{weakest.map((item) => titleOf(item.topicId)).join("、")}，可回
              「专项训练」对应关卡重点补强。
            </p>
          )}
        </Stack>
      )}
    </section>
  );
}

function CardsSection({ data }: { data: Summary }) {
  const { summary } = data.cards;
  return (
    <section className="panel">
      <div className="section-head">
        <h3 className="section-title">规范词记忆</h3>
        <span className="muted">
          近 7 日复习 {data.cards.last7} 次 · 今日 {data.cards.today} 次
        </span>
      </div>
      <ResponsiveGrid minItemWidth="140px" gap="0.9rem">
        <StatCard label="全部卡片" value={summary.total} />
        <StatCard label="待学习/复习" value={summary.new + summary.due} />
        <StatCard label="已掌握" value={summary.mastered} />
        <StatCard label="记忆正确率" value={`${Math.round(summary.accuracy * 100)}%`} />
      </ResponsiveGrid>
      {summary.total === 0 && (
        <p className="muted hint-line">在「申论 → 规范词卡片」复习后会展示这里。</p>
      )}
    </section>
  );
}

function ExtraStats({ data }: { data: Summary }) {
  return (
    <section className="panel">
      <div className="section-head">
        <h3 className="section-title">错题本与舒尔特方格</h3>
        <span className="muted">错题重做正确率来自最近的重做记录</span>
      </div>
      <div className="two-col">
        <div className="sub-block">
          <p className="subtitle">
            <ListChecks size={15} /> 错题本
          </p>
          <ResponsiveGrid minItemWidth="120px" gap="0.7rem">
            <StatCard label="待巩固错题" value={data.mistakes.open} />
            <StatCard label="已掌握" value={data.mistakes.mastered} />
            <StatCard label="重做次数" value={data.mistakes.retryTotal} />
            <StatCard
              label="重做正确率"
              value={`${Math.round(data.mistakes.retryAccuracy * 100)}%`}
            />
          </ResponsiveGrid>
        </div>
        <div className="sub-block">
          <p className="subtitle">
            <Brain size={15} /> 舒尔特 · 各项最佳
          </p>
          {data.schulte.bests.length ? (
            <div className="stat-table">
              <div className="stat-row stat-row-head">
                <span>玩法</span>
                <span>阶数</span>
                <span>最佳用时</span>
              </div>
              {data.schulte.bests.map((best) => (
                <div className="stat-row" key={`${best.variant}-${best.gridSize}`}>
                  <span>{variantLabel[best.variant] ?? best.variant}</span>
                  <span>{best.gridSize} 阶</span>
                  <span>{ms2s(best.bestMs)}s</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted hint-line">
              完成一次舒尔特方格后展示最佳成绩（近 30 天 {data.schulte.runs30} 次）。
            </p>
          )}
        </div>
      </div>
      {data.quiz.items.length === 0 &&
        data.cards.summary.total === 0 &&
        data.schulte.bests.length === 0 && (
          <p className="muted hint-line">
            <BookOpen size={14} /> 提示：先去「专项训练 / 规范词卡片 / 舒尔特方格」产生数据。
          </p>
        )}
    </section>
  );
}
