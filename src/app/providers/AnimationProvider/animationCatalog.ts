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
  type: 'idle' | 'listen' | 'talk' | 'start' | 'quit'
  timeScale?: number
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
    timeScale: 0.5,
  },
  {
    id: 'idle2',
    description: '待机动画2',
    animationName: 'idle2',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'idle',
    timeScale: 0.5,
  },
  {
    id: 'idle3',
    description: '待机动画3',
    animationName: 'idle3',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'idle',
  },
  {
    id: 'idle4',
    description: '待机动画4',
    animationName: 'idle4',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'idle',
    timeScale: 0.5,
  },
  {
    id: 'listen1',
    description: '听动作',
    animationName: 'listen1',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'listen',
    timeScale: 1,
  },
  {
    id: 'listen2',
    description: '听动作',
    animationName: 'listen2',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'listen',
    timeScale: 1,
  },
  {
    id: 'talk1',
    description: '说动作',
    animationName: 'talk1',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'talk',
    timeScale: 1,
  },
  {
    id: 'talk2',
    description: '说动作',
    animationName: 'talk2',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'talk',
    timeScale: 1,
  },
  {
    id: 'talk3',
    description: '说动作',
    animationName: 'talk3',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'talk',
    timeScale: 1,
  },
  {
    id: 'start1',
    description: '开始动作',
    animationName: 'start1',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'start',
    timeScale: 1,
  },
  {
    id: 'start2',
    description: '开始动作',
    animationName: 'start2',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
    type: 'start',
    timeScale: 1,
  },
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
