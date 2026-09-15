/**
 * 专项训练：资料速算 × 数字推理 双轨闯关。
 * 每个模块区分 低/中/高 三个“难度局”（各 10 题、同难度）：
 * - 难度由题干数字复杂度与选项接近程度决定；
 * - 通过本模块「高难度 · 实战」局（≥8 对且限时内）才算模块通关，解锁下一模块；
 * - 低/中局用于练习与刷星，通关关卡可反复重练。
 * 交互：答题乐观过渡、答案期间预取下一题、骨架屏与失败重试。
 * 折叠：每个轨道首次进入时默认展开“首个尚未高难通关”的模块，其余收起；此后不再自动改动，
 * 由用户的点击 / 展开全部 / 收起全部决定（口径与错题本一致）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Calculator,
  ChevronDown,
  ChevronRight,
  Clock,
  Lock,
  RotateCcw,
  Search,
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
import { openKnowledgeDoc } from "../lib/doc-link";
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
  docId: string | null;
  budgetClass: BudgetClass;
  budgetsMs: Record<Difficulty, number>;
  /** 前置模块 id（与 unlockTitles 同序），用于算出「还差哪几个没过」 */
  unlock: string[];
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
  const { showToast } = useToast();
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [progress, setProgress] = useState<Map<string, ProgressItem> | null>(null);
  const [track, setTrack] = useState<TrackId>("speed");
  const [screen, setScreen] = useState<"map" | "run" | "result">("map");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // 关卡运行状态
  const [topic, setTopic] = useState<TopicMeta | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [items, setItems] = useState<RunItem[]>([]);
  const [current, setCurrent] = useState<QuestionData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [questionStartedAt, setQuestionStartedAt] = useState(0);
  const [summary, setSummary] = useState<Grade["run"] | null>(null);
  /** 下一题是否已就绪（只用于按钮文案；真正的去重靠 questionCache） */
  const [prefetchReady, setPrefetchReady] = useState(false);
  /** 刚点下的选项：服务端判定回来之前先把选中态画出来，点下去不能「没反应」 */
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  /**
   * 同一序号的题目只请求一次（按序号缓存在途 Promise）。
   *
   * 原来用 `prefetched` 单个槽位 + `prefetching` 布尔量去重，只能防住「两次预取」，
   * 防不住「预取还没回来、用户就点下一题」：那一刻槽位还是空的，`ensureQuestion` 会为
   * 同一序号再发一个请求。服务端按「已生成题数 === 请求序号」校验，两个请求必然有一个
   * 撞成 409 RUN_STATE（题目序号不连续，请重新开始本局）。更糟的是预取结果在
   * `q.index !== itemsRef.current.length` 时被丢弃，而服务端已经插入，客户端与服务端的
   * 序号从此错位，之后每一步都 409。
   * 现在改为按序号共享同一个 Promise：撞车时拿到的是同一份题目，不会再重复生成。
   */
  const questionCache = useRef(new Map<number, Promise<QuestionData>>());
  /** 同步防连点：交卷时的 in-flight 标记（submitting 是 state，同一 tick 内挡不住第二次点击） */
  const submittingRef = useRef(false);
  /** 每题一个提交幂等键：网络重试沿用同一个 key，服务端才认得出是同一次提交 */
  const idempotencyKeys = useRef(new Map<string, string>());


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
  const stageTopics = useMemo(
    () => catalog?.tracks.find((t) => t.id === track)?.topics ?? [],
    [catalog, track],
  );

  // 默认折叠：每个轨道只在「数据就绪后的首次进入」自动展开“首个尚未高难通关”的模块，
  // 之后完全尊重用户的手动折叠（口径与错题本一致：初始化只做一次，不被后续数据刷新重置）。
  // 注意 guard 必须在写 ref 之前——否则首帧 catalog/progress 还是 null 时就把轨道记为已初始化，
  // 等数据回来再也不会展开（原实现的 bug）。
  // 合并而非覆盖：切轨道时保留另一条轨道已展开的模块，切回来时状态不丢。
  const initedTracks = useRef<Set<TrackId>>(new Set());
  useEffect(() => {
    if (initedTracks.current.has(track)) return;
    if (!catalog || !progress || stageTopics.length === 0) return;
    initedTracks.current.add(track);
    const firstNotCleared = stageTopics.find(
      (t) => (progress.get(`${t.id}:hard`)?.stars ?? 0) < 1,
    );
    setExpandedIds(
      (prev) => new Set([...prev, firstNotCleared?.id ?? stageTopics[0].id]),
    );
  }, [track, catalog, progress, stageTopics]);

  /**
   * 本局身份放在 ref 里而不是只靠 state：开局的第一次取题/预取发生在 setState 提交之前，
   * 回调闭包里读到的 runId 还是 null（实测过：第 1 题的预取就是这样被静默跳过的，
   * 于是第一题之后那一次「下一题」仍要等一个完整往返）。
   */
  const runRef = useRef<{
    runId: string;
    topicId: string;
    difficulty: Difficulty;
  } | null>(null);

  /** 取第 index 题：同序号共享在途请求，失败不缓存（允许重试） */
  const fetchQuestion = useCallback(
    (index: number): Promise<QuestionData> => {
      const run = runRef.current;
      if (!run) return Promise.reject(new Error("本局尚未开始"));
      const cached = questionCache.current.get(index);
      if (cached) return cached;
      const request = api<QuestionData>("/quiz/questions", {
        method: "POST",
        body: JSON.stringify({
          topicId: run.topicId,
          difficulty: run.difficulty,
          runId: run.runId,
          index,
        }),
      }).catch((error) => {
        questionCache.current.delete(index);
        throw error;
      });
      questionCache.current.set(index, request);
      return request;
    },
    [],
  );

  /**
   * 预取第 index 题（静默失败）。结果按序号留在 questionCache 里，用户随后点「下一题」
   * 会复用它；若用户抢在预取返回前就点了「下一题」，两次调用共享同一个在途 Promise，
   * 服务端只会收到一次序号请求。
   *
   * 触发时机是**打开当前题时**（见 openQuestion）而不是答完之后：服务端只要求
   * 「已生成题数 === 请求序号」，当前题打开时它必然已生成，所以下一题此刻就能合法预取。
   * 这样用户在读题/算题的那几秒里就把下一题拿回来了，答完直接点「下一题」不用再等一轮往返。
   */
  const prefetch = useCallback(
    (index: number) => {
      if (index >= 10 || !runRef.current) return;
      if (questionCache.current.has(index)) {
        setPrefetchReady(true);
        return;
      }
      void fetchQuestion(index)
        .then((q) => {
          if (q.index === itemsRef.current.length) setPrefetchReady(true);
        })
        .catch(() => undefined);
    },
    [fetchQuestion],
  );

  /** 取第 index 题并显示加载态（用于冷启动/失败重试/兜底） */
  const ensureQuestion = useCallback(
    async (index: number): Promise<QuestionData | null> => {
      if (!runRef.current) return null;
      // 已预取好的题不再闪一下「加载中…」
      if (!questionCache.current.has(index)) {
        setFetching(true);
        setLoadError(null);
      }
      try {
        return await fetchQuestion(index);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "题目加载失败");
        return null;
      } finally {
        setFetching(false);
      }
    },
    [fetchQuestion],
  );

  const openQuestion = useCallback(
    (q: QuestionData | null) => {
      setCurrent(q);
      setQuestionStartedAt(Date.now());
      setPrefetchReady(false);
      setPendingIndex(null);
      if (q) prefetch(q.index + 1);
    },
    [prefetch],
  );

  const startRun = useCallback(
    async (nextTopic: TopicMeta, nextDifficulty: Difficulty) => {
      const nextRunId = crypto.randomUUID();
      setTopic(nextTopic);
      setDifficulty(nextDifficulty);
      setItems([]);
      setSummary(null);
      setSubmitting(false);
      setLoadError(null);
      setCurrent(null);
      setPendingIndex(null);
      questionCache.current.clear();
      idempotencyKeys.current.clear();
      submittingRef.current = false;
      // 先登记本局身份：后面的取题与预取都读 runRef，避免踩 setState 还没提交的空档
      runRef.current = {
        runId: nextRunId,
        topicId: nextTopic.id,
        difficulty: nextDifficulty,
      };
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

  /** 答完一题后再补一次预取：正常情况是缓存命中（不做请求），只在之前的预取失败时重试 */
  useEffect(() => {
    if (screen === "run" && items.length > 0 && !summary) prefetch(items.length);
  }, [screen, items.length, summary, prefetch]);

  const answer = async (selectedIndex: number) => {
    // 用 ref 兜同步连点：submitting 是 state，同一 tick 里的两次点击都会看到 false，
    // 会发出两个不同 idempotencyKey 的提交，后一个被服务端判为该题已提交。
    if (!current || submittingRef.current || items.length !== current.index) return;
    const elapsedMs = Math.max(0, Date.now() - questionStartedAt);
    const questionId = current.questionId;
    const idempotencyKey =
      idempotencyKeys.current.get(questionId) ?? crypto.randomUUID();
    idempotencyKeys.current.set(questionId, idempotencyKey);
    submittingRef.current = true;
    setPendingIndex(selectedIndex);
    setSubmitting(true);
    try {
      const grade = await api<Grade>("/quiz/answers", {
        method: "POST",
        body: JSON.stringify({
          questionId,
          selectedIndex,
          elapsedMs,
          idempotencyKey,
        }),
      });
      idempotencyKeys.current.delete(questionId);
      const nextItems = [...itemsRef.current, { q: current, selectedIndex, grade }];
      setItems(nextItems);
      setPendingIndex(null);
      if (grade.run?.finished) {
        setSummary(grade.run);
        setScreen("result");
        void loadProgress();
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "提交失败，请重试", "error");
      setPendingIndex(null);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
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
    // 本局作废：清掉身份与已预取的题，避免退出后还有零星请求打进来
    runRef.current = null;
    questionCache.current.clear();
    idempotencyKeys.current.clear();
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
            topics={stageTopics}
            difficultyRuns={catalog.difficultyRuns}
            progressMap={progress}
            progressKey={progressKey}
            expandedIds={expandedIds}
            onToggle={(id) =>
              setExpandedIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onExpandAll={() => setExpandedIds(new Set(stageTopics.map((t) => t.id)))}
            onCollapseAll={() => setExpandedIds(new Set())}
            onStart={(t, d) => void startRun(t, d)}
            onDocs={(docId) => openKnowledgeDoc(docId)}
            onLocked={(names) =>
              showToast(
                names.length
                  ? `需先通过前置模块的高难度局（实战）：${names.join("、")}`
                  : "需先通过前置模块的高难度局（实战）",
                "info",
              )
            }
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
          pickedIndex={lastItem?.selectedIndex ?? pendingIndex}
          submitting={submitting}
          fetching={fetching}
          loadError={loadError}
          prefetchReady={prefetchReady}
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
  expandedIds,
  onToggle,
  onExpandAll,
  onCollapseAll,
  onStart,
  onDocs,
  onLocked,
}: {
  topics: TopicMeta[];
  difficultyRuns: RunDifficultyMeta[];
  progressMap: Map<string, ProgressItem> | null;
  progressKey: (topicId: string, difficulty: Difficulty) => string;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onStart: (topic: TopicMeta, difficulty: Difficulty) => void;
  onDocs: (docId: string) => void;
  onLocked: (unlockNames: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [onlyUndone, setOnlyUndone] = useState(false);
  /**
   * 还差哪些前置模块没过：前置里「高难度 · 实战」局尚未通关的那些，按 unlock 顺序给出标题。
   * 已通过的不再列出——锁着的时候真正要补的就是这几关。progress 还没拿到时退回全部前置，
   * 不能凭「拿不到进度」就把要求说成「无」。
   */
  const lockedPrereqTitles = (topic: TopicMeta): string[] => {
    if (!progressMap) return topic.unlockTitles;
    return topic.unlock
      .map((prereqId, index) => ({ prereqId, title: topic.unlockTitles[index] }))
      .filter(
        ({ prereqId }) =>
          (progressMap.get(progressKey(prereqId, "hard"))?.stars ?? 0) < 1,
      )
      .map(({ title }) => title)
      .filter((title): title is string => Boolean(title));
  };
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("zh-CN");
    return topics.filter((topic) => {
      if (q && !`${topic.title} ${topic.description} ${topic.unlockTitles.join(" ")}`
        .toLocaleLowerCase("zh-CN")
        .includes(q)) return false;
      if (onlyUndone) {
        const cleared =
          (progressMap?.get(progressKey(topic.id, "hard"))?.stars ?? 0) >= 1;
        if (cleared) return false;
      }
      return true;
    });
  }, [topics, query, onlyUndone, progressMap, progressKey]);

  if (!topics.length)
    return <EmptyState icon={Calculator} title="暂无关卡" description="稍后再来看看" />;
  return (
    <Stack gap="1rem">
      <div className="map-toolbar">
        <div className="map-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索模块名称…"
          />
        </div>
        <label className="map-undone-toggle">
          <input
            type="checkbox"
            checked={onlyUndone}
            onChange={(event) => setOnlyUndone(event.target.checked)}
          />
          仅看未通关
        </label>
        <button className="secondary map-collapse-btn" onClick={onCollapseAll}>
          收起全部
        </button>
        <button className="secondary map-collapse-btn" onClick={onExpandAll}>
          展开全部
        </button>
      </div>
      <p className="muted">
        点击模块展开“低 / 中 / 高”三个难度局（默认只展开首个未通关的模块）；难度越高，题干数字越复杂、选项越接近。
        <strong> 通过“高难度 · 实战”局（≥8 对且限时内）才算模块通关</strong>，可解锁下一模块。
      </p>
      {visible.length === 0 && (
        <EmptyState
          icon={Search}
          title="没有匹配的模块"
          description="试试清空搜索或切换筛选条件"
        />
      )}
      {visible.map((topic) => {
        const itemByDiff = (difficulty: Difficulty) =>
          progressMap?.get(progressKey(topic.id, difficulty));
        const unlocked = itemByDiff("easy")?.unlocked ?? false;
        const needTitles = unlocked ? [] : lockedPrereqTitles(topic);
        const isExpanded = expandedIds.has(topic.id);
        const clearedHard = (itemByDiff("hard")?.stars ?? 0) >= 1;
        return (
          <div
            className={`stage-card ${unlocked ? "" : "is-locked"} ${isExpanded ? "is-open" : ""}`}
            key={topic.id}
          >
            <button
              className="stage-card-head"
              aria-expanded={isExpanded}
              onClick={() => onToggle(topic.id)}
            >
              <span className={`stage-badge r${topic.rating}`}>
                {RATING_LABEL[topic.rating]}
              </span>
              <span className="stage-text">
                <strong>
                  {topic.title}
                  {unlocked && clearedHard && (
                    <em className="stage-done">已通关</em>
                  )}
                  {/* 折叠时不展开也能看到卡在哪：展开后由难度局上的提示承担，不重复 */}
                  {!unlocked && !isExpanded && needTitles.length > 0 && (
                    <em className="stage-lock" title={`需先通关：${needTitles.join("、")}`}>
                      <Lock size={10} /> 需先通关：{needTitles.join("、")}
                    </em>
                  )}
                </strong>
                <small>{topic.description || "逐题闯关"}</small>
              </span>
              <span className="stage-mini-stars">
                {difficultyRuns.map((meta) => {
                  const stars = itemByDiff(meta.id)?.stars ?? 0;
                  return (
                    <span
                      className={`mini-run d${meta.id}`}
                      key={meta.id}
                      title={`${meta.label} ${stars} 星`}
                    >
                      {stars > 0 ? (
                        <span className="stars" aria-label={`${stars} 星`}>
                          {Array.from({ length: stars }, (_, i) => (
                            <Star key={i} size={11} className="filled" />
                          ))}
                        </span>
                      ) : (
                        <span className="mini-empty">{meta.short}</span>
                      )}
                    </span>
                  );
                })}
              </span>
              <span className="stage-arrow">
                {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </span>
              {topic.docId && (
                <span
                  className="stage-doc"
                  role="button"
                  title="查看知识讲解"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDocs(topic.docId as string);
                  }}
                >
                  <BookOpen size={15} />
                </span>
              )}
            </button>
            {isExpanded && (
              <div className="difficulty-runs">
                {difficultyRuns.map((meta) => {
                  const item = itemByDiff(meta.id);
                  const stars = item?.stars ?? 0;
                  const practice = item && item.total > 0;
                  return (
                    <button
                      key={meta.id}
                      className={`run-chip d${meta.id} ${unlocked ? "" : "locked"} ${meta.id === "hard" ? "combat" : ""}`}
                      // 锁定时不禁用：点一下会提示要先通关哪几个模块（禁用的按钮不派发 click，
                      // 提示就永远看不到）。外观仍由 .locked 的透明度与 not-allowed 光标体现。
                      aria-disabled={!unlocked}
                      title={unlocked ? meta.description : `需先通关：${needTitles.join("、")}`}
                      onClick={() =>
                        unlocked ? onStart(topic, meta.id) : onLocked(needTitles)
                      }
                    >
                      <span className="run-chip-label">
                        {meta.short === "高" ? "高 · 实战" : meta.label}
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
                      {!unlocked && meta.id === "easy" && needTitles.length > 0 && (
                        <small className="lock-hint" title={`需先通关：${needTitles.join("、")}`}>
                          <Lock size={11} /> 需先通关：{needTitles.join("、")}
                        </small>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
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
  pickedIndex,
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
  /** 当前选中的选项：判定回来前就是刚点下的那个（即时反馈），回来后以服务端结果为准 */
  pickedIndex: number | null;
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
            const isPicked = pickedIndex === index;
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
