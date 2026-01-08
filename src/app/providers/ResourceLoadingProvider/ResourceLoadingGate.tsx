"use client";

import { useCallback, useState, type ReactNode } from "react";
import ResourceLoadingOverlay from "@/app/page/components/ResourceLoadingOverlay";
import { useResourceLoading } from "@/app/providers/ResourceLoadingProvider";
import { resumeAudioContext } from "@/app/utils/audioContextManager";

type ResourceLoadingGateProps = {
  children: ReactNode;
};

/**
 * 资源加载门禁组件：
 * - 未加载完成时只展示加载遮罩
 * - 失败时提供重试入口
 * - 加载完成后才渲染页面内容
 */
export default function ResourceLoadingGate({ children }: ResourceLoadingGateProps) {
  const { isLoading, loaded, total, errors, allLoaded, retry } = useResourceLoading();
  // 控制用户是否已点击“进入”，未进入前始终保持遮罩
  const [hasEntered, setHasEntered] = useState(false);
  // 用户点击进入时解锁音频，同时放行页面内容
  const handleEnter = useCallback(async () => {
    await resumeAudioContext();
    setHasEntered(true);
  }, []);

  if (hasEntered) {
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
