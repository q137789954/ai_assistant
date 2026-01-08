"use client";

import type { ReactNode } from "react";
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

  if (!allLoaded) {
    return (
      <div className="relative min-h-screen">
        <ResourceLoadingOverlay
          visible={isLoading || errors.length > 0}
          loaded={loaded}
          total={total}
          errors={errors}
          onRetry={retry}
        />
      </div>
    );
  }

  return <>{children}</>;
}
