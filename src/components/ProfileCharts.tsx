/** 个人数据分析的无依赖 SVG/CSS 图表组件 */
import { titleOf } from "../generator/catalog";

export function ProgressRing({
  ratio,
  value,
  label,
  size = 92,
  stroke = 9,
  color = "#315c77",
}: {
  ratio: number;
  value?: string;
  label?: string;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="progress-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e8eef1"
          strokeWidth={stroke}
        />
        {clamped > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * clamped} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div className="progress-ring-center">
        <strong>{value ?? `${Math.round(clamped * 100)}%`}</strong>
        {label && <span>{label}</span>}
      </div>
    </div>
  );
}

type TrendDay = {
  date: string;
  quizCount: number;
  cardReviews: number;
  schulteRuns: number;
  retries: number;
};

/** 所选范围的学习热力（按自然周排列，颜色越深当日学习项越多） */
export function ActivityHeatmap({ days }: { days: TrendDay[] }) {
  if (!days.length)
    return <p className="muted hint-line">最近还没有学习记录。</p>;
  const totals = days.map(
    (day) =>
      day.quizCount + day.cardReviews + day.schulteRuns + day.retries,
  );
  const max = Math.max(1, ...totals);
  const firstWeekday =
    (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const blanks = Array.from({ length: firstWeekday }, (_, index) => index);
  return (
    <figure className="activity-heatmap">
      <div className="heat-grid">
        {blanks.map((index) => (
          <span className="heat-cell blank" key={`blank-${index}`} />
        ))}
        {days.map((day, index) => {
          const total = totals[index];
          const level = total === 0 ? 0 : Math.min(4, 1 + Math.floor((total / max) * 4));
          return (
            <span
              key={day.date}
              className="heat-cell"
              data-level={level}
              title={`${day.date.slice(5)} · 答题 ${day.quizCount} · 复习 ${day.cardReviews} · 舒尔特 ${day.schulteRuns} · 错题重做 ${day.retries}`}
            />
          );
        })}
      </div>
      <figcaption>
        <span>颜色越深，当日学习项越多</span>
        <span className="heat-legend">
          少
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} data-level={level} />
          ))}
          多
        </span>
      </figcaption>
    </figure>
  );
}

type WeekdayItem = { weekday: number; quizCount: number; correct: number };

/** 一周答题节奏柱图（周一=0） */
export function WeekdayBars({
  items,
  days,
}: {
  items: WeekdayItem[];
  days?: number;
}) {
  const labels = ["一", "二", "三", "四", "五", "六", "日"];
  const max = Math.max(1, ...items.map((item) => item.quizCount));
  const total = items.reduce((sum, item) => sum + item.quizCount, 0);
  if (!total)
    return <p className="muted hint-line">完成一次专项训练后展示答题节奏。</p>;
  return (
    <figure className="weekday-chart">
      <div className="weekday-bars">
        {items.map((item) => (
          <div className="weekday-col" key={item.weekday}>
            <span className="weekday-value">
              {item.quizCount || ""}
            </span>
            <div className="weekday-track">
              <div
                className="weekday-bar"
                style={{ height: `${Math.max(2, (item.quizCount / max) * 100)}%` }}
                title={`${labels[item.weekday]} · ${item.quizCount} 题 · 正确率 ${
                  item.quizCount
                    ? Math.round((item.correct / item.quizCount) * 100)
                    : 0
                }%`}
              />
            </div>
            <span className="weekday-label">周{labels[item.weekday]}</span>
          </div>
        ))}
      </div>
      <figcaption>
        最近 {days ?? 30} 天答题量分布 · 周末也别忘了保持手感
      </figcaption>
    </figure>
  );
}

type ModuleItem = {
  topicId: string;
  total: number;
  accuracy: number;
  stars: number;
};

function accuracyColor(accuracy: number) {
  if (accuracy >= 0.9) return "#2f7d5d";
  if (accuracy >= 0.8) return "#315c77";
  if (accuracy >= 0.6) return "#bb623a";
  return "#a33a2e";
}

/** 分模块正确率横条（默认把弱项排在前面） */
export function ModuleAccuracyBars({
  items,
  limit = 12,
}: {
  items: ModuleItem[];
  limit?: number;
}) {
  if (!items.length)
    return (
      <p className="muted hint-line">
        完成专项训练后，这里会按正确率标出需要补强的模块。
      </p>
    );
  const sorted = [...items]
    .sort((a, b) => {
      const enoughA = a.total >= 5 ? 1 : 0;
      const enoughB = b.total >= 5 ? 1 : 0;
      if (enoughA !== enoughB) return enoughB - enoughA;
      return a.accuracy - b.accuracy || b.total - a.total;
    })
    .slice(0, limit);
  return (
    <div className="module-bars">
      {sorted.map((item) => (
        <div className="bar-row" key={item.topicId}>
          <span className="bar-label" title={titleOf(item.topicId)}>
            {titleOf(item.topicId)}
            {item.stars > 0 && (
              <i className="bar-stars" title={`高难度局 ${item.stars} 星`}>
                {"★".repeat(item.stars)}
              </i>
            )}
          </span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width: `${Math.max(2, Math.round(item.accuracy * 100))}%`,
                background: accuracyColor(item.accuracy),
              }}
            />
          </div>
          <span className="bar-value">
            {Math.round(item.accuracy * 100)}%
          </span>
          <span className="bar-meta">{item.total} 题</span>
        </div>
      ))}
    </div>
  );
}

type DifficultyItem = {
  difficulty: "easy" | "medium" | "hard";
  total: number;
  accuracy: number;
  averageMs: number;
};

const difficultyLabel: Record<DifficultyItem["difficulty"], string> = {
  easy: "低难度",
  medium: "中难度",
  hard: "高难度 · 实战",
};
const difficultyColor: Record<DifficultyItem["difficulty"], string> = {
  easy: "#7fa88f",
  medium: "#315c77",
  hard: "#bb623a",
};

/** 低/中/高难度题量环图 + 正确率图例 */
export function DifficultyDonut({ items }: { items: DifficultyItem[] }) {
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const size = 148;
  const stroke = 18;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let cursor = 0;
  return (
    <div className="difficulty-viz">
      <div className="difficulty-donut">
        <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#edf1f3"
            strokeWidth={stroke}
          />
          {total > 0 &&
            items.map((item) => {
              if (!item.total) return null;
              const length = (item.total / total) * circumference;
              const offset = -cursor;
              cursor += length;
              return (
                <circle
                  key={item.difficulty}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={difficultyColor[item.difficulty]}
                  strokeWidth={stroke}
                  strokeDasharray={`${Math.max(0, length - 2)} ${circumference}`}
                  strokeDashoffset={offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
            })}
        </svg>
        <div className="donut-center">
          <strong>{total}</strong>
          <span>累计题量</span>
        </div>
      </div>
      <div className="difficulty-legend">
        {items.map((item) => (
          <div className="difficulty-row" key={item.difficulty}>
            <span
              className="legend-dot"
              style={{ background: difficultyColor[item.difficulty] }}
            />
            <div className="difficulty-text">
              <strong>{difficultyLabel[item.difficulty]}</strong>
              <span>
                {item.total} 题 · 正确率{" "}
                {item.total ? `${Math.round(item.accuracy * 100)}%` : "—"}
              </span>
            </div>
            <div className="difficulty-meter">
              <i
                style={{
                  width: `${item.total ? Math.max(3, item.accuracy * 100) : 0}%`,
                  background: difficultyColor[item.difficulty],
                }}
              />
            </div>
            <span className="difficulty-time">
              {item.total ? `${(item.averageMs / 1000).toFixed(1)}s/题` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 星级分布条：0 / 1 / 2 / 3 星模块占比 */
export function StarDistribution({
  items,
  totalStars,
  maxStars,
}: {
  items: Array<{ stars: number; count: number }>;
  totalStars: number;
  maxStars: number;
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const colors = ["#e3e9ec", "#b98a4b", "#8a6d3b", "#2f7d5d"];
  return (
    <div className="star-distribution">
      <div className="star-strip">
        {items.map((item) =>
          item.count > 0 ? (
            <span
              key={item.stars}
              style={{
                flexGrow: item.count,
                background: colors[Math.min(3, item.stars)],
                color: item.stars === 0 ? "#516676" : "#fff",
              }}
              title={`${item.stars} 星 · ${item.count} 个模块`}
            >
              {item.count}
            </span>
          ) : null,
        )}
      </div>
      <div className="star-legend">
        {items.map((item) => (
          <span key={item.stars}>
            <i style={{ background: colors[Math.min(3, item.stars)] }} />
            {item.stars === 0 ? "未通关" : `${item.stars} 星`} · {item.count}
          </span>
        ))}
        <em>
          累计 {totalStars}/{maxStars} 星 · {total} 个模块
        </em>
      </div>
    </div>
  );
}
