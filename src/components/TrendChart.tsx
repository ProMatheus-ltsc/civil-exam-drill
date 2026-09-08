/**
 * 30 日趋势图：并列柱状（题量/复习次数）+ 归一化折线（正确率）。
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
}: {
  seriesLabels: string[];
  colors: string[];
  points: DayPoint[];
}) {
  const width = 860;
  const height = 190;
  const padL = 38;
  const padR = 14;
  const padT = 18;
  const padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const maxBar = Math.max(1, ...points.flatMap((p) => p.bars));
  const slot = points.length ? plotW / points.length : 1;
  const groupW = slot * 0.62;
  const barW = groupW / Math.max(1, seriesLabels.length);
  const y = (value: number) => padT + plotH - (value / maxBar) * plotH;

  if (!points.length)
    return (
      <div className="trend-empty">
        近 30 天还没有学习记录，先去完成一次训练吧
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
    segment.push(`${cx},${y(point.line * maxBar)}`);
    if (lineSegments.length === 0) lineSegments.push(segment);
    else lineSegments[lineSegments.length - 1] = segment;
  }

  return (
    <figure className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近 30 日学习趋势">
        {[0, 0.5, 1].map((ratio) => {
          const yy = padT + plotH - ratio * plotH;
          return (
            <g key={ratio}>
              <line x1={padL} y1={yy} x2={width - padR} y2={yy} stroke="#e8edf0" />
              <text x={padL - 6} y={yy + 4} textAnchor="end" fontSize="10" fill="#8b99a3">
                {Math.round(maxBar * ratio)}
              </text>
            </g>
          );
        })}
        {points.map((point, index) => {
          const center = padL + slot * index + slot / 2;
          return (
            <g key={point.date}>
              <text x={center} y={height - 8} textAnchor="middle" fontSize="9" fill="#8b99a3">
                {point.date.slice(5)}
              </text>
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
                  cy={y(point.line * maxBar)}
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
        <em>近 30 天 · 东八区自然日</em>
      </figcaption>
    </figure>
  );
}
