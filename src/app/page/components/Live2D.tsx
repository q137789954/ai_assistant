'use client'

import { useEffect, useRef } from 'react'
import type { Application } from 'pixi.js'
import type { Live2DModel } from 'pixi-live2d-display/cubism4'

const MODEL_PATH = '/hiyori_free/runtime/hiyori_free_t08.model3.json'

export default function Live2D() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const modelRef = useRef<Live2DModel | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // 使用类型定义避免在运行时引入 pixi.js，保持动态导入的方式
    let app: Application | null = null
    let isUnmounted = false
    const updateLayout = () => {
      const model = modelRef.current
      const currentContainer = containerRef.current
      if (!model || !currentContainer || !app) return
      const width = currentContainer.clientWidth
      const height = currentContainer.clientHeight
      if (!width || !height) return
      app.renderer.resize(width, height)
      model.position.set(width / 2, height)
      if (model.width && model.height) {
        const scale = Math.min(width / model.width, height / model.height) * 0.9
        if (scale > 0) {
          model.scale.set(scale)
        }
      }
    }

    const handleResize = () => {
      updateLayout()
    }

    const init = async () => {
      try {
        const PIXI = await import('pixi.js')
        const live2d = await import('pixi-live2d-display/cubism4')
        if (isUnmounted) return

        // 创建用于绘制 Live2D 的 PIXI 应用，采用容器尺寸自动适配
        app = new PIXI.Application({
          resizeTo: container,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
        })
        container.appendChild(app.view)
        window.addEventListener('resize', handleResize)

        const model = await live2d.Live2DModel.from(MODEL_PATH)
        if (isUnmounted) {
          model.destroy()
          return
        }
        modelRef.current = model
        model.anchor.set(0.5, 1)
        app.stage.addChild(model)
        updateLayout()
      } catch (error) {
        console.error('Live2D 模型载入失败', error)
      }
    }

    init()

    return () => {
      isUnmounted = true
      window.removeEventListener('resize', handleResize)
      modelRef.current?.destroy()
      app?.destroy(true, { children: true, texture: true, baseTexture: true })
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="pointer-events-none relative h-full min-h-[360px] w-full"
    />
  )
}
