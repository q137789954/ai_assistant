'use client'

import { useMemo } from 'react'
import { useVideoPlayer } from '@/app/providers/VideoProvider'

export default function VideoPlayer() {
  const {
    currentVideo,
    registerVideoElement,
    allVideosLoaded,
    preloadProgress,
  } = useVideoPlayer()

  // 通过状态 hint 简要描述当前预加载进度
  const statusHint = useMemo(() => {
    if (allVideosLoaded) {
      return '视频资源已就绪'
    }
    return `正在预加载 ( ${preloadProgress.loaded}/${preloadProgress.total} )`
  }, [allVideosLoaded, preloadProgress])

  return (
    <section className="h-full w-full">
      {currentVideo ? (
          <video
            ref={registerVideoElement}
            className="max-w-[960px] object-contain"
            poster={currentVideo.thumbnail}
            playsInline
            muted
            autoPlay
            preload="metadata"
          />
        ) : ''}
        {!allVideosLoaded && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/70 text-sm font-medium text-white">
            {statusHint}
          </div>
        )}
    </section>
  )
}
