'use client'

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

export interface VideoMeta {
  id: string
  description?: string
  src: string
  thumbnail?: string
}

export interface PreloadProgress {
  loaded: number
  total: number
}

// 默认的视频列表，可由外部通过 props 覆盖
const DEFAULT_VIDEO_PLAYLIST: VideoMeta[] = [
  {
    id: 'entrance',
    description: '入场动画',
    src: '/video-penguin/idle/standby2.mp4',
  },
  {
    id: 'standby',
    description: '待机动画',
    src: '/video-penguin/idle/standby.mp4',
  },
  {
    id: 'dance',
    description: '跳舞动画',
    src: '/video-penguin/dance/d4.mp4',
  },
  {
    id: 'jeer',
    description: '嘲笑动画',
    src: '/video-penguin/jeer/jeer.mp4',
  },
  {
    id: 'think',
    description: '思考动画',
    src: '/video-penguin/think/t1.mp4',
  },
]

// Context 暴露的能力，用于外部控制播放/暂停/切换/预加载状态读取
interface VideoProviderContext {
  videos: VideoMeta[]
  currentVideo: VideoMeta | null
  isPreloading: boolean
  allVideosLoaded: boolean
  preloadProgress: PreloadProgress
  registerVideoElement: (element: HTMLVideoElement | null) => void
  switchToVideoById: (id: string) => void
  play: () => void
  pause: () => void
  resetToFirstFrame: () => void
}

const VideoProviderContext = createContext<VideoProviderContext | null>(null)

export function useVideoPlayer() {
  const context = useContext(VideoProviderContext)
  if (!context) {
    throw new Error('useVideoPlayer 必须在 VideoProvider 内部调用')
  }
  return context
}

export interface VideoProviderProps {
  videos?: VideoMeta[]
  children: React.ReactNode
}

export default function VideoProvider({ videos: rawVideos, children }: VideoProviderProps) {
  const videos = useMemo(() => rawVideos && rawVideos.length > 0 ? rawVideos : DEFAULT_VIDEO_PLAYLIST, [rawVideos])
  const { status } = useSession()

  const [currentVideoId, setCurrentVideoId] = useState<string | null>(videos[0]?.id ?? null)
  const [isPreloading, setIsPreloading] = useState(false)
  const [allVideosLoaded, setAllVideosLoaded] = useState(false)
  const [preloadProgress, setPreloadProgress] = useState<PreloadProgress>({
    loaded: 0,
    total: videos.length,
  })

  const videoElementRef = useRef<HTMLVideoElement | null>(null)
  const preloadAbortRef = useRef<() => void>(() => {})

  // 视频列表变化时重置预加载状态，并清理之前的资源
  useEffect(() => {
    setPreloadProgress({ loaded: 0, total: videos.length })
    setAllVideosLoaded(false)
    setIsPreloading(false)
    preloadAbortRef.current()
  }, [videos])

  const currentVideo = useMemo(
    () => videos.find((item) => item.id === currentVideoId) ?? videos[0] ?? null,
    [currentVideoId, videos]
  )

  // 保证当视频列表变更时，当前选中 id 始终有效，默认回退到第一项
  useEffect(() => {
    if (videos.length === 0) {
      setCurrentVideoId(null)
      return
    }
    if (currentVideoId && videos.some((item) => item.id === currentVideoId)) {
      return
    }
    setCurrentVideoId(videos[0].id)
  }, [videos, currentVideoId])

  // 每次切换视频时重新加载并尝试播放，避免残留旧资源
  useEffect(() => {
    if (!currentVideo || !videoElementRef.current) {
      return
    }
    const element = videoElementRef.current
    element.pause()
    element.src = currentVideo.src
    element.load()
    void element.play().catch(() => {
      /* 自动播放可能被浏览器拦截，直接忽略 */
    })
  }, [currentVideo])

  // 外部组件将 video DOM 注入到 Provider，由此统一控制播放源
  const registerVideoElement = useCallback(
    (element: HTMLVideoElement | null) => {
      videoElementRef.current = element
      if (!element || !currentVideo) {
        return
      }
      element.src = currentVideo.src
      element.load()
    },
    [currentVideo]
  )

  const play = useCallback(() => {
    const element = videoElementRef.current
    if (!element) {
      return
    }
    void element.play().catch(() => {})
  }, [])

  const pause = useCallback(() => {
    const element = videoElementRef.current
    if (!element) {
      return
    }
    element.pause()
  }, [])

  const resetToFirstFrame = useCallback(() => {
    const element = videoElementRef.current
    if (!element) {
      return
    }
    element.pause()
    element.currentTime = 0
  }, [])

  const switchToVideoById = useCallback(
    (id: string) => {
      if (!id || !videos.some((item) => item.id === id)) {
        return
      }
      setCurrentVideoId(id)
    },
    [videos]
  )

  // 只有登录后才会触发预加载流程，避免未授权用户占用带宽
  useEffect(() => {
    if (status !== 'authenticated' || videos.length === 0 || allVideosLoaded) {
      return
    }

    setIsPreloading(true)
    setPreloadProgress({ loaded: 0, total: videos.length })
    let aborted = false
    const cleanupFns: Array<() => void> = []

    const markLoaded = () => {
      setPreloadProgress((prev) => {
        const nextLoaded = prev.loaded + 1
        if (nextLoaded >= prev.total) {
          setAllVideosLoaded(true)
          setIsPreloading(false)
        }
        return { ...prev, loaded: Math.min(nextLoaded, prev.total) }
      })
    }

    videos.forEach((video) => {
      const preloadElement = document.createElement('video')
      preloadElement.preload = 'auto'
      preloadElement.src = video.src
      const onReady = () => {
        if (aborted) {
          return
        }
        markLoaded()
      }
      const onError = () => {
        if (aborted) {
          return
        }
        markLoaded()
      }
      preloadElement.addEventListener('canplaythrough', onReady, { once: true })
      preloadElement.addEventListener('error', onError, { once: true })
      preloadElement.load()
      cleanupFns.push(() => {
        preloadElement.removeEventListener('canplaythrough', onReady)
        preloadElement.removeEventListener('error', onError)
        preloadElement.src = ''
      })
    })

    preloadAbortRef.current = () => {
      aborted = true
      cleanupFns.forEach((fn) => fn())
      setIsPreloading(false)
    }

    return () => {
      preloadAbortRef.current()
      setIsPreloading(false)
    }
  }, [status, videos, allVideosLoaded])

  const value = useMemo(
    () => ({
      videos,
      currentVideo,
      isPreloading,
      allVideosLoaded,
      preloadProgress,
      registerVideoElement,
      switchToVideoById,
      play,
      pause,
      resetToFirstFrame,
    }),
    [
      videos,
      currentVideo,
      isPreloading,
      allVideosLoaded,
      preloadProgress,
      registerVideoElement,
      switchToVideoById,
      play,
      pause,
      resetToFirstFrame,
    ]
  )

  return (
    <VideoProviderContext.Provider value={value}>
      {children}
    </VideoProviderContext.Provider>
  )
}
