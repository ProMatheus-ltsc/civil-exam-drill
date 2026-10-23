import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  Brain,
  Calculator,
  ChartNoAxesColumn,
  CheckCircle2,
  FileText,
  ListChecks,
  QrCode,
  Sparkles,
  Target,
  Timer,
  Trophy,
} from "lucide-react";
import { PublicLayout } from "../components/PublicLayout";
import { FreeQuiz } from "../components/FreeQuiz";

const features = [
  {
    icon: Calculator,
    title: "资料分析速算",
    text: "27 个速算关卡，从加法、除法到基期比重，按前置关系逐关解锁。",
    to: "/register",
    cta: "开始练",
  },
  {
    icon: FileText,
    title: "申论 39 关",
    text: "六阶段闯关，每关目标、任务、客观题和自评清单都拆好，不再对着资料空看。",
    to: "/register",
    cta: "看关卡",
  },
  {
    icon: Timer,
    title: "30 分钟模考",
    text: "20 题资料分析小模考，交卷即出分数、正确率、用时和薄弱题型报告。",
    to: "/register",
    cta: "去模考",
  },
  {
    icon: ChartNoAxesColumn,
    title: "弱项诊断",
    text: "7/30/90 天趋势、模块正确率、学习热力，直接告诉你下一步补哪一关。",
    to: "/register",
    cta: "看分析",
  },
  {
    icon: ListChecks,
    title: "错题间隔复习",
    text: "错因标签 + 复习时间表，连续答对两次才出清，避免“蒙对一次就消失”。",
    to: "/register",
    cta: "管理错题",
  },
  {
    icon: Brain,
    title: "舒尔特方格",
    text: "数字、汉字、彩色字母三种玩法，免费训练专注力，登录后保存云端历史。",
    to: "/schulte",
    cta: "免费玩",
  },
];

export function LandingPage() {
  return (
    <PublicLayout>
      <main className="public-landing">
        <section className="public-hero">
          <div className="public-hero-copy">
            <p className="eyebrow">每日练习 · 学习记录 · 弱项复盘</p>
            <h1>
              把每一次练习，
              <br />
              <em>变成看得见的进步</em>
            </h1>
            <p className="public-lede">
              资料分析速算、申论闯关、错题复习和模考报告放在同一条学习闭环里。
              不再“刷了很多题”，却说不清自己到底弱在哪。
            </p>
            <div className="public-actions">
              <Link className="primary public-cta" to="/try">
                免费试做 3 题 <ArrowRight size={16} />
              </Link>
              <Link className="secondary public-cta" to="/register">
                免费注册
              </Link>
            </div>
            <ul className="public-trust">
              <li>
                <CheckCircle2 size={15} /> 无需信用卡
              </li>
              <li>
                <CheckCircle2 size={15} /> 邮箱登录，数据云端同步
              </li>
              <li>
                <CheckCircle2 size={15} /> 先练后付费，付费功能暂未开放
              </li>
            </ul>
          </div>
          <div className="public-dashboard-card" aria-hidden="true">
            <div className="public-dashboard-head">
              <div>
                <small>今日计划</small>
                <strong>资料分析 · 15 分钟</strong>
              </div>
              <span className="public-dashboard-ring">
                <strong>72%</strong>
                <small>完成</small>
              </span>
            </div>
            <div className="public-task">
              <span className="public-task-icon speed">
                <Calculator size={15} />
              </span>
              <span>
                <strong>增长率 · 10 题</strong>
                <small>目标正确率 90%</small>
              </span>
              <em>去练</em>
            </div>
            <div className="public-task">
              <span className="public-task-icon mistake">
                <ListChecks size={15} />
              </span>
              <span>
                <strong>今日待复习 · 6 题</strong>
                <small>基期量、比重、平均数</small>
              </span>
              <em>复习</em>
            </div>
            <div className="public-task">
              <span className="public-task-icon mock">
                <Timer size={15} />
              </span>
              <span>
                <strong>资料分析模考</strong>
                <small>20 题 · 30 分钟 · 出报告</small>
              </span>
              <em>去测</em>
            </div>
            <div className="public-mini-chart">
              {[38, 62, 48, 76, 58, 88, 72].map((value, index) => (
                <i key={index} style={{ height: `${value}%` }} />
              ))}
              <span>近 7 天题量</span>
            </div>
          </div>
        </section>

        <section className="public-stats" aria-label="产品数据">
          <div>
            <strong>200+</strong>
            <span>知识文档</span>
          </div>
          <div>
            <strong>56</strong>
            <span>专项训练关卡</span>
          </div>
          <div>
            <strong>39</strong>
            <span>申论闯关</span>
          </div>
          <div>
            <strong>3 档</strong>
            <span>每关难度局</span>
          </div>
        </section>

        <section className="public-section">
          <div className="public-section-head">
            <p className="eyebrow">从“刷题”到“会练”</p>
            <h2>每个模块都围绕一个明确结果</h2>
            <p>不是再堆一个题库，而是把学、练、测、诊断和复习串起来。</p>
          </div>
          <div className="public-feature-grid">
            {features.map((feature) => (
              <article className="public-feature" key={feature.title}>
                <span className="public-feature-icon">
                  <feature.icon size={21} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
                <Link to={feature.to}>
                  {feature.cta} <ArrowRight size={14} />
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="public-section public-demo-section">
          <div className="public-demo-copy">
            <p className="eyebrow">先试后注册</p>
            <h2>3 道题，感受训练方式</h2>
            <p>
              这不是“看一遍就会”的知识点，而是考场里真的会卡住的计算和口径。
              答完立刻看解析，再决定要不要开始系统训练。
            </p>
            <ul className="public-check-list">
              <li>
                <Target size={16} /> 每道题都有可复用的速算方法
              </li>
              <li>
                <Sparkles size={16} /> 答案解析指出常见错法，而不只是给答案
              </li>
              <li>
                <Trophy size={16} /> 注册后可记录进度、错题和薄弱模块
              </li>
            </ul>
          </div>
          <FreeQuiz />
        </section>

        <section className="public-section">
          <div className="public-section-head">
            <p className="eyebrow">怎么开始</p>
            <h2>三步进入自己的训练节奏</h2>
          </div>
          <div className="public-steps">
            <article>
              <span>01</span>
              <h3>先做一次诊断</h3>
              <p>从速算基础关开始，系统记录每道题的对错与用时。</p>
            </article>
            <article>
              <span>02</span>
              <h3>每天领一张计划</h3>
              <p>弱项、错题、规范词和模考按优先级排进今日任务。</p>
            </article>
            <article>
              <span>03</span>
              <h3>用报告看进步</h3>
              <p>模块正确率、趋势和模考分数，帮你判断下一步补哪里。</p>
            </article>
          </div>
        </section>

        <section className="public-community-band">
          <div>
            <p className="eyebrow">打卡与社群</p>
            <h2>一个人练很容易断，一群人会走得更远</h2>
            <p>关注公众号获取更新与打卡提醒，也可以扫码添加个人微信交流。</p>
          </div>
          <Link className="secondary public-cta" to="/community">
            <QrCode size={16} /> 查看社群二维码
          </Link>
        </section>

        <section className="public-final-cta">
          <BookOpen size={30} />
          <h2>下一道题，先把方法练对</h2>
          <p>免费注册后，从第一个速算关卡开始。</p>
          <Link className="primary public-cta" to="/register">
            免费注册 <ArrowRight size={16} />
          </Link>
        </section>
      </main>
    </PublicLayout>
  );
}
