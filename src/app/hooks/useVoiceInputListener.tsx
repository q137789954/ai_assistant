'use client'

import { useContext, useEffect, useRef } from 'react'
import { MicVAD, type RealTimeVADOptions } from '@ricky0123/vad-web'
import { GlobalsContext } from '@/app/providers/GlobalsProviders'
import type { UserSpeechItem } from '@/app/providers/GlobalsProviders/types'

// 默认指向 public/onnx-runtime 目录，保证 wasm/模型/worker 依赖都可通过静态路径访问
const DEFAULT_VAD_ASSET_PATH = '/onnx-runtime/'
const DEFAULT_VAD_OPTIONS: Partial<RealTimeVADOptions> = {
  baseAssetPath: DEFAULT_VAD_ASSET_PATH,
  onnxWASMBasePath: DEFAULT_VAD_ASSET_PATH,
}
export const FAST_VAD_PRESET: Partial<RealTimeVADOptions> = {
  // 1. 新模型，官方推荐的 v5，一般响应 & 鲁棒性会比 legacy 好一点
  model: 'v5',

  // 2. 阈值稍微调“硬”一点，减少噪音误触发
  // 判断概率是否足够大以判定为语音的阈值
  positiveSpeechThreshold: 0.65,
  // 判断概率是否足够小以判定为非语音的阈值
  negativeSpeechThreshold: 0.4,
  // 在判定语音片段结束前需要持续遇到的非语音帧的毫秒数
  redemptionMs: 500,
  // 在语音片段前补充的音频时长（毫秒）
  preSpeechPadMs: 50,
  // 语音片段的最短允许持续时长（毫秒）
  minSpeechMs: 100,

  // 7. 如果你希望点“关闭语音输入”时也把尾巴提交，可以开这个
  // submitUserSpeechOnPause: true,
}

type VoiceInputListenerOptions = {
  /**
   * 一次完整说话结束后的原始 PCM（16k Float32）
   */
  onSpeechSegment?: (audio: Float32Array) => void
  /**
   * 初始化 / 运行时报错
   */
  onError?: (error: Error) => void
  /**
   * 透传给 MicVAD 的配置（阈值、静音时长等）
   */
  vadOptions?: Partial<RealTimeVADOptions>
}

/**
 * useVoiceInputListener（vad-web 版本）
 *
 * - 监听全局 voiceInputEnabled
 * - 为 true 时：启动 MicVAD，自动请求麦克风并做 VAD
 * - 为 false 时：暂停监听
 * - onSpeechStart：更新 isUserSpeaking = true
 * - onSpeechEnd：更新 isUserSpeaking = false，并把本次语音 push 到 pendingUserSpeechQueue
 */
export default function useVoiceInputListener(options: VoiceInputListenerOptions = {}) {
  const globals = useContext(GlobalsContext)
  if (!globals) {
    throw new Error('useVoiceInputListener 必须在 GlobalsProviders 内部使用')
  }

  const { voiceInputEnabled, dispatch } = globals
  const { onSpeechSegment, onError, vadOptions } = options

  const vadRef = useRef<MicVAD | null>(null)
  const initializingRef = useRef(false)

  // 根据全局开关启动 / 暂停 VAD
  useEffect(() => {
    // 语音输入关闭：暂停 VAD，并重置 isUserSpeaking
    if (!voiceInputEnabled) {
      if (vadRef.current) {
        vadRef.current.pause()
      }
      dispatch({ type: 'SET_USER_SPEAKING', payload: false })
      return
    }

    let cancelled = false

    const ensureVad = async () => {
      if (vadRef.current || initializingRef.current) return
      initializingRef.current = true

      try {
        const instance = await MicVAD.new({
          ...DEFAULT_VAD_OPTIONS,
          ...FAST_VAD_PRESET,
          ...vadOptions,
          // 浏览器自己从麦克风拿流；如果你想自己传 MediaStream，可以用 stream 选项
          onSpeechStart: () => {
            if (cancelled) return
            console.log('[useVoiceInputListener] 检测到用户开始说话')
            dispatch({ type: 'SET_USER_SPEAKING', payload: true })
          },
          onSpeechEnd: (audio: Float32Array) => {
            if (cancelled) return
            console.log('[useVoiceInputListener] 检测到用户结束说话，音频长度：', audio.length)
            // 结束说话
            dispatch({ type: 'SET_USER_SPEAKING', payload: false })

            // 构造队列元素
            const item: UserSpeechItem = {
              id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              audio,
              sampleRate: 16000,
              createdAt: Date.now(),
            }

            dispatch({ type: 'ENQUEUE_USER_SPEECH', payload: item })

            // 额外给调用方一个回调
            onSpeechSegment?.(audio)
          },
        })

        if (cancelled) {
          // 组件已经卸载
          instance.destroy()
          return
        }

        vadRef.current = instance
        instance.start()
      } catch (e: unknown) {
        console.error('[useVoiceInputListener] 初始化 MicVAD 失败', e)
        onError?.(e instanceof Error ? e : new Error(String(e)))

        // 避免 UI 显示“已开启”但实际上没在听
        dispatch({ type: 'SET_VOICE_INPUT_ENABLED', payload: false })
      } finally {
        initializingRef.current = false
      }
    }

    void ensureVad()

    // 依赖变化（或组件卸载）时只标记取消，
    // 真正 destroy 在单独的 cleanup effect 里做
    return () => {
      cancelled = true
    }
  }, [voiceInputEnabled, dispatch, onSpeechSegment, onError, vadOptions])

  // 组件卸载时，彻底销毁 VAD（释放 AudioContext / Worklet / 模型等资源）
  useEffect(() => {
    return () => {
      if (vadRef.current) {
        try {
          vadRef.current.destroy()
        } catch (e) {
          console.warn('[useVoiceInputListener] destroy VAD 出错', e)
        }
        vadRef.current = null
      }
    }
  }, [])
}
