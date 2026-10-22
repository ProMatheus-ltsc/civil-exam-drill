import { useEffect } from "react";
import { X } from "lucide-react";
import { CommunityQrGrid } from "./CommunityQr";

export function CommunityModal({
  open,
  onClose,
  title = "加入学习社群",
  reason,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  reason?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="community-mask" onClick={onClose}>
      <div
        className="community-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="community-modal-head">
          <div>
            <p className="eyebrow">打卡 · 交流 · 人工批改</p>
            <h2>{title}</h2>
            {reason && <p className="muted">{reason}</p>}
          </div>
          <button className="back" type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <CommunityQrGrid compact />
      </div>
    </div>
  );
}
