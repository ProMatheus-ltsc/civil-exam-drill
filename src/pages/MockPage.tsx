import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileBarChart,
  Play,
  Share2,
  Target,
  Timer,
  Trophy,
  XCircle,
} from "lucide-react";
import { EmptyState } from "@shared/core/components/EmptyState";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import { ResponsiveGrid } from "@shared/core/components/responsive/ResponsiveGrid";
import { Stack } from "@shared/core/components/responsive/Stack";
import { StatCard } from "@shared/core/components/stats/StatCard";
import { useToast } from "@shared/core/hooks/useToast";
import { api } from "../api/client";
import { MaterialView } from "../components/MaterialView";
import { PublicLayout } from "../components/PublicLayout";
import { ProgressRing } from "../components/ProfileCharts";
import type { MaterialSpec } from "../generator/types";

type MockDifficulty = "easy" | "medium" | "hard";

type MockQuestion = {
  id: string;
  position: number;
  topicId: string;
  topicTitle: string;
  difficulty: MockDifficulty;
  stem: string;
  options: string[];
  material: MaterialSpec | null;
  selectedIndex: number | null;
};

type MockListItem = {
  id: string;
  status: "active" | "submitted";
  questionCount: number;
  limitMs: number;
  startedAt: string;
  submittedAt: string | null;
  durationMs: number;
  correctCount: number | null;
  score: number | null;
  shareToken: string | null;
  remainingMs: number;
};

type MockListResponse = { items: MockListItem[]; active: MockListItem | null };

type MockExam = {
  id: string;
  status: "active" | "submitted";
  questionCount: number;
  limitMs: number;
  startedAt: string;
  remainingMs: number;
  questions: MockQuestion[];
};

type MockTopicStat = {
  topicId: string;
  title: string;
  total: number;
  correct: number;
  accuracy: number;
  averageMs: number;
};

type MockReportQuestion = MockQuestion & {
  answerIndex: number;
  explanation: string;
  correct: boolean;
  elapsedMs: number;
};

export type MockReport = {
  id: string;
  status: "submitted";
  nickname: string;
  score: number;
  correctCount: number;
  questionCount: number;
  accuracy: number;
  durationMs: number;
  limitMs: number;
  startedAt: string;
  submittedAt: string | null;
  shareToken: string | null;
  byTopic: MockTopicStat[];
  weakTopics: MockTopicStat[];
  focusTopics: MockTopicStat[];
  slowestTopic: MockTopicStat | null;
  comparison: {
    attemptCount: number;
    bestScore: number;
    previousScore: number | null;
    deltaScore: number | null;
  };
  questions: MockReportQuestion[] | null;
};

const MOCK_TOPIC_NOTES: Record<string, string> = {
  "formula-growth-rate": "由基期与现期还原同比增速",
  "formula-growth-amount": "现期 × r ÷ (1+r) 求增量",
  "formula-base-amount": "现期 ÷ (1+r) 还原基期",
  "formula-base-ratio": "分子分母各自还原到基期",
  "formula-average-basic": "总量 ÷ 份数，分清比重与平均",
};

const DIFFICULTY_LABEL: Record<MockDifficulty, string> = {
  easy: "低难度",
  medium: "中难度",
  hard: "高难度",
};

const fmtDuration = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const fmtDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const scoreColor = (score: number) =>
  score >= 85 ? "#2f7d5d" : score >= 70 ? "#bb623a" : "#b94a3d";

export function MockPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [data, setData] = useState<MockListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<MockListResponse>("/mock/exams")
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "模考数据加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const start = async () => {
    if (data?.active) {
      const keepGoing = window.confirm(
        "还有一场模考未交卷。开始新模考后，旧场次仍会保留，可在列表中继续。确定开始新一场吗？",
      );
      if (!keepGoing) return;
    }
    setStarting(true);
    try {
      const result = await api<{ examId: string }>("/mock/exams", {
        method: "POST",
      });
      navigate(`/mock/${result.examId}`);
    } catch (cause) {
      showToast(
        cause instanceof Error ? cause.message : "模考创建失败，请稍后再试",
        "error",
      );
      setStarting(false);
    }
  };

  if (loading) return <LoadingSpinner message="模考数据加载中…" />;
  if (error)
    return (
      <section className="panel">
        <EmptyState
          icon={FileBarChart}
          title="模考暂时不可用"
          description={error}
        />
      </section>
    );

  const items = data?.items ?? [];
  const submitted = items.filter((item) => item.status === "submitted");
  const bestScore = submitted.reduce(
    (best, item) => Math.max(best, item.score ?? 0),
    0,
  );
  return (
    <Stack gap="1.5rem">
      <section className="panel mock-intro">
        <div className="mock-intro-head">
          <div>
            <p className="eyebrow">限时模考 · 资料分析</p>
            <h2>30 分钟，测一次真实水平</h2>
            <p className="muted">
              20 道资料分析列式题，覆盖增长率、增长量、基期量、基期比重和平均数。
              交卷即出分数、正确率、用时和分题型报告。
            </p>
          </div>
          <div className="mock-intro-action">
            <button
              className="primary touch-target"
              disabled={starting}
              onClick={() => void start()}
            >
              <Play size={16} />
              {starting ? "正在组卷…" : "开始模考"}
            </button>
            <span className="muted">交卷后可生成分享链接</span>
          </div>
        </div>
        <ResponsiveGrid minItemWidth="130px" gap="0.75rem">
          <StatCard label="题量" value="20 题" />
          <StatCard label="限时" value="30 分钟" />
          <StatCard label="题型" value="5 类" />
          <StatCard label="难度" value="中 / 高" />
        </ResponsiveGrid>
        <div className="mock-topic-grid">
          {Object.entries(MOCK_TOPIC_NOTES).map(([topicId, note]) => (
            <div className="mock-topic-note" key={topicId}>
              <strong>
                {topicId === "formula-growth-rate"
                  ? "增长率"
                  : topicId === "formula-growth-amount"
                    ? "增长量"
                    : topicId === "formula-base-amount"
                      ? "基期量"
                      : topicId === "formula-base-ratio"
                        ? "基期比重"
                        : "平均数基础"}
              </strong>
              <span>{note}</span>
              <em>4 题</em>
            </div>
          ))}
        </div>
        {data?.active && (
          <button
            className="mock-active-banner"
            onClick={() => navigate(`/mock/${data.active?.id}`)}
          >
            <Clock size={17} />
            <span>
              <strong>有一场模考还在进行</strong>
              <small>
                剩余 {fmtDuration(data.active.remainingMs)} · 点击继续作答
              </small>
            </span>
            <ArrowRight size={16} />
          </button>
        )}
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">历史模考</h3>
          <span className="muted">
            {submitted.length
              ? `${submitted.length} 次已交卷 · 最佳 ${bestScore} 分`
              : "还没有交卷记录"}
          </span>
        </div>
        {items.length ? (
          <div className="mock-history">
            {items.map((item) => (
              <button
                className="mock-history-item"
                key={item.id}
                onClick={() =>
                  navigate(
                    item.status === "submitted"
                      ? `/mock/${item.id}/report`
                      : `/mock/${item.id}`,
                  )
                }
              >
                <span
                  className={`mock-history-score ${item.status === "active" ? "is-active" : ""}`}
                  style={
                    item.status === "submitted"
                      ? { color: scoreColor(item.score ?? 0) }
                      : undefined
                  }
                >
                  {item.status === "submitted"
                    ? `${item.score} 分`
                    : "进行中"}
                </span>
                <span className="mock-history-text">
                  <strong>{fmtDate(item.startedAt)}</strong>
                  <small>
                    {item.status === "submitted"
                      ? `答对 ${item.correctCount}/${item.questionCount} · 用时 ${fmtDuration(item.durationMs)}`
                      : `剩余 ${fmtDuration(item.remainingMs)} · 点击继续`}
                  </small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FileBarChart}
            title="还没有模考记录"
            description="开始第一场，交卷后这里会保留成绩与报告"
          />
        )}
      </section>
    </Stack>
  );
}

export function MockRunPage() {
  const { examId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [exam, setExam] = useState<MockExam | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [remainingMs, setRemainingMs] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const autoSubmitTried = useRef(false);
  const questionOpenedAt = useRef(Date.now());
  const timeSpent = useRef(new Map<string, number>());

  const submit = useCallback(
    async (auto = false) => {
      if (!examId || submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      try {
        await api(`/mock/exams/${examId}/submit`, { method: "POST" });
        showToast(auto ? "时间到，已自动交卷" : "交卷成功，报告已生成", "success");
        navigate(`/mock/${examId}/report`, { replace: true });
      } catch (cause) {
        submittingRef.current = false;
        setSubmitting(false);
        showToast(
          cause instanceof Error ? cause.message : "交卷失败，请重试",
          "error",
        );
      }
    },
    [examId, navigate, showToast],
  );

  useEffect(() => {
    if (!examId) return;
    let cancelled = false;
    api<MockExam>(`/mock/exams/${examId}`)
      .then((data) => {
        if (cancelled) return;
        if (data.status === "submitted") {
          navigate(`/mock/${examId}/report`, { replace: true });
          return;
        }
        const restored: Record<string, number> = {};
        for (const question of data.questions)
          if (question.selectedIndex !== null)
            restored[question.id] = question.selectedIndex;
        setExam(data);
        setAnswers(restored);
        setRemainingMs(data.remainingMs);
        questionOpenedAt.current = Date.now();
      })
      .catch((cause) => {
        if (!cancelled)
          setLoadError(
            cause instanceof Error ? cause.message : "模考加载失败",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [examId, navigate]);

  useEffect(() => {
    if (!exam) return;
    const deadline = Date.parse(exam.startedAt) + exam.limitMs;
    const tick = () => setRemainingMs(Math.max(0, deadline - Date.now()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [exam]);

  useEffect(() => {
    if (!exam || submitting || remainingMs > 0 || autoSubmitTried.current)
      return;
    autoSubmitTried.current = true;
    void submit(true);
  }, [exam, remainingMs, submitting, submit]);

  const moveTo = (next: number) => {
    const currentQuestion = exam?.questions[index];
    if (currentQuestion) {
      const now = Date.now();
      const spent =
        (timeSpent.current.get(currentQuestion.id) ?? 0) +
        Math.max(0, now - questionOpenedAt.current);
      timeSpent.current.set(currentQuestion.id, spent);
      questionOpenedAt.current = now;
      const selected = answers[currentQuestion.id];
      if (selected !== undefined && examId)
        void api(`/mock/exams/${examId}/answers`, {
          method: "POST",
          body: JSON.stringify({
            questionId: currentQuestion.id,
            selectedIndex: selected,
            elapsedMs: Math.min(exam.limitMs, Math.round(spent)),
          }),
        }).catch(() => undefined);
    }
    setIndex(Math.max(0, Math.min((exam?.questions.length ?? 1) - 1, next)));
  };

  const choose = (question: MockQuestion, option: number) => {
    if (!exam || !examId || submitting) return;
    setAnswers((previous) => ({ ...previous, [question.id]: option }));
    const now = Date.now();
    const spent =
      (timeSpent.current.get(question.id) ?? 0) +
      Math.max(0, now - questionOpenedAt.current);
    timeSpent.current.set(question.id, spent);
    questionOpenedAt.current = now;
    void api(`/mock/exams/${examId}/answers`, {
      method: "POST",
      body: JSON.stringify({
        questionId: question.id,
        selectedIndex: option,
        elapsedMs: Math.min(exam.limitMs, Math.round(spent)),
      }),
    }).catch(() => undefined);
  };

  const requestSubmit = () => {
    if (!exam) return;
    const answeredCount = exam.questions.filter(
      (question) => answers[question.id] !== undefined,
    ).length;
    const unanswered = exam.questionCount - answeredCount;
    if (
      unanswered > 0 &&
      !window.confirm(`还有 ${unanswered} 题未作答，确定交卷吗？`)
    )
      return;
    void submit();
  };

  if (loading) return <LoadingSpinner message="模考试卷加载中…" />;
  if (loadError)
    return (
      <section className="panel">
        <EmptyState
          icon={FileBarChart}
          title="试卷加载失败"
          description={loadError}
        />
        <Link className="secondary" to="/mock">
          返回模考首页
        </Link>
      </section>
    );
  if (!exam) return null;
  const question = exam.questions[index];
  if (!question) return null;
  const answeredCount = exam.questions.filter(
    (item) => answers[item.id] !== undefined,
  ).length;
  const urgent = remainingMs <= 5 * 60 * 1000;
  return (
    <section className="panel mock-run">
      <div className="mock-run-head">
        <button className="back" onClick={() => navigate("/mock")}>
          <ArrowLeft size={15} /> 退出模考
        </button>
        <div className={`mock-timer ${urgent ? "is-urgent" : ""}`}>
          <Clock size={16} />
          <strong>{fmtDuration(remainingMs)}</strong>
          <span>剩余</span>
        </div>
      </div>
      <div className="mock-progress-line" aria-hidden="true">
        <i style={{ width: `${(answeredCount / exam.questionCount) * 100}%` }} />
      </div>
      <div className="mock-run-grid">
        <div>
          <article className="mock-question">
            <div className="mock-question-meta">
              <span>第 {index + 1} / {exam.questionCount} 题</span>
              <span>{question.topicTitle}</span>
              <span>{DIFFICULTY_LABEL[question.difficulty]}</span>
            </div>
            <h3>{question.stem}</h3>
            <MaterialView material={question.material} />
            <div className="mock-options">
              {question.options.map((option, optionIndex) => {
                const selected = answers[question.id] === optionIndex;
                return (
                  <button
                    key={option}
                    className={selected ? "selected" : ""}
                    disabled={submitting}
                    onClick={() => choose(question, optionIndex)}
                  >
                    <span>{String.fromCharCode(65 + optionIndex)}</span>
                    {option}
                  </button>
                );
              })}
            </div>
          </article>
          <div className="mock-nav">
            <button
              className="secondary"
              disabled={index === 0}
              onClick={() => moveTo(index - 1)}
            >
              上一题
            </button>
            {index < exam.questions.length - 1 ? (
              <button className="primary" onClick={() => moveTo(index + 1)}>
                下一题 <ArrowRight size={15} />
              </button>
            ) : (
              <button
                className="primary"
                disabled={submitting}
                onClick={requestSubmit}
              >
                {submitting ? "交卷中…" : "交卷并查看报告"}
              </button>
            )}
          </div>
        </div>
        <aside className="mock-sheet">
          <div className="mock-sheet-head">
            <h4>答题卡</h4>
            <span className="muted">
              {answeredCount}/{exam.questionCount}
            </span>
          </div>
          <div className="mock-sheet-grid">
            {exam.questions.map((item, itemIndex) => {
              const answered = answers[item.id] !== undefined;
              return (
                <button
                  key={item.id}
                  className={`${answered ? "answered" : ""} ${itemIndex === index ? "current" : ""}`}
                  onClick={() => moveTo(itemIndex)}
                >
                  {itemIndex + 1}
                </button>
              );
            })}
          </div>
          <div className="mock-sheet-legend">
            <span><i className="answered" />已答</span>
            <span><i />未答</span>
            <span><i className="current" />当前</span>
          </div>
          <button
            className="primary mock-submit"
            disabled={submitting}
            onClick={requestSubmit}
          >
            <Trophy size={15} />
            {submitting ? "交卷中…" : "交卷"}
          </button>
          <p className="muted hint-line">
            中途退出不会清空已选答案，30 分钟内可回来继续。
          </p>
        </aside>
      </div>
    </section>
  );
}

function MockReportView({
  report,
  publicView = false,
}: {
  report: MockReport;
  publicView?: boolean;
}) {
  const { showToast } = useToast();
  const delta = report.comparison.deltaScore;
  const share = async () => {
    if (!report.shareToken) return;
    const url = `${window.location.href.split("#")[0]}#/mock/report/${report.shareToken}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "资料分析模考成绩",
          text: `我在 30 分钟资料分析模考中得了 ${report.score} 分，来看看错在哪。`,
          url,
        });
        return;
      } catch {
        // 用户取消分享或不支持时退回复制链接
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast("分享链接已复制", "success");
    } catch {
      showToast(url, "info");
    }
  };
  return (
    <Stack gap="1.5rem">
      <section className="panel mock-report-hero">
        <div className="mock-report-title">
          <p className="eyebrow">资料分析模考 · 成绩报告</p>
          <h2>
            {publicView
              ? `${report.nickname}的模考成绩`
              : "本次模考成绩"}
          </h2>
          <p className="muted">
            {fmtDate(report.submittedAt)} 交卷 · 用时{" "}
            {fmtDuration(report.durationMs)} / {fmtDuration(report.limitMs)}
          </p>
        </div>
        <div className="mock-score-row">
          <ProgressRing
            ratio={report.score / 100}
            value={String(report.score)}
            label="得分"
            size={142}
            stroke={12}
            color={scoreColor(report.score)}
          />
          <ResponsiveGrid minItemWidth="130px" gap="0.75rem">
            <StatCard
              label="答对"
              value={`${report.correctCount}/${report.questionCount}`}
            />
            <StatCard
              label="正确率"
              value={`${Math.round(report.accuracy * 100)}%`}
            />
            <StatCard label="用时" value={fmtDuration(report.durationMs)} />
            <StatCard
              label="历史最佳"
              value={`${report.comparison.bestScore} 分`}
            />
          </ResponsiveGrid>
        </div>
        <div className="mock-compare">
          {delta === null ? (
            <>
              <Target size={16} />
              这是你的第 {report.comparison.attemptCount} 次模考
              {report.comparison.attemptCount === 1
                ? "，先记录一个基准成绩"
                : ""}
            </>
          ) : delta > 0 ? (
            <>
              <Trophy size={16} />
              比上次提高 {delta} 分，继续保持
            </>
          ) : delta < 0 ? (
            <>
              <Target size={16} />
              比上次下降 {-delta} 分，优先补强下面标注的题型
            </>
          ) : (
            <>
              <Target size={16} />
              与上次持平，下一步重点压用时
            </>
          )}
          {report.comparison.previousScore !== null && (
            <span className="muted">
              上次 {report.comparison.previousScore} 分
            </span>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3 className="section-title">分题型表现</h3>
          <span className="muted">正确率越低越需要优先补</span>
        </div>
        <div className="mock-topic-list">
          {report.byTopic.map((item) => (
            <div className="mock-topic-row" key={item.topicId}>
              <div className="mock-topic-label">
                <strong>{item.title}</strong>
                <span>
                  {item.correct}/{item.total} 题 · 平均{" "}
                  {Math.round(item.averageMs / 1000)}s
                </span>
              </div>
              <div className="mock-topic-bar">
                <i
                  style={{
                    width: `${Math.max(4, item.accuracy * 100)}%`,
                    background:
                      item.accuracy >= 0.8
                        ? "#2f7d5d"
                        : item.accuracy >= 0.6
                          ? "#bb623a"
                          : "#b94a3d",
                  }}
                />
              </div>
              <em>{Math.round(item.accuracy * 100)}%</em>
            </div>
          ))}
        </div>
      </section>

      <section className="panel mock-focus">
        <div className="section-head">
          <h3 className="section-title">优先补强</h3>
          <span className="muted">按本次正确率排序</span>
        </div>
        {report.weakTopics.length ? (
          <div className="mock-focus-list">
            {report.weakTopics.map((item) => (
              <div className="mock-focus-item" key={item.topicId}>
                <span>
                  <XCircle size={16} />
                  <strong>{item.title}</strong>
                  <em>{Math.round(item.accuracy * 100)}%</em>
                </span>
                {!publicView && (
                  <Link
                    className="secondary"
                    to={`/quiz?topic=${encodeURIComponent(item.topicId)}`}
                  >
                    去补强 <ArrowRight size={14} />
                  </Link>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="good-hint">
            五类题型正确率都在 60% 以上，没有明显短板。
          </p>
        )}
        {report.slowestTopic && (
          <p className="muted hint-line">
            <Clock size={14} /> 平均用时最长：{report.slowestTopic.title}（
            {Math.round(report.slowestTopic.averageMs / 1000)} 秒/题），
            可以用限时关卡继续压缩时间。
          </p>
        )}
      </section>

      {!publicView && report.questions && (
        <section className="panel">
          <div className="section-head">
            <h3 className="section-title">逐题回顾</h3>
            <span className="muted">
              点击题目展开答案与解析
            </span>
          </div>
          <div className="mock-review-list">
            {report.questions.map((item) => (
              <details
                className={`mock-review ${item.correct ? "ok" : "no"}`}
                key={item.id}
              >
                <summary>
                  <span className="mock-review-index">{item.position + 1}</span>
                  <strong>{item.topicTitle}</strong>
                  <em>
                    {item.correct ? (
                      <>
                        <CheckCircle2 size={14} /> 正确
                      </>
                    ) : (
                      <>
                        <XCircle size={14} /> 错误
                      </>
                    )}
                  </em>
                </summary>
                <div className="mock-review-body">
                  <p>{item.stem}</p>
                  <MaterialView material={item.material} />
                  <div className="options">
                    {item.options.map((option, optionIndex) => (
                      <div
                        key={option}
                        className={`mock-review-option ${optionIndex === item.answerIndex ? "correct" : ""} ${optionIndex === item.selectedIndex && optionIndex !== item.answerIndex ? "wrong" : ""}`}
                      >
                        <span>{String.fromCharCode(65 + optionIndex)}</span>
                        {option}
                      </div>
                    ))}
                  </div>
                  <p className="muted">
                    {item.selectedIndex === null
                      ? "本题未作答。"
                      : `你的选择：${String.fromCharCode(65 + item.selectedIndex)}。`}
                    {item.explanation}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      <div className="mock-report-actions">
        {publicView ? (
          <>
            <Link className="primary" to="/register">
              免费注册，测一次自己的水平 <ArrowRight size={15} />
            </Link>
            <Link className="secondary" to="/try">
              先试试 3 道免费题
            </Link>
          </>
        ) : (
          <>
            <button className="primary" onClick={() => void share()}>
              <Share2 size={15} /> 分享成绩
            </button>
            <Link className="secondary" to="/mock">
              再考一次
            </Link>
            {report.weakTopics[0] && (
              <Link
                className="secondary"
                to={`/quiz?topic=${encodeURIComponent(report.weakTopics[0].topicId)}`}
              >
                去补最弱项
              </Link>
            )}
          </>
        )}
      </div>
    </Stack>
  );
}

export function MockReportPage() {
  const { examId } = useParams();
  const [report, setReport] = useState<MockReport | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!examId) return;
    let cancelled = false;
    api<MockReport>(`/mock/exams/${examId}/report`)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : "成绩报告加载失败",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [examId]);
  if (error)
    return (
      <section className="panel">
        <EmptyState
          icon={FileBarChart}
          title="报告暂时不可用"
          description={error}
        />
        <Link className="secondary" to="/mock">
          返回模考首页
        </Link>
      </section>
    );
  if (!report) return <LoadingSpinner message="成绩报告加载中…" />;
  return <MockReportView report={report} />;
}

export function MockSharedReportPage() {
  const { token } = useParams();
  const [report, setReport] = useState<MockReport | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<MockReport>(`/mock/reports/${token}`)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : "分享链接无效或已失效",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [token]);
  return (
    <PublicLayout>
      <main className="public-tool-page">
        {error ? (
          <section className="panel">
            <EmptyState
              icon={FileBarChart}
              title="分享链接无效"
              description={error}
            />
            <Link className="secondary" to="/">
              返回首页
            </Link>
          </section>
        ) : report ? (
          <MockReportView report={report} publicView />
        ) : (
          <LoadingSpinner message="成绩报告加载中…" />
        )}
      </main>
    </PublicLayout>
  );
}
