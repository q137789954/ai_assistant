'use client'

import { useContext, useEffect, useRef, useCallback } from 'react'
import { MicVAD, type RealTimeVADOptions } from '@ricky0123/vad-web'
import { GlobalsContext } from '@/app/providers/GlobalsProviders'
import type { UserSpeechItem } from '@/app/providers/GlobalsProviders/types'

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

// 句子合并时间窗口：两次说话间隔 < 该值，就认为还是同一句
const DEFAULT_MERGE_WINDOW_MS = 300

type VoiceInputListenerOptions = {
  /**
   * 一次完整“业务句子”结束后的原始 PCM（16k Float32，已经合并过）
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
  /**
   * 句子合并窗口（毫秒）
   * - 两次说话间隔 < 该值，则合并为同一句
   * - 默认为 800ms
   */
  mergeWindowMs?: number
}

/**
 * useVoiceInputListener（带“句子合并”的 vad-web 版本）
 *
 * - 监听全局 voiceInputEnabled
 * - MicVAD 层负责快速检测开始/结束
 * - 本 hook 内部做“句子合并”，缓解拆句问题
 */
export default function useVoiceInputListener(options: VoiceInputListenerOptions = {}) {
  const globals = useContext(GlobalsContext)
  if (!globals) {
    throw new Error('useVoiceInputListener 必须在 GlobalsProviders 内部使用')
  }

  const { voiceInputEnabled, dispatch } = globals
  const { onSpeechSegment, onError, vadOptions, mergeWindowMs = DEFAULT_MERGE_WINDOW_MS } = options

  const vadRef = useRef<MicVAD | null>(null)
  const initializingRef = useRef(false)

  // 是否处于“VAD 认为用户在说话”的状态
  const speakingRef = useRef(false)

  // 等待合并的语音段（可能是一句被拆成多段）
  const pendingSegmentsRef = useRef<Float32Array[]>([])
  const mergeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSpeechEndAtRef = useRef<number | null>(null)

  /**
   * 把 pendingSegmentsRef 里的所有段合并成一段，并入队 & 回调
   */
  const flushMergedUtterance = useCallback(() => {
    const segments = pendingSegmentsRef.current
    if (!segments.length) return

    // 计算总长度
    const totalLength = segments.reduce((sum, seg) => sum + seg.length, 0)
    const merged = new Float32Array(totalLength)

    let offset = 0
    for (const seg of segments) {
      merged.set(seg, offset)
      offset += seg.length
    }

    pendingSegmentsRef.current = []
    mergeTimerRef.current = null
    lastSpeechEndAtRef.current = null

    const item: UserSpeechItem = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      audio: merged,
      sampleRate: 16000,
      createdAt: Date.now(),
    }

    // 入全局队列
    dispatch({ type: 'ENQUEUE_USER_SPEECH', payload: item })

    // 给调用方回调“合并后的一句”
    onSpeechSegment?.(merged)
  }, [dispatch, onSpeechSegment])

  // 根据全局开关启动 / 暂停 VAD
  useEffect(() => {
    // 语音输入关闭：暂停 VAD，并重置 isUserSpeaking
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

      // 关闭时，如果还有没提交的句子，直接 flush 一下
      if (mergeTimerRef.current) {
        clearTimeout(mergeTimerRef.current)
        mergeTimerRef.current = null
      }
      flushMergedUtterance()

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

            const now = Date.now()
            const lastEnd = lastSpeechEndAtRef.current

            // 如果在 merge 窗口内又开始说话 => 认为是上一句的延续
            if (lastEnd != null && now - lastEnd < mergeWindowMs) {
              if (mergeTimerRef.current) {
                clearTimeout(mergeTimerRef.current)
                mergeTimerRef.current = null
              }
              // 不 flush，继续往 pendingSegments 里追加
            } else {
              // 超过窗口，说明上一句应该已经结束了
              // 如果还有未提交的 segment，先 flush 掉
              flushMergedUtterance()
            }

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

            // 把这段先缓存起来，不马上当成“一句”
            pendingSegmentsRef.current.push(audio)
            lastSpeechEndAtRef.current = Date.now()

            // 重置定时器：在 mergeWindowMs 内如果没有新的 onSpeechStart，就把这些段合并成一句
            if (mergeTimerRef.current) {
              clearTimeout(mergeTimerRef.current)
            }
            mergeTimerRef.current = setTimeout(() => {
              if (cancelled) return
              flushMergedUtterance()
            }, mergeWindowMs)
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
        const err = e instanceof Error ? e : new Error(String(e))
        onError?.(err)

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
  }, [voiceInputEnabled, dispatch, mergeWindowMs, onError, vadOptions, flushMergedUtterance])

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

      if (mergeTimerRef.current) {
        clearTimeout(mergeTimerRef.current)
        mergeTimerRef.current = null
      }
    }
  }, [])
}
