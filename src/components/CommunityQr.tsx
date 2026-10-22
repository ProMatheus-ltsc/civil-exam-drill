import { Check, Copy, MessageCircle, QrCode } from "lucide-react";
import { useState } from "react";
import { COMMUNITY } from "../community";
import { useToast } from "@shared/core/hooks/useToast";

export function CommunityQrGrid({ compact = false }: { compact?: boolean }) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const copyWechat = async () => {
    if (!COMMUNITY.wechatId) return;
    try {
      await navigator.clipboard.writeText(COMMUNITY.wechatId);
      setCopied(true);
      showToast("微信号已复制", "success");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      showToast("复制失败，请手动输入微信号", "error");
    }
  };

  return (
    <div className={`community-qr-grid ${compact ? "is-compact" : ""}`}>
      <article className="community-qr-card">
        <span className="community-qr-icon">
          <QrCode size={19} />
        </span>
        <h3>公众号</h3>
        <p>关注「{COMMUNITY.officialName}」，获取更新、打卡提醒和学习方法。</p>
        <img src={COMMUNITY.officialQr} alt="公众号二维码" />
      </article>
      <article className="community-qr-card">
        <span className="community-qr-icon">
          <MessageCircle size={19} />
        </span>
        <h3>个人微信</h3>
        <p>扫码添加，备注「学习助手」，交流训练问题或预约人工批改。</p>
        <img src={COMMUNITY.personalQr} alt="个人微信二维码" />
        {COMMUNITY.wechatId && (
          <button className="secondary community-copy" type="button" onClick={copyWechat}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "已复制" : "复制微信号"}
          </button>
        )}
      </article>
      <p className="community-note">{COMMUNITY.note}</p>
    </div>
  );
}
