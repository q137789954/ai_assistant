'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { useVideoPlayer } from '@/app/providers/VideoProvider'

export default function VideoPlayer() {
  const {
    currentVideo,
    registerVideoElement,
    allVideosLoaded,
    preloadProgress,
  } = useVideoPlayer()
  const containerRef = useRef<HTMLDivElement>(null)
  const [maxVideoSize, setMaxVideoSize] = useState(0)

  // 监听容器尺寸，动态计算出可用盒子的最小边长以保证视频始终在容器内完整展示
  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    const updateSize = () => {
      const { width, height } = containerRef.current!.getBoundingClientRect()
      setMaxVideoSize(Math.min(width, height))
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const statusHint = useMemo(() => {
    if (allVideosLoaded) {
      return '视频资源已就绪'
    }
    return `正在预加载 ( ${preloadProgress.loaded}/${preloadProgress.total} )`
  }, [allVideosLoaded, preloadProgress])

  // 利用计算出的最大尺寸来限制视频的宽高，若尚未测量则先铺满容器
  const videoStyle =
    maxVideoSize > 0
      ? { width: `${maxVideoSize}px`, height: `${maxVideoSize}px` }
      : { width: '100%', height: '100%' }

  return (
    <section className="flex flex-col items-center gap-4 w-full h-full">
      <div
        ref={containerRef}
        className="relative w-full min-h-[200px] h-full overflow-hidden bg-black"
      >
        {currentVideo && (
          <video
            ref={registerVideoElement}
            style={{ ...videoStyle, maxWidth: '100%', maxHeight: '100%' }}
            className="absolute inset-0 m-auto object-contain"
            poster={currentVideo.thumbnail}
            playsInline
            muted
            autoPlay
            preload="metadata"
          />
        )}
        {!allVideosLoaded && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/70 text-sm font-medium text-white">
            {statusHint}
          </div>
        )}
      </div>
    </section>
  )
}
