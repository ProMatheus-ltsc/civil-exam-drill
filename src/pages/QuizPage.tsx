/**
 * 专项训练：资料速算 × 数字推理 双轨闯关。
 * 关卡地图 → 关内 10 题（先难度提升）→ 结算（限时 + ≥80% 通关、1~3 星、可刷星重练）。
 * 交互：答题乐观过渡（选项 spinner）、展示答案期间预取下一题、骨架屏与失败重试。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Calculator,
  ChevronRight,
  Clock,
  Lock,
  RotateCcw,
  Sparkles,
  Star,
  Target,
  Trophy,
} from "lucide-react";
import { EmptyState } from "@shared/core/components/EmptyState";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import { Stack } from "@shared/core/components/responsive/Stack";
import { useToast } from "@shared/core/hooks/useToast";
import { api } from "../api/client";
import { BUDGET_SECONDS } from "../generator/catalog";
import type { MaterialSpec } from "../generator/types";
import { MaterialView } from "../components/MaterialView";

type TrackId = "speed" | "sequence";
type Difficulty = "easy" | "medium" | "hard";
type BudgetClass = "tool" | "concept" | "material" | "sequence";

type TopicMeta = {
  id: string;
  track: TrackId;
  title: string;
  description: string;
  rating: 1 | 2 | 3;
  material: boolean;
  docId: string | null;
  budgetMs: number;
  budgetClass: BudgetClass;
  unlockTitles: string[];
};
type CatalogData = {
  runLength: number;
  passAccuracy: number;
  tracks: Array<{ id: TrackId; title: string; topics: TopicMeta[] }>;
};
type ProgressItem = {
  topicId: string;
  unlocked: boolean;
  stars: number;
  total: number;
  accuracy: number;
};
type QuestionData = {
  questionId: string;
  topicId: string;
  difficulty: Difficulty;
  index: number;
  runLength: number;
  stem: string;
  options: string[];
  material: MaterialSpec | null;
};
type Grade = {
  correct: boolean;
  answerIndex: number;
  explanation: string;
  run: {
    finished: boolean;
    total: number;
    correct: number;
    accuracy: number;
    durationMs: number;
    passed: boolean;
    stars: number;
  } | null;
};
type RunItem = {
  q: QuestionData;
  selectedIndex: number;
  grade: Grade;
};

const RATING_LABEL = ["", "基础", "进阶", "高阶"] as const;
const msText = (ms: number) => `${(ms / 1000).toFixed(0)} 秒`;

export function QuizPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [progress, setProgress] = useState<Map<string, ProgressItem> | null>(null);
  const [track, setTrack] = useState<TrackId>("speed");
  const [screen, setScreen] = useState<"map" | "run" | "result">("map");

  // 关卡运行状态
  const [topic, setTopic] = useState<TopicMeta | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [items, setItems] = useState<RunItem[]>([]);
  const [current, setCurrent] = useState<QuestionData | null>(null);
  const [prefetched, setPrefetched] = useState<QuestionData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [questionStartedAt, setQuestionStartedAt] = useState(0);
  const [summary, setSummary] = useState<Grade["run"] | null>(null);

  const progressRef = useRef<Map<string, ProgressItem> | null>(null);
  progressRef.current = progress;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const prefetching = useRef(false);

  const loadProgress = useCallback(async () => {
    const list = await api<ProgressItem[]>("/quiz/progress");
    setProgress(new Map(list.map((item) => [item.topicId, item])));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api<CatalogData>("/quiz/catalog");
        if (!cancelled) setCatalog(data);
        await loadProgress();
      } catch {
        /* 空态提示由下方兜底渲染负责 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProgress]);

  /** 取题：优先命中预取，否则网络拉取 */
  const ensureQuestion = useCallback(
    async (index: number): Promise<QuestionData | null> => {
      setFetching(true);
      setLoadError(null);
      try {
        if (prefetched && prefetched.index === index) {
          const ready = prefetched;
          setPrefetched(null);
          return ready;
        }
        return await api<QuestionData>("/quiz/questions", {
          method: "POST",
          body: JSON.stringify({ topicId: topic?.id, runId, index }),
        });
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "题目加载失败");
        return null;
      } finally {
        setFetching(false);
      }
    },
    [prefetched, runId, topic],
  );

  const openQuestion = useCallback(
    (q: QuestionData | null) => {
      setCurrent(q);
      setQuestionStartedAt(Date.now());
    },
    [],
  );

  const startRun = useCallback(
    async (nextTopic: TopicMeta) => {
      const nextRunId = crypto.randomUUID();
      setTopic(nextTopic);
      setRunId(nextRunId);
      setItems([]);
      setSummary(null);
      setSubmitting(false);
      setLoadError(null);
      setCurrent(null);
      setPrefetched(null);
      setScreen("run");
      const q = await api<QuestionData>("/quiz/questions", {
        method: "POST",
        body: JSON.stringify({
          topicId: nextTopic.id,
          runId: nextRunId,
          index: 0,
        }),
      }).catch(() => null);
      if (q) openQuestion(q);
      else setLoadError("题目加载失败，请检查网络后重试");
    },
    [openQuestion],
  );

  /** 预取下一题（当前题展示解析期间执行，静默失败） */
  const prefetchNext = useCallback(() => {
    const index = itemsRef.current.length;
    if (index >= 10 || prefetching.current) return;
    prefetching.current = true;
    void api<QuestionData>("/quiz/questions", {
      method: "POST",
      body: JSON.stringify({ topicId: topic?.id, runId, index }),
    })
      .then((q) => {
        if (q.index === itemsRef.current.length) setPrefetched(q);
      })
      .catch(() => undefined)
      .finally(() => {
        prefetching.current = false;
      });
  }, [runId, topic]);

  useEffect(() => {
    if (screen === "run" && items.length > 0 && !summary) prefetchNext();
  }, [screen, items.length, summary, prefetchNext]);

  const answer = async (selectedIndex: number) => {
    if (!current || submitting || items.length !== current.index) return;
    const elapsedMs = Math.max(0, Date.now() - questionStartedAt);
    setSubmitting(true);
    try {
      const grade = await api<Grade>("/quiz/answers", {
        method: "POST",
        body: JSON.stringify({
          questionId: current.questionId,
          selectedIndex,
          elapsedMs,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const nextItems = [...itemsRef.current, { q: current, selectedIndex, grade }];
      setItems(nextItems);
      setSubmitting(false);
      if (grade.run?.finished) {
        setSummary(grade.run);
        setScreen("result");
        void loadProgress();
      }
    } catch (error) {
      setSubmitting(false);
      showToast(error instanceof Error ? error.message : "提交失败，请重试", "error");
    }
  };

  const goNext = async () => {
    if (!topic) return;
    const index = itemsRef.current.length;
    if (index >= 10) return;
    const q = await ensureQuestion(index);
    openQuestion(q);
  };

  const goBackToMap = () => {
    setScreen("map");
    setTopic(null);
    void loadProgress();
  };

  if (!catalog)
    return <LoadingSpinner message="关卡加载中…" />;
  const answered = items.length;
  const showingAnswer = items.length > 0 && current !== null && answered === current.index + 1;
  const lastItem = showingAnswer ? items[items.length - 1] : null;

  return (
    <section className="panel">
      <p className="eyebrow">双轨闯关 · 先难度提升，再模块进阶</p>
      <h2>专项训练</h2>

      {screen === "map" && (
        <>
          <div className="essay-tabs quiz-tabs" role="tablist">
            {catalog.tracks.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={track === item.id}
                className={track === item.id ? "active" : ""}
                onClick={() => setTrack(item.id)}
              >
                {item.title}
              </button>
            ))}
          </div>
          <StageMap
            topics={catalog.tracks.find((t) => t.id === track)?.topics ?? []}
            progressMap={progress}
            onStart={(t) => void startRun(t)}
            onDocs={(docId) => navigate(`/knowledge/${docId}`)}
            onLocked={(names) => showToast(`需先通过：${names.join("、")}`, "info")}
          />
        </>
      )}

      {screen === "run" && topic && (
        <RunView
          topic={topic}
          current={current}
          answered={answered}
          showingAnswer={showingAnswer}
          lastItem={lastItem ?? null}
          submitting={submitting}
          fetching={fetching}
          loadError={loadError}
          prefetchReady={!!prefetched}
          startedAt={questionStartedAt}
          onBack={goBackToMap}
          onAnswer={(i) => void answer(i)}
          onNext={() => void goNext()}
          onRetry={() => {
            if (itemsRef.current.length === 0) void startRun(topic);
            else void goNext();
          }}
        />
      )}

      {screen === "result" && topic && summary && (
        <ResultView
          topic={topic}
          items={items}
          summary={summary}
          onRestart={() => void startRun(topic)}
          onMap={goBackToMap}
        />
      )}
    </section>
  );
}

function StageMap({
  topics,
  progressMap,
  onStart,
  onDocs,
  onLocked,
}: {
  topics: TopicMeta[];
  progressMap: Map<string, ProgressItem> | null;
  onStart: (topic: TopicMeta) => void;
  onDocs: (docId: string) => void;
  onLocked: (unlockNames: string[]) => void;
}) {
  if (!topics.length)
    return (
      <EmptyState icon={Calculator} title="暂无关卡" description="稍后再来看看" />
    );
  return (
    <Stack gap="0.875rem">
      <p className="muted">
        每关 10 题，答对 ≥8 且总用时在预算内即通关（1★）；9 题 2★、全对 3★，可反复刷星，已通关关卡仍可重练。
      </p>
      {topics.map((topic) => {
        const item = progressMap?.get(topic.id);
        const unlocked = item?.unlocked ?? false;
        return (
          <div className={`stage-row ${unlocked ? "" : "is-locked"}`} key={topic.id}>
            <button
              className="stage-main"
              onClick={() => (unlocked ? onStart(topic) : onLocked(topic.unlockTitles))}
            >
              <span className={`stage-badge r${topic.rating}`}>
                {RATING_LABEL[topic.rating]}
              </span>
              <span className="stage-text">
                <strong>
                  {topic.title}
                  {topic.material && <em className="stage-material">材料</em>}
                </strong>
                <small>{topic.description || "逐题闯关"}</small>
              </span>
              <span className="stage-meta">
                {unlocked ? (
                  <>
                    <span className="stars" aria-label={`${item?.stars ?? 0} 星`}>
                      {Array.from({ length: 3 }, (_, i) => (
                        <Star key={i} size={15} className={i < (item?.stars ?? 0) ? "filled" : ""} />
                      ))}
                    </span>
                    <small>
                      <Clock size={12} /> 预算 {msText(topic.budgetMs)}
                    </small>
                    {item && item.total > 0 && (
                      <small>
                        已练 {item.total} 题 · {Math.round(item.accuracy * 100)}%
                      </small>
                    )}
                  </>
                ) : (
                  <small className="lock-hint">
                    <Lock size={13} /> 需先通过：{topic.unlockTitles.join("、")}
                  </small>
                )}
              </span>
              <span className="stage-arrow">
                {unlocked ? <ChevronRight size={18} /> : <Lock size={15} />}
              </span>
            </button>
            {topic.docId && (
              <button
                className="stage-doc"
                title="查看知识讲解"
                onClick={() => onDocs(topic.docId as string)}
              >
                <BookOpen size={15} />
              </button>
            )}
          </div>
        );
      })}
    </Stack>
  );
}

function RunView({
  topic,
  current,
  answered,
  showingAnswer,
  lastItem,
  submitting,
  fetching,
  loadError,
  prefetchReady,
  startedAt,
  onBack,
  onAnswer,
  onNext,
  onRetry,
}: {
  topic: TopicMeta;
  current: QuestionData | null;
  answered: number;
  showingAnswer: boolean;
  lastItem: RunItem | null;
  submitting: boolean;
  fetching: boolean;
  loadError: string | null;
  prefetchReady: boolean;
  startedAt: number;
  onBack: () => void;
  onAnswer: (index: number) => void;
  onNext: () => void;
  onRetry: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const budgetSeconds = useMemo(
    () => (current ? BUDGET_SECONDS[topic.budgetClass][current.difficulty] * 1000 : null),
    [current, topic.budgetClass],
  );
  useEffect(() => {
    if (!current || showingAnswer || !budgetSeconds) {
      setSecondsLeft(null);
      return;
    }
    const tick = window.setInterval(() => {
      const left = budgetSeconds - (Date.now() - startedAt);
      setSecondsLeft(left);
    }, 250);
    return () => window.clearInterval(tick);
  }, [current?.questionId, showingAnswer, budgetSeconds, startedAt]);

  if (!current && loadError)
    return (
      <div className="explanation">
        <h3>题目加载失败</h3>
        <p>{loadError}</p>
        <Stack direction="horizontal" gap="0.75rem">
          <button className="primary" onClick={onRetry}>
            重试
          </button>
          <button className="secondary" onClick={onBack}>
            返回关卡地图
          </button>
        </Stack>
      </div>
    );
  if (!current || fetching)
    return (
      <div className="quiz-skeleton" aria-label="加载题目中">
        <span />
        <span />
        <span />
      </div>
    );

  const qIndex = current.index;
  return (
    <div className="run-view">
      <div className="run-head">
        <button className="back" onClick={onBack}>
          <ArrowLeft size={16} /> 退出本关
        </button>
        <div className="run-progress">
          <span className="run-title">
            {topic.title} · 第 {qIndex + 1}/{current.runLength} 题
            {topic.material && <em className="stage-material">含材料</em>}
          </span>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${(answered / 10) * 100}%` }} />
          </div>
        </div>
        {secondsLeft !== null && !showingAnswer && (
          <span className={`run-timer ${secondsLeft < 0 ? "over" : ""}`}>
            <Clock size={15} />
            {secondsLeft < 0 ? "已超时" : `${Math.ceil(secondsLeft / 1000)}s`}
          </span>
        )}
      </div>

      {current.material && <MaterialView material={current.material} />}

      <div className="question">
        <h3 className="stem">{current.stem}</h3>
        <div className="options">
          {current.options.map((option, index) => {
            const isPicked = lastItem?.selectedIndex === index;
            const isCorrect = showingAnswer && lastItem?.grade.answerIndex === index;
            const cls = showingAnswer
              ? isCorrect
                ? "correct"
                : isPicked
                  ? "picked-wrong"
                  : ""
              : "";
            return (
              <button
                key={option}
                className={`${cls} ${submitting && isPicked ? "pending" : ""}`}
                disabled={submitting || !!showingAnswer || answered !== qIndex}
                onClick={() => onAnswer(index)}
              >
                <span className="option-key">{String.fromCharCode(65 + index)}</span>
                <span className="option-text">{option}</span>
                {submitting && isPicked && <span className="spinner" aria-label="提交中" />}
              </button>
            );
          })}
        </div>
        {showingAnswer && lastItem && (
          <div className={`explanation ${lastItem.grade.correct ? "is-correct" : ""}`}>
            <strong className="verdict">
              {lastItem.grade.correct ? "回答正确" : "回答错误"}
              {lastItem.grade.correct && <Sparkles size={15} />}
            </strong>
            <p>{lastItem.grade.explanation}</p>
            <button className="primary next-btn" disabled={fetching} onClick={onNext}>
              {answered >= current.runLength
                ? "查看成绩"
                : prefetchReady
                  ? "下一题"
                  : fetching
                    ? "加载中…"
                    : "下一题"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultView({
  topic,
  items,
  summary,
  onRestart,
  onMap,
}: {
  topic: TopicMeta;
  items: RunItem[];
  summary: NonNullable<Grade["run"]>;
  onRestart: () => void;
  onMap: () => void;
}) {
  const stars = summary.passed ? summary.stars : 0;
  const missed = items.filter((item) => !item.grade.correct);
  return (
    <div className="run-result">
      <div className="result-hero">
        {stars > 0 ? <Trophy size={44} /> : <Target size={44} />}
        <h3>{summary.passed ? "通关成功" : "本关未通过"}</h3>
        <div className="stars big" aria-label={`${stars} 星`}>
          {Array.from({ length: 3 }, (_, i) => (
            <Star key={i} size={36} className={i < stars ? "filled" : ""} />
          ))}
        </div>
        <p>
          答对 {summary.correct}/{summary.total} · 正确率 {Math.round(summary.accuracy * 100)}% ·
          用时 {msText(summary.durationMs)}（预算 {msText(topic.budgetMs)}）
        </p>
        <p className="muted">
          {summary.passed
            ? stars >= 3
              ? "满分通关，太强了！"
              : "通关成功！可继续下一关，也可回来刷满 3 星。"
            : "答对 ≥8 题且不超过时间预算才可通关，再来一次吧。"}
        </p>
        <Stack direction="horizontal" gap="0.75rem" align="center">
          <button className="primary" onClick={onRestart}>
            <RotateCcw size={15} /> 再战一局
          </button>
          <button className="secondary" onClick={onMap}>
            返回关卡地图
          </button>
        </Stack>
      </div>
      {missed.length > 0 && (
        <details className="result-review" open>
          <summary>本关错题与解析（{missed.length} 题，已自动收入错题本）</summary>
          <Stack gap="0.75rem">
            {items.map((item, index) =>
              item.grade.correct ? null : (
                <div className="review-item" key={index}>
                  <strong>
                    {index + 1}. {item.q.stem}
                  </strong>
                  {item.q.material && <MaterialView material={item.q.material} />}
                  <p className="review-answer">
                    你的答案：{item.q.options[item.selectedIndex]}　正确答案：
                    {item.q.options[item.grade.answerIndex]}
                  </p>
                  <p className="muted">{item.grade.explanation}</p>
                </div>
              ),
            )}
          </Stack>
        </details>
      )}
    </div>
  );
}
