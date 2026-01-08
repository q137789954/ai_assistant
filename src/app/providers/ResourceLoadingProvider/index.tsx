"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_ANIMATION_LIST } from "@/app/providers/AnimationProvider/animationCatalog";

/**
 * 资源加载上下文暴露给外部的状态结构。
 */
export type ResourceLoadingState = {
  /** 是否仍在加载中（包含重试流程） */
  isLoading: boolean;
  /** 进度百分比（0-100） */
  progress: number;
  /** 已完成加载的资源数量 */
  loaded: number;
  /** 资源总数 */
  total: number;
  /** 失败的资源列表（包含 URL 和错误信息） */
  errors: string[];
  /** 是否全部资源加载成功 */
  allLoaded: boolean;
  /** 触发重新加载的入口 */
  retry: () => void;
};

const ResourceLoadingContext = createContext<ResourceLoadingState | undefined>(undefined);

/**
 * 供组件安全读取资源加载状态，确保必须在 Provider 内使用。
 */
export const useResourceLoading = () => {
  const context = useContext(ResourceLoadingContext);
  if (!context) {
    throw new Error("useResourceLoading 必须在 ResourceLoadingProvider 内部调用");
  }
  return context;
};

type ResourceLoadingProviderProps = {
  children: ReactNode;
  /**
   * 可选的额外资源 URL（例如未来的音频/图片），会与动画资源一起加载。
   */
  resources?: string[];
};

/**
 * 统一的资源加载 Provider：
 * - 进入站点即加载动画/音频/图片等资源
 * - 提供进度、错误、重试能力
 */
export default function ResourceLoadingProvider({
  children,
  resources,
}: ResourceLoadingProviderProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [loaded, setLoaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [retryCount, setRetryCount] = useState(0);

  // 记录当前一次加载的终止逻辑，便于重试或卸载时取消请求
  const abortControllersRef = useRef<AbortController[]>([]);
  const completedRef = useRef(0);
  const errorsRef = useRef<string[]>([]);

  // 将动画资源 + 外部资源合并，去重后作为最终加载列表
  const resourceList = useMemo(() => {
    const animationResources = DEFAULT_ANIMATION_LIST.flatMap((animation) =>
      [animation.json, animation.atlas, animation.image].filter(Boolean),
    ) as string[];
    const extraResources = (resources ?? []).filter(Boolean);
    return Array.from(new Set([...animationResources, ...extraResources]));
  }, [resources]);

  const resetCounters = useCallback(() => {
    completedRef.current = 0;
    errorsRef.current = [];
  }, []);

  const retry = useCallback(() => {
    setRetryCount((count) => count + 1);
  }, []);

  useEffect(() => {
    // 每次进入加载流程先重置状态，确保进度条与错误列表同步
    resetCounters();
    setErrors([]);
    setLoaded(0);
    setTotal(resourceList.length);
    setIsLoading(resourceList.length > 0);

    // 如无资源需要加载，直接标记完成
    if (resourceList.length === 0) {
      setIsLoading(false);
      return;
    }

    let aborted = false;
    abortControllersRef.current.forEach((controller) => controller.abort());
    abortControllersRef.current = [];

    const handleComplete = (errorMessage?: string) => {
      if (aborted) {
        return;
      }
      if (errorMessage) {
        errorsRef.current = [...errorsRef.current, errorMessage];
        setErrors(errorsRef.current);
      }
      completedRef.current += 1;
      setLoaded(completedRef.current);
      // 当全部资源完成后，停止 loading 状态
      if (completedRef.current >= resourceList.length) {
        setIsLoading(false);
      }
    };

    resourceList.forEach((url) => {
      const controller = new AbortController();
      abortControllersRef.current.push(controller);
      fetch(url, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          // 读取响应体确保资源真正被下载完成，避免只完成了头部握手
          return response.arrayBuffer();
        })
        .catch((error: unknown) => {
          if (aborted || controller.signal.aborted) {
            return;
          }
          const message =
            error instanceof Error ? error.message : String(error ?? "未知错误");
          handleComplete(`资源加载失败：${url}（${message}）`);
          return;
        })
        .finally(() => {
          if (aborted || controller.signal.aborted) {
            return;
          }
          // 失败与成功都要计入已完成进度
          if (!errorsRef.current.some((item) => item.includes(url))) {
            handleComplete();
          }
        });
    });

    return () => {
      aborted = true;
      abortControllersRef.current.forEach((controller) => controller.abort());
      abortControllersRef.current = [];
    };
  }, [resourceList, retryCount, resetCounters]);

  // 进度百分比，避免 total 为 0 的除零
  const progress = useMemo(() => {
    const safeTotal = Math.max(total, 1);
    return Math.min(100, Math.round((loaded / safeTotal) * 100));
  }, [loaded, total]);

  // 仅当加载流程结束且无错误时才视为全部资源就绪，避免初始状态误判
  const allLoaded = !isLoading && loaded >= total && errors.length === 0;

  const value = useMemo(
    () => ({
      isLoading,
      progress,
      loaded,
      total,
      errors,
      allLoaded,
      retry,
    }),
    [isLoading, progress, loaded, total, errors, allLoaded, retry],
  );

  return (
    <ResourceLoadingContext.Provider value={value}>
      {children}
    </ResourceLoadingContext.Provider>
  );
}
