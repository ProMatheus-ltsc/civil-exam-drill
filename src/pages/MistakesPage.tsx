import { useEffect, useRef, useState } from "react";
import { ListChecks } from "lucide-react";
import { EmptyState } from "@shared/core/components/EmptyState";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import { Stack } from "@shared/core/components/responsive/Stack";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";

type Mistake = {
  questionId: string;
  stem: string;
  options: string[];
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
      <strong>{item.stem}</strong>
      <p>错误次数：{item.wrongCount}</p>
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
                {String.fromCharCode(65 + index)}. {option}
              </button>
            ))}
          </div>
          {result && (
            <p>
              <strong>
                {result.correct ? "重做正确，已掌握" : "仍需巩固"}
              </strong>
              　{result.explanation}
            </p>
          )}
        </>
      ) : (
        <>
          <p>答案：{item.options[item.answerIndex]}</p>
          <p>{item.explanation}</p>
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
