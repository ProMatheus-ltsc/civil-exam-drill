/**
 * 专项训练：资料速算 × 数字推理 双轨闯关。
 * 每个模块区分 低/中/高 三个“难度局”（各 10 题、同难度）：
 * - 难度由题干数字复杂度与选项接近程度决定；
 * - 通过本模块「高难度 · 实战」局（≥8 对且限时内）才算模块通关，解锁下一模块；
 * - 低/中局用于练习与刷星，通关关卡可反复重练。
 * 交互：答题乐观过渡、答案期间预取下一题、骨架屏与失败重试。
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
import { perQuestionBudgetSeconds } from "../generator/catalog";
import type { MaterialSpec } from "../generator/types";
import { MaterialView } from "../components/MaterialView";

type TrackId = "speed" | "sequence";
type Difficulty = "easy" | "medium" | "hard";
type BudgetClass = "tool" | "concept" | "material" | "sequence";
type RunDifficultyMeta = {
  id: Difficulty;
  label: string;
  short: string;
  description: string;
};
type TopicMeta = {
  id: string;
  track: TrackId;
  title: string;
  description: string;
  rating: 1 | 2 | 3;
  material: boolean;
  docId: string | null;
  budgetClass: BudgetClass;
  budgetsMs: Record<Difficulty, number>;
  unlockTitles: string[];
};
type CatalogData = {
  runLength: number;
  passAccuracy: number;
  difficultyRuns: RunDifficultyMeta[];
  tracks: Array<{ id: TrackId; title: string; topics: TopicMeta[] }>;
};
type ProgressItem = {
  topicId: string;
  difficulty: Difficulty;
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
    difficulty: Difficulty;
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
const DIFF_LABEL: Record<Difficulty, string> = {
  easy: "低难度",
  medium: "中难度",
  hard: "高难度 · 实战",
};
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
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [runId, setRunId] = useState<string | null>(null);
  const [items, setItems] = useState<RunItem[]>([]);
  const [current, setCurrent] = useState<QuestionData | null>(null);
  const [prefetched, setPrefetched] = useState<QuestionData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [questionStartedAt, setQuestionStartedAt] = useState(0);
  const [summary, setSummary] = useState<Grade["run"] | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const prefetching = useRef(false);

  const loadProgress = useCallback(async () => {
    const list = await api<ProgressItem[]>("/quiz/progress");
    setProgress(
      new Map(list.map((item) => [`${item.topicId}:${item.difficulty}`, item])),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api<CatalogData>("/quiz/catalog");
        if (!cancelled) setCatalog(data);
        await loadProgress();
      } catch {
        /* 空态兜底 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProgress]);

  const progressKey = (topicId: string, diff: Difficulty) => `${topicId}:${diff}`;

  const ensureQuestion = useCallback(
    async (index: number): Promise<QuestionData | null> => {
      if (!topic || !runId) return null;
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
          body: JSON.stringify({ topicId: topic.id, difficulty, runId, index }),
        });
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "题目加载失败");
        return null;
      } finally {
        setFetching(false);
      }
    },
    [difficulty, prefetched, runId, topic],
  );

  const openQuestion = useCallback((q: QuestionData | null) => {
    setCurrent(q);
    setQuestionStartedAt(Date.now());
  }, []);

  const startRun = useCallback(
    async (nextTopic: TopicMeta, nextDifficulty: Difficulty) => {
      const nextRunId = crypto.randomUUID();
      setTopic(nextTopic);
      setDifficulty(nextDifficulty);
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
          difficulty: nextDifficulty,
          runId: nextRunId,
          index: 0,
        }),
      }).catch(() => null);
      if (q) openQuestion(q);
      else setLoadError("题目加载失败，请检查网络后重试");
    },
    [openQuestion],
  );

  /** 展示答案期间预取下一题（静默失败） */
  const prefetchNext = useCallback(() => {
    const index = itemsRef.current.length;
    if (index >= 10 || prefetching.current || !topic || !runId) return;
    prefetching.current = true;
    void api<QuestionData>("/quiz/questions", {
      method: "POST",
      body: JSON.stringify({ topicId: topic.id, difficulty, runId, index }),
    })
      .then((q) => {
        if (q.index === itemsRef.current.length) setPrefetched(q);
      })
      .catch(() => undefined)
      .finally(() => {
        prefetching.current = false;
      });
  }, [difficulty, runId, topic]);

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
    const index = itemsRef.current.length;
    if (index >= 10 || !topic) return;
    const q = await ensureQuestion(index);
    openQuestion(q);
  };

  const goBackToMap = () => {
    setScreen("map");
    setTopic(null);
    void loadProgress();
  };

  if (!catalog) return <LoadingSpinner message="关卡加载中…" />;
  const answered = items.length;
  const showingAnswer = items.length > 0 && current !== null && answered === current.index + 1;
  const lastItem = showingAnswer ? items[items.length - 1] : null;

  return (
    <section className="panel">
      <p className="eyebrow">双轨闯关 · 低/中/高难度局</p>
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
            difficultyRuns={catalog.difficultyRuns}
            progressMap={progress}
            progressKey={progressKey}
            onStart={(t, d) => void startRun(t, d)}
            onDocs={(docId) => navigate(`/knowledge/${docId}`)}
            onLocked={(names) => showToast(`需先通过前置模块的高难度局：${names.join("、")}`, "info")}
          />
        </>
      )}

      {screen === "run" && topic && (
        <RunView
          topic={topic}
          difficulty={difficulty}
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
            if (itemsRef.current.length === 0) void startRun(topic, difficulty);
            else void goNext();
          }}
        />
      )}

      {screen === "result" && topic && summary && (
        <ResultView
          topic={topic}
          difficulty={difficulty}
          items={items}
          summary={summary}
          onRestart={() => void startRun(topic, difficulty)}
          onMap={goBackToMap}
        />
      )}
    </section>
  );
}

function StageMap({
  topics,
  difficultyRuns,
  progressMap,
  progressKey,
  onStart,
  onDocs,
  onLocked,
}: {
  topics: TopicMeta[];
  difficultyRuns: RunDifficultyMeta[];
  progressMap: Map<string, ProgressItem> | null;
  progressKey: (topicId: string, difficulty: Difficulty) => string;
  onStart: (topic: TopicMeta, difficulty: Difficulty) => void;
  onDocs: (docId: string) => void;
  onLocked: (unlockNames: string[]) => void;
}) {
  if (!topics.length)
    return <EmptyState icon={Calculator} title="暂无关卡" description="稍后再来看看" />;
  return (
    <Stack gap="1rem">
      <p className="muted">
        每个模块分「低 / 中 / 高」三个难度局（各 10 题）。难度越高，题干数字越复杂、选项越接近；
        <strong> 通过“高难度 · 实战”局（≥8 对且限时内）才算模块通关</strong>
        ，可解锁下一模块；低/中局用于练习与刷星，已通关模块可反复重练。
      </p>
      {topics.map((topic) => {
        const itemByDiff = (difficulty: Difficulty) =>
          progressMap?.get(progressKey(topic.id, difficulty));
        const unlocked = itemByDiff("easy")?.unlocked ?? false;
        return (
          <div className={`stage-card ${unlocked ? "" : "is-locked"}`} key={topic.id}>
            <div className="stage-card-head">
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
            <div className="difficulty-runs">
              {difficultyRuns.map((meta) => {
                const item = itemByDiff(meta.id);
                const stars = item?.stars ?? 0;
                const practice = item && item.total > 0;
                return (
                  <button
                    key={meta.id}
                    className={`run-chip d${meta.id} ${unlocked ? "" : "locked"} ${meta.id === "hard" ? "combat" : ""}`}
                    disabled={!unlocked}
                    title={meta.description}
                    onClick={() =>
                      unlocked ? onStart(topic, meta.id) : onLocked(topic.unlockTitles)
                    }
                  >
                    <span className="run-chip-label">
                      {meta.short === "高" ? "高 · 实战" : `${meta.label}`}
                    </span>
                    <span className="stars" aria-label={`${meta.label} ${stars} 星`}>
                      {Array.from({ length: 3 }, (_, i) => (
                        <Star key={i} size={13} className={i < stars ? "filled" : ""} />
                      ))}
                    </span>
                    <small>
                      <Clock size={11} /> {msText(topic.budgetsMs[meta.id])}
                    </small>
                    {practice && (
                      <small>
                        {item.total} 题 · {Math.round(item.accuracy * 100)}%
                      </small>
                    )}
                    {!unlocked && meta.id === "easy" && (
                      <small className="lock-hint">
                        <Lock size={11} /> 需先通关前置模块
                      </small>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </Stack>
  );
}

function RunView({
  topic,
  difficulty,
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
  difficulty: Difficulty;
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
  const perQuestionMs = useMemo(() => {
    if (!current || !topic) return null;
    return perQuestionBudgetSeconds(topic, current.difficulty) * 1000;
  }, [current, topic]);

  useEffect(() => {
    if (!current || showingAnswer || !perQuestionMs) {
      setSecondsLeft(null);
      return;
    }
    const tick = window.setInterval(() => {
      const left = perQuestionMs - (Date.now() - startedAt);
      setSecondsLeft(left);
    }, 250);
    return () => window.clearInterval(tick);
  }, [current?.questionId, showingAnswer, perQuestionMs, startedAt]);

  if (!current && loadError)
    return (
      <div className="explanation">
        <h3>题目加载失败</h3>
        <p>{loadError}</p>
        <Stack direction="horizontal" gap="0.75rem">
          <button className="primary" onClick={onRetry}>重试</button>
          <button className="secondary" onClick={onBack}>返回关卡地图</button>
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

  return (
    <div className="run-view">
      <div className="run-head">
        <button className="back" onClick={onBack}>
          <ArrowLeft size={16} /> 退出本局
        </button>
        <div className="run-progress">
          <span className="run-title">
            {topic.title} · {DIFF_LABEL[difficulty]} · 第 {current.index + 1}/{current.runLength} 题
            {difficulty === "hard" && topic.track === "speed" && (
              <em className="stage-material">实战材料</em>
            )}
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
                disabled={submitting || !!showingAnswer || answered !== current.index}
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
  difficulty,
  items,
  summary,
  onRestart,
  onMap,
}: {
  topic: TopicMeta;
  difficulty: Difficulty;
  items: RunItem[];
  summary: NonNullable<Grade["run"]>;
  onRestart: () => void;
  onMap: () => void;
}) {
  const stars = summary.passed ? summary.stars : 0;
  const missed = items.filter((item) => !item.grade.correct);
  const isModuleCleared = difficulty === "hard" && summary.passed;
  return (
    <div className="run-result">
      <div className="result-hero">
        {stars > 0 ? <Trophy size={44} /> : <Target size={44} />}
        <h3>{summary.passed ? "通关成功" : "本局未通过"}</h3>
        <p className="run-result-sub">
          {topic.title} · {DIFF_LABEL[difficulty]}
          {difficulty === "hard" && topic.track === "speed" && "（实战）"}
        </p>
        <div className="stars big" aria-label={`${stars} 星`}>
          {Array.from({ length: 3 }, (_, i) => (
            <Star key={i} size={36} className={i < stars ? "filled" : ""} />
          ))}
        </div>
        <p>
          答对 {summary.correct}/{summary.total} · 正确率 {Math.round(summary.accuracy * 100)}% ·
          用时 {msText(summary.durationMs)}（预算 {msText(topic.budgetsMs[difficulty])}）
        </p>
        <p className="muted">
          {summary.passed
            ? stars >= 3
              ? "满分通关，太强了！"
              : isModuleCleared
                ? "高难度 · 实战通关：本模块已通关，下一模块已解锁，也可回来刷满 3 星。"
                : "本局通过！可继续挑战更高难度或刷星。"
            : "每局答对 ≥8 题且不超过时间预算才可通过；高难度局通过即完成本模块。"}
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
          <summary>本局错题与解析（{missed.length} 题，已自动收入错题本）</summary>
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
