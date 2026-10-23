import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Brain, ArrowRight } from "lucide-react";

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="public-shell">
      <header className="public-header">
        <Link className="public-brand" to="/">
          <span className="public-brand-icon">
            <Brain size={20} />
          </span>
          <span>
            <strong>学习助手</strong>
          </span>
        </Link>
        <nav className="public-nav" aria-label="公开导航">
          <Link to="/try">免费体验</Link>
          <Link to="/schulte">舒尔特方格</Link>
          <Link to="/community">学习社群</Link>
          <Link to="/login">登录</Link>
          <Link className="public-nav-cta" to="/register">
            免费注册 <ArrowRight size={14} />
          </Link>
        </nav>
      </header>
      {children}
      <footer className="public-footer">
        <div>
          <strong>学习助手</strong>
          <p>资料分析速算、申论闯关与学习数据，放在同一个练习闭环里。</p>
        </div>
        <div className="public-footer-links">
          <Link to="/try">免费体验</Link>
          <Link to="/schulte">舒尔特方格</Link>
          <Link to="/community">学习社群</Link>
          <Link to="/login">登录</Link>
        </div>
        <small>仅供个人学习使用 · 题目与材料如涉版权问题请联系处理</small>
      </footer>
    </div>
  );
}
