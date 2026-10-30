import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  BellRing,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  ListChecks,
  PenLine,
  Target,
  Timer,
} from "lucide-react";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import { useToast } from "@shared/core/hooks/useToast";
import { api } from "../api/client";
import { titleOf } from "../generator";

type QuizItem = {
  topicId: string;
  total: number;
  correct: number;
  accuracy: number;
  averageMs: number;
  stars: number;
  track: string;
};

type Summary = {
  activity: {
    streak: number;
    activeToday: boolean;
    today: {
      quizCount: number;
      cardReviews: number;
      schulteRuns: number;
      retries: number;
    };
  };
  quiz: { items: QuizItem[] };
  cards: {
    summary: {
      total: number;
      new: number;
      due: number;
      learning: number;
      mastered: number;
    };
  };
  mistakes: { open: number; mastered: number };
  essay: {
    cleared: number;
    total: number;
    todayDone: boolean;
    next: {
      id: string;
      day: number;
      title: string;
      goal: string;
      minutes: number;
      taskCount: number;
      firstTask: { title: string; minutes: number } | null;
    } | null;
  };
};

type MockItem = {
  id: string;
  status: "active" | "submitted";
  score: number | null;
  submittedAt: string | null;
  correctCount: number | null;
  questionCount: number;
};

type MockList = { items: MockItem[]; active: MockItem | null };

type TaskKind = "mistake" | "target" | "cards";

type PlanTask = {
  id: string;
  kind: TaskKind;
  title: string;
  reason: string;
  minutes: number;
  href: string;
  cta: string;
  done: boolean;
};

const TASK_ICON: Record<TaskKind, typeof Target> = {
  mistake: ListChecks,
  target: Target,
  cards: BookOpen,
};

const REMINDER_KEY = "civil-exam-reminder";
type Reminder = { enabled: boolean; time: string; lastNotified: string };
const defaultReminder: Reminder = { enabled: false, time: "20:00", lastNotified: "" };

function readReminder(): Reminder {
  try {
    const parsed = JSON.parse(localStorage.getItem(REMINDER_KEY) ?? "") as Partial<Reminder>;
    return {
      enabled: Boolean(parsed.enabled),
      time: /^\d{2}:\d{2}$/.test(String(parsed.time)) ? String(parsed.time) : "20:00",
      lastNotified: String(parsed.lastNotified ?? ""),
    };
  } catch {
    return defaultReminder;
  }
}

function saveReminder(reminder: Reminder) {
  localStorage.setItem(REMINDER_KEY, JSON.stringify(reminder));
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE");
}

function reminderSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 13) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function daysSince(raw: string | null) {
  if (!raw) return null;
  const time = Date.parse(raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`);
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

export function PlanPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [mocks, setMocks] = useState<MockList | null>(null);
  const [reminder, setReminder] = useState<Reminder>(readReminder);
  const [busy, setBusy] = useState(true);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    const [profile, mockList] = await Promise.all([
      api<Summary>("/profile/summary?days=7"),
      api<MockList>("/mock/exams").catch(() => ({ items: [], active: null })),
    ]);
    setSummary(profile);
    setMocks(mockList);
  }, []);

  useEffect(() => {
    setBusy(true);
    void load()
      .catch(() => undefined)
      .finally(() => setBusy(false));
  }, [load]);

  useEffect(() => {
    if (!reminder.enabled) return;
    const check = () => {
      if (!reminderSupported() || Notification.permission !== "granted") return;
      const now = new Date();
      const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const day = todayKey();
      if (reminder.lastNotified === day || clock < reminder.time) return;
      const next = { ...reminder, lastNotified: day };
      setReminder(next);
      saveReminder(next);
      void navigator.serviceWorker
        ?.getRegistration()
        .then(async (registration) => {
          if (registration) {
            await registration.showNotification("该学习啦", {
              body: "今天的 15 分钟计划还没完成，来做几道题保持节奏。",
              tag: "civil-exam-daily",
            });
            return;
          }
          new Notification("该学习啦", {
            body: "今天的 15 分钟计划还没完成，来做几道题保持节奏。",
            tag: "civil-exam-daily",
          });
        })
        .catch(() => undefined);
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [reminder]);

  const plan = useMemo(() => {
    const today = summary?.activity.today ?? {
      quizCount: 0,
      cardReviews: 0,
      schulteRuns: 0,
      retries: 0,
    };
    const items = summary?.quiz.items ?? [];
    const weak = [...items]
      .filter((item) => item.total >= 3 && item.accuracy < 0.7)
      .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total)[0];
    const fallback = [...items].sort(
      (a, b) => a.stars - b.stars || a.total - b.total,
    )[0];
    const focusId = weak?.topicId ?? fallback?.topicId ?? "addition";
    const focusTitle = titleOf(focusId);
    const focusReason = weak
      ? `正确率 ${Math.round(weak.accuracy * 100)}%，低于 70% 目标线，优先补这一类`
      : fallback
        ? "这一关还没拿到三星，用一局 10 题把星级补上"
        : "先完成一局 10 题，建立你的能力基线";

    const tasks: PlanTask[] = [];
    if ((summary?.mistakes.open ?? 0) > 0) {
      tasks.push({
        id: "mistakes",
        kind: "mistake",
        title: "错题重练",
        reason: `还有 ${summary?.mistakes.open} 道错题没掌握，先清掉 5 道`,
        minutes: 5,
        href: "/mistakes?due=1",
        cta: "去重练",
        done: today.retries > 0,
      });
    }
    const cardsTask =
      (summary?.cards.summary.due ?? 0) > 0
        ? {
            reason: `${summary?.cards.summary.due} 张规范词卡片今天到期`,
            minutes: 2,
          }
        : (summary?.cards.summary.new ?? 0) > 0
          ? {
              reason: `还有 ${summary?.cards.summary.new} 张新卡片没看过，先翻 5 张`,
              minutes: 2,
            }
          : null;
    if (cardsTask) {
      tasks.push({
        id: "cards",
        kind: "cards",
        title: "规范词卡片",
        reason: cardsTask.reason,
        minutes: cardsTask.minutes,
        href: "/essay?tab=cards",
        cta: "去复习",
        done: today.cardReviews > 0,
      });
    }
    const used = tasks.reduce((sum, task) => sum + task.minutes, 0);
    const focusMinutes = Math.min(10, Math.max(5, 15 - used));
    tasks.splice(tasks.length ? 1 : 0, 0, {
      id: "focus",
      kind: "target",
      title: `弱项专练 · ${focusTitle}`,
      reason: focusReason,
      minutes: focusMinutes,
      href: `/quiz?topic=${focusId}`,
      cta: "开始一局",
      done: today.quizCount >= 10,
    });

    const doneCount = tasks.filter((task) => task.done).length;
    const totalMinutes = tasks.reduce((sum, task) => sum + task.minutes, 0);
    return { tasks, today, doneCount, totalMinutes, focusId, focusTitle };
  }, [summary]);

  /**
   * 申论主线：与行测微计划分开展示。
   * 申论一关 30~120 分钟，塞进「15 分钟」的行测计划里会把节奏撑爆，
   * 所以单独成卡、按子任务推进，并始终占位（哪怕全通关）——
   * 之前这块整个缺失，导致申论断档 14 天都没人提醒。
   */
  const essayTask = useMemo(() => {
    const essay = summary?.essay;
    if (!essay) return null;
    if (!essay.next) {
      if (essay.cleared < essay.total) return null;
      return {
        title: "申论 39 关已全部通关",
        reason: "闯关部分结束，接下来用整卷模考保持手感",
        minutes: 0,
        href: "/essay",
        cta: "查看进度",
        done: essay.todayDone,
        badge: `${essay.cleared}/${essay.total}`,
      };
    }
    const { next } = essay;
    const first = next.firstTask;
    return {
      title: `申论 Day${next.day} · ${next.title}`,
      reason: first
        ? `今日第 1/${next.taskCount} 步：${first.title}（${first.minutes} 分钟）· 全关共 ${next.minutes} 分钟，可拆几次做完 · 已通关 ${essay.cleared}/${essay.total}`
        : `已通关 ${essay.cleared}/${essay.total}，这一关还没开始`,
      minutes: first?.minutes ?? next.minutes,
      href: "/essay",
      cta: "去闯关",
      done: essay.todayDone,
      badge: `${essay.cleared}/${essay.total}`,
    };
  }, [summary]);

  const challenge = useMemo(() => {
    const submitted = (mocks?.items ?? [])
      .filter((item) => item.status === "submitted")
      .sort((a, b) => Date.parse(b.submittedAt ?? "") - Date.parse(a.submittedAt ?? ""));
    const latest = submitted[0];
    if (!latest) {
      return {
        title: "完整模考 · 30 分钟",
        reason: "还没有模考记录，先测一次真实水平",
        href: "/mock",
        cta: "开始模考",
      };
    }
    const days = daysSince(latest.submittedAt);
    if (latest.score !== null && latest.score < 60) {
      return {
        title: "模考复盘 · 5 分钟",
        reason: `最近一次 ${latest.score} 分，先看最弱题型的解析`,
        href: `/mock/${latest.id}/report`,
        cta: "查看报告",
      };
    }
    if (days !== null && days >= 7) {
      return {
        title: "保持考试手感 · 30 分钟",
        reason: `距上次模考已 ${days} 天，建议再测一次`,
        href: "/mock",
        cta: "再考一次",
      };
    }
    return {
      title: "最近模考报告",
      reason: `${latest.score ?? 0} 分 · ${days === 0 ? "今天" : `${days ?? 0} 天前`}`,
      href: `/mock/${latest.id}/report`,
      cta: "打开报告",
    };
  }, [mocks]);

  const enableReminder = async () => {
    if (!reminderSupported()) {
      showToast("当前浏览器不支持通知提醒", "error");
      return;
    }
    if (Notification.permission === "denied") {
      showToast("通知权限已被拒绝，请在浏览器设置中开启", "error");
      return;
    }
    const permission =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    if (permission !== "granted") {
      showToast("没有获得通知权限，提醒未开启", "error");
      return;
    }
    const next = { ...reminder, enabled: true };
    setReminder(next);
    saveReminder(next);
    showToast(`已设置每天 ${next.time} 提醒`, "success");
  };

  const disableReminder = () => {
    const next = { ...reminder, enabled: false };
    setReminder(next);
    saveReminder(next);
    showToast("已关闭学习提醒", "success");
  };

  const changeReminderTime = (time: string) => {
    const next = { ...reminder, time };
    setReminder(next);
    saveReminder(next);
  };

  if (busy && !summary) return <LoadingSpinner message="正在生成今日计划…" />;

  const activeExam = mocks?.active;
  const progress = plan.tasks.length
    ? Math.round((plan.doneCount / plan.tasks.length) * 100)
    : 0;
  const permissionText = !reminderSupported()
    ? "当前浏览器不支持通知"
    : Notification.permission === "denied"
      ? "通知权限已被拒绝，可在浏览器设置中重新开启"
      : reminder.enabled
        ? `每天 ${reminder.time} 提醒已开启（需保持页面打开）`
        : "开启后，到点会收到浏览器通知";

  return (
    <section className="panel plan-page">
      <div className="plan-head">
        <div>
          <p className="eyebrow">今日计划</p>
          <h2>
            <CalendarCheck size={22} /> {greeting()}，今天练 {plan.totalMinutes} 分钟
          </h2>
          <p className="muted">
            {new Intl.DateTimeFormat("zh-CN", {
              month: "long",
              day: "numeric",
              weekday: "long",
            }).format(new Date())}
            {" · "}
            连续学习 {summary?.activity.streak ?? 0} 天
          </p>
        </div>
        <div className="plan-progress">
          <strong>
            {plan.doneCount}/{plan.tasks.length}
          </strong>
          <span>已完成</span>
          <div className="plan-progress-track">
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <div className="plan-today">
        <span>今日已练 {plan.today.quizCount} 题</span>
        <span>复习 {plan.today.cardReviews} 张卡片</span>
        <span>重做 {plan.today.retries} 道错题</span>
      </div>

      {activeExam && (
        <Link className="plan-active" to={`/mock/${activeExam.id}`}>
          <Timer size={18} />
          <span>有一场进行中的模考，回来继续作答</span>
          <ArrowRight size={16} />
        </Link>
      )}

      {essayTask && (
        <article className={`plan-task plan-essay${essayTask.done ? " done" : ""}`}>
          <span className="plan-task-icon">
            {essayTask.done ? <CheckCircle2 size={20} /> : <PenLine size={20} />}
          </span>
          <div className="plan-task-body">
            <div className="plan-task-head">
              <h3>{essayTask.title}</h3>
              <span className="plan-essay-badge">申论 {essayTask.badge}</span>
              {essayTask.minutes > 0 && (
                <span className="plan-task-time">
                  <Clock3 size={13} /> {essayTask.minutes} 分钟
                </span>
              )}
            </div>
            <p>{essayTask.reason}</p>
          </div>
          <Link
            className={essayTask.done ? "secondary plan-task-cta" : "primary plan-task-cta"}
            to={essayTask.href}
          >
            {essayTask.done ? "再练一次" : essayTask.cta}
          </Link>
        </article>
      )}

      <div className="plan-tasks">
        {plan.tasks.map((task) => {
          const Icon = TASK_ICON[task.kind];
          return (
            <article
              key={task.id}
              className={`plan-task${task.done ? " done" : ""}`}
            >
              <span className="plan-task-icon">
                {task.done ? <CheckCircle2 size={20} /> : <Icon size={20} />}
              </span>
              <div className="plan-task-body">
                <div className="plan-task-head">
                  <h3>{task.title}</h3>
                  <span className="plan-task-time">
                    <Clock3 size={13} /> {task.minutes} 分钟
                  </span>
                </div>
                <p>{task.reason}</p>
              </div>
              <Link
                className={task.done ? "secondary plan-task-cta" : "primary plan-task-cta"}
                to={task.href}
              >
                {task.done ? "再练一次" : task.cta}
              </Link>
            </article>
          );
        })}
      </div>

      <div className="plan-columns">
        <section className="plan-block">
          <h3>本周弱项</h3>
          {(summary?.quiz.items.length ?? 0) === 0 ? (
            <p className="muted">完成第一局训练后，这里会按正确率排出优先补强顺序。</p>
          ) : (
            <ul className="plan-weak-list">
              {[...(summary?.quiz.items ?? [])]
                .sort((a, b) => a.accuracy - b.accuracy)
                .slice(0, 4)
                .map((item) => (
                  <li key={item.topicId}>
                    <div className="plan-weak-head">
                      <span>{titleOf(item.topicId)}</span>
                      <strong>{Math.round(item.accuracy * 100)}%</strong>
                    </div>
                    <div className="plan-weak-track">
                      <i style={{ width: `${Math.round(item.accuracy * 100)}%` }} />
                    </div>
                    <span className="muted">
                      {item.correct}/{item.total} 题 · 高难度 {item.stars} 星
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section className="plan-block plan-challenge">
          <h3>下一步挑战</h3>
          <p className="plan-challenge-title">{challenge.title}</p>
          <p className="muted">{challenge.reason}</p>
          <Link className="secondary plan-task-cta" to={challenge.href}>
            {challenge.cta} <ArrowRight size={15} />
          </Link>
        </section>

        <section className="plan-block plan-reminder">
          <h3>
            {reminder.enabled ? <BellRing size={17} /> : <Bell size={17} />} 学习提醒
          </h3>
          <p className="muted">{permissionText}</p>
          <label className="plan-reminder-time">
            提醒时间
            <input
              type="time"
              value={reminder.time}
              onChange={(event) => changeReminderTime(event.target.value)}
            />
          </label>
          <div className="plan-reminder-actions">
            {reminder.enabled ? (
              <button className="secondary" onClick={disableReminder}>
                关闭提醒
              </button>
            ) : (
              <button className="primary" onClick={() => void enableReminder()}>
                开启提醒
              </button>
            )}
            <Link className="plan-community-link" to="/community">
              找同伴一起学
            </Link>
          </div>
        </section>
      </div>
    </section>
  );
}
