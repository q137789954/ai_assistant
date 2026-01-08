"use client";

import { useEffect } from "react";

export type DefeatOverlayProps = {
  // 控制弹窗是否显示
  open: boolean;
  // 点击关闭按钮或遮罩时触发
  onClose?: () => void;
  // 点击“继续对战”按钮时触发
  onContinue?: () => void;
  // 弹窗标题
  title?: string;
  // 弹窗描述文案
  description?: string;
};

const DefeatOverlay = ({
  open,
  onContinue,
  title = "你击败了我",
  description = "破防条已满，企鹅认输。要不要继续开喷？",
}: DefeatOverlayProps) => {
  // 弹窗出现时锁定页面滚动，避免背景内容继续滚动
  useEffect(() => {
    if (!open) {
      return;
    }
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="presentation"
    >
      {/* <video
        className="absolute inset-0 h-full w-full object-cover z-[1000] pointer-events-none"
        autoPlay
        loop
        muted
        playsInline
      >
        <source src="/video/firework.mp4" type="video/mp4" />
      </video> */}
      <div
        className="w-[min(90vw,420px)] rounded-3xl bg-white/80 px-6 py-5 text-center shadow-2xl backdrop-blur-lg"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="击败提示"
      >
        <div className="text-2xl font-semibold text-slate-900">{title}</div>
        <div className="mt-2 text-sm text-slate-600">{description}</div>
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            className="rounded-full bg-black px-5 py-2 text-sm font-semibold text-white transition hover:bg-black/80"
            // 点击继续时只触发继续事件，避免提前关闭导致流程中断
            onClick={() => onContinue?.()}
          >
            继续对战
          </button>
        </div>
      </div>
    </div>
  );
};

export default DefeatOverlay;
