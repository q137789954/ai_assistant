"use client";

import { useState, type ReactNode } from "react";
import ResourceLoadingOverlay from "@/app/page/components/ResourceLoadingOverlay";
import { useResourceLoading } from "@/app/providers/ResourceLoadingProvider";

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
          onEnter={allLoaded ? () => setHasEntered(true) : undefined}
        />
      </div>
    );
  }
}
