'use client'

import { useContext, useEffect, useRef, useCallback } from 'react'
import { MicVAD, type RealTimeVADOptions } from '@ricky0123/vad-web'
import { GlobalsContext } from '@/app/providers/GlobalsProviders'

// 默认指向 public/onnx-runtime 目录，保证 wasm/模型/worker 依赖都可通过静态路径访问
const DEFAULT_VAD_ASSET_PATH = '/onnx-runtime/'
const DEFAULT_VAD_OPTIONS: Partial<RealTimeVADOptions> = {
  baseAssetPath: DEFAULT_VAD_ASSET_PATH,
  onnxWASMBasePath: DEFAULT_VAD_ASSET_PATH,
}

/**
 * 为“非常快”场景调整的 VAD 预设：
 * - redemptionMs 小：结束判断很快
 * - 上层再做 merge，避免拆句
 */
export const FAST_VAD_PRESET: Partial<RealTimeVADOptions> = {
  model: 'v5',

  // 阈值：开始稍微敏感一点，结束略宽松
  positiveSpeechThreshold: 0.6,
  negativeSpeechThreshold: 0.35,

  // 静音多久判定为“语音段结束”（ms）
  // 越小越快，但越容易拆句；我们用上层 merge 来兜底
  redemptionMs: 120,

  // 在语音片段前补一点，避免吃掉开头音节
  preSpeechPadMs: 80,

  // 片段最短时长（ms），太短的直接视为误触发
  minSpeechMs: 200,
}

type VoiceInputListenerOptions = {
  /**
   * 每次 VAD 判断出的独立语音段（16k Float32 PCM）
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
 * useVoiceInputListener（只做 VAD + 回调）
 *
 * - 监听全局 voiceInputEnabled
 * - MicVAD 负责快速检测开始/结束
 * - 不做句子合并，仅将每段 raw audio 透传给调用方
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

  // 是否处于“VAD 认为用户在说话”的状态
  const speakingRef = useRef(false)

  /**
   * 直接回调每个独立的语音段，留给调用方决定如何合并或发送
   */
  const handleSpeechSegment = useCallback(
    (audio: Float32Array) => {
      if (!audio.length) {
        return
      }

      onSpeechSegment?.(audio)
    },
    [onSpeechSegment],
  )

  // 根据全局开关启动 / 暂停 VAD
  useEffect(() => {
    if (!voiceInputEnabled) {
      if (vadRef.current) {
        try {
          vadRef.current.pause()
        } catch (e) {
          console.warn('[useVoiceInputListener] pause VAD 出错', e)
        }
      }
      speakingRef.current = false
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

          onSpeechStart: () => {
            if (cancelled) return
            console.log('[useVoiceInputListener] 检测到用户开始说话')

            speakingRef.current = true
            dispatch({ type: 'SET_USER_SPEAKING', payload: true })
          },

          onSpeechEnd: (audio: Float32Array) => {
            if (cancelled) return
            console.log(
              '[useVoiceInputListener] 检测到用户结束说话，音频长度：',
              audio.length,
            )

            speakingRef.current = false
            dispatch({ type: 'SET_USER_SPEAKING', payload: false })

            handleSpeechSegment(audio)
          },
        })

        if (cancelled) {
          instance.destroy()
          return
        }

        vadRef.current = instance
        instance.start()
      } catch (e: unknown) {
        console.error('[useVoiceInputListener] 初始化 MicVAD 失败', e)
        const err = e instanceof Error ? e : new Error(String(e))
        onError?.(err)

        // 避免 UI 显示“已开启”但实际上没在听
        dispatch({ type: 'SET_VOICE_INPUT_ENABLED', payload: false })
      } finally {
        initializingRef.current = false
      }
    }

    void ensureVad()

    return () => {
      cancelled = true
    }
  }, [voiceInputEnabled, dispatch, onError, vadOptions, handleSpeechSegment])

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

      // 退出时确保 speaking 状态复位
      speakingRef.current = false
    }
  }, [])
}
