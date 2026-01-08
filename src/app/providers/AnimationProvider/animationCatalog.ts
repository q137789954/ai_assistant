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
  },
  {
    id: 'idle2',
    description: '待机动画2',
    animationName: 'idle2',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
  },
  {
    id: 'idle3',
    description: '待机动画3',
    animationName: 'idle3',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
  },
  {
    id: 'idle4',
    description: '待机动画4',
    animationName: 'idle4',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
  },
  {
    id: 'listen',
    description: '听动作',
    animationName: 'listen',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
  },
  {
    id: 'talk1',
    description: '说动作',
    animationName: 'talk1',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
  },
  {
    id: 'talk2',
    description: '说动作',
    animationName: 'talk2',
    json: '/animation/penguin/animation.json',
    atlas: '/animation/penguin/animation.atlas',
    image: '/animation/penguin/animation.png',
  },
]
