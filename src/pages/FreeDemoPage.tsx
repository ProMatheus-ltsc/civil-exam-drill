import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Timer, TrendingUp } from "lucide-react";
import { PublicLayout } from "../components/PublicLayout";
import { FreeQuiz } from "../components/FreeQuiz";

export function FreeDemoPage() {
  return (
    <PublicLayout>
      <main className="public-demo-page">
        <section className="public-demo-page-head">
          <p className="eyebrow">免费体验</p>
          <h1>3 道题，先看看自己卡在哪</h1>
          <p>
            不用注册，直接作答。每题都会给出方法和常见错法，答完可以继续进入完整关卡训练。
          </p>
        </section>
        <div className="public-demo-page-grid">
          <FreeQuiz />
          <aside className="public-demo-aside">
            <div>
              <Timer size={20} />
              <h3>真实考场口径</h3>
              <p>按资料分析的常见问法出题，不是脱离场景的纯计算。</p>
            </div>
            <div>
              <TrendingUp size={20} />
              <h3>训练会记录数据</h3>
              <p>注册后每题的对错、用时、模块都会进入学习分析。</p>
            </div>
            <div>
              <CheckCircle2 size={20} />
              <h3>先从基础关开始</h3>
              <p>系统会按前置关系解锁，不需要一上来就硬啃难题。</p>
            </div>
            <Link className="primary" to="/register">
              免费注册，继续训练 <ArrowRight size={16} />
            </Link>
          </aside>
        </div>
      </main>
    </PublicLayout>
  );
}
