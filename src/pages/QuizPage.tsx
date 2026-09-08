import { useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { Calculator } from "lucide-react";
import { EmptyState } from "@shared/core/components/EmptyState";
import { Stack } from "@shared/core/components/responsive/Stack";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";

type Question = { questionId: string; stem: string; options: string[] };
type Answer = { correct: boolean; answerIndex: number; explanation: string };
const topics = [
  ["arithmetic", "加减与多项求和"],
  ["multiply", "乘法与平方"],
  ["divide", "除法估算"],
  ["sensitive", "敏感数/百化分"],
  ["decimal", "小数速算"],
  ["growth", "增长率/增长量"],
  ["ratio", "比重/平均数"],
  ["annual", "年平均量/年均增长率"],
  ["interval-growth", "间隔增长率"],
  ["mixed-growth", "混合增长率"],
  ["multiples", "倍数与翻番"],
  ["ratio-change", "两期比重差"],
];

export function QuizPage() {
  const [topicId, setTopicId] = useState("sensitive"),
    [difficulty, setDifficulty] = useState("easy"),
    [question, setQuestion] = useState<Question | null>(null),
    [answer, setAnswer] = useState<Answer | null>(null),
    [session, setSession] = useState({ total: 0, correct: 0, totalMs: 0 }),
    [ended, setEnded] = useState(false);
  const started = useRef(0);
  const { busy, run } = useAsync();
  const next = () =>
    run(async () => {
      if (ended) {
        setSession({ total: 0, correct: 0, totalMs: 0 });
        setEnded(false);
      }
      setQuestion(
        await api("/quiz/questions", {
          method: "POST",
          body: JSON.stringify({ topicId, difficulty }),
        }),
      );
      setAnswer(null);
      started.current = performance.now();
    });
  // pending 记录用户点了哪个选项（未等网络响应即高亮），同时阻止连点
  const [pending, setPending] = useState<number | null>(null);
  const submit = (selectedIndex: number) => {
    if (!question || answer || pending !== null) return;
    const elapsedMs = Math.round(performance.now() - started.current);
    setPending(selectedIndex);
    void run(async () => {
      const result = await api<Answer>("/quiz/answers", {
        method: "POST",
        body: JSON.stringify({
          questionId: question.questionId,
          selectedIndex,
          elapsedMs,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setAnswer(result);
      setPending(null);
      setSession((current) => ({
        total: current.total + 1,
        correct: current.correct + Number(result.correct),
        totalMs: current.totalMs + elapsedMs,
      }));
    });
  };
  return (
    <section className="panel">
      <p className="eyebrow">专项练习</p>
      <h2>速算训练</h2>
      <Stack direction="horizontal" wrap gap="0.75rem" align="end">
        <label>
          专题
          <select
            value={topicId}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              setTopicId(event.target.value)
            }
          >
            {topics.map((item) => (
              <option key={item[0]} value={item[0]}>
                {item[1]}
              </option>
            ))}
          </select>
        </label>
        <label>
          难度
          <select
            value={difficulty}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              setDifficulty(event.target.value)
            }
          >
            <option value="easy">简单</option>
            <option value="medium">中等</option>
            <option value="hard">困难</option>
          </select>
        </label>
        <button className="primary" disabled={busy} onClick={next}>
          {question ? "换一道题" : "开始练习"}
        </button>
        {session.total > 0 && !ended && (
          <button className="secondary" onClick={() => setEnded(true)}>
            结束本轮
          </button>
        )}
      </Stack>
      {ended ? (
        <div className="explanation">
          <h3>本轮完成</h3>
          <p>
            共 {session.total} 题，答对 {session.correct} 题，正确率{" "}
            {Math.round((session.correct / session.total) * 100)}%，总用时{" "}
            {(session.totalMs / 1000).toFixed(1)} 秒。
          </p>
          <button className="primary" onClick={next}>
            开始新一轮
          </button>
        </div>
      ) : question ? (
        <div className="question">
          <h3>{question.stem}</h3>
          <div className="options">
            {question.options.map((option, index) => (
              <button
                key={option}
                disabled={!!answer || pending !== null}
                className={
                  answer && index === answer.answerIndex
                    ? "correct"
                    : pending === index
                      ? "selected"
                      : ""
                }
                onClick={() => submit(index)}
              >
                {String.fromCharCode(65 + index)}. {option}
              </button>
            ))}
          </div>
          {answer && (
            <div className="explanation">
              <strong>{answer.correct ? "回答正确" : "回答错误"}</strong>
              <p>{answer.explanation}</p>
              <button className="primary" onClick={next}>
                下一题
              </button>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={Calculator}
          title="开始速算练习"
          description="选择专题和难度，然后开始答题"
          action={
            <button className="primary" onClick={next}>
              开始练习
            </button>
          }
        />
      )}
    </section>
  );
}
