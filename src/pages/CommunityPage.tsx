import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarCheck, MessageCircle, Users } from "lucide-react";
import { CommunityModal } from "../components/CommunityModal";
import { CommunityQrGrid } from "../components/CommunityQr";

export function CommunityPage({ publicView = false }: { publicView?: boolean }) {
  const [humanReviewOpen, setHumanReviewOpen] = useState(false);
  return (
    <section className="panel community-page">
      <p className="eyebrow">打卡与社群</p>
      <h2>学习社群</h2>
      <p className="muted community-page-lede">
        一个人练很容易断。这里先放公众号和个人微信二维码，后续可以直接替换为真实的打卡群或社群入口。
      </p>
      <div className="community-page-points">
        <div>
          <CalendarCheck size={18} />
          <strong>每日打卡</strong>
          <span>完成今日计划后，在社群里发一张完成截图。</span>
        </div>
        <div>
          <Users size={18} />
          <strong>互相督学</strong>
          <span>找到同岗位、同进度的备考搭子，减少半途而废。</span>
        </div>
        <div>
          <ArrowRight size={18} />
          <strong>人工批改</strong>
          <span>需要逐段点评时，可通过个人微信预约人工批改。</span>
        </div>
      </div>
      <CommunityQrGrid />
      <div className="community-page-actions">
        <button
          className="secondary"
          type="button"
          onClick={() => setHumanReviewOpen(true)}
        >
          <MessageCircle size={16} /> 预约人工批改
        </button>
        {publicView ? (
          <Link className="primary" to="/register">
            免费注册，开始学习 <ArrowRight size={16} />
          </Link>
        ) : (
          <>
            <Link className="primary" to="/plan">
              去看今日计划 <ArrowRight size={16} />
            </Link>
            <Link className="secondary" to="/essay">
              去申论闯关
            </Link>
          </>
        )}
      </div>
      <CommunityModal
        open={humanReviewOpen}
        onClose={() => setHumanReviewOpen(false)}
        title="预约人工批改"
        reason="人工批改为内测增值服务：扫码添加个人微信，备注「人工批改」。当前暂不接入支付，先沟通批改范围与时间。"
      />
    </section>
  );
}