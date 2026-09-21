/**
 * 申论闯关：六阶段 39 关，逐关解锁（通关上一关才开下一关）。
 *
 * 与专项训练（资料速算/数字推理）保持同一套观感与口径：
 *   - 关卡卡片（阶段徽标 + 难度档 + 星级 + 「需先通关」提示 + 折叠展开 + 查看讲解）；
 *   - 难度档沿用 基础/进阶/高阶 三档徽标；
 *   - 每关下发 5 道四选一客观题（题干与选项来自服务端，答案只在交卷后随解析回传），
 *     再对照自评清单逐条打勾；星级＝客观题（每题 2 分）与清单（每条 1 分）的加权总分，
 *     且客观题答对不足 80% 直接不通关——规则见 src/essay/rules.ts，服务端按同一份实现判星。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Lock,
  ListChecks,
  Star,
  Target,
} from "lucide-react";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import { useToast } from "@shared/core/hooks/useToast";
import { api } from "../api/client";
import { essayQuizPassLine } from "../essay/rules";
import { useAsync } from "../hooks/useAsync";

const RATING_LABEL: Record<number, string> = { 1: "基础", 2: "进阶", 3: "高阶" };

type EssayTask = { title: string; minutes: number; output: string };

type QuizOption = { key: number; text: string };
type QuizItem = { id: string; tag: string; stem: string; options: QuizOption[] };
type QuizMark = { id: string; correct: boolean; answerKey: number; explanation: string };
type QuizResult = { correct: number; total: number; marks: QuizMark[] };

type EssayLevel = {
  id: string;
  day: number;
  stage: string;
  title: string;
  goal: string;
  rating: 1 | 2 | 3;
  minutes: number;
  points: string[];
  tasks: EssayTask[];
  checklist: string[];
  docId: string;
  previousTitle: string | null;
  unlocked: boolean;
  stars: number;
  checked: number[];
  notes: string;
  quiz: QuizItem[];
  /** 上次交卷的判分结果（含正确答案与解析）；没交过卷就是 null */
  quizResult: QuizResult | null;
};

type EssayStage = {
  id: string;
  title: string;
  from: number;
  to: number;
  goal: string;
};

type Payload = {
  stages: EssayStage[];
  levels: EssayLevel[];
  summary: {
    total: number;
    cleared: number;
    stars: number;
    quizAnswered: number;
    quizCorrect: number;
  };
};

/** 展开中的草稿：自评勾选 + 客观题作答（题目 id → 选项原始下标）+ 笔记 */
type Draft = { checked: number[]; quiz: Record<string, number>; notes: string };

function draftOf(level: EssayLevel): Draft {
  return { checked: level.checked, quiz: {}, notes: level.notes };
}

function StarRow({ count, size = 13 }: { count: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${count} 星`}>
      {Array.from({ length: 3 }, (_, index) => (
        <Star key={index} size={size} className={index < count ? "filled" : ""} />
      ))}
    </span>
  );
}

export function EssayTraining({ onDoc }: { onDoc: (docId: string) => void }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const { busy, run } = useAsync();
  const { showToast } = useToast();

  const load = useCallback(async () => {
    const data = await api<Payload>("/essay/training");
    setPayload(data);
    return data;
  }, []);

  useEffect(() => {
    void load().catch(() => setPayload(null));
  }, [load]);

  const currentDraft = (level: EssayLevel) => drafts[level.id] ?? draftOf(level);

  /**
   * 用函数式更新：批处理下同一帧里的多次点击（比如连勾几个选项）不能各自基于渲染时的旧草稿合并，
   * 否则后面的会把前面的覆盖掉——表现为「点了 5 道题只记住最后一道」。
   */
  const patchDraft = (level: EssayLevel, update: (draft: Draft) => Partial<Draft>) =>
    setDrafts((current) => {
      const base = current[level.id] ?? draftOf(level);
      return { ...current, [level.id]: { ...base, ...update(base) } };
    });

  const toggle = (level: EssayLevel) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(level.id)) next.delete(level.id);
      else next.add(level.id);
      return next;
    });
    setDrafts((current) => (current[level.id] ? current : { ...current, [level.id]: draftOf(level) }));
  };

  const submit = (level: EssayLevel) =>
    run(async () => {
      const draft = currentDraft(level);
      const quiz = level.quiz.map((item) => ({ id: item.id, key: draft.quiz[item.id] }));
      const result = await api<{
        stars: number;
        checked: number[];
        correct: number;
        quizTotal: number;
      }>(`/essay/training/${level.id}`, {
        method: "POST",
        body: JSON.stringify({ quiz, checked: draft.checked, notes: draft.notes }),
      });
      await load();
      setDrafts((current) => ({
        ...current,
        [level.id]: { checked: result.checked, quiz: draft.quiz, notes: draft.notes },
      }));
      const head = `客观题 ${result.correct}/${result.quizTotal}`;
      showToast(
        result.stars >= 1
          ? `第 ${level.day} 关已通关（${result.stars} 星，${head}），下一关已解锁`
          : `${head}，还差一点才通关——客观题需答对 ${essayQuizPassLine(level.quiz.length)} 题且总分达 80%`,
        result.stars >= 1 ? "success" : "info",
      );
    });

  const grouped = useMemo(() => {
    if (!payload) return [];
    return payload.stages.map((stage) => ({
      stage,
      levels: payload.levels.filter((level) => level.stage === stage.id),
    }));
  }, [payload]);

  if (!payload) return <LoadingSpinner />;

  const nextLevel = payload.levels.find((level) => level.stars < 1);
  const accuracy =
    payload.summary.quizAnswered > 0
      ? Math.round((payload.summary.quizCorrect / payload.summary.quizAnswered) * 100)
      : null;

  return (
    <section className="panel">
      <p className="eyebrow">六阶段 · {payload.summary.total} 关 · 逐关解锁</p>
      <h2>申论闯关</h2>
      <p className="muted">
        每关先看训练目标与核心要点，再按实操任务练，然后做 5 道客观题核对要点是否记住，
        最后对照自评清单检查任务是否落地。
        <strong>客观题答对 ≥{essayQuizPassLine(5)} 题</strong>且客观题与自评的加权总分
        <strong>≥80% 即通关</strong>（≥90% 两星、满分三星），通关后才解锁下一关。
      </p>
      <div className="essay-training-chips">
        <span>
          已完成 {payload.summary.cleared}/{payload.summary.total} 关
        </span>
        <span>累计 {payload.summary.stars} 星</span>
        {accuracy !== null && (
          <span>
            客观题正确率 {accuracy}%（{payload.summary.quizCorrect}/
            {payload.summary.quizAnswered}）
          </span>
        )}
        <span>
          {nextLevel ? `下一关：第 ${nextLevel.day} 关《${nextLevel.title}》` : "全部通关"}
        </span>
      </div>

      {grouped.map(({ stage, levels }) => {
        const cleared = levels.filter((level) => level.stars >= 1).length;
        return (
          <div className="essay-stage" key={stage.id}>
            <div className="essay-stage-head">
              <h3>
                阶段 · {stage.title}
                <span className="muted">
                  （Day {stage.from}-{stage.to}）
                </span>
              </h3>
              <span className="muted">
                {stage.goal} · 已完成 {cleared}/{levels.length}
              </span>
            </div>
            {levels.map((level) => {
              const isOpen = expanded.has(level.id);
              const draft = currentDraft(level);
              const checkedCount = draft.checked.length;
              const quizTotal = level.quiz.length;
              const passLine = essayQuizPassLine(quizTotal);
              const answered = level.quiz.filter((item) => draft.quiz[item.id] !== undefined).length;
              const remaining = quizTotal - answered;
              const submitLabel = !level.unlocked
                ? `需先通关：${level.previousTitle}`
                : remaining > 0
                  ? `还差 ${remaining} 道客观题`
                  : level.quizResult
                    ? "重新交卷"
                    : "交卷闯关";
              return (
                <div
                  className={`stage-card ${level.unlocked ? "" : "is-locked"} ${isOpen ? "is-open" : ""}`}
                  key={level.id}
                >
                  <button
                    className="stage-card-head"
                    aria-expanded={isOpen}
                    onClick={() => toggle(level)}
                  >
                    <span className={`stage-badge r${level.rating}`}>
                      {RATING_LABEL[level.rating]}
                    </span>
                    <span className="stage-text">
                      <strong>
                        第 {level.day} 关 · {level.title}
                        {level.stars >= 1 && <em className="stage-done">已通关</em>}
                        {!level.unlocked && !isOpen && (
                          <em className="stage-lock" title={`需先通关：${level.previousTitle}`}>
                            <Lock size={10} /> 需先通关：{level.previousTitle}
                          </em>
                        )}
                      </strong>
                      <small>
                        <Clock size={11} /> 约 {level.minutes} 分钟 · 客观题 {answered}/{quizTotal} · 自评{" "}
                        {checkedCount}/{level.checklist.length}
                        {level.quizResult &&
                          ` · 上次交卷 ${level.quizResult.correct}/${level.quizResult.total}`}
                      </small>
                    </span>
                    <span className="essay-stars">
                      <StarRow count={level.stars} />
                    </span>
                    <span className="stage-arrow">
                      {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </span>
                    <span
                      className="stage-doc"
                      role="button"
                      title="查看延伸讲解"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDoc(level.docId);
                      }}
                    >
                      <BookOpen size={15} />
                    </span>
                  </button>

                  {isOpen && (
                    <div className="essay-level-body">
                      <p className="essay-goal">
                        <Target size={14} /> {level.goal}
                      </p>

                      <div className="essay-block">
                        <h4>核心要点</h4>
                        <ul className="essay-points">
                          {level.points.map((point) => (
                            <li key={point}>{point}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="essay-block">
                        <h4>实操任务（合计约 {level.minutes} 分钟）</h4>
                        <ol className="essay-tasks">
                          {level.tasks.map((task) => (
                            <li key={task.title}>
                              <strong>{task.title}</strong>
                              <em className="muted"> {task.minutes} 分钟</em>
                              <p className="muted">交付物：{task.output}</p>
                            </li>
                          ))}
                        </ol>
                      </div>

                      <div className="essay-block">
                        <h4>
                          <ListChecks size={13} /> 客观题
                          <span className="muted">
                            {" "}
                            （{quizTotal} 题，答对 ≥{passLine} 题才计入通关）
                          </span>
                        </h4>
                        <div className="essay-quiz">
                          {level.quiz.map((item, index) => {
                            const chosen = draft.quiz[item.id];
                            const mark = level.quizResult?.marks.find((entry) => entry.id === item.id);
                            return (
                              <div className="essay-quiz-item" key={item.id}>
                                <p className="essay-quiz-stem">
                                  <span className="essay-quiz-index">{index + 1}</span>
                                  <em className="essay-quiz-tag">{item.tag}</em>
                                  <span>{item.stem}</span>
                                  {mark && (
                                    <em className={`essay-quiz-badge ${mark.correct ? "ok" : "no"}`}>
                                      {mark.correct ? "✓ 答对" : "✗ 答错"}
                                    </em>
                                  )}
                                </p>
                                <div className="essay-quiz-options">
                                  {item.options.map((option, optionIndex) => {
                                    const isChosen = chosen === option.key;
                                    const isAnswer = mark?.answerKey === option.key;
                                    const className = [
                                      "essay-quiz-option",
                                      isChosen ? "on" : "",
                                      mark && isAnswer ? "right" : "",
                                      mark && isChosen && !mark.correct ? "wrong" : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" ");
                                    return (
                                      <button
                                        type="button"
                                        key={option.key}
                                        className={className}
                                        disabled={!level.unlocked}
                                        onClick={() =>
                                          patchDraft(level, (draft) => ({
                                            quiz: { ...draft.quiz, [item.id]: option.key },
                                          }))
                                        }
                                      >
                                        <span className="essay-quiz-key">
                                          {String.fromCharCode(65 + optionIndex)}
                                        </span>
                                        <span>{option.text}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                                {mark && (
                                  <p className="essay-quiz-solution">
                                    {!mark.correct && (
                                      <strong>
                                        正确项：
                                        {item.options.find((option) => option.key === mark.answerKey)?.text}
                                        。
                                      </strong>
                                    )}
                                    {mark.explanation}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="essay-block">
                        <h4>
                          通关自评
                          <span className="muted"> （自评每条 1 分，客观题每题 2 分）</span>
                        </h4>
                        <div className="essay-checklist">
                          {level.checklist.map((item, index) => (
                            <label
                              key={item}
                              className={draft.checked.includes(index) ? "on" : ""}
                            >
                              <input
                                type="checkbox"
                                checked={draft.checked.includes(index)}
                                disabled={!level.unlocked}
                                onChange={(event) => {
                                  const on = event.target.checked;
                                  patchDraft(level, (draft) => ({
                                    checked: on
                                      ? [...draft.checked, index].sort((a, b) => a - b)
                                      : draft.checked.filter((value) => value !== index),
                                  }));
                                }}
                              />
                              <span>{item}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="essay-block">
                        <h4>笔记 / 作答留痕</h4>
                        <textarea
                          rows={4}
                          value={draft.notes}
                          disabled={!level.unlocked}
                          placeholder="把要点、错题、时间分配、复盘结论记在这里，提交时一起保存"
                          onChange={(event) => {
                            const value = event.target.value;
                            patchDraft(level, () => ({ notes: value }));
                          }}
                        />
                      </div>

                      <div className="essay-submit">
                        <span className="muted">
                          客观题 {answered}/{quizTotal} 题（答对 ≥{passLine} 题）· 自评 {checkedCount}/
                          {level.checklist.length} 项
                          {level.quizResult &&
                            ` · 上次交卷 ${level.quizResult.correct}/${level.quizResult.total}`}
                          {level.stars > 0 && ` · 最好成绩 ${level.stars} 星`}
                        </span>
                        <button
                          className="primary"
                          disabled={!level.unlocked || remaining > 0 || busy}
                          title={
                            !level.unlocked
                              ? `需先通关：${level.previousTitle}`
                              : remaining > 0
                                ? `还需作答 ${remaining} 道客观题`
                                : undefined
                          }
                          onClick={() => submit(level)}
                        >
                          {submitLabel}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
