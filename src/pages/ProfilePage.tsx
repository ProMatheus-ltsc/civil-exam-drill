import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  Brain,
  ChartNoAxesColumn,
  ChevronDown,
  ListChecks,
} from "lucide-react";
import { EmptyState } from "@shared/core/components/EmptyState";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import { ResponsiveGrid } from "@shared/core/components/responsive/ResponsiveGrid";
import { Stack } from "@shared/core/components/responsive/Stack";
import { StatCard } from "@shared/core/components/stats/StatCard";
import { api } from "../api/client";
import type { TrackId } from "../generator/catalog";
import { titleOf } from "../generator/catalog";
import { TrendChart } from "../components/TrendChart";
import {
  ActivityHeatmap,
  DifficultyDonut,
  ModuleAccuracyBars,
  ProgressRing,
  StarDistribution,
  WeekdayBars,
} from "../components/ProfileCharts";

type Difficulty = "easy" | "medium" | "hard";

type Summary = {
  rangeDays: number;
  activity: {
    studyDays: number;
    streak: number;
    activeToday: boolean;
    today: { quizCount: number; cardReviews: number; schulteRuns: number; retries: number };
  };
  trend: Array<{
    date: string;
    quizCount: number;
    correct: number;
    accuracy: number;
    durationMs: number;
    cardReviews: number;
    schulteRuns: number;
    retries: number;
  }>;
  quiz: {
    items: Array<{
      topicId: string;
      track: TrackId;
      total: number;
      correct: number;
      accuracy: number;
      averageMs: number;
      stars: number;
    }>;
    byDifficulty: Array<{
      difficulty: Difficulty;
      total: number;
      correct: number;
      accuracy: number;
      averageMs: number;
    }>;
    weekday: Array<{ weekday: number; quizCount: number; correct: number }>;
    overall: { total: number; correct: number; accuracy: number; averageMs: number };
  };
  progress: {
    totalTopics: number;
    clearedTopics: number;
    totalStars: number;
    maxStars: number;
    starsDistribution: Array<{ stars: number; count: number }>;
    tracks: Array<{
      id: TrackId;
      title: string;
      totalTopics: number;
      clearedTopics: number;
      stars: number;
      maxStars: number;
      total: number;
      correct: number;
      accuracy: number;
      averageMs: number;
    }>;
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
  schulte: { bests: Array<{ gridSize: number; variant: string; bestMs: number }>; runs: number };
};

const variantLabel: Record<string, string> = {
  standard: "标准数字",
  hanzi: "汉字",
  color_letters: "彩色字母",
};
const ms2s = (ms: number) => (ms / 1000).toFixed(2);
const trackColor: Record<TrackId, string> = {
  speed: "#315c77",
  sequence: "#6a5a8a",
  material: "#bb623a",
};
const trackShort: Record<TrackId, string> = {
  speed: "资料速算",
  sequence: "数字推理",
  material: "资料实战",
};

function emptySummary(days: number): Summary {
  const zeroDay = {
    quizCount: 0,
    correct: 0,
    accuracy: 0,
    cardReviews: 0,
    schulteRuns: 0,
    retries: 0,
  };
  return {
    rangeDays: days,
    activity: { studyDays: 0, streak: 0, activeToday: false, today: zeroDay },
    trend: Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.now() + 8 * 3600000 - (days - 1 - i) * 86400000)
        .toISOString()
        .slice(0, 10),
      durationMs: 0,
      ...zeroDay,
    })),
    quiz: {
      items: [],
      byDifficulty: (["easy", "medium", "hard"] as const).map((difficulty) => ({
        difficulty,
        total: 0,
        correct: 0,
        accuracy: 0,
        averageMs: 0,
      })),
      weekday: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        quizCount: 0,
        correct: 0,
      })),
      overall: { total: 0, correct: 0, accuracy: 0, averageMs: 0 },
    },
    progress: {
      totalTopics: 0,
      clearedTopics: 0,
      totalStars: 0,
      maxStars: 0,
      starsDistribution: [0, 1, 2, 3].map((stars) => ({ stars, count: 0 })),
      tracks: [],
    },
    cards: {
      summary: { total: 0, new: 0, due: 0, learning: 0, mastered: 0, accuracy: 0 },
      today: 0,
      last7: 0,
    },
    mistakes: { open: 0, mastered: 0, retryTotal: 0, retryAccuracy: 0 },
    schulte: { bests: [], runs: 0 },
  };
}

const RANGE_OPTIONS = [7, 30, 90] as const;
const WEAK_MIN_TOTAL = 10;
const MODULE_PAGE_SIZE = 12;

export function ProfilePage({
  user,
}: {
  user: { nickname: string; email?: string };
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rangeDays, setRangeDays] = useState<(typeof RANGE_OPTIONS)[number]>(30);
  const [trackFilter, setTrackFilter] = useState<"all" | TrackId>("all");
  const [weakOnly, setWeakOnly] = useState(false);
  const [showAllModules, setShowAllModules] = useState(false);
  const [moreOpen, setMoreOpen] = useState(
    () => !window.matchMedia("(max-width: 600px)").matches,
  );
  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    void api<Summary>(`/profile/summary?days=${rangeDays}`)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rangeDays]);
  const filteredModules = useMemo(() => {
    let items = summary?.quiz.items ?? [];
    if (trackFilter !== "all")
      items = items.filter((item) => item.track === trackFilter);
    if (weakOnly)
      items = items.filter(
        (item) =>
          item.total >= WEAK_MIN_TOTAL && item.accuracy < 0.9,
      );
    return items;
  }, [summary, trackFilter, weakOnly]);
  if (loading && !summary) return <LoadingSpinner message="统计加载中…" />;
  const data = summary ?? emptySummary(rangeDays);
  const days = data.rangeDays || rangeDays;
  const moduleLimit = showAllModules
    ? filteredModules.length
    : MODULE_PAGE_SIZE;
  const todayTotal =
    data.activity.today.quizCount +
    data.activity.today.cardReviews +
    data.activity.today.schulteRuns +
    data.activity.today.retries;
  const initial = Array.from(user.nickname)[0] ?? "学";

  return (
    <Stack gap="1.5rem">
      <section className="panel profile-overview">
        <div className="profile-identity">
          <div className="profile-avatar" aria-hidden="true">
            {initial}
          </div>
          <div>
            <p className="eyebrow">学习数据</p>
            <h2>{user.nickname}</h2>
            <p className="muted">
              {user.email || "邮箱账号"} · 连续学习 {data.activity.streak} 天
              {data.activity.activeToday ? " · 今日已打卡" : " · 今天还没开练"}
            </p>
          </div>
        </div>
        <ResponsiveGrid minItemWidth="150px" gap="0.9rem">
          <StatCard label={`近 ${days} 天学习`} value={`${data.activity.studyDays} 天`} />
          <StatCard label="连续学习" value={`${data.activity.streak} 天`} />
          <StatCard label="累计答题" value={`${data.quiz.overall.total} 题`} />
          <StatCard
            label="总正确率"
            value={`${Math.round(data.quiz.overall.accuracy * 100)}%`}
          />
          <StatCard label="今日完成" value={`${todayTotal} 项`} />
          <StatCard
            label="平均每题用时"
            value={`${Math.round(data.quiz.overall.averageMs / 100) / 10}s`}
          />
        </ResponsiveGrid>
        <div className="profile-range">
          <span className="muted">
            趋势与节奏范围{refreshing ? " · 更新中…" : ""}
          </span>
          <div className="viz-filters" role="group" aria-label="统计范围">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`viz-chip ${rangeDays === option ? "active" : ""}`}
                aria-pressed={rangeDays === option}
                onClick={() => setRangeDays(option)}
              >
                {option} 天
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">学习节奏</h3>
          <span className="muted">用热力图看坚持，用星期图找规律</span>
        </div>
        <div className="two-col viz-two-col">
          <div>
            <p className="subtitle">近 {days} 天学习热力</p>
            <ActivityHeatmap days={data.trend} />
          </div>
          <div>
            <p className="subtitle">一周答题分布</p>
            <WeekdayBars items={data.quiz.weekday} days={days} />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">近 {days} 天做题与正确率趋势</h3>
          <span className="muted">左轴题量 · 右轴正确率</span>
        </div>
        <TrendChart
          days={days}
          seriesLabels={["速算/数推", "规范词复习", "舒尔特/错题重做"]}
          colors={["#17324d", "#bb623a", "#7fa88f"]}
          points={data.trend.map((day) => ({
            date: day.date,
            bars: [day.quizCount, day.cardReviews, day.schulteRuns + day.retries],
            line: day.quizCount > 0 ? day.accuracy : null,
          }))}
        />
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">通关进度</h3>
          <span className="muted">高难度局通过才算通关</span>
        </div>
        <div className="progress-overview">
          <div className="progress-total">
            <ProgressRing
              ratio={
                data.progress.totalTopics
                  ? data.progress.clearedTopics / data.progress.totalTopics
                  : 0
              }
              value={`${data.progress.clearedTopics}/${data.progress.totalTopics}`}
              label="模块通关"
              size={118}
              stroke={11}
              color="#2f7d5d"
            />
            <p className="muted">
              {data.progress.totalTopics
                ? `已完成 ${Math.round(
                    (data.progress.clearedTopics / data.progress.totalTopics) * 100,
                  )}% 的模块，继续按解锁顺序推进`
                : "还没有关卡进度"}
            </p>
          </div>
          <div className="track-cards">
            {data.progress.tracks.map((track) => (
              <article className="track-card" key={track.id}>
                <ProgressRing
                  ratio={
                    track.totalTopics
                      ? track.clearedTopics / track.totalTopics
                      : 0
                  }
                  value={`${track.clearedTopics}/${track.totalTopics}`}
                  label="关卡"
                  size={76}
                  stroke={8}
                  color={trackColor[track.id]}
                />
                <div className="track-card-text">
                  <h4>{track.title}</h4>
                  <p>
                    {track.stars}/{track.maxStars} 星 · 累计 {track.total} 题
                  </p>
                  <p className="muted">
                    正确率{" "}
                    {track.total
                      ? `${Math.round(track.accuracy * 100)}%`
                      : "—"}{" "}
                    · 平均{" "}
                    {track.total
                      ? `${Math.round(track.averageMs / 1000)}s/题`
                      : "—"}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
        <StarDistribution
          items={data.progress.starsDistribution}
          totalStars={data.progress.totalStars}
          maxStars={data.progress.maxStars}
        />
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">分模块正确率 · 弱项优先</h3>
          <span className="muted">
            {filteredModules.length} 个模块
            {weakOnly ? "符合薄弱条件" : "有记录"}
          </span>
        </div>
        {data.quiz.items.length === 0 ? (
          <EmptyState
            icon={ChartNoAxesColumn}
            title="还没有训练数据"
            description="前往「专项训练」开始闯关，这里会展示每关的正确率与星级"
          />
        ) : (
          <Stack gap="1rem">
            <div className="module-toolbar">
              <div className="viz-filters" role="group" aria-label="按轨道筛选">
                {(["all", "speed", "sequence", "material"] as const).map(
                  (filter) => (
                    <button
                      key={filter}
                      type="button"
                      className={`viz-chip ${trackFilter === filter ? "active" : ""}`}
                      onClick={() => {
                        setTrackFilter(filter);
                        setShowAllModules(false);
                      }}
                    >
                      {filter === "all" ? "全部" : trackShort[filter]}
                    </button>
                  ),
                )}
              </div>
              <label className="weak-toggle">
                <input
                  type="checkbox"
                  checked={weakOnly}
                  onChange={(event) => {
                    setWeakOnly(event.target.checked);
                    setShowAllModules(false);
                  }}
                />
                只看薄弱（题量 ≥{WEAK_MIN_TOTAL} 且正确率 &lt;90%）
              </label>
            </div>
            {filteredModules.length ? (
              <ModuleAccuracyBars
                items={filteredModules}
                limit={moduleLimit}
              />
            ) : (
              <p className="muted hint-line">
                当前筛选下没有薄弱模块，换个轨道或取消筛选看看。
              </p>
            )}
            {filteredModules.length > MODULE_PAGE_SIZE && (
              <button
                type="button"
                className="secondary module-more"
                onClick={() => setShowAllModules((value) => !value)}
              >
                {showAllModules
                  ? "收起模块"
                  : `展开全部 ${filteredModules.length} 个模块`}
              </button>
            )}
            <WeakHint items={data.quiz.items} />
          </Stack>
        )}
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">难度分布与用时</h3>
          <span className="muted">高难度局为实战材料题</span>
        </div>
        <DifficultyDonut items={data.quiz.byDifficulty} />
      </section>

      <section className="panel profile-more">
        <div className="section-head">
          <h3 className="section-title">更多学习数据</h3>
          <button
            type="button"
            className="profile-more-toggle"
            aria-expanded={moreOpen}
            aria-controls="profile-more-body"
            onClick={() => setMoreOpen((value) => !value)}
          >
            {moreOpen ? "收起" : "展开"}
            <ChevronDown
              size={16}
              className={moreOpen ? "is-open" : ""}
            />
          </button>
        </div>
        {moreOpen && (
          <div className="profile-more-body" id="profile-more-body">
            <CardsSection data={data} />
            <ExtraStats data={data} />
          </div>
        )}
      </section>
    </Stack>
  );
}

function WeakHint({ items }: { items: Summary["quiz"]["items"] }) {
  const practiced = items.filter((item) => item.total >= 10);
  const weakest = [...practiced]
    .filter((item) => item.accuracy < 0.9)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 3);
  if (weakest.length)
    return (
      <div className="weak-hint">
        <p>相对薄弱（题量 ≥10），点击直达对应关卡补强：</p>
        <div className="weak-links">
          {weakest.map((item) => (
            <Link
              key={item.topicId}
              className="weak-link"
              to={`/quiz?topic=${encodeURIComponent(item.topicId)}`}
            >
              <span>{titleOf(item.topicId)}</span>
              <em>{Math.round(item.accuracy * 100)}%</em>
              <ArrowRight size={13} />
            </Link>
          ))}
        </div>
      </div>
    );
  if (practiced.length)
    return (
      <p className="good-hint">
        题量 ≥10 的模块正确率均在 90% 以上，继续保持这个节奏。
      </p>
    );
  return null;
}

function CardsSection({ data }: { data: Summary }) {
  const { summary } = data.cards;
  const segments = [
    { label: "待学习", value: summary.new, color: "#9fb3c0" },
    { label: "学习中", value: summary.learning, color: "#d9a441" },
    { label: "已掌握", value: summary.mastered, color: "#2f7d5d" },
  ];
  return (
    <section className="panel">
      <div className="section-head">
        <h3 className="section-title">规范词记忆</h3>
        <span className="muted">
          近 7 日复习 {data.cards.last7} 次 · 今日 {data.cards.today} 次
        </span>
      </div>
      <div className="cards-overview">
        <ProgressRing
          ratio={summary.total ? summary.mastered / summary.total : 0}
          value={`${summary.mastered}/${summary.total}`}
          label="已掌握"
          size={100}
          stroke={9}
          color="#2f7d5d"
        />
        <div className="cards-detail">
          <div className="stacked-meter" aria-hidden="true">
            {segments.map((segment) =>
              segment.value > 0 ? (
                <i
                  key={segment.label}
                  style={{
                    flexGrow: segment.value,
                    background: segment.color,
                  }}
                  title={`${segment.label} ${segment.value}`}
                />
              ) : null,
            )}
          </div>
          <div className="stacked-legend">
            {segments.map((segment) => (
              <span key={segment.label}>
                <i style={{ background: segment.color }} />
                {segment.label} <strong>{segment.value}</strong>
              </span>
            ))}
            <span>
              <i style={{ background: "#bb623a" }} />
              待复习 <strong>{summary.due}</strong>
            </span>
            <span className="stacked-accuracy">
              记忆正确率{" "}
              <strong>{Math.round(summary.accuracy * 100)}%</strong>
            </span>
          </div>
        </div>
      </div>
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
          <div className="retry-overview">
            <ProgressRing
              ratio={data.mistakes.retryAccuracy}
              value={`${Math.round(data.mistakes.retryAccuracy * 100)}%`}
              label="重做正确率"
              size={88}
              stroke={8}
              color="#bb623a"
            />
            <ResponsiveGrid minItemWidth="110px" gap="0.7rem">
              <StatCard label="待巩固错题" value={data.mistakes.open} />
              <StatCard label="已掌握" value={data.mistakes.mastered} />
              <StatCard label="重做次数" value={data.mistakes.retryTotal} />
            </ResponsiveGrid>
          </div>
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
              完成一次舒尔特方格后展示最佳成绩（近期 {data.schulte.runs} 次）。
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
