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
import { DEFAULT_ANIMATION_LIST, type AnimationMeta } from './animationCatalog'

export type { AnimationMeta } from './animationCatalog'

interface SpineRegistration {
  spine: SpineInstance | null
  defaultAnimationName?: string | null
}

// Context 暴露出的功能项，供下游消费控制动画播放与切换
interface AnimationProviderContext {
  animations: AnimationMeta[]
  currentAnimation: AnimationMeta | null
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

  const [currentAnimationId, setCurrentAnimationId] = useState<string | null>(
    animations[0]?.id ?? null
  )

  const spineInstanceRef = useRef<SpineInstance | null>(null)
  const primaryAnimationNameRef = useRef<string | null>(null)

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

  const value = useMemo(
    () => ({
      animations,
      currentAnimation,
      registerSpineInstance,
      switchToAnimationById,
      play,
      pause,
      resetToFirstFrame,
    }),
    [
      animations,
      currentAnimation,
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
