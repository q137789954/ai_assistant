"use client";

type ResourceLoadingOverlayProps = {
  /** 是否展示资源加载遮罩层 */
  visible: boolean;
  /** 当前已加载的资源数量 */
  loaded: number;
  /** 需要加载的资源总量 */
  total: number;
  /** 资源加载失败的错误列表 */
  errors?: string[];
  /** 触发重试的回调 */
  onRetry?: () => void;
  /** 资源加载完成后进入站点的回调 */
  onEnter?: () => void;
};

const ResourceLoadingOverlay = ({
  visible,
  loaded,
  total,
  errors = [],
  onRetry,
  onEnter,
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

  const hasError = errors.length > 0;
  // 资源加载完成且无错误时允许进入站点
  const canEnter = !hasError && loaded >= total;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#0b0c11]/95 text-white">
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
        {/* 文案：展示加载进度或错误提示 */}
        <div className="text-[12px] uppercase tracking-[0.22em] text-[rgba(204,255,0,0.6)] sm:text-[12px] md:text-[13px]">
          {hasError
            ? "LOADING FAILED"
            : canEnter
              ? "READY TO ENTER"
              : `LOADING ENVIRONMENT ${percent}%`}
        </div>
        {hasError && (
          <div className="flex flex-col items-center gap-3 text-xs text-red-200">
            {/* 展示错误数量，避免直接刷屏 */}
            <div>资源加载失败（{errors.length} 个）。</div>
            {onRetry && (
              <button
                className="rounded-full border border-[rgba(204,255,0,0.6)] px-4 py-1 text-[12px] uppercase tracking-[0.22em] text-[rgba(204,255,0,0.8)] transition hover:border-[rgba(204,255,0,0.9)] hover:text-[rgba(204,255,0,0.95)]"
                onClick={onRetry}
              >
                RETRY
              </button>
            )}
          </div>
        )}
        {canEnter && onEnter && (
          <button
            className="rounded-full border border-[rgba(204,255,0,0.7)] px-5 py-1.5 text-[12px] uppercase tracking-[0.28em] text-[rgba(204,255,0,0.9)] transition hover:border-[rgba(204,255,0,1)] hover:text-[rgba(204,255,0,1)]"
            onClick={onEnter}
          >
            ENTER
          </button>
        )}
      </div>
    </div>
  );
};

export default ResourceLoadingOverlay;
