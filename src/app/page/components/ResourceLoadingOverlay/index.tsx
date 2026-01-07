"use client";

type ResourceLoadingOverlayProps = {
  /** 是否展示资源加载遮罩层 */
  visible: boolean;
  /** 当前已加载的资源数量 */
  loaded: number;
  /** 需要加载的资源总量 */
  total: number;
};

const ResourceLoadingOverlay = ({
  visible,
  loaded,
  total,
}: ResourceLoadingOverlayProps) => {
  // 资源加载完成后直接返回 null，避免渲染空容器占位
  if (!visible) {
    return null;
  }

  // 防止 total 为 0 导致除零异常，同时将百分比控制在 0-100
  const safeTotal = Math.max(total, 1);
  const percent = Math.min(100, Math.round((loaded / safeTotal) * 100));
  // 进度条宽度百分比，配合内联样式实现精确展示
  const progressWidth = `${percent}%`;

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-[#0b0c11]/95 text-white">
      {/* 主体容器：在移动端更窄、在桌面端更宽 */}
      <div className="flex w-[78vw] max-w-[520px] flex-col items-center gap-4 text-center sm:w-[360px] sm:max-w-[560px] md:w-[460px]">
        {/* 标题：仿照示例做字距与轻微发光效果 */}
        <div className="select-none text-[20px] font-semibold tracking-[0.38em] text-[rgba(204,255,0,0.9)] drop-shadow-[0_0_12px_rgba(255,255,255,0.25)] sm:text-[22px] md:text-[24px]">
          ROAST.AI
        </div>
        {/* 进度条外框：使用半透明边框与圆角营造质感 */}
        <div className="h-[10px] w-full rounded-full border border-slate-200/40 bg-white/5 shadow-[0_0_18px_rgba(255,255,255,0.08)]">
          {/* 进度条填充：与示例一致的亮色条，支持百分比变化 */}
          <div
            className="h-full rounded-full bg-gradient-to-r from-[rgba(204,255,0,0.5)] via-[rgba(204,255,0,.8)] to-[rgba(204,255,0,.6)] transition-[width] duration-300"
            style={{ width: progressWidth }}
          />
        </div>
        {/* 文案：展示加载进度 */}
        <div className="text-[12px] uppercase tracking-[0.22em] text-[rgba(204,255,0,0.6)] sm:text-[12px] md:text-[13px]">
          LOADING ENVIRONMENT {percent}%
        </div>
      </div>
    </div>
  );
};

export default ResourceLoadingOverlay;
