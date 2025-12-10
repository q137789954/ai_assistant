'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'

const Live2D = dynamic(() => import('./Live2D'), {
  ssr: false,
  loading: () => null,
})

const SCRIPT_SRC = '/live2d/live2dcubismcore.min.js'

/**
 * 扩展浏览器 window，声明可能挂载的 Live2D Core，全局仅用于类型提示。
 */
type Live2DWindow = Window & { Live2DCubismCore?: unknown }

function loadLive2DCore() {
  if (typeof window === 'undefined') return Promise.reject(new Error('浏览器环境需要 Live2D Core'))
  const live2dWindow = window as Live2DWindow
  if (live2dWindow.Live2DCubismCore) return Promise.resolve()

  const existing = document.querySelector<HTMLScriptElement>(`script[data-live2d-core]`)
  if (existing) {
    return existing.hasAttribute('data-loaded')
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          existing.addEventListener('load', resolve, { once: true })
          existing.addEventListener('error', () => reject(new Error('Live2D Core 加载失败')), { once: true })
        })
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.setAttribute('data-live2d-core', 'true')
    script.addEventListener('load', () => {
      script.setAttribute('data-loaded', 'true')
      resolve()
    })
    script.addEventListener('error', () => {
      reject(new Error('Live2D Core 加载失败'))
    })
    document.body.appendChild(script)
  })
}

export default function Live2DClient() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadLive2DCore()
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch((error) => {
        console.error(error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) return null
  return <Live2D />
}
