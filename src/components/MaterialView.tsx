/**
 * 单题短材料渲染：文字段落 + 小型表格 + SVG 柱状/折线图。
 * 只接收纯结构化数据（generator 侧 material spec），不含任何 HTML。
 */
import type { MaterialSpec } from "../generator/types";

function niceMax(values: number[]) {
  const max = Math.max(...values, 0);
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const unit = max / magnitude;
  const step =
    unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return step * magnitude;
}

function MiniChart({ chart }: { chart: NonNullable<MaterialSpec["chart"]> }) {
  const width = 640;
  const height = 170;
  const padL = 46;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const allValues = chart.series.flatMap((s) => s.values);
  const yMax = niceMax(allValues);
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const innerW = plotW / Math.max(1, chart.categories.length);
  const y = (value: number) =>
    padT + plotH - (value / yMax) * plotH;
  const ticks = 4;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${chart.categories.join("、")}图表`}>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const value = (yMax / ticks) * i;
        const yy = y(value);
        return (
          <g key={i}>
            <line x1={padL} y1={yy} x2={width - padR} y2={yy} stroke="#e5eaed" strokeWidth="1" />
            <text x={padL - 6} y={yy + 4} textAnchor="end" fontSize="11" fill="#71818d">
              {Math.round(value)}
            </text>
          </g>
        );
      })}
      {chart.categories.map((category, categoryIndex) => {
        const center = padL + innerW * categoryIndex + innerW / 2;
        const groupWidth = innerW * 0.7;
        const barWidth = groupWidth / Math.max(1, chart.series.length);
        return (
          <g key={category}>
            <text x={center} y={height - 8} textAnchor="middle" fontSize="11" fill="#516676">
              {category}
            </text>
            {chart.series.map((series, seriesIndex) => {
              const value = series.values[categoryIndex] ?? 0;
              if (chart.kind === "bar") {
                const x = center - groupWidth / 2 + barWidth * seriesIndex + 1;
                return (
                  <rect
                    key={series.label}
                    x={x}
                    y={y(Math.max(0, value))}
                    width={Math.max(2, barWidth - 2)}
                    height={Math.max(0, y(0) - y(Math.max(0, value)))}
                    fill={seriesIndex === 0 ? "#17324d" : "#bb623a"}
                    rx="2"
                  />
                );
              }
              const points = chart.categories
                .map((_, i) => {
                  const px = padL + innerW * i + innerW / 2;
                  return `${px},${y(series.values[i] ?? 0)}`;
                })
                .join(" ");
              const colors = ["#17324d", "#bb623a"];
              return (
                <polyline
                  key={series.label}
                  points={points}
                  fill="none"
                  stroke={colors[seriesIndex % colors.length]}
                  strokeWidth="2.5"
                />
              );
            })}
          </g>
        );
      })}
      {chart.series.length > 1 && (
        <g>
          {chart.series.map((series, index) => (
            <g key={series.label} transform={`translate(${padL + (width - padL - padR) * 0.55 + index * 90}, ${padT - 2})`}>
              <rect x={0} y={-9} width={10} height={10} rx="2" fill={index === 0 ? "#17324d" : "#bb623a"} />
              <text x={16} y={0} fontSize="11" fill="#516676">
                {series.label}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

export function MaterialView({ material }: { material: MaterialSpec | null }) {
  if (!material) return null;
  return (
    <div className="material-box">
      {material.paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
      {material.table && (
        <div className="table-scroll">
          <table>
            {material.table.caption && <caption>{material.table.caption}</caption>}
            <thead>
              <tr>
                {material.table.headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {material.table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {material.chart && <MiniChart chart={material.chart} />}
      {material.footnote && <small className="material-footnote">{material.footnote}</small>}
    </div>
  );
}
