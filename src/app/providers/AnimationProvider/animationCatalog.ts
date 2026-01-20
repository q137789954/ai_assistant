'use client'

/**
 * 动画元数据结构：描述单条 Spine 动画资源的地址与动画名。
 */
export interface AnimationMeta {
  id: string
  description?: string
  json: string
  atlas?: string
  image?: string
  animationName?: string
  type: 'idle' | 'listen' | 'talk' | 'start' | 'quit' | 'angry' | 'happy' | 'sad'
  timeScale?: number
  audio?: string
  audioStartFrame?: number
}

// 默认的 Spine 动画列表，保证在未提供参数时也有可播放的骨骼资源
export const DEFAULT_ANIMATION_LIST: AnimationMeta[] = [
  {
    id: 'idle1',
    description: '待机动画1',
    animationName: 'idle1',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'idle',
    timeScale: 0.3,
  },
  {
    id: 'idle2',
    description: '待机动画2',
    animationName: 'idle2',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'idle',
    timeScale: 0.3,
  },
  {
    id: 'idle3',
    description: '待机动画3',
    animationName: 'idle3',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'idle',
    timeScale: 0.3,
  },
  {
    id: 'listen',
    description: '听动作',
    animationName: 'listen',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'listen',
    timeScale: 0.3,
  },
  {
    id: 'talk',
    description: '说动作',
    animationName: 'talk',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'talk',
    timeScale: 1,
  },
  {
    id: 'anger1',
    description: '愤怒的说',
    animationName: 'anger1',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'angry',
    timeScale: 0.3,
  },
  {
    id: 'anger2',
    description: '愤怒的说',
    animationName: 'anger2',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'angry',
    timeScale: 0.3,
  },
  // {
  //   id: 'start1',
  //   description: '开始动作',
  //   animationName: 'start1',
  //   json: '/animation/penguin/animation.json',
  //   atlas: '/animation/penguin/animation.atlas',
  //   image: '/animation/penguin/animation.png',
  //   type: 'start',
  //   timeScale: 0.8,
  //   // audio:'/voice/start1.mp3',
  //   audioStartFrame:2
  // },
  // {
  //   id: 'start2',
  //   description: '开始动作',
  //   animationName: 'start2',
  //   json: '/animation/penguin/animation.json',
  //   atlas: '/animation/penguin/animation.atlas',
  //   image: '/animation/penguin/animation.png',
  //   type: 'start',
  //   timeScale: 0.8,
  //   audio:'/voice/start2.mp3',
  //   audioStartFrame:2
  // },
  {
    id: 'quit',
    description: '退出动作',
    animationName: 'quit',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'quit',
    timeScale: 1,
  },
]
