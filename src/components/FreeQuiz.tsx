import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, RotateCcw, XCircle } from "lucide-react";

type DemoQuestion = {
  tag: string;
  stem: string;
  options: string[];
  answer: number;
  explanation: string;
};

const questions: DemoQuestion[] = [
  {
    tag: "多位数加法",
    stem: "4827 + 3196 = ?",
    options: ["7923", "8023", "8123", "7903"],
    answer: 1,
    explanation: "高位叠加：4800+3100=7900，27+96=123，合计 8023。",
  },
  {
    tag: "基期量",
    stem: "某市 2023 年 GDP 为 4800 亿元，同比增长 12.5%。2022 年约为多少亿元？",
    options: ["4267", "4320", "4420", "4500"],
    answer: 0,
    explanation: "基期量 = 现期 ÷ (1+增长率) = 4800 ÷ 1.125 ≈ 4267 亿元。",
  },
  {
    tag: "比重",
    stem: "2023 年出口 235420 亿元、进口 177260 亿元。出口占进出口总额的比重约为？",
    options: ["52.9%", "57.0%", "43.0%", "60.1%"],
    answer: 1,
    explanation: "进出口总额 = 235420+177260 = 412680；235420÷412680 ≈ 57.0%。",
  },
];

export function FreeQuiz() {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const question = questions[index];

  const choose = (option: number) => {
    if (picked !== null) return;
    setPicked(option);
    if (option === question.answer) setScore((value) => value + 1);
  };

  const next = () => {
    if (index + 1 >= questions.length) {
      setFinished(true);
      return;
    }
    setIndex((value) => value + 1);
    setPicked(null);
  };

  const restart = () => {
    setIndex(0);
    setPicked(null);
    setScore(0);
    setFinished(false);
  };

  if (finished) {
    return (
      <div className="free-quiz free-quiz-result">
        <span className="free-quiz-badge">体验完成</span>
        <h3>
          答对 {score}/{questions.length} 题
        </h3>
        <p className="muted">
          {score >= 3
            ? "计算底子不错，可以直接进入关卡训练。"
            : score >= 2
              ? "基础在线，系统训练能把速度和稳定性再拉一档。"
              : "别急，速算靠方法不靠硬算，专项训练会拆开教你。"}
        </p>
        <div className="free-quiz-actions">
          <Link className="primary" to="/register">
            免费注册，开始训练 <ArrowRight size={16} />
          </Link>
          <button className="secondary" onClick={restart}>
            <RotateCcw size={15} /> 再做一次
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="free-quiz">
      <div className="free-quiz-head">
        <span className="free-quiz-badge">免费体验 · 无需登录</span>
        <span className="muted">
          {index + 1} / {questions.length}
        </span>
      </div>
      <div className="free-quiz-progress" aria-hidden="true">
        <i style={{ width: `${((index + (picked === null ? 0 : 1)) / questions.length) * 100}%` }} />
      </div>
      <p className="free-quiz-tag">{question.tag}</p>
      <h3>{question.stem}</h3>
      <div className="free-quiz-options">
        {question.options.map((option, optionIndex) => {
          const isAnswer = picked !== null && optionIndex === question.answer;
          const isWrong = picked === optionIndex && optionIndex !== question.answer;
          return (
            <button
              key={option}
              type="button"
              className={`${isAnswer ? "correct" : ""} ${isWrong ? "picked-wrong" : ""}`}
              disabled={picked !== null}
              onClick={() => choose(optionIndex)}
            >
              <span>{String.fromCharCode(65 + optionIndex)}</span>
              {option}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div className={`free-quiz-feedback ${picked === question.answer ? "ok" : "no"}`}>
          <strong>
            {picked === question.answer ? (
              <>
                <CheckCircle2 size={16} /> 回答正确
              </>
            ) : (
              <>
                <XCircle size={16} /> 正确答案：{question.options[question.answer]}
              </>
            )}
          </strong>
          <p>{question.explanation}</p>
          <button className="primary" onClick={next}>
            {index + 1 >= questions.length ? "查看结果" : "下一题"} <ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
