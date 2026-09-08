/** 数字推理公共构造：展示项 + 填空 + 选项洗牌 */
import type { QuestionDraft } from "../types";

/** 200 以内质数表 */
export const PRIMES: number[] = (() => {
  const sieve = Array.from({ length: 201 }, () => true);
  sieve[0] = sieve[1] = false;
  for (let i = 2; i * i <= 200; i += 1)
    if (sieve[i]) for (let j = i * i; j <= 200; j += i) sieve[j] = false;
  return sieve.map((ok, value) => (ok ? value : -1)).filter((v) => v > 0);
})();

/** 200 以内合数表 */
export const COMPOSITES: number[] = (() => {
  const list: number[] = [];
  for (let n = 4; n <= 200; n += 1) if (!PRIMES.includes(n)) list.push(n);
  return list;
})();

export interface SeqInput {
  templateId: string;
  params: Record<string, number | string>;
  /** 括号前的展示项（不含答案） */
  shown: (string | number)[];
  answer: string | number;
  distractors: (string | number)[];
  explanation: string;
}

/** 数字推理题干文案：3、7、11、（ ） */
export function seqStem(shown: (string | number)[]) {
  return `${shown.map(String).join("、")}、（ ），求括号中的数。`;
}

function uniqueStrings(answer: string, distractors: (string | number)[]) {
  const values = [answer];
  for (const item of distractors) {
    const text = String(item);
    if (!values.includes(text)) values.push(text);
    if (values.length === 4) break;
  }
  return values;
}

/** 组装 4 选项数字推理题（数量不足时按答案±k 兜底，保证互异） */
export function buildSequence(
  input: SeqInput,
  random: () => number,
): QuestionDraft {
  const answerText = String(input.answer);
  let values = uniqueStrings(answerText, input.distractors);
  const base = typeof input.answer === "number" ? (input.answer as number) : 0;
  let pad = 1;
  while (values.length < 4) {
    const candidate = String(base + pad);
    if (!values.includes(candidate)) values.push(candidate);
    pad += 1;
  }
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [values[index], values[target]] = [values[target], values[index]];
  }
  const answerIndex = values.indexOf(answerText) as 0 | 1 | 2 | 3;
  return {
    templateId: input.templateId,
    params: input.params,
    stem: seqStem(input.shown),
    options: values as [string, string, string, string],
    answerIndex,
    explanation: input.explanation,
  };
}