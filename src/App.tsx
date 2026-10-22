import { useEffect, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
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
import { EssayPage, KnowledgeDocPage, KnowledgePage } from "./pages/KnowledgePage";
import { MistakesPage } from "./pages/MistakesPage";
import { ProfilePage } from "./pages/ProfilePage";
import { QuizPage } from "./pages/QuizPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { SchultePage } from "./pages/SchultePage";

type User = { id: string; nickname: string; email?: string };
type AuthMode = "login" | "register";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<AuthMode>("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [nickname, setNickname] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError("");
    setPassword("");
    setConfirm("");
  };

  const submit = async () => {
    const trimmedEmail = email.trim();
    if (!emailPattern.test(trimmedEmail)) {
      setError("请输入有效的邮箱地址");
      return;
    }
    if (password.length < 8) {
      setError("密码至少 8 位");
      return;
    }
    if (mode === "register" && password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const data = await api<{ user: User }>(
        mode === "register" ? "/auth/register" : "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            email: trimmedEmail,
            password,
            ...(mode === "register" && nickname.trim()
              ? { nickname: nickname.trim() }
              : {}),
          }),
        },
      );
      onLogin(data.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const submitOnEnter = (event: { key: string }) => {
    if (event.key === "Enter") void submit();
  };

  return (
    <main className="login-shell dvh">
      <section className="login-card auth-card">
        <p className="eyebrow">个人学习工具</p>
        <h1>学习助手</h1>
        <p className="muted">
          {mode === "login"
            ? "使用邮箱登录，继续知识复习与专项训练。"
            : "注册后学习记录会自动同步，换设备也能接着练。"}
        </p>
        <div className="auth-tabs" role="tablist" aria-label="登录或注册">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? "active" : ""}
            onClick={() => switchMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={mode === "register" ? "active" : ""}
            onClick={() => switchMode("register")}
          >
            注册
          </button>
        </div>
        <Stack gap="1rem">
          <label>
            邮箱
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              inputMode="email"
              maxLength={254}
            />
          </label>
          {mode === "register" && (
            <label>
              昵称（可选）
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                maxLength={12}
                placeholder="默认取邮箱前缀，可稍后修改"
                autoComplete="nickname"
                onKeyDown={submitOnEnter}
              />
            </label>
          )}
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              onKeyDown={submitOnEnter}
            />
          </label>
          {mode === "login" && (
            <p className="auth-forgot">
              <Link to="/reset">忘记密码？</Link>
            </p>
          )}
          {mode === "register" && (
            <label>
              确认密码
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="再输入一次密码"
                autoComplete="new-password"
                onKeyDown={submitOnEnter}
              />
            </label>
          )}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="primary touch-target"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy
              ? mode === "login"
                ? "登录中…"
                : "注册中…"
              : mode === "login"
                ? "登录"
                : "注册并登录"}
          </button>
          <p className="auth-switch muted">
            {mode === "login" ? "还没有账号？" : "已有账号？"}
            <button
              type="button"
              onClick={() =>
                switchMode(mode === "login" ? "register" : "login")
              }
            >
              {mode === "login" ? "免费注册" : "返回登录"}
            </button>
          </p>
          <p className="auth-note muted">
            仅支持邮箱登录，密码经加密存储，不会以明文保存。
          </p>
        </Stack>
      </section>
    </main>
  );
}

function SignedIn({ user, onLogout }: { user: User; onLogout: () => void }) {
  const nav = [
    { to: "/knowledge", icon: BookOpen, label: "知识库" },
    { to: "/essay", icon: FileText, label: "写作" },
    { to: "/quiz", icon: Calculator, label: "专项训练" },
    { to: "/mistakes", icon: ListChecks, label: "错题本" },
    { to: "/schulte", icon: Brain, label: "舒尔特方格" },
    { to: "/profile", icon: ChartNoAxesColumn, label: "数据分析" },
  ];
  return (
    <Layout
      navItems={nav}
      appConfig={{ name: "学习助手", icon: Brain }}
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
        <Route path="/profile" element={<ProfilePage user={user} />} />
        <Route path="*" element={<Navigate to="/knowledge" replace />} />
      </Routes>
    </Layout>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
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
  const completeLogin = (next: User) => {
    setUser(next);
    navigate("/knowledge");
  };
  if (location.pathname === "/reset")
    return <ResetPasswordPage onLogin={completeLogin} />;
  return (
    <>
      <ToastContainer />
      {user ? (
        <SignedIn user={user} onLogout={logout} />
      ) : (
        <Login onLogin={completeLogin} />
      )}
    </>
  );
}
