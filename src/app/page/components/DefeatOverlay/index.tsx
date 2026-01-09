"use client";

import { useEffect, useRef, useState } from "react";

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

  // 通过子组件挂载/卸载来重置视频与内容状态，避免在 effect 中同步 setState
  return (
    <DefeatOverlayContent
      onContinue={onContinue}
      title={title}
      description={description}
    />
  );
};

const DefeatOverlayContent = ({
  onContinue,
  title,
  description,
}: Pick<DefeatOverlayProps, "onContinue" | "title" | "description">) => {
  // 控制弹窗内容是否展示，视频开始播放 1 秒后才显示内容
  const [showContent, setShowContent] = useState(false);
  // 记录视频源加载失败次数，用于判断是否所有源都不可用
  const [sourceErrorCount, setSourceErrorCount] = useState(0);
  // 当前视频源总数，用于判断是否全部失败
  const totalSourceCount = 2;
  // 记录延迟展示的计时器，避免重复触发
  const showTimerRef = useRef<number | null>(null);

  // 启动“1 秒后展示内容”的计时器
  const scheduleShowContent = () => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
    }
    showTimerRef.current = window.setTimeout(() => {
      setShowContent(true);
      showTimerRef.current = null;
    }, 800);
  };

  // 如果视频全部加载失败，仍然按照 1 秒延迟展示内容
  useEffect(() => {
    if (sourceErrorCount >= totalSourceCount && !showContent) {
      scheduleShowContent();
    }
  }, [sourceErrorCount, showContent]);

  // 组件卸载时清理计时器，避免残留回调
  useEffect(() => {
    return () => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
      }
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="presentation"
    >
      <div className="absolute inset-0 h-full w-full z-[1000] pointer-events-none">
        <video
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted
          playsInline
          // 视频开始播放后计时 1 秒，再展示弹窗内容
          onPlay={scheduleShowContent}
        >
          <source
            src="/video/firework.mov"
            type="video/quicktime"
            // 某个源加载失败时仅累计次数，不直接展示内容
            onError={() => setSourceErrorCount((count) => count + 1)}
          />
          <source
            src="/video/firework.webm"
            type="video/webm"
            // 某个源加载失败时仅累计次数，不直接展示内容
            onError={() => setSourceErrorCount((count) => count + 1)}
          />
        </video>
      </div>
      {/* 视频播放完成后展示内容 */}
      {showContent ? (
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
      ) : null}
    </div>
  );
};

export default DefeatOverlay;
