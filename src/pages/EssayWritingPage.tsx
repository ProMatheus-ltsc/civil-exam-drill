import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  History,
  MessageCircle,
  PenLine,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import { useToast } from "@shared/core/hooks/useToast";
import { api } from "../api/client";
import { CommunityModal } from "../components/CommunityModal";
import { WRITING_PROMPTS } from "../essay/writing";
import type { WritingDimension, WritingGrade } from "../essay/writing";

type SubmissionDetail = WritingGrade & {
  id: string;
  promptId: string;
  promptTitle: string;
  title: string;
  content: string;
  createdAt: string;
};

type SubmissionItem = {
  id: string;
  promptId: string;
  promptTitle: string;
  title: string;
  wordCount: number;
  score: number;
  grade: string;
  createdAt: string;
};

const countChars = (text: string) =>
  (text.match(/[\u4e00-\u9fa5]|[a-zA-Z0-9]/g) ?? []).length;

const scoreColor = (score: number) =>
  score >= 85 ? "#2f7b5f" : score >= 70 ? "#a96b22" : score >= 55 ? "#bb623a" : "#a33b3b";

function formatDate(raw: string) {
  const time = Date.parse(raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`);
  if (Number.isNaN(time)) return raw.slice(0, 16);
  return new Date(time).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DimensionBars({ dimensions }: { dimensions: WritingDimension[] }) {
  return (
    <div className="writing-dimensions">
      {dimensions.map((dimension) => (
        <div key={dimension.id} className="writing-dimension">
          <div className="writing-dimension-head">
            <span>{dimension.label}</span>
            <strong>
              {dimension.score}
              <small>/{dimension.max}</small>
            </strong>
          </div>
          <div className="writing-dimension-track">
            <i
              style={{
                width: `${Math.round((dimension.score / dimension.max) * 100)}%`,
                background: scoreColor((dimension.score / dimension.max) * 100),
              }}
            />
          </div>
          <p>{dimension.comment}</p>
        </div>
      ))}
    </div>
  );
}

function GradeReport({
  detail,
  onRewrite,
  onHumanReview,
}: {
  detail: SubmissionDetail;
  onRewrite: () => void;
  onHumanReview: () => void;
}) {
  return (
    <div className="writing-report">
      <div className="writing-report-head">
        <div>
          <p className="eyebrow">整篇批改报告</p>
          <h2>{detail.title}</h2>
          <p className="muted">
            {detail.promptTitle} · {detail.wordCount} 字 · {formatDate(detail.createdAt)}
          </p>
        </div>
        <div className="writing-score" style={{ color: scoreColor(detail.score) }}>
          <strong>{detail.score}</strong>
          <span>{detail.grade}</span>
        </div>
      </div>

      <p className="writing-summary">{detail.summary}</p>
      <p className="writing-disclaimer">
        规则评分用于练习反馈，不等同于真实阅卷分数。
      </p>

      <DimensionBars dimensions={detail.dimensions} />

      <section className="writing-block">
        <h3>关键词覆盖</h3>
        <div className="writing-keywords">
          {detail.matchedKeywords.map((word) => (
            <span key={word} className="hit">
              <CheckCircle2 size={13} /> {word}
            </span>
          ))}
          {detail.missingKeywords.map((word) => (
            <span key={word} className="miss">
              {word}
            </span>
          ))}
        </div>
      </section>

      {detail.issues.length > 0 && (
        <section className="writing-block">
          <h3>
            <TriangleAlert size={16} /> 需要优先修正
          </h3>
          <ul className="writing-issue-list">
            {detail.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="writing-block">
        <h3>
          <Sparkles size={16} /> 下一步建议
        </h3>
        <ul className="writing-suggestion-list">
          {detail.suggestions.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
      </section>

      <section className="writing-block">
        <h3>
          <FileText size={16} /> 逐段点评
        </h3>
        <div className="writing-paragraphs">
          {detail.paragraphs.map((paragraph) => (
            <article
              key={paragraph.index}
              className={`writing-paragraph ${paragraph.verdict}`}
            >
              <header>
                <span>第 {paragraph.index} 段</span>
                <small>{paragraph.chars} 字</small>
              </header>
              <p className="writing-paragraph-text">{paragraph.text}</p>
              <p className="writing-paragraph-feedback">{paragraph.feedback}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="writing-report-actions">
        <button className="primary" onClick={onRewrite}>
          <RotateCcw size={15} /> 再写一篇
        </button>
        <button className="secondary" onClick={onHumanReview}>
          <MessageCircle size={15} /> 预约人工批改
        </button>
      </div>
    </div>
  );
}

export function EssayWritingPage() {
  const [promptId, setPromptId] = useState(WRITING_PROMPTS[0].id);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<SubmissionItem[]>([]);
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [humanReviewOpen, setHumanReviewOpen] = useState(false);
  const { showToast } = useToast();

  const prompt = useMemo(
    () => WRITING_PROMPTS.find((item) => item.id === promptId) ?? WRITING_PROMPTS[0],
    [promptId],
  );
  const words = countChars(content);

  const loadHistory = useCallback(async () => {
    try {
      const data = await api<{ items: SubmissionItem[] }>(
        "/essay/writing/submissions",
      );
      setHistory(data.items);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const submit = async () => {
    if (!title.trim()) {
      showToast("先给文章拟一个标题", "error");
      return;
    }
    if (words < 200) {
      showToast("正文至少 200 字，先把观点展开", "error");
      return;
    }
    setBusy(true);
    try {
      const result = await api<SubmissionDetail>("/essay/writing/submissions", {
        method: "POST",
        body: JSON.stringify({ promptId: prompt.id, title: title.trim(), content }),
      });
      setDetail(result);
      await loadHistory();
      showToast(`批改完成：${result.grade} · ${result.score} 分`, "success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "提交失败，请稍后重试", "error");
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (id: string) => {
    setBusy(true);
    try {
      const result = await api<SubmissionDetail>(`/essay/writing/submissions/${id}`);
      setDetail(result);
      const matched = WRITING_PROMPTS.find((item) => item.id === result.promptId);
      if (matched) setPromptId(matched.id);
      setTitle(result.title);
      setContent(result.content);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "加载批改记录失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const rewrite = () => {
    setDetail(null);
    setTitle("");
    setContent("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (busy && !detail && !history.length)
    return <LoadingSpinner message="正在准备批改…" />;

  return (
    <section className="panel writing-page">
      <div className="writing-head">
        <div>
          <p className="eyebrow">整篇批改</p>
          <h2>
            <PenLine size={22} /> 写完一篇，再改一篇
          </h2>
          <p className="muted">
            按申论阅卷维度给出分数、关键词覆盖和逐段点评。人工批改为内测增值项，暂不接入支付。
          </p>
        </div>
        <span className="writing-tip">
          <ClipboardCheck size={15} /> 建议限时 {prompt.suggestedMinutes} 分钟
        </span>
      </div>

      <div className="writing-layout">
        <div className="writing-main">
          {detail ? (
            <GradeReport
              detail={detail}
              onRewrite={rewrite}
              onHumanReview={() => setHumanReviewOpen(true)}
            />
          ) : (
            <>
              <div className="writing-prompts" role="tablist" aria-label="选择练习题目">
                {WRITING_PROMPTS.map((item) => (
                  <button
                    key={item.id}
                    role="tab"
                    aria-selected={item.id === prompt.id}
                    className={item.id === prompt.id ? "active" : ""}
                    onClick={() => setPromptId(item.id)}
                  >
                    <small>{item.type}</small>
                    <strong>{item.title}</strong>
                  </button>
                ))}
              </div>

              <article className="writing-prompt">
                <div className="writing-prompt-head">
                  <h3>{prompt.title}</h3>
                  <span>
                    <Clock3 size={13} /> {prompt.suggestedMinutes} 分钟 ·{" "}
                    {prompt.targetWords.min}—{prompt.targetWords.max} 字
                  </span>
                </div>
                <div className="writing-material">
                  {prompt.material.split(/\n+/).map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
                <p className="writing-question">{prompt.question}</p>
                <ul className="writing-requirements">
                  {prompt.requirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
              </article>

              <article className="writing-editor">
                <label>
                  文章标题
                  <input
                    value={title}
                    maxLength={60}
                    placeholder="自拟标题，尽量回应主题"
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label>
                  正文
                  <textarea
                    value={content}
                    rows={18}
                    maxLength={5000}
                    placeholder="开头亮明观点，中间分论点展开，结尾总结升华。建议每段之间空一行。"
                    onChange={(event) => setContent(event.target.value)}
                  />
                </label>
                <div className="writing-editor-foot">
                  <span className={words < prompt.targetWords.min ? "warn" : ""}>
                    {words} 字
                    {words < prompt.targetWords.min
                      ? ` · 还差 ${prompt.targetWords.min - words} 字到建议下限`
                      : ""}
                  </span>
                  <div>
                    <button
                      className="secondary"
                      onClick={() => {
                        setTitle("");
                        setContent("");
                      }}
                    >
                      清空
                    </button>
                    <button className="primary" disabled={busy} onClick={() => void submit()}>
                      {busy ? "批改中…" : "提交批改"} <ArrowRight size={15} />
                    </button>
                  </div>
                </div>
              </article>
            </>
          )}
        </div>

        <aside className="writing-history">
          <div className="writing-history-head">
            <h3>
              <History size={16} /> 批改记录
            </h3>
            <span className="muted">{history.length} 篇</span>
          </div>
          {history.length === 0 ? (
            <p className="muted">
              还没有批改记录。完成第一篇后，这里会保留分数和报告。
            </p>
          ) : (
            <div className="writing-history-list">
              {history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="writing-history-item"
                  onClick={() => void openHistory(item.id)}
                >
                  <div>
                    <strong>{item.title}</strong>
                    <span className="muted">
                      {item.promptTitle} · {item.wordCount} 字 · {formatDate(item.createdAt)}
                    </span>
                  </div>
                  <em style={{ color: scoreColor(item.score) }}>
                    {item.score}
                    <small>{item.grade}</small>
                  </em>
                </button>
              ))}
            </div>
          )}
          <button
            className="secondary writing-human-entry"
            onClick={() => setHumanReviewOpen(true)}
          >
            <MessageCircle size={15} /> 人工批改（内测）
          </button>
        </aside>
      </div>

      <CommunityModal
        open={humanReviewOpen}
        onClose={() => setHumanReviewOpen(false)}
        title="预约人工批改"
        reason="人工批改为内测增值服务：扫码添加个人微信，备注「人工批改」。当前暂不接入支付，先沟通批改范围与时间。"
      />
    </section>
  );
}
