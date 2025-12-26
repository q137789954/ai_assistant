'use client'

type SpineInstance = import('@pixi-spine/all-4.1').Spine

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSession } from 'next-auth/react'

export interface AnimationMeta {
  id: string
  description?: string
  json: string
  atlas?: string
  image?: string
}

export interface PreloadProgress {
  loaded: number
  total: number
}

// 默认的 Spine 动画列表，确保在未提供参数时也有可播放的骨骼资源
const DEFAULT_ANIMATION_LIST: AnimationMeta[] = [
  {
    id: 'idle1',
    description: '待机动画1',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
  },
  {
    id: 'idle2',
    description: '待机动画2',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
  },
  {
    id: 'idle3',
    description: '待机动画3',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
  },
  {
    id: 'listen',
    description: '听动作',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
  },
  {
    id: 'talk',
    description: '说动作',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
  },
]

interface SpineRegistration {
  spine: SpineInstance | null
  defaultAnimationName?: string | null
}

// Context 暴露出的功能项，供下游消费控制动画播放、切换与加载状态
interface AnimationProviderContext {
  animations: AnimationMeta[]
  currentAnimation: AnimationMeta | null
  isPreloading: boolean
  allAnimationsLoaded: boolean
  preloadProgress: PreloadProgress
  registerSpineInstance: (registration: SpineRegistration) => void
  switchToAnimationById: (id: string) => void
  play: () => void
  pause: () => void
  resetToFirstFrame: () => void
}

const AnimationProviderContext = createContext<AnimationProviderContext | null>(null)

// 方便组件直接获取动画上下文，确保必须在 Provider 内使用
export function useAnimationPlayer() {
  const context = useContext(AnimationProviderContext)
  if (!context) {
    throw new Error('useAnimationPlayer 必须在 AnimationProvider 内部调用')
  }
  return context
}

export interface AnimationProviderProps {
  animations?: AnimationMeta[]
  children: React.ReactNode
}

export default function AnimationProvider({
  animations: rawAnimations,
  children,
}: AnimationProviderProps) {
  // 生成最终的动画配置列表，优先使用 props 传入的值
  const animations = useMemo(
    () => (rawAnimations && rawAnimations.length > 0 ? rawAnimations : DEFAULT_ANIMATION_LIST),
    [rawAnimations]
  )
  const { status } = useSession()

  const [currentAnimationId, setCurrentAnimationId] = useState<string | null>(
    animations[0]?.id ?? null
  )
  // 预加载状态相关字段，用于消费层显示进度或提示
  const [isPreloading, setIsPreloading] = useState(false)
  const [allAnimationsLoaded, setAllAnimationsLoaded] = useState(animations.length === 0)
  const [preloadProgress, setPreloadProgress] = useState<PreloadProgress>({
    loaded: 0,
    total: animations.length,
  })

  const spineInstanceRef = useRef<SpineInstance | null>(null)
  const primaryAnimationNameRef = useRef<string | null>(null)
  const preloadAbortRef = useRef<() => void>(() => {})

  // 动画列表变更时需要重置预加载状态及计数器
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPreloadProgress({ loaded: 0, total: animations.length })
      setAllAnimationsLoaded(animations.length === 0)
      setIsPreloading(false)
      preloadAbortRef.current()
    }, 0)
    return () => {
      window.clearTimeout(timer)
    }
  }, [animations])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (animations.length === 0) {
        setCurrentAnimationId(null)
        return
      }
      if (currentAnimationId && animations.some((item) => item.id === currentAnimationId)) {
        return
      }
      setCurrentAnimationId(animations[0].id)
    }, 0)
    return () => {
      window.clearTimeout(timer)
    }
  }, [animations, currentAnimationId])

  const currentAnimation = useMemo(
    () => animations.find((item) => item.id === currentAnimationId) ?? animations[0] ?? null,
    [animations, currentAnimationId]
  )

  // 提供给渲染组件注册 Spine 实例和默认动画名称的能力
  const registerSpineInstance = useCallback(
    ({ spine, defaultAnimationName = null }: SpineRegistration) => {
      spineInstanceRef.current = spine
      primaryAnimationNameRef.current = defaultAnimationName
    },
    []
  )

  // 播放控制：恢复 Spine 时间缩放率
  const play = useCallback(() => {
    const spine = spineInstanceRef.current
    if (!spine) {
      return
    }
    spine.state.timeScale = 1
  }, [])

  // 暂停控制：把时间缩放置为 0
  const pause = useCallback(() => {
    const spine = spineInstanceRef.current
    if (!spine) {
      return
    }
    spine.state.timeScale = 0
  }, [])

  // 重置到默认动画的起始帧并暂停
  const resetToFirstFrame = useCallback(() => {
    const spine = spineInstanceRef.current
    const animationName = primaryAnimationNameRef.current
    if (!spine || !animationName) {
      return
    }
    spine.state.setAnimation(0, animationName, true)
    spine.state.timeScale = 0
    spine.update(0)
  }, [])

  // 根据 id 切换到指定动画配置
  const switchToAnimationById = useCallback(
    (id: string) => {
      if (!id || !animations.some((item) => item.id === id)) {
        return
      }
      // 只有在确实发生动画切换时才调用 setState，避免 setter 依赖 currentAnimationId 导致函数身份变化
      setCurrentAnimationId((prevId) => (prevId === id ? prevId : id))
    },
    [animations]
  )

  // 认证用户才会执行预加载，依赖状态控制取消与进度反馈
  useEffect(() => {
    if (status !== 'authenticated' || animations.length === 0 || allAnimationsLoaded) {
      return
    }

    const initHandle = window.setTimeout(() => {
      setIsPreloading(true)
      setPreloadProgress({ loaded: 0, total: animations.length })
    }, 0)
    let aborted = false
    const cleanupFns: Array<() => void> = []

    const markLoaded = () => {
      setPreloadProgress((prev) => {
        const nextLoaded = prev.loaded + 1
        if (nextLoaded >= prev.total) {
          setAllAnimationsLoaded(true)
          setIsPreloading(false)
        }
        return { ...prev, loaded: Math.min(nextLoaded, prev.total) }
      })
    }

    animations.forEach((animation) => {
      const resources = [animation.json, animation.atlas, animation.image].filter(Boolean) as string[]
      if (resources.length === 0) {
        markLoaded()
        return
      }
      const controller = new AbortController()
      cleanupFns.push(() => controller.abort())

      void Promise.allSettled(
        resources.map((url) =>
          fetch(url, { signal: controller.signal }).catch(() => {
            /* 忽略单个资源的加载失败，整体仍然会计数 */
          })
        )
      ).then(() => {
        if (aborted) {
          return
        }
        markLoaded()
      })
    })

    preloadAbortRef.current = () => {
      aborted = true
      cleanupFns.forEach((fn) => fn())
      setIsPreloading(false)
    }

    return () => {
      window.clearTimeout(initHandle)
      preloadAbortRef.current()
      setIsPreloading(false)
    }
  }, [status, animations, allAnimationsLoaded])

  const value = useMemo(
    () => ({
      animations,
      currentAnimation,
      isPreloading,
      allAnimationsLoaded,
      preloadProgress,
      registerSpineInstance,
      switchToAnimationById,
      play,
      pause,
      resetToFirstFrame,
    }),
    [
      animations,
      currentAnimation,
      isPreloading,
      allAnimationsLoaded,
      preloadProgress,
      registerSpineInstance,
      switchToAnimationById,
      play,
      pause,
      resetToFirstFrame,
    ]
  )

  return (
    <AnimationProviderContext.Provider value={value}>
      {children}
    </AnimationProviderContext.Provider>
  )
}
