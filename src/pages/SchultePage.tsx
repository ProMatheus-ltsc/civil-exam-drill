import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { Stack } from "@shared/core/components/responsive/Stack";
import { useToast } from "@shared/core/hooks/useToast";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";

type History = {
  items: Array<{
    id: string;
    elapsedMs: number;
    mistakes: number;
    createdAt: string;
  }>;
  personalBestMs: number | null;
  trend: Array<{ time: string; valueMs: number }>;
};
const cn = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const chinese = (n: number) =>
  n < 10
    ? cn[n]
    : n === 10
      ? "十"
      : n < 20
        ? `十${cn[n - 10]}`
        : `${cn[Math.floor(n / 10)]}十${cn[n % 10]}`;
const letter = (n: number) => {
  let text = "";
  for (let value = n; value > 0; value = Math.floor((value - 1) / 26))
    text = String.fromCharCode(65 + ((value - 1) % 26)) + text;
  return text;
};
const colors = [
  "#dc2626",
  "#2563eb",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
];

export function SchultePage() {
  const [size, setSize] = useState(5),
    [variant, setVariant] = useState("standard"),
    [cells, setCells] = useState<number[]>([]),
    [expected, setExpected] = useState(1),
    [mistakes, setMistakes] = useState(0),
    [history, setHistory] = useState<History | null>(null);
  const started = useRef(0),
    historyRequest = useRef(0),
    { showToast } = useToast(),
    { run } = useAsync();
  const loadHistory = async () => {
    const requestId = ++historyRequest.current;
    const result = await api<History>(
      `/schulte/results?gridSize=${size}&variant=${variant}&limit=20`,
    );
    if (requestId === historyRequest.current) setHistory(result);
  };
  useEffect(() => {
    void run(loadHistory);
  }, [size, variant]);
  const start = () => {
    const values = Array.from({ length: size * size }, (_, index) => index + 1);
    for (let index = values.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [values[index], values[swap]] = [values[swap], values[index]];
    }
    setCells(values);
    setExpected(1);
    setMistakes(0);
    started.current = performance.now();
  };
  const click = (value: number) => {
    if (!started.current) return;
    if (value !== expected) {
      setMistakes((current) => current + 1);
      return;
    }
    if (value < cells.length) {
      setExpected((current) => current + 1);
      return;
    }
    const elapsedMs = Math.round(performance.now() - started.current);
    started.current = 0;
    void run(async () => {
      const result = await api<{ personalBestMs: number }>("/schulte/results", {
        method: "POST",
        body: JSON.stringify({
          gridSize: size,
          variant,
          elapsedMs,
          mistakes,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      showToast(
        `完成 ${(elapsedMs / 1000).toFixed(2)} 秒；最佳 ${(result.personalBestMs / 1000).toFixed(2)} 秒`,
        "success",
      );
      await loadHistory();
    });
  };
  const label = (value: number) =>
    variant === "hanzi"
      ? chinese(value)
      : variant === "color_letters"
        ? letter(value)
        : String(value);
  const trendPoints = history?.trend
    .map((point, index, all) => {
      const values = all.map((item) => item.valueMs),
        min = Math.min(...values),
        max = Math.max(...values);
      return `${(index * 300) / (all.length - 1)},${75 - ((point.valueMs - min) * 60) / Math.max(1, max - min)}`;
    })
    .join(" ");
  return (
    <section className="panel">
      <p className="eyebrow">专注力训练</p>
      <h2>舒尔特方格</h2>
      <Stack direction="horizontal" wrap gap="0.75rem" align="end">
        <label>
          阶数
          <select
            value={size}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              setSize(Number(event.target.value))
            }
          >
            {Array.from(
              { length: variant === "color_letters" ? 4 : 9 },
              (_, index) => index + 2,
            ).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          变体
          <select
            value={variant}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setVariant(event.target.value);
              if (event.target.value === "color_letters" && size > 5)
                setSize(5);
            }}
          >
            <option value="standard">数字</option>
            <option value="hanzi">汉字数字</option>
            <option value="color_letters">彩色字母</option>
          </select>
        </label>
        <button className="primary" onClick={start}>
          {cells.length ? "重新开始" : "开始训练"}
        </button>
      </Stack>
      <p>
        {cells.length
          ? `请点击：${expected} · 误点：${mistakes}`
          : "选择阶数和显示方式后开始"}
      </p>
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${size},1fr)` }}
      >
        {cells.map((value) => (
          <button
            key={value}
            disabled={value < expected}
            style={
              variant === "color_letters"
                ? { color: colors[(value - 1) % colors.length] }
                : undefined
            }
            onClick={() => click(value)}
          >
            {label(value)}
          </button>
        ))}
      </div>
      <section className="schulte-history">
        <h3>历史成绩</h3>
        {history?.trend && history.trend.length >= 2 && (
          <svg viewBox="0 0 300 90" role="img" aria-label="用时趋势">
            <polyline
              fill="none"
              stroke="#bb623a"
              strokeWidth="3"
              points={trendPoints}
            />
          </svg>
        )}
        {history?.items.length ? (
          history.items.map((item) => (
            <div key={item.id}>
              <span>{new Date(item.createdAt).toLocaleString("zh-CN")}</span>
              <strong>{(item.elapsedMs / 1000).toFixed(2)} 秒</strong>
              <span>误点 {item.mistakes}</span>
            </div>
          ))
        ) : (
          <p className="muted">当前阶数和变体暂无记录</p>
        )}
      </section>
    </section>
  );
}
