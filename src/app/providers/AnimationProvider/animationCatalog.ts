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
  type: 'idle' | 'start' | 'quit' | 'angry' | 'contempt'
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
    id: 'anger1',
    description: '愤怒的说',
    animationName: 'anger1',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'angry',
    timeScale: 0.5,
  },
  {
    id: 'contempt1',
    description: '轻蔑的说',
    animationName: 'contempt1',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'contempt',
    timeScale: 0.75,
  },
  {
    id: 'contempt2',
    description: '轻蔑的说',
    animationName: 'contempt2',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'contempt',
    timeScale: 0.75,
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
    animationName: 'quit1',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'quit',
    timeScale: 1,
  },
]
