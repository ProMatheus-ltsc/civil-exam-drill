import { useEffect, useRef, useState } from "react";
import { ListChecks } from "lucide-react";
import { EmptyState } from "@shared/core/components/EmptyState";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import { Stack } from "@shared/core/components/responsive/Stack";
import { api } from "../api/client";
import { titleOf } from "../generator/catalog";
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

const difficultyLabel: Record<string, string> = {
  easy: "简单",
  medium: "中等",
  hard: "困难",
};

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
      await onUpdated();
    });
  return (
    <article className="mistake">
      <small className="mistake-tag">
        {titleOf(item.topicId)} · {difficultyLabel[item.difficulty] ?? item.difficulty}
      </small>
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
  if (busy && !items.length) return <LoadingSpinner message="错题加载中…" />;
  return (
    <section className="panel">
      <p className="eyebrow">错题复习</p>
      <h2>错题本</h2>
      {items.length ? (
        <Stack gap="1rem">
          {items.map((item) => (
            <MistakeCard item={item} key={item.questionId} onUpdated={load} />
          ))}
        </Stack>
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
