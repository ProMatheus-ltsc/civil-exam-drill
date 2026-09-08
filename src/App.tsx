import { useEffect, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Brain,
  Calculator,
  ChartNoAxesColumn,
  FileText,
  ListChecks,
} from "lucide-react";
import { Layout } from "@shared/core/components/Layout";
import { LoadingSpinner } from "@shared/core/components/LoadingSpinner";
import { Stack } from "@shared/core/components/responsive/Stack";
import { ToastContainer } from "@shared/core/components/Toast";
import { api } from "./api/client";
import { useAsync } from "./hooks/useAsync";
import { EssayPage, KnowledgeDocPage, KnowledgePage } from "./pages/KnowledgePage";
import { MistakesPage } from "./pages/MistakesPage";
import { ProfilePage } from "./pages/ProfilePage";
import { QuizPage } from "./pages/QuizPage";
import { SchultePage } from "./pages/SchultePage";

type User = { id: string; nickname: string };

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [inviteCode, setInviteCode] = useState(""),
    [nickname, setNickname] = useState("");
  const { busy, run } = useAsync();
  const submit = () =>
    run(async () => {
      const data = await api<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ inviteCode, nickname }),
      });
      onLogin(data.user);
    });
  return (
    <main className="login-shell dvh">
      <section className="login-card">
        <p className="eyebrow">个人备考工具</p>
        <h1>公考加油站</h1>
        <p className="muted">登录后继续知识复习和专项训练。</p>
        <Stack gap="1rem">
          <label>
            邀请码
            <input
              value={inviteCode}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setInviteCode(event.target.value)
              }
              placeholder="请输入邀请码"
            />
          </label>
          <label>
            昵称
            <input
              value={nickname}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setNickname(event.target.value)
              }
              maxLength={12}
              placeholder="1～12 个字符"
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) =>
                event.key === "Enter" && submit()
              }
            />
          </label>
          <button
            className="primary touch-target"
            disabled={busy}
            onClick={submit}
          >
            {busy ? "登录中…" : "进入学习"}
          </button>
        </Stack>
      </section>
    </main>
  );
}

function SignedIn({ user, onLogout }: { user: User; onLogout: () => void }) {
  const nav = [
    { to: "/knowledge", icon: BookOpen, label: "知识库" },
    { to: "/essay", icon: FileText, label: "申论" },
    { to: "/quiz", icon: Calculator, label: "专项训练" },
    { to: "/mistakes", icon: ListChecks, label: "错题本" },
    { to: "/schulte", icon: Brain, label: "舒尔特方格" },
    { to: "/profile", icon: ChartNoAxesColumn, label: "个人统计" },
  ];
  return (
    <Layout
      navItems={nav}
      appConfig={{ name: "公考加油站", icon: Brain }}
      storageKey="civil-exam-nav"
      user={{ username: user.nickname }}
      onLogout={onLogout}
    >
      <Routes>
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/knowledge/:id" element={<KnowledgeDocPage />} />
        <Route path="/essay" element={<EssayPage />} />
        <Route path="/quiz" element={<QuizPage />} />
        <Route path="/mistakes" element={<MistakesPage />} />
        <Route path="/schulte" element={<SchultePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/knowledge" replace />} />
      </Routes>
    </Layout>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  useEffect(() => {
    api<{ user: User }>("/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  const logout = () => {
    void api("/auth/logout", { method: "POST" })
      .catch(() => undefined)
      .finally(() => {
        setUser(null);
        navigate("/");
      });
  };
  if (loading) return <LoadingSpinner message="恢复登录状态…" />;
  return (
    <>
      <ToastContainer />
      {user ? (
        <SignedIn user={user} onLogout={logout} />
      ) : (
        <Login
          onLogin={(next) => {
            setUser(next);
            navigate("/knowledge");
          }}
        />
      )}
    </>
  );
}
