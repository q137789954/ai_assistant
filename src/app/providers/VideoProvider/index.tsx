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

// 默认的视频播放列表，确保在未传视频配置时仍有可用资源
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

// Context 暴露的能力，可供下游组件控制播放器并查询预加载状态等
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
  // 生成为渲染使用的有效视频列表，优先使用 props，如果为空则回退到默认列表
  const videos = useMemo(() => (rawVideos && rawVideos.length > 0 ? rawVideos : DEFAULT_VIDEO_PLAYLIST), [rawVideos])
  // 通过 next-auth 获取认证状态，用于决定是否可以预加载视频
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

  // 视频资源列表变更时需要重置预加载状态，并清理之前的临时资源
  useEffect(() => {
    setPreloadProgress({ loaded: 0, total: videos.length })
    setAllVideosLoaded(false)
    setIsPreloading(false)
    preloadAbortRef.current()
  }, [videos])

  // 当前选中视频元数据，优先匹配当前 id，若不存在则退回到第一个视频或 null
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

  // 每次切换 videoMeta 都派发一次资源刷新以及尝试自动播放
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

  // 注册视频 DOM 元素，使 Provider 可以统一切换 src 并管理播放
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

  // 对外暴露的播放函数，容错处理缺失元素
  const play = useCallback(() => {
    const element = videoElementRef.current
    if (!element) {
      return
    }
    void element.play().catch(() => {})
  }, [])

  // 对外暴露的暂停函数，直接调用 DOM pause
  const pause = useCallback(() => {
    const element = videoElementRef.current
    if (!element) {
      return
    }
    element.pause()
  }, [])

  // 回退到当前视频的起始帧
  const resetToFirstFrame = useCallback(() => {
    const element = videoElementRef.current
    if (!element) {
      return
    }
    element.pause()
    element.currentTime = 0
  }, [])

  // 通过 VIDEO ID 切换到某个合法的视频
  const switchToVideoById = useCallback(
    (id: string) => {
      if (!id || !videos.some((item) => item.id === id)) {
        return
      }
      setCurrentVideoId(id)
    },
    [videos]
  )

  // 只有登录后才会执行资源预加载逻辑，防止匿名访问消耗过多带宽
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

    // 遍历准备好的每个视频，动态创建 video 元素并监听加载结果
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

    // 提供在组件卸载或视频列表变化时中断预加载的能力
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

  // 利用 memo 保证 context value 仅在依赖变更时更新，降低多余渲染
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

  // 提供 context 给下游组件
  return (
    <VideoProviderContext.Provider value={value}>
      {children}
    </VideoProviderContext.Provider>
  )
}
