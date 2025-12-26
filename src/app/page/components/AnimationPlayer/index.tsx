'use client'

type PixiApplication = import('pixi.js').Application
type SpineInstance = import('@pixi-spine/all-4.1').Spine

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAnimationPlayer } from '@/app/providers/AnimationProvider'
import { GlobalsContext } from '@/app/providers/GlobalsProviders'

export default function AnimationPlayer() {
  const {
    currentAnimation,
    allAnimationsLoaded,
    preloadProgress,
    registerSpineInstance,
    play,
    pause,
  } = useAnimationPlayer()

  const safeDestroySpine = (instance: SpineInstance | null) => {
    if (!instance) {
      return
    }
    try {
      instance.destroy({ children: true, texture: true, baseTexture: true })
    } catch (error) {
      console.warn('Spine 销毁失败（可能已经被销毁）：', error)
    }
  }

  const crossfadeSpines = (from: SpineInstance, to: SpineInstance) => {
    const app = appRef.current
    if (!app) {
      safeDestroySpine(from)
      to.alpha = 1
      return
    }
    if (transitionHandleRef.current !== null) {
      cancelAnimationFrame(transitionHandleRef.current)
      transitionHandleRef.current = null
    }
    const duration = 200
    const startTime = performance.now()
    const step = () => {
      const now = performance.now()
      const progress = Math.min((now - startTime) / duration, 1)
      from.alpha = Math.max(0, 1 - progress)
      to.alpha = Math.min(1, progress)
      if (progress < 1) {
        transitionHandleRef.current = requestAnimationFrame(step)
        return
      }
      to.alpha = 1
      if (from.parent === app.stage) {
        app.stage.removeChild(from)
      }
      safeDestroySpine(from)
      transitionHandleRef.current = null
    }
    transitionHandleRef.current = requestAnimationFrame(step)
  }

  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<PixiApplication | null>(null)
  const spineRef = useRef<SpineInstance | null>(null)
  const pixiRef = useRef<typeof import('pixi.js') | null>(null)
  const spineModuleRef = useRef<typeof import('@pixi-spine/all-4.1') | null>(null)
  const [modulesReady, setModulesReady] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const globals = useContext(GlobalsContext)
  const chatbotVisible = globals?.chatbotVisible ?? false
  const transitionHandleRef = useRef<number | null>(null)

  // 负责在画布尺寸变化时重新适配 Spine 的位置和缩放
  const fitStage = useCallback(() => {
    const app = appRef.current
    const spine = spineRef.current
    if (!app || !spine) {
      return
    }
    const { width, height } = app.renderer
    // 让 Spine 实例的中心位置对齐画布中心
    spine.x = width / 2
    spine.y = height / 2
    const bounds = spine.getLocalBounds()
    const contentWidth = Math.max(1, bounds.width)
    const contentHeight = Math.max(1, bounds.height)
    const scale = Math.min((width * 0.9) / contentWidth, (height * 0.9) / contentHeight)
    // 以动画自身包围盒中心作为缩放与旋转的参考点，避免偏移
    spine.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    spine.scale.set(scale)
  }, [])

  // 初始化 Pixi 与 Spine 运行时，并在组件卸载时做清理
  useEffect(() => {
    const hostElement = hostRef.current
    if (!hostElement) {
      return
    }
    let canceled = false
    const initialize = async () => {
      try {
        const PIXI = await import('pixi.js')
        const spineModule = await import('@pixi-spine/all-4.1')
        if (canceled) {
          return
        }
        pixiRef.current = PIXI
        spineModuleRef.current = spineModule
        const app = new PIXI.Application({
          backgroundColor: 0x111111,
          backgroundAlpha: 0,
          resizeTo: hostElement,
          antialias: true,
          autoDensity: true,
        })
        app.view.style.backgroundColor = 'transparent'
        app.ticker.maxFPS = 30
        appRef.current = app
        hostElement.appendChild(app.view)
        window.addEventListener('resize', fitStage)
        setModulesReady(true)
      } catch (error) {
        console.error('动画初始化失败：', error)
        setErrorMessage((error as Error)?.message ?? '动画初始化失败')
      }
    }
    initialize()
    return () => {
      canceled = true
      window.removeEventListener('resize', fitStage)
      registerSpineInstance({ spine: null, defaultAnimationName: null })
      const spine = spineRef.current
      const app = appRef.current
      if (spine && app) {
        app.stage.removeChild(spine)
        safeDestroySpine(spine)
        spineRef.current = null
      }
      if (app) {
        app.destroy(true, { children: true, texture: true, baseTexture: true })
        appRef.current = null
      }
      hostElement.replaceChildren()
      pixiRef.current = null
      spineModuleRef.current = null
      setModulesReady(false)
      if (transitionHandleRef.current !== null) {
        cancelAnimationFrame(transitionHandleRef.current)
        transitionHandleRef.current = null
      }
    }
  }, [fitStage, registerSpineInstance])

  useEffect(() => {
    if (!currentAnimation || !modulesReady || !appRef.current) {
      if (!currentAnimation) {
        const previousSpine = spineRef.current
        if (previousSpine && appRef.current) {
          appRef.current.stage.removeChild(previousSpine)
          previousSpine.destroy({ children: true, texture: true, baseTexture: true })
          spineRef.current = null
        }
        registerSpineInstance({ spine: null, defaultAnimationName: null })
      }
      return undefined
    }

    let canceled = false
    let attachedSpine: SpineInstance | null = null

    const loadAnimation = async () => {
      try {
        setErrorMessage(null)
        const PIXI = pixiRef.current
        const spineModule = spineModuleRef.current
        if (!PIXI || !spineModule) {
          return
        }
        // 先并行加载 Spine JSON/atlas/贴图，确保后续实例化时所有纹理都已经准备好
        const spinePromise = PIXI.Assets.load(currentAnimation.json)
        const atlasPromise = currentAnimation.atlas
          ? PIXI.Assets.load(currentAnimation.atlas)
          : Promise.resolve(null)
        const texturePromise = currentAnimation.image
          ? PIXI.Assets.load(currentAnimation.image)
          : Promise.resolve(null)
        const [resource] = await Promise.all([spinePromise, atlasPromise, texturePromise])
        if (canceled) {
          return
        }
        const { Spine } = spineModule
        const spineInstance = new Spine(resource.spineData)
        const previous = spineRef.current
        spineRef.current = spineInstance
        attachedSpine = spineInstance
        appRef.current?.stage.addChild(spineInstance)
        spineInstance.alpha = 0
        const animationList = (spineInstance.spineData?.animations || []) as Array<{ name: string }>
        const firstAnimation = animationList[0]?.name
        if (!firstAnimation) {
          throw new Error('未能识别 Spine 动画名称，请检查 animation.json')
        }
        spineInstance.state.setAnimation(0, firstAnimation, true)
        spineInstance.state.timeScale = 1
        fitStage()
        registerSpineInstance({ spine: spineInstance, defaultAnimationName: firstAnimation })
        if (previous && appRef.current) {
          crossfadeSpines(previous, spineInstance)
        } else {
          spineInstance.alpha = 1
        }
      } catch (error) {
        if (!canceled) {
          console.error('动画加载失败：', error)
          setErrorMessage((error as Error)?.message ?? '动画加载失败')
        }
      }
    }

    void loadAnimation()

    return () => {
      canceled = true
      registerSpineInstance({ spine: null, defaultAnimationName: null })
      if (transitionHandleRef.current !== null) {
        cancelAnimationFrame(transitionHandleRef.current)
        transitionHandleRef.current = null
      }
    }
  }, [currentAnimation, fitStage, modulesReady, registerSpineInstance])

  useEffect(() => {
    if (!modulesReady || !appRef.current || typeof document === 'undefined') {
      return undefined
    }
    const app = appRef.current
    const handlePlaybackChange = () => {
      const shouldPause = document.hidden || chatbotVisible
      if (shouldPause) {
        pause()
        app.ticker?.stop()
        return
      }
      play()
      app.ticker?.start()
    }
    handlePlaybackChange()

    const handleVisibility = () => handlePlaybackChange()
    const handleWindowBlur = () => {
      pause()
      app.ticker?.stop()
    }
    const handleWindowFocus = () => handlePlaybackChange()

    window.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('blur', handleWindowBlur)
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      window.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('blur', handleWindowBlur)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [chatbotVisible, modulesReady, pause, play])

  const statusHint = useMemo(() => {
    if (allAnimationsLoaded) {
      return '动画资源已就绪'
    }
    return `正在预加载 ( ${preloadProgress.loaded}/${preloadProgress.total} )`
  }, [allAnimationsLoaded, preloadProgress])

  return (
    <section className="flex flex-col items-center gap-4 w-full h-full bg-[url('/home/lamplight.jpeg')] bg-cover bg-center bg-no-repeat">
      <div
        ref={hostRef}
        className="relative w-full min-h-[320px] h-full overflow-hidden"
      >
        {errorMessage && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-red-900/80 text-sm font-semibold text-white">
            {errorMessage}
          </div>
        )}
        {!allAnimationsLoaded && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/80 text-sm font-medium text-white">
            {statusHint}
          </div>
        )}
      </div>
    </section>
  )
}
