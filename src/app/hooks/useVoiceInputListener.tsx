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
  preSpeechPadMs: 150,

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
  // 记录上一次是否因 VoiceInputToggle 关闭而暂停了 VAD，方便再次打开时恢复
  const pausedRef = useRef(false)
  // 代替原先的局部 cancelled 标志，确保回调在重启 VAD 后仍能感知最新状态
  const cancelledRef = useRef(false)

  // 是否处于“VAD 认为用户在说话”的状态
  const speakingRef = useRef(false)
  // 控制是否在当前语音周期中持续向外推送每帧音频，关键信号源于 onSpeechStart/onSpeechEnd
  const streamingRef = useRef(false)
  // 动态记录最终使用的 positiveSpeechThreshold，便于在 onFrameProcessed 中根据真实阈值判断是否属于语音
  const positiveSpeechThresholdRef = useRef(
    FAST_VAD_PRESET.positiveSpeechThreshold ?? 0.6,
  )
  // 记录最近一次收到“语音帧”的时间戳，用于超时补发 onSpeechEnd
  const lastSpeechFrameAtRef = useRef<number | null>(null)
  // 兜底结束的定时器句柄，避免 VAD 未触发 onSpeechEnd 时卡住
  const endFallbackTimerRef = useRef<number | null>(null)
  // 兜底结束的时间窗口（ms），基于 redemptionMs + buffer 计算
  const endFallbackDelayMsRef = useRef<number>(500)
  // 控制日志输出频率，避免 onFrameProcessed 过于频繁刷屏
  const lastFrameLogAtRef = useRef<number>(0)

  // 清理兜底定时器，避免重复触发或内存泄露
  const clearEndFallbackTimer = useCallback(() => {
    if (endFallbackTimerRef.current === null) {
      return
    }
    window.clearTimeout(endFallbackTimerRef.current)
    endFallbackTimerRef.current = null
  }, [])

  // 触发兜底 onSpeechEnd：当 VAD 未正常结束时，保证上层能收尾请求
  const triggerFallbackSpeechEnd = useCallback(() => {
    if (cancelledRef.current) {
      return
    }
    // 如果当前已经不在“说话/推流”状态，说明已经正常结束，无需兜底
    if (!speakingRef.current && !streamingRef.current) {
      return
    }
    // 兜底走与 VAD 结束一致的收尾流程
    optionOnSpeechEnd?.()
    speakingRef.current = false
    streamingRef.current = false
    dispatch({ type: 'SET_USER_SPEAKING', payload: false })
  }, [dispatch, optionOnSpeechEnd])

  // 刷新兜底结束定时器：每次收到语音帧都延后结束判断
  const scheduleEndFallback = useCallback(() => {
    clearEndFallbackTimer()
    endFallbackTimerRef.current = window.setTimeout(() => {
      if (cancelledRef.current) {
        return
      }
      const lastSpeechAt = lastSpeechFrameAtRef.current
      if (!lastSpeechAt) {
        return
      }
      const elapsed = Date.now() - lastSpeechAt
      // 防止旧定时器误触发：只有超过阈值才真正执行兜底结束
      if (elapsed < endFallbackDelayMsRef.current) {
        return
      }
      triggerFallbackSpeechEnd()
    }, endFallbackDelayMsRef.current)
  }, [clearEndFallbackTimer, triggerFallbackSpeechEnd])

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

      // 低于阈值时不触发 onSpeechSegment，同时节流输出调试日志
      if (!isSpeech) {
        const now = Date.now()
        if (now - lastFrameLogAtRef.current > 2000) {
          console.debug('[useVoiceInputListener] 未命中语音阈值', {
            score: probs.isSpeech,
            threshold,
          })
          lastFrameLogAtRef.current = now
        }
        return
      }

      if (!isSpeech || !frame.length) {
        if (!frame.length) {
          console.warn('[useVoiceInputListener] 命中语音但帧为空', {
            score: probs.isSpeech,
            threshold,
          })
        }
        return
      }

      // 记录首帧命中，便于定位“有说话但没有发出去”的情况
      if (!lastSpeechFrameAtRef.current) {
        console.debug('[useVoiceInputListener] 语音帧命中', {
          score: probs.isSpeech,
          threshold,
          frameLength: frame.length,
        })
      }

      streamingRef.current = true
      lastSpeechFrameAtRef.current = Date.now()
      // 每次有语音帧都刷新兜底结束时间，避免 onSpeechEnd 缺失导致卡住
      scheduleEndFallback()
      onSpeechSegment?.(frame)
    },
    [onSpeechSegment, scheduleEndFallback],
  )

  // 根据全局开关启动 / 暂停 VAD
  useEffect(() => {
    cancelledRef.current = false
    if (!voiceInputEnabled) {
      if (vadRef.current) {
        try {
          vadRef.current.pause()
          pausedRef.current = true
          console.debug('[useVoiceInputListener] 语音输入关闭，暂停 VAD')
        } catch (e) {
          console.warn('[useVoiceInputListener] pause VAD 出错', e)
        }
      }
      speakingRef.current = false
      streamingRef.current = false
      dispatch({ type: 'SET_USER_SPEAKING', payload: false })
      clearEndFallbackTimer()
      lastSpeechFrameAtRef.current = null

      // 当全局关闭语音输入时马上终止推送并标记状态
      cancelledRef.current = true
      return
    }

    // 重新开启因开关关闭而暂停的 VAD 实例
    const resumePausedVad = () => {
      if (!pausedRef.current || !vadRef.current) {
        return false
      }

      try {
        vadRef.current.start()
        pausedRef.current = false
        console.debug('[useVoiceInputListener] 语音输入打开，恢复 VAD')
        return true
      } catch (e) {
        console.warn('[useVoiceInputListener] resume VAD 出错', e)
        return false
      }
    }

    if (resumePausedVad()) {
      return () => {
        cancelledRef.current = true
      }
    }

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
        // 兜底结束窗口：使用 redemptionMs + buffer，避免误判导致过早结束
        const redemptionMs =
          mergedVadOptions.redemptionMs ?? FAST_VAD_PRESET.redemptionMs ?? 200
        endFallbackDelayMsRef.current = redemptionMs + 200

        // 记录调用方可能自定义的 onFrameProcessed，以便我们包裹后仍能透传事件
        const userOnFrameProcessed = mergedVadOptions.onFrameProcessed
        const instance = await MicVAD.new({
          ...mergedVadOptions,
          onFrameProcessed: (probs, frame) => {
            handleFrameProcessed(probs, frame)
            userOnFrameProcessed?.(probs, frame)
          },

          onSpeechStart: () => {
            if (cancelledRef.current) return
            if(optionOnSpeechStart) {
              optionOnSpeechStart()
            }
            console.debug('[useVoiceInputListener] VAD 检测到开始说话')
            speakingRef.current = true
            streamingRef.current = true
            dispatch({ type: 'SET_USER_SPEAKING', payload: true })
          },

          onSpeechEnd: () => {
            if (cancelledRef.current) return
            if(optionOnSpeechEnd) {
              optionOnSpeechEnd()
            }
            console.debug('[useVoiceInputListener] VAD 检测到结束说话')

            // 结束语音周期时关闭逐帧推送开关，并通知全局状态
            speakingRef.current = false
            streamingRef.current = false
            dispatch({ type: 'SET_USER_SPEAKING', payload: false })
            clearEndFallbackTimer()
            lastSpeechFrameAtRef.current = null
          },
        })

        if (cancelledRef.current) {
          instance.destroy()
          return
        }

        vadRef.current = instance
        instance.start()
        console.debug('[useVoiceInputListener] VAD 初始化完成并启动')
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
      cancelledRef.current = true
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
      pausedRef.current = false
      clearEndFallbackTimer()
      lastSpeechFrameAtRef.current = null
    }
  }, [])
}
