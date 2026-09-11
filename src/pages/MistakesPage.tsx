/**
 * 错题本：按「专项训练」模块（关卡）归类展示。
 * 归类维度只有模块——同一模块下的错题不再区分难度（低/中/高），
 * 因为难度只影响题目生成，对“哪块知识薄弱”的判断没有区分价值。
 * 分组顺序：沿用接口返回的“最近答错时间倒序”，即最近出错的模块排在最前。
 * 出清口径：重做正确 → 后端把该题标记为已掌握，列表不再返回，错题数量随之减少。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ListChecks } from "lucide-react";
import { EmptyState } from "@shared/core/components/EmptyState";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import { Stack } from "@shared/core/components/responsive/Stack";
import { useToast } from "@shared/core/hooks/useToast";
import { api } from "../api/client";
import { titleOf, topicById, tracks } from "../generator/catalog";
import type { MaterialSpec } from "../generator/types";
import { MaterialView } from "../components/MaterialView";
import { useAsync } from "../hooks/useAsync";

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
};

type RetryResult = {
  correct: boolean;
  answerIndex: number;
  explanation: string;
};

/** 模块所属轨道（资料速算 / 数字推理） */
function trackTitleOf(topicId: string) {
  const track = topicById.get(topicId as Parameters<typeof topicById.get>[0])?.track;
  return tracks.find((item) => item.id === track)?.title;
}

function MistakeCard({
  item,
  onUpdated,
}: {
  item: Mistake;
  onUpdated: () => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false),
    [result, setResult] = useState<RetryResult | null>(null);
  const started = useRef(0);
  const { busy, run } = useAsync();
  const { showToast } = useToast();
  const start = () => {
    setRetrying(true);
    setResult(null);
    started.current = performance.now();
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
      // 答对即出清：重新拉取后该题不再返回，卡片随之消失，用 toast 补上反馈
      if (next.correct) showToast("重做正确，已从错题本移除", "success");
      await onUpdated();
    });
  return (
    <article className="mistake">
      <strong>{item.stem}</strong>
      <p className="muted">错误次数：{item.wrongCount}</p>
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
                {result.correct ? "重做正确，已掌握" : "仍需巩固"}
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
  const { busy, run } = useAsync();
  const load = () =>
    run(async () =>
      setItems(
        (await api<{ items: Mistake[] }>("/quiz/mistakes?limit=100")).items,
      ),
    );
  useEffect(() => {
    void load();
  }, []);

  // 按模块归类：items 已按最近答错时间倒序，Map 的插入顺序即“模块最近出错”的先后
  const groups = useMemo(() => {
    const map = new Map<string, Mistake[]>();
    for (const item of items) {
      const list = map.get(item.topicId);
      if (list) list.push(item);
      else map.set(item.topicId, [item]);
    }
    return [...map.entries()];
  }, [items]);

  if (busy && !items.length) return <LoadingSpinner message="错题加载中…" />;
  return (
    <section className="panel">
      <p className="eyebrow">错题复习</p>
      <h2>错题本</h2>
      {groups.length ? (
        <>
          <p className="muted hint-line">
            <ListChecks size={14} /> 共 {items.length} 道错题，按「专项训练」的模块归类，
            同一模块内不再区分难度；重做正确的题目会自动移出本页。
          </p>
          <Stack gap="1.5rem">
            {groups.map(([topicId, list]) => {
              const trackTitle = trackTitleOf(topicId);
              return (
                <section className="mistake-group" key={topicId}>
                  <p className="subtitle">
                    {titleOf(topicId)}
                    <span className="mistake-count">{list.length} 题</span>
                    {trackTitle && (
                      <span className="mistake-track">{trackTitle}</span>
                    )}
                  </p>
                  <Stack gap="1rem">
                    {list.map((item) => (
                      <MistakeCard
                        item={item}
                        key={item.questionId}
                        onUpdated={load}
                      />
                    ))}
                  </Stack>
                </section>
              );
            })}
          </Stack>
        </>
      ) : (
        <EmptyState
          icon={ListChecks}
          title="暂无错题"
          description="训练中答错的题目会自动收录在这里"
        />
      )}
    </section>
  );
}
