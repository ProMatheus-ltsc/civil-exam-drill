import { useEffect, useState } from "react";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import { ResponsiveGrid } from "@shared/core/components/responsive/ResponsiveGrid";
import { StatCard } from "@shared/core/components/stats/StatCard";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";

type QuizStats = { overall: { total: number; accuracy: number } };
type SchulteStats = { personalBestMs: number | null };
export function ProfilePage() {
  const [stats, setStats] = useState<QuizStats | null>(null),
    [history, setHistory] = useState<SchulteStats | null>(null);
  const { busy, run } = useAsync();
  useEffect(() => {
    void run(async () => {
      const [a, b]: [QuizStats, SchulteStats] = await Promise.all([
        api<QuizStats>("/quiz/stats"),
        api<SchulteStats>("/schulte/results?limit=20"),
      ]);
      setStats(a);
      setHistory(b);
    });
  }, []);
  if (busy) return <LoadingSpinner message="统计加载中…" />;
  return (
    <section className="panel">
      <p className="eyebrow">学习记录</p>
      <h2>学习统计</h2>
      <ResponsiveGrid minItemWidth="180px" gap="1rem">
        <StatCard label="速算题量" value={stats?.overall.total ?? 0} />
        <StatCard
          label="正确率"
          value={`${Math.round((stats?.overall.accuracy ?? 0) * 100)}%`}
        />
        <StatCard
          label="舒尔特最佳"
          value={
            history?.personalBestMs
              ? (history.personalBestMs / 1000).toFixed(2) + " 秒"
              : "-"
          }
        />
      </ResponsiveGrid>
    </section>
  );
}
