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


  positiveSpeechThreshold: 0.8,
  negativeSpeechThreshold: 0.6,

  // 静音多久判定为“语音段结束”（ms）
  // 越小越快，但越容易拆句；我们用上层 merge 来兜底
  redemptionMs: 200,

  // 在语音片段前补一点，避免吃掉开头音节
  preSpeechPadMs: 100,

  // 片段最短时长（ms），太短的直接视为误触发
  minSpeechMs: 100,
}

type VoiceInputListenerOptions = {
  /**
   * 每次 VAD 判断出的独立语音段（16k Float32 PCM）
   */
  onSpeechSegment?: (audio: Float32Array) => void
  onSpeechEnd?: () => void
  onSpeechStart?: () => void
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
  const { onSpeechSegment, onError, vadOptions, onSpeechEnd: optionOnSpeechEnd, onSpeechStart: optionOnSpeechStart } = options

  const vadRef = useRef<MicVAD | null>(null)
  const initializingRef = useRef(false)

  // 是否处于“VAD 认为用户在说话”的状态
  const speakingRef = useRef(false)
  // 控制是否在当前语音周期中持续向外推送每帧音频，关键信号源于 onSpeechStart/onSpeechEnd
  const streamingRef = useRef(false)
  // 动态记录最终使用的 positiveSpeechThreshold，便于在 onFrameProcessed 中根据真实阈值判断是否属于语音
  const positiveSpeechThresholdRef = useRef(
    FAST_VAD_PRESET.positiveSpeechThreshold ?? 0.6,
  )

  /**
   * 每帧到来时判断是否命中语音阈值，满足则立即透传给 onSpeechSegment。
   * 这样可以支持将音频逐帧推送给服务端，便于第三方流式处理；判断依据是真实阈值（可能来自用户配置）、
   * 以及当前帧的模型得分，避免将噪声误认为语音段。
   */
  const handleFrameProcessed = useCallback(
    (probs: { isSpeech: number }, frame: Float32Array) => {
      // 只有当模型得分超过当前阈值才视作语音并发送，避免无意义帧打扰下游
      const threshold =
        positiveSpeechThresholdRef.current ??
        FAST_VAD_PRESET.positiveSpeechThreshold ??
        0.6
      const isSpeech = probs.isSpeech >= threshold

      if (!isSpeech || !frame.length) {
        return
      }

      streamingRef.current = true
      onSpeechSegment?.(frame)
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
      streamingRef.current = false
      dispatch({ type: 'SET_USER_SPEAKING', payload: false })

      // 当全局关闭语音输入时马上终止推送并标记状态
      return
    }

    let cancelled = false

    const ensureVad = async () => {
      if (vadRef.current || initializingRef.current) return
      initializingRef.current = true

      try {
        // 将默认路径、快速预设以及调用方传入的选项按优先级合并，确保我们总有一套完整的配置供 MicVAD 使用
        const mergedVadOptions: Partial<RealTimeVADOptions> = {
          ...DEFAULT_VAD_OPTIONS,
          ...FAST_VAD_PRESET,
          ...vadOptions,
        }

        // 记录落地的 positiveSpeechThreshold，供逐帧推送判断是否属于语音
        const mergedPositiveThreshold =
          mergedVadOptions.positiveSpeechThreshold ??
          FAST_VAD_PRESET.positiveSpeechThreshold ??
          0.6
        positiveSpeechThresholdRef.current = mergedPositiveThreshold

        // 记录调用方可能自定义的 onFrameProcessed，以便我们包裹后仍能透传事件
        const userOnFrameProcessed = mergedVadOptions.onFrameProcessed
        const instance = await MicVAD.new({
          ...mergedVadOptions,
          onFrameProcessed: (probs, frame) => {
            handleFrameProcessed(probs, frame)
            userOnFrameProcessed?.(probs, frame)
          },

          onSpeechStart: () => {
            if (cancelled) return
            if(optionOnSpeechStart) {
              optionOnSpeechStart()
            }
            speakingRef.current = true
            streamingRef.current = true
            dispatch({ type: 'SET_USER_SPEAKING', payload: true })
          },

          onSpeechEnd: () => {
            if (cancelled) return
            if(optionOnSpeechEnd) {
              optionOnSpeechEnd()
            }

            // 结束语音周期时关闭逐帧推送开关，并通知全局状态
            speakingRef.current = false
            streamingRef.current = false
            dispatch({ type: 'SET_USER_SPEAKING', payload: false })
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
  }, [voiceInputEnabled, dispatch, onError, vadOptions, handleFrameProcessed])

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

      // 清理语音相关的状态，以免残留影响下一次激活
      // 退出时确保 speaking 状态复位
      speakingRef.current = false
    }
  }, [])
}
