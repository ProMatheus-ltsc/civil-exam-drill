/** 随机与数值格式化工具（自旧 index.ts 抽出，语义保持一致） */
import type { Difficulty, Rng } from "./types";

export function seeded(seed: string) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export const scales: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };

/** 由 seed 派生 Rng（含难度档 level） */
export function makeRng(seed: string, difficulty: Difficulty): Rng {
  const next = seeded(seed);
  return {
    level: scales[difficulty],
    random: next,
    integer: (min: number, max: number) =>
      Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(values: readonly T[]) => values[Math.floor(next() * values.length)],
  };
}

export function canonical(params: Record<string, number | string>) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(params).sort((a, b) => a[0].localeCompare(b[0])),
    ),
  );
}

export function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** 数字转展示文本：去掉多余小数尾零 */
export function fmt(value: number, digits = 2) {
  const scaled = round(value, digits);
  return Number.isInteger(scaled)
    ? String(scaled)
    : scaled
        .toFixed(digits)
        .replace(/0+$/, "")
        .replace(/\.$/, "");
}
