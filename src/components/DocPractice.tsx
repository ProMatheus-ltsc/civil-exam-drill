/**
 * 文档底部的「学完就练」：把当前讲解关联到专项训练关卡，并提供 5 题小练。
 * 小练复用 /quiz/questions（不带 runId，不校验关卡解锁）与 /quiz/answers，
 * 因此答案会照常计入统计，答错也会进入错题本；但不影响 10 题闯关的通关判定。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, RotateCcw, Trophy, XCircle } from "lucide-react";
import { api } from "../api/client";
import { LADDERS, titleOf, topics, tracks } from "../generator/catalog";
import type { Difficulty, MaterialSpec } from "../generator/types";
import { MaterialView } from "./MaterialView";
import { useAsync } from "../hooks/useAsync";

type ProgressRow = {
  topicId: string;
  difficulty: Difficulty;
  stars: number;
  total: number;
  accuracy: number;
};

type PracticeQuestion = {
  questionId: string;
  stem: string;
  options: string[];
  material: MaterialSpec | null;
  difficulty: Difficulty;
};

type AnswerResult = {
  correct: boolean;
  answerIndex: number;
  explanation: string;
};

type PracticeItem = PracticeQuestion & { result?: AnswerResult };

type Phase = "idle" | "loading" | "active" | "done";

const PRACTICE_COUNT = 5;

function summarize(rows: ProgressRow[]) {
  const stars = rows.reduce((best, row) => Math.max(best, row.stars), 0);
  const practiced = rows.filter((row) => row.total > 0);
  const total = practiced.reduce((sum, row) => sum + row.total, 0);
  const accuracy = total
    ? practiced.reduce((sum, row) => sum + row.accuracy * row.total, 0) / total
    : 0;
  return { stars, total, accuracy };
}

export function DocPractice({ docId }: { docId: string }) {
  const related = useMemo(
    () => topics.filter((topic) => topic.docId === docId),
    [docId],
  );
  const [topicId, setTopicId] = useState(related[0]?.id ?? "");
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<PracticeItem[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const started = useRef(0);
  const { busy, run } = useAsync();

  useEffect(() => {
    setTopicId(related[0]?.id ?? "");
    setPhase("idle");
    setItems([]);
    setIndex(0);
    setPicked(null);
    setScore(0);
  }, [docId]);

  useEffect(() => {
    if (!related.length) return;
    void api<ProgressRow[]>("/quiz/progress")
      .then(setProgress)
      .catch(() => undefined);
  }, [docId]);

  const topic = related.find((item) => item.id === topicId) ?? related[0];
  const rows = progress.filter((row) => row.topicId === topic?.id);
  const mastery = summarize(rows);
  const question = items[index];
  const result = question?.result;

  const start = () =>
    run(async () => {
      if (!topic) return;
      setPhase("loading");
      try {
        const difficulties = LADDERS[topic.rating].slice(0, PRACTICE_COUNT);
        const questions = await Promise.all(
          difficulties.map((difficulty) =>
            api<PracticeQuestion>("/quiz/questions", {
              method: "POST",
              body: JSON.stringify({ topicId: topic.id, difficulty }),
            }),
          ),
        );
        setItems(questions);
        setIndex(0);
        setPicked(null);
        setScore(0);
        started.current = performance.now();
        setPhase("active");
      } catch (error) {
        setPhase("idle");
        throw error;
      }
    });

  const choose = (option: number) => {
    if (!question || picked !== null) return;
    setPicked(option);
    void run(async () => {
      try {
        const next = await api<AnswerResult>("/quiz/answers", {
          method: "POST",
          body: JSON.stringify({
            questionId: question.questionId,
            selectedIndex: option,
            elapsedMs: Math.round(performance.now() - started.current),
            idempotencyKey: crypto.randomUUID(),
          }),
        });
        setItems((previous) =>
          previous.map((item, itemIndex) =>
            itemIndex === index ? { ...item, result: next } : item,
          ),
        );
        if (next.correct) setScore((value) => value + 1);
      } catch (error) {
        setPicked(null);
        throw error;
      }
    });
  };

  const next = () => {
    if (index + 1 >= items.length) {
      setPhase("done");
      return;
    }
    setIndex((value) => value + 1);
    setPicked(null);
    started.current = performance.now();
  };

  const restart = () => {
    setPhase("idle");
    setItems([]);
    setIndex(0);
    setPicked(null);
    setScore(0);
  };

  if (!related.length || !topic) return null;

  return (
    <section className="doc-practice">
      <div className="doc-practice-head">
        <div>
          <p className="eyebrow">学完就练</p>
          <h3>把这篇讲解变成 {PRACTICE_COUNT} 道题</h3>
          <p className="muted">
            小练不计入闯关星级，但答题数据会同步到学习统计；答错会自动进错题本。
          </p>
        </div>
        <Link className="secondary doc-practice-level-link" to={`/quiz?topic=${topic.id}`}>
          进入完整关卡 <ArrowRight size={15} />
        </Link>
      </div>

      <div className="doc-practice-levels">
        {related.map((item) => {
          const itemMastery = summarize(
            progress.filter((row) => row.topicId === item.id),
          );
          const track = tracks.find((entry) => entry.id === item.track);
          return (
            <button
              key={item.id}
              className={item.id === topic.id ? "active" : ""}
              onClick={() => {
                setTopicId(item.id);
                restart();
              }}
            >
              <strong>{item.title}</strong>
              <small>
                {track?.title ?? "专项训练"} ·{" "}
                {itemMastery.stars > 0
                  ? `已通关 ${"★".repeat(itemMastery.stars)}`
                  : itemMastery.total > 0
                    ? `练习中 · 正确率 ${Math.round(itemMastery.accuracy * 100)}%`
                    : "未开始"}
              </small>
            </button>
          );
        })}
      </div>

      {phase === "idle" && (
        <div className="doc-practice-cta">
          <button className="primary" disabled={busy} onClick={start}>
            开始 {PRACTICE_COUNT} 题小练
          </button>
          <span className="muted">
            {mastery.total > 0
              ? `当前模块累计正确率 ${Math.round(mastery.accuracy * 100)}%`
              : "从这篇讲解对应的关卡抽题"}
          </span>
        </div>
      )}

      {phase === "loading" && <p className="muted">正在生成小练题目…</p>}

      {phase === "active" && question && (
        <div className="free-quiz doc-practice-quiz">
          <div className="free-quiz-head">
            <span className="free-quiz-badge">
              {titleOf(topic.id)} · {question.difficulty === "hard" ? "高阶" : question.difficulty === "medium" ? "进阶" : "基础"}
            </span>
            <span className="muted">
              {index + 1} / {items.length}
            </span>
          </div>
          <div className="free-quiz-progress" aria-hidden="true">
            <i
              style={{
                width: `${((index + (picked === null ? 0 : 1)) / items.length) * 100}%`,
              }}
            />
          </div>
          <h3>{question.stem}</h3>
          {question.material && <MaterialView material={question.material} />}
          <div className="free-quiz-options">
            {question.options.map((option, optionIndex) => {
              const isAnswer = result && optionIndex === result.answerIndex;
              const isWrong =
                result && picked === optionIndex && !result.correct;
              return (
                <button
                  key={option}
                  type="button"
                  className={`${isAnswer ? "correct" : ""} ${isWrong ? "picked-wrong" : ""}`}
                  disabled={picked !== null || busy}
                  onClick={() => choose(optionIndex)}
                >
                  <span>{String.fromCharCode(65 + optionIndex)}</span>
                  {option}
                </button>
              );
            })}
          </div>
          {result && (
            <div className={`free-quiz-feedback ${result.correct ? "ok" : "no"}`}>
              <strong>
                {result.correct ? (
                  <>
                    <CheckCircle2 size={16} /> 回答正确
                  </>
                ) : (
                  <>
                    <XCircle size={16} /> 正确答案：{question.options[result.answerIndex]}
                  </>
                )}
              </strong>
              <p>{result.explanation}</p>
              <button className="primary" onClick={next}>
                {index + 1 >= items.length ? "查看小练结果" : "下一题"}{" "}
                <ArrowRight size={15} />
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "done" && (
        <div className="free-quiz free-quiz-result doc-practice-quiz">
          <span className="free-quiz-badge">小练完成</span>
          <h3>
            答对 {score}/{items.length} 题
          </h3>
          <p className="muted">
            {score === items.length
              ? "这篇讲解的关键方法已经掌握，可以去完整关卡冲星级了。"
              : score >= 3
                ? "基本掌握，建议回到文中再过一遍错题涉及的步骤。"
                : "先别急着刷题，回到讲解里把例题和公式重新走一遍。"}
          </p>
          <div className="free-quiz-actions">
            <Link className="primary" to={`/quiz?topic=${topic.id}`}>
              去完整关卡 <ArrowRight size={16} />
            </Link>
            <button className="secondary" onClick={restart}>
              <RotateCcw size={15} /> 再练一组
            </button>
          </div>
        </div>
      )}

      {mastery.stars > 0 && (
        <p className="doc-practice-mastery">
          <Trophy size={14} /> 该模块最佳成绩：{"★".repeat(mastery.stars)}
          {mastery.total > 0 &&
            ` · 累计正确率 ${Math.round(mastery.accuracy * 100)}%`}
        </p>
      )}
    </section>
  );
}
