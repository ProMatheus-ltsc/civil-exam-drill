/**
 * 申论 21 天闯关：六阶段 21 关，逐关解锁（通关上一关才开下一关）。
 *
 * 与专项训练（资料速算/数字推理）保持同一套观感与口径：
 *   - 关卡卡片（阶段徽标 + 难度档 + 星级 + 「需先通关」提示 + 折叠展开 + 查看讲解）；
 *   - 难度档沿用 基础/进阶/高阶 三档徽标；
 *   - 星级判定换成「自评清单达成率」：≥80% 一星通关、≥90% 二星、全中三星。
 * 申论没有客观题可以自动判分，所以通关依据是「把任务做完 → 对照清单自评 → 留下笔记」，
 * 星级由服务端按清单条数重算（不接受客户端传来的星数），只增不减。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Lock,
  Star,
  Target,
} from "lucide-react";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import { useToast } from "@shared/core/hooks/useToast";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";

const RATING_LABEL: Record<number, string> = { 1: "基础", 2: "进阶", 3: "高阶" };

type EssayTask = { title: string; minutes: number; output: string };

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
  summary: { total: number; cleared: number; stars: number };
};

/** 与 src/essay/training.ts 的 essayStars 同规则：只用于展开时的「预计可得星」预览 */
function previewStars(checked: number, total: number) {
  if (total <= 0) return 0;
  const rate = checked / total;
  if (rate >= 1) return 3;
  if (rate >= 0.9) return 2;
  if (rate >= 0.8) return 1;
  return 0;
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
  const [drafts, setDrafts] = useState<
    Record<string, { checked: number[]; notes: string }>
  >({});
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

  const draftOf = (level: EssayLevel) =>
    drafts[level.id] ?? { checked: level.checked, notes: level.notes };

  const toggle = (level: EssayLevel) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(level.id)) next.delete(level.id);
      else next.add(level.id);
      return next;
    });
    setDrafts((current) =>
      current[level.id]
        ? current
        : {
            ...current,
            [level.id]: { checked: level.checked, notes: level.notes },
          },
    );
  };

  const submit = (level: EssayLevel) =>
    run(async () => {
      const draft = draftOf(level);
      const result = await api<{ stars: number; checked: number[] }>(
        `/essay/training/${level.id}`,
        {
          method: "POST",
          body: JSON.stringify({ checked: draft.checked, notes: draft.notes }),
        },
      );
      await load();
      setDrafts((current) => ({
        ...current,
        [level.id]: { checked: result.checked, notes: draft.notes },
      }));
      showToast(
        result.stars >= 1
          ? `第 ${level.day} 关已通关（${result.stars} 星），下一关已解锁`
          : `已保存自评：还差一点才通关（${draft.checked.length}/${level.checklist.length} 项）`,
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

  return (
    <section className="panel">
      <p className="eyebrow">六阶段 · 21 关 · 逐关解锁</p>
      <h2>申论 21 天闯关</h2>
      <p className="muted">
        每关先看训练目标与核心要点，再按实操任务练，最后对照自评清单逐条检查。
        <strong>清单勾中 ≥80% 即通关</strong>（≥90% 两星、全中三星），通关后才解锁下一关。
      </p>
      <div className="essay-training-chips">
        <span>已完成 {payload.summary.cleared}/{payload.summary.total} 关</span>
        <span>累计 {payload.summary.stars} 星</span>
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
              const draft = draftOf(level);
              const checkedCount = draft.checked.length;
              const earned = previewStars(checkedCount, level.checklist.length);
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
                        <Clock size={11} /> 约 {level.minutes} 分钟 · 自评 {checkedCount}/
                        {level.checklist.length} 项
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
                          通关自评
                          <span className="muted">
                            {" "}
                            （勾中 ≥80% 通关 · ≥90% 两星 · 全中三星）
                          </span>
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
                                onChange={(event) =>
                                  setDrafts((current) => {
                                    const base = current[level.id] ?? {
                                      checked: level.checked,
                                      notes: level.notes,
                                    };
                                    const next = event.target.checked
                                      ? [...base.checked, index]
                                      : base.checked.filter((value) => value !== index);
                                    return {
                                      ...current,
                                      [level.id]: { ...base, checked: next.sort((a, b) => a - b) },
                                    };
                                  })
                                }
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
                          onChange={(event) =>
                            setDrafts((current) => {
                              const base = current[level.id] ?? {
                                checked: level.checked,
                                notes: level.notes,
                              };
                              return {
                                ...current,
                                [level.id]: { ...base, notes: event.target.value },
                              };
                            })
                          }
                        />
                      </div>

                      <div className="essay-submit">
                        <span className="muted">
                          当前 {checkedCount}/{level.checklist.length} 项，可得 {earned} 星
                          {level.stars > 0 && ` · 最好成绩 ${level.stars} 星`}
                        </span>
                        <button
                          className="primary"
                          disabled={!level.unlocked || busy}
                          title={level.unlocked ? undefined : `需先通关：${level.previousTitle}`}
                          onClick={() => submit(level)}
                        >
                          {!level.unlocked
                            ? `需先通关：${level.previousTitle}`
                            : level.stars > 0
                              ? "更新自评"
                              : "提交闯关"}
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
