import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "civil-exam-install-dismissed";

/** 可安装时展示一次底部安装条；用户拒绝后不再打扰 */
export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if (localStorage.getItem(DISMISS_KEY)) return;
    const onPrompt = (raw: Event) => {
      raw.preventDefault();
      setEvent(raw as InstallEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt as EventListener);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt as EventListener);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  };

  const install = async () => {
    if (!event) return;
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === "accepted") {
      setVisible(false);
      setEvent(null);
    }
  };

  if (!visible || !event) return null;
  return (
    <div className="install-prompt" role="dialog" aria-label="安装学习助手">
      <span className="install-prompt-icon">
        <Download size={18} />
      </span>
      <div className="install-prompt-copy">
        <strong>把「学习助手」安装到桌面</strong>
        <p>像 App 一样打开，练习提醒更可靠。</p>
      </div>
      <div className="install-prompt-actions">
        <button className="primary" type="button" onClick={() => void install()}>
          安装
        </button>
        <button
          className="secondary"
          type="button"
          aria-label="暂不安装"
          onClick={dismiss}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
