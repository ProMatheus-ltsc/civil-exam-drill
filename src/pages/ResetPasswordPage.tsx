import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Stack } from "@shared/core/components/responsive/Stack";
import { api } from "../api/client";

type ResetUser = { id: string; nickname: string; email?: string };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function ResetPasswordPage({
  onLogin,
}: {
  onLogin: (user: ResetUser) => void;
}) {
  const token = new URLSearchParams(useLocation().search).get("token") ?? "";
  return token ? (
    <SetPassword token={token} onLogin={onLogin} />
  ) : (
    <RequestReset />
  );
}

function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="login-shell dvh">
      <section className="login-card auth-card">
        <p className="eyebrow">账号找回</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
        <Stack gap="1rem">{children}</Stack>
      </section>
    </main>
  );
}

function RequestReset() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = email.trim();
    if (!emailPattern.test(trimmed)) {
      setError("请输入有效的邮箱地址");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const data = await api<{ sent: boolean; devResetUrl?: string }>(
        "/auth/password/forgot",
        {
          method: "POST",
          body: JSON.stringify({ email: trimmed }),
        },
      );
      setDevResetUrl(data.devResetUrl ?? "");
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发送失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="找回密码"
      description="输入注册邮箱，我们会发送一封重置密码的邮件。"
    >
      {sent ? (
        <>
          <p className="auth-success" role="status">
            如果该邮箱已注册，重置链接已发送。请检查收件箱与垃圾邮件，链接 30
            分钟内有效。
          </p>
          {devResetUrl && (
            <a className="primary touch-target dev-reset-link" href={devResetUrl}>
              本地开发：直接打开重置链接
            </a>
          )}
        </>
      ) : (
        <>
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
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
          </label>
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
            {busy ? "发送中…" : "发送重置链接"}
          </button>
        </>
      )}
      <p className="auth-switch muted">
        <Link to="/">返回登录</Link>
      </p>
      <p className="auth-note muted">
        为保护账号安全，无论邮箱是否注册都会提示已发送。
      </p>
    </AuthShell>
  );
}

function SetPassword({
  token,
  onLogin,
}: {
  token: string;
  onLogin: (user: ResetUser) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (password.length < 8) {
      setError("密码至少 8 位");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const data = await api<{ user: ResetUser }>("/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      onLogin(data.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重置失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="设置新密码"
      description="设置完成后会退出其他设备的登录，并用新密码自动登录。"
    >
      <label>
        新密码
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="至少 8 位"
          autoComplete="new-password"
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />
      </label>
      <label>
        确认新密码
        <input
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder="再输入一次密码"
          autoComplete="new-password"
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />
      </label>
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
        {busy ? "重置中…" : "重置密码并登录"}
      </button>
      <p className="auth-switch muted">
        <Link to="/reset">重新申请重置链接</Link>
        <span aria-hidden="true">·</span>
        <Link to="/">返回登录</Link>
      </p>
      <p className="auth-note muted">
        密码经加盐哈希存储，不会以明文保存。
      </p>
    </AuthShell>
  );
}
