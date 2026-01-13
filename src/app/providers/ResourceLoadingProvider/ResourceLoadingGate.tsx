"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import ResourceLoadingOverlay from "@/app/page/components/ResourceLoadingOverlay";
import { useResourceLoading } from "@/app/providers/ResourceLoadingProvider";
import { resumeAudioContext } from "@/app/utils/audioContextManager";

type ResourceLoadingGateProps = {
  children: ReactNode;
};

// 仅在当前文档生命周期内执行一次“刷新清理”逻辑，避免组件重挂载时反复清空标记
let hasHandledReload = false;
// 仅用于客户端运行时记忆“已进入”状态，防止站内跳转时遮罩闪现
let hasEnteredInMemory = false;

/**
 * 资源加载门禁组件：
 * - 未加载完成时只展示加载遮罩
 * - 失败时提供重试入口
 * - 加载完成后才渲染页面内容
 */
export default function ResourceLoadingGate({ children }: ResourceLoadingGateProps) {
  const { isLoading, loaded, total, errors, allLoaded, retry, isResourceCached } =
    useResourceLoading();
  // 记录“已进入站点”的状态，优先读取内存态，避免站内跳转时再次闪出遮罩
  const [hasEntered, setHasEntered] = useState(hasEnteredInMemory);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      // 刷新页面时强制清除标记，确保刷新后仍会展示遮罩（仅清一次，避免路由重挂载误清）
      if (!hasHandledReload) {
        const navEntry = window.performance
          .getEntriesByType("navigation")
          .at(0) as PerformanceNavigationTiming | undefined;
        if (navEntry?.type === "reload") {
          window.sessionStorage.removeItem("roast-ai:has-entered");
        }
        hasHandledReload = true;
      }
      // 仅当本次会话已进入过时，跳过遮罩；若存储不可用则回退到内存状态
      const entered = window.sessionStorage.getItem("roast-ai:has-entered") === "1";
      if (entered || hasEnteredInMemory) {
        hasEnteredInMemory = true;
        setHasEntered(true);
      } else {
        setHasEntered(false);
      }
    } catch {
      // 忽略浏览器禁用存储导致的异常，继续走内存态
    }
  }, []);
  // 用户点击进入时解锁音频，同时放行页面内容
  const handleEnter = useCallback(async () => {
    await resumeAudioContext();
    // 标记为已进入，确保本次会话内的页面跳转不再弹出加载遮罩
    try {
      window.sessionStorage.setItem("roast-ai:has-entered", "1");
    } catch {
      // 忽略浏览器禁用存储导致的异常，继续走内存态
    }
    hasEnteredInMemory = true;
    setHasEntered(true);
  }, []);

  // 资源已命中缓存时直接放行，避免再次显示加载遮罩
  if (isResourceCached || hasEntered) {
    return <>{children}</>;
  }

  // 未点击进入前保持遮罩层展示，加载完成后展示“进入”按钮
  if (!hasEntered) {
    return (
      <div className="relative min-h-screen">
        <ResourceLoadingOverlay
          visible
          loaded={loaded}
          total={total}
          errors={errors}
          onRetry={retry}
          onEnter={allLoaded ? handleEnter : undefined}
        />
      </div>
    );
  }
}
