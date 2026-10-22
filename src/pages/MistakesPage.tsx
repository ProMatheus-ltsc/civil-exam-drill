/**
 * 错题本：按「专项训练」模块（关卡）归类展示。
 * 归类维度只有模块——同一模块下的错题不再区分难度（低/中/高），
 * 因为难度只影响题目生成，对“哪块知识薄弱”的判断没有区分价值。
 * 复习口径：连续重做正确 2 次才出清；第一次正确后安排次日再考，答错则重新排期。
 * 错因标签只用于自我复盘，不参与出清判断。
 * 出清后后端不再返回该题，列表与计数随之减少；原始作答记录保留，统计不受影响。
 * 折叠口径：每个模块可单独折叠/展开，首次只展开最靠前的模块，展开状态按模块 id 记录。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Clock3, ListChecks } from "lucide-react";
import { EmptyState } from "@shared/core/components/EmptyState";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import { Stack } from "@shared/core/components/responsive/Stack";
import { useToast } from "@shared/core/hooks/useToast";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { titleOf, topicById, tracks } from "../generator/catalog";
import type { MaterialSpec } from "../generator/types";
import { MaterialView } from "../components/MaterialView";
import { useAsync } from "../hooks/useAsync";
import {
  MISTAKE_CAUSES,
  type MistakeCauseId,
  mistakeCauseLabel,
} from "../mistakes";

type Mistake = {
  questionId: string;
  topicId: string;
  difficulty: string;
  stem: string;
  options: string[];
  material: MaterialSpec | null;
  answerIndex: number;
  explanation: string;
  mastered: boolean;
  wrongCount: number;
  causeTag: MistakeCauseId | null;
  reviewStage: number;
  nextReviewAt: string | null;
  lastReviewedAt: string | null;
};

type RetryResult = {
  correct: boolean;
  answerIndex: number;
  explanation: string;
  mastered: boolean;
  reviewStage: number;
  nextReviewAt: string | null;
};

type Counts = { open: number; due: number };

/** 模块所属轨道（资料速算 / 数字推理） */
function trackTitleOf(topicId: string) {
  const track = topicById.get(topicId as Parameters<typeof topicById.get>[0])?.track;
  return tracks.find((item) => item.id === track)?.title;
}

/** 距离下次复习的自然语言描述 */
function reviewHint(item: Mistake) {
  if (!item.nextReviewAt) return "现在可复习";
  const diff = new Date(item.nextReviewAt).getTime() - Date.now();
  if (diff <= 0) return "已到复习时间";
  if (diff < 3600000) return `${Math.ceil(diff / 60000)} 分钟后复习`;
  if (diff < 86400000) return `${Math.ceil(diff / 3600000)} 小时后复习`;
  return `${Math.ceil(diff / 86400000)} 天后再复习`;
}

function MistakeCard({
  item,
  onUpdated,
  onCauseChange,
}: {
  item: Mistake;
  onUpdated: () => Promise<void>;
  onCauseChange: (questionId: string, cause: MistakeCauseId | null) => void;
}) {
  const [retrying, setRetrying] = useState(false),
    [result, setResult] = useState<RetryResult | null>(null),
    [cause, setCause] = useState<MistakeCauseId | null>(item.causeTag);
  const started = useRef(0);
  const { busy, run } = useAsync();
  const { busy: causeBusy, run: runCause } = useAsync();
  const { showToast } = useToast();
  useEffect(() => setCause(item.causeTag), [item.causeTag]);
  const start = () => {
    setRetrying(true);
    setResult(null);
    started.current = performance.now();
  };
  const pickCause = (next: MistakeCauseId) => {
    const value = cause === next ? null : next;
    void runCause(async () => {
      await api(`/quiz/mistakes/${item.questionId}/cause`, {
        method: "PATCH",
        body: JSON.stringify({ cause: value }),
      });
      setCause(value);
      onCauseChange(item.questionId, value);
    });
  };
  const submit = (selectedIndex: number) =>
    run(async () => {
      const next = await api<RetryResult>(
        `/quiz/mistakes/${item.questionId}/retry`,
        {
          method: "POST",
          body: JSON.stringify({
            selectedIndex,
            elapsedMs: Math.round(performance.now() - started.current),
            idempotencyKey: crypto.randomUUID(),
          }),
        },
      );
      setResult(next);
      // 连续答对两次才出清；第一次答对只推进阶段，用 toast 说明还差一次
      if (next.mastered) showToast("连续两次答对，已从错题本移除", "success");
      else if (next.correct) showToast("答对 1 次，明天再复习一次即可出清", "success");
      await onUpdated();
    });
  return (
    <article className="mistake">
      <strong>{item.stem}</strong>
      <p className="muted mistake-meta">
        错误次数：{item.wrongCount}
        {item.reviewStage > 0
          ? ` · 已答对 ${Math.min(item.reviewStage, 2)}/2 次`
          : " · 尚未重做"}
        {item.causeTag && ` · 错因：${mistakeCauseLabel(item.causeTag)}`}
      </p>
      <div className="mistake-causes">
        <span className="mistake-causes-label">
          <Clock3 size={13} /> {reviewHint(item)}
        </span>
        <span className="mistake-causes-tag">错因</span>
        {MISTAKE_CAUSES.map((causeOption) => (
          <button
            key={causeOption.id}
            type="button"
            title={causeOption.hint}
            className={cause === causeOption.id ? "active" : ""}
            disabled={causeBusy}
            onClick={() => pickCause(causeOption.id)}
          >
            {causeOption.label}
          </button>
        ))}
      </div>
      {item.material && <MaterialView material={item.material} />}
      {retrying ? (
        <>
          <div className="options">
            {item.options.map((option, index) => (
              <button
                key={option}
                disabled={busy || !!result}
                className={
                  result && index === result.answerIndex ? "correct" : ""
                }
                onClick={() => submit(index)}
              >
                <span className="option-key">
                  {String.fromCharCode(65 + index)}
                </span>
                <span className="option-text">{option}</span>
              </button>
            ))}
          </div>
          {result && (
            <p className="muted">
              <strong>
                {result.mastered
                  ? "连续答对两次，已掌握"
                  : result.correct
                    ? "答对 1 次，还需再答对 1 次"
                    : "仍需巩固"}
              </strong>
              <br />
              {result.explanation}
            </p>
          )}
        </>
      ) : (
        <>
          <p>
            答案：{item.options[item.answerIndex]}
            <br />
            {item.explanation}
          </p>
        </>
      )}
      <button className="secondary" disabled={busy} onClick={start}>
        {retrying ? "重新开始" : "重做此题"}
      </button>
    </article>
  );
}

export function MistakesPage() {
  const [items, setItems] = useState<Mistake[]>([]);
  const [counts, setCounts] = useState<Counts>({ open: 0, due: 0 });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const inited = useRef(false);
  const { busy, run } = useAsync();
  const [searchParams, setSearchParams] = useSearchParams();
  const dueOnly = searchParams.get("due") === "1";
  const load = () =>
    run(async () => {
      const data = await api<{ items: Mistake[]; counts: Counts }>(
        `/quiz/mistakes?limit=100${dueOnly ? "&due=1" : ""}`,
      );
      setItems(data.items);
      setCounts(data.counts);
      // 已展开的模块被清空后，把「下一个模块」展开，避免只剩一个折叠标题
      setExpandedIds((prev) => {
        if (!prev.size) return prev;
        const stillExists = data.items.some((item) => prev.has(item.topicId));
        return stillExists || !data.items.length
          ? prev
          : new Set([data.items[0].topicId]);
      });
    });
  // 切换「全部 / 今日待复习」视为一次新的浏览：重新载入并重置展开状态
  useEffect(() => {
    inited.current = false;
    setExpandedIds(new Set());
    void load();
  }, [dueOnly]);

  // 按模块归类：全部视图按最近答错时间倒序，待复习视图按到期时间正序
  const groups = useMemo(() => {
    const map = new Map<string, Mistake[]>();
    for (const item of items) {
      const list = map.get(item.topicId);
      if (list) list.push(item);
      else map.set(item.topicId, [item]);
    }
    return [...map.entries()];
  }, [items]);

  const groupIds = useMemo(() => groups.map(([topicId]) => topicId), [groups]);
  // 首次拿到数据时只展开最靠前的模块；此后不再自动改动，避免重做后把用户手动收起的模块又弹开
  useEffect(() => {
    if (inited.current || !groupIds.length) return;
    inited.current = true;
    setExpandedIds(new Set([groupIds[0]]));
  }, [groupIds]);

  const toggle = (topicId: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });

  const setDueOnly = (next: boolean) =>
    setSearchParams(next ? { due: "1" } : {}, { replace: true });

  const updateCause = (questionId: string, cause: MistakeCauseId | null) =>
    setItems((prev) =>
      prev.map((item) =>
        item.questionId === questionId ? { ...item, causeTag: cause } : item,
      ),
    );

  if (busy && !items.length) return <LoadingSpinner message="错题加载中…" />;
  return (
    <section className="panel">
      <p className="eyebrow">错题复习</p>
      <h2>错题本</h2>
      <div className="mistake-filters">
        <button
          className={!dueOnly ? "active" : ""}
          onClick={() => setDueOnly(false)}
        >
          全部 {counts.open}
        </button>
        <button
          className={dueOnly ? "active" : ""}
          onClick={() => setDueOnly(true)}
        >
          今日待复习 {counts.due}
        </button>
      </div>
      {groups.length ? (
        <>
          <div className="mistake-toolbar">
            <p className="muted hint-line">
              <ListChecks size={14} /> 共 {items.length} 道错题，按「专项训练」的模块归类；
              连续重做正确 2 次才移出本页，只对 1 次会安排次日再复习。
              错因标签用于复盘，不改变出清规则。
            </p>
            <div className="mistake-actions">
              <button
                className="secondary map-collapse-btn"
                onClick={() => setExpandedIds(new Set(groupIds))}
              >
                展开全部
              </button>
              <button
                className="secondary map-collapse-btn"
                onClick={() => setExpandedIds(new Set())}
              >
                收起全部
              </button>
            </div>
          </div>
          <Stack gap="1.5rem">
            {groups.map(([topicId, list]) => {
              const trackTitle = trackTitleOf(topicId);
              const open = expandedIds.has(topicId);
              return (
                <section
                  className={`mistake-group ${open ? "is-open" : ""}`}
                  key={topicId}
                >
                  <button
                    className="mistake-group-head"
                    aria-expanded={open}
                    onClick={() => toggle(topicId)}
                  >
                    <span className="mistake-group-title">
                      {titleOf(topicId)}
                    </span>
                    <span className="mistake-count">{list.length} 题</span>
                    {trackTitle && (
                      <span className="mistake-track">{trackTitle}</span>
                    )}
                    <span className="mistake-chevron">
                      {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                  </button>
                  {open && (
                    <Stack gap="1rem">
                      {list.map((item) => (
                        <MistakeCard
                          item={item}
                          key={item.questionId}
                          onUpdated={load}
                          onCauseChange={updateCause}
                        />
                      ))}
                    </Stack>
                  )}
                </section>
              );
            })}
          </Stack>
        </>
      ) : (
        <EmptyState
          icon={ListChecks}
          title={dueOnly ? "今天没有待复习的错题" : "暂无错题"}
          description={
            dueOnly
              ? "继续按计划训练，到期的错题会自动出现在这里"
              : "训练中答错的题目会自动收录在这里"
          }
        />
      )}
    </section>
  );
}
