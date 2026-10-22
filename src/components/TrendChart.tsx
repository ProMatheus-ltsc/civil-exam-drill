import { useEffect, useState } from "react";

/**
 * 趋势图：并列柱状（题量/复习次数）+ 归一化折线（正确率）。
 * 无第三方依赖的轻量 SVG；断档日折线自动分段，不跨空连点。
 */
type DayPoint = {
  date: string;
  bars: number[];
  line: number | null; // 0~1
};
export function TrendChart({
  seriesLabels,
  colors,
  points,
  days,
}: {
  seriesLabels: string[];
  colors: string[];
  points: DayPoint[];
  days?: number;
}) {
  // 手机屏上 860 宽等比缩到 ~330px，刻度会只剩 4px；窄屏改用更高的独立坐标系。
  const [compact, setCompact] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 640px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const width = compact ? 390 : 860;
  const height = compact ? 230 : 190;
  const padL = compact ? 30 : 38;
  const padR = compact ? 42 : 44;
  const padT = 18;
  const padB = compact ? 30 : 26;
  const tickFont = compact ? 12 : 10;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const maxBar = Math.max(1, ...points.flatMap((p) => p.bars));
  const slot = points.length ? plotW / points.length : 1;
  const groupW = slot * 0.62;
  const barW = groupW / Math.max(1, seriesLabels.length);
  const y = (value: number) => padT + plotH - (value / maxBar) * plotH;
  const accuracyY = (ratio: number) => padT + plotH - ratio * plotH;
  const tickStep = Math.max(1, Math.ceil(points.length / 7));

  if (!points.length)
    return (
      <div className="trend-empty">
        近 {days ?? 30} 天还没有学习记录，先去完成一次训练吧
      </div>
    );

  // 折线分段：跳过无正确率的天，避免跨空连点
  const lineSegments: string[][] = [];
  for (const [index, point] of points.entries()) {
    if (point.line === null) {
      lineSegments.push([]);
      continue;
    }
    const cx = padL + slot * index + slot / 2;
    const segment = lineSegments[lineSegments.length - 1] ?? [];
    segment.push(`${cx},${accuracyY(point.line)}`);
    if (lineSegments.length === 0) lineSegments.push(segment);
    else lineSegments[lineSegments.length - 1] = segment;
  }

  return (
    <figure className="trend-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`近 ${days ?? 30} 日学习趋势`}
      >
        {[0, 0.5, 1].map((ratio) => {
          const yy = padT + plotH - ratio * plotH;
          return (
            <g key={ratio}>
              <line x1={padL} y1={yy} x2={width - padR} y2={yy} stroke="#e8edf0" />
              <text x={padL - 6} y={yy + 4} textAnchor="end" fontSize={tickFont} fill="#8b99a3">
                {Math.round(maxBar * ratio)}
              </text>
              <text x={width - padR + 6} y={yy + 4} textAnchor="start" fontSize={tickFont} fill="#a33a2e">
                {Math.round(ratio * 100)}%
              </text>
            </g>
          );
        })}
        {points.map((point, index) => {
          const center = padL + slot * index + slot / 2;
          const showDate =
            index % tickStep === 0 || index === points.length - 1;
          return (
            <g key={point.date}>
              <title>
                {`${point.date} · ${seriesLabels
                  .map((label, seriesIndex) => `${label} ${point.bars[seriesIndex] ?? 0}`)
                  .join(" · ")}${
                  point.line !== null
                    ? ` · 正确率 ${Math.round(point.line * 100)}%`
                    : ""
                }`}
              </title>
              {showDate && (
                <text x={center} y={height - 8} textAnchor="middle" fontSize={tickFont} fill="#8b99a3">
                  {point.date.slice(5)}
                </text>
              )}
              {point.bars.map((value, seriesIndex) => (
                <rect
                  key={seriesIndex}
                  x={center - groupW / 2 + barW * seriesIndex + 0.5}
                  y={y(value)}
                  width={Math.max(1.5, barW - 1)}
                  height={Math.max(0, padT + plotH - y(value))}
                  fill={colors[seriesIndex % colors.length]}
                  rx="1"
                  opacity={value > 0 ? 0.95 : 0.18}
                />
              ))}
              {point.line !== null && (
                <circle
                  cx={center}
                  cy={accuracyY(point.line)}
                  r="2.2"
                  fill="#fff"
                  stroke="#a33a2e"
                  strokeWidth="1.4"
                />
              )}
            </g>
          );
        })}
        {lineSegments
          .filter((segment) => segment.length >= 2)
          .map((segment, index) => (
            <polyline
              key={index}
              points={segment.join(" ")}
              fill="none"
              stroke="#a33a2e"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          ))}
      </svg>
      <figcaption>
        {seriesLabels.map((label, index) => (
          <span key={label}>
            <i style={{ background: colors[index % colors.length] }} /> {label}
          </span>
        ))}
        {points.some((p) => p.line !== null) && (
          <span>
            <i style={{ background: "#a33a2e" }} /> 正确率
          </span>
        )}
        <em>近 {days ?? 30} 天 · 东八区自然日</em>
      </figcaption>
    </figure>
  );
}
