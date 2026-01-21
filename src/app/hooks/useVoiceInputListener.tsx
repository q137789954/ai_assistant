'use client'

import { useContext, useEffect, useRef, useCallback } from 'react'
import { MicVAD, type RealTimeVADOptions } from '@ricky0123/vad-web'
import { GlobalsContext } from '@/app/providers/GlobalsProviders'

/**
 * =========================
 * 资源路径与默认配置
 * =========================
 *
 * vad-web（@ricky0123/vad-web）底层依赖：
 * - onnxruntime-web 的 wasm 文件
 * - vad 模型文件
 * - worker 等静态资源
 *
 * 这里统一把资源放在 public/onnx-runtime/ 下，
 * 通过 baseAssetPath / onnxWASMBasePath 让 MicVAD 能以静态路径加载资源。
 */
const DEFAULT_VAD_ASSET_PATH = '/onnx-runtime/'
const DEFAULT_VAD_OPTIONS: Partial<RealTimeVADOptions> = {
  baseAssetPath: DEFAULT_VAD_ASSET_PATH,
  onnxWASMBasePath: DEFAULT_VAD_ASSET_PATH,
}

/**
 * =========================
 * 快速预设（可按需调整）
 * =========================
 *
 * 目标：更快识别“开始/结束”
 * - redemptionMs 越小：越快判定结束，但越可能拆句
 * - preSpeechPadMs：补一点点开头，避免吃掉首音节
 * - minSpeechMs：太短的段当作误触发
 */
export const FAST_VAD_PRESET: Partial<RealTimeVADOptions> = {
  model: 'v5',
  positiveSpeechThreshold: 0.8,
  negativeSpeechThreshold: 0.6,
  redemptionMs: 200,
  preSpeechPadMs: 150,
  minSpeechMs: 100,
}

/**
 * =========================
 * 对外暴露的最小能力（纯粹版）
 * =========================
 *
 * 只提供三类回调：
 * - onSpeechStart：检测到“开始说话”
 * - onSpeechSegment：检测到一段完整语音（Float32Array，16k PCM）
 * - onSpeechEnd：这次说话周期结束（注意：兜底也会触发）
 *
 * + VoiceInputToggle（voiceInputEnabled）控制 VAD 的 pause/resume/init
 *
 * 其他功能（逐帧推流/阈值过滤/日志节流/合并句子等）统统不做。
 */
type VoiceInputListenerOptions = {
  /**
   * 每段完整语音（来自 MicVAD 的 onSpeechEnd(audio)）
   * audio 为 16k Float32 PCM（单声道）
   */
  onSpeechSegment?: (audio: Float32Array) => void

  /** VAD 判断开始说话 */
  onSpeechStart?: () => void

  /**
   * VAD 判断结束说话（或兜底超时结束）
   * - 如果 VAD 没有触发正常 onSpeechEnd，这个也会被兜底触发，避免上层卡住
   */
  onSpeechEnd?: () => void

  /** 初始化/运行错误 */
  onError?: (error: Error) => void

  /** 透传给 MicVAD 的配置 */
  vadOptions?: Partial<RealTimeVADOptions>
}

/**
 * useVoiceInputListener（纯粹版 + 兜底说话状态回落）
 *
 * =========================
 * 我们为什么还要 onFrameProcessed？
 * =========================
 *
 * 你要求“纯粹”，只保留三种回调，但又希望：
 * - 全局 speaking 状态不会因为某些异常（VAD 未触发 onSpeechEnd）而卡住
 *
 * 兜底逻辑需要一个“心跳信号”来判断用户是否仍在说话：
 * - onFrameProcessed 会持续被调用（每帧都有 probs.isSpeech）
 * - 我们不把 frame 往外发，不做阈值过滤、推流，只做一件事：
 *   当 probs.isSpeech >= positiveSpeechThreshold 时，刷新 lastSpeechFrameAt
 *
 * 这样就可以：
 * - 每次收到“语音帧”就延后兜底结束计时
 * - 如果超过 endFallbackDelay（≈ redemptionMs + buffer）没收到语音帧，
 *   且 VAD 也没给 onSpeechEnd，就判定“结束”并兜底触发 onSpeechEnd + speaking=false
 */
export default function useVoiceInputListener(
  options: VoiceInputListenerOptions = {},
) {
  const globals = useContext(GlobalsContext)
  if (!globals) {
    throw new Error('useVoiceInputListener 必须在 GlobalsProviders 内部使用')
  }

  const { voiceInputEnabled, dispatch } = globals
  const { onSpeechSegment, onError, vadOptions, onSpeechEnd, onSpeechStart } =
    options

  /**
   * =========================
   * VAD 实例与生命周期控制
   * =========================
   */
  const vadRef = useRef<MicVAD | null>(null)

  /** 防止并发初始化（重复 new） */
  const initializingRef = useRef(false)

  /**
   * 标记是否因为 VoiceInputToggle 关闭而 pause 了 VAD：
   * - 关闭：pause（保留实例，便于快速恢复）
   * - 再打开：start（resume）
   */
  const pausedRef = useRef(false)

  /**
   * “取消标志”：
   * - effect 清理 / 关闭 / 卸载时设为 true
   * - 回调中检查，防止异步初始化结束后仍然 setState / dispatch
   */
  const cancelledRef = useRef(false)

  /**
   * =========================
   * 兜底：说话状态回落（关键）
   * =========================
   *
   * speakingRef：
   * - 我们内部认为是否处于“说话周期中”
   *
   * lastSpeechFrameAt：
   * - 最近一次识别到“语音帧”的时间戳（来自 onFrameProcessed）
   *
   * endFallbackTimer：
   * - 定时检查，如果长时间没有语音帧，则认为结束（兜底）
   *
   * endFallbackDelayMs：
   * - 兜底超时时间：
   *   取 redemptionMs + buffer（例：200 + 250 = 450ms）
   *   这样不会比 VAD 更激进，避免误把短停顿判成结束
   *
   * positiveSpeechThreshold：
   * - 用于判断 frame 是否算“语音帧”（只用于兜底刷新心跳）
   */
  const speakingRef = useRef(false)
  const lastSpeechFrameAtRef = useRef<number | null>(null)
  const endFallbackTimerRef = useRef<number | null>(null)
  const endFallbackDelayMsRef = useRef<number>(600)
  const positiveSpeechThresholdRef = useRef<number>(
    FAST_VAD_PRESET.positiveSpeechThreshold ?? 0.6,
  )

  /**
   * 清理兜底定时器：避免重复触发、避免卸载后还回调
   */
  const clearEndFallbackTimer = useCallback(() => {
    if (endFallbackTimerRef.current === null) return
    window.clearTimeout(endFallbackTimerRef.current)
    endFallbackTimerRef.current = null
  }, [])

  /**
   * 统一“结束”出口（非常重要）：
   * - 正常路径：MicVAD 的 onSpeechEnd(audio) 触发 => finalizeSpeechEnd('vad')
   * - 兜底路径：超时 => finalizeSpeechEnd('fallback')
   *
   * 统一出口可以确保：
   * - speaking 状态只回落一次（防重复）
   * - timer / lastSpeechFrameAt 都会清理
   * - onSpeechEnd 一定会触发（包括兜底）
   * - 全局 SET_USER_SPEAKING=false 一定会 dispatch
   */
  const finalizeSpeechEnd = useCallback(
    (reason: 'vad' | 'fallback') => {
      // 已取消（关闭/卸载/切换）时，任何回调都不应再影响状态
      if (cancelledRef.current) return

      // 防重复触发：如果已经不是 speaking，则直接忽略
      // （避免正常 onSpeechEnd 后，兜底 timer 又触发一次）
      if (!speakingRef.current) return

      // 1) 内部状态回落
      speakingRef.current = false

      // 2) 清理心跳与兜底 timer
      lastSpeechFrameAtRef.current = null
      clearEndFallbackTimer()

      // 3) 对外：通知全局 speaking=false
      dispatch({ type: 'SET_USER_SPEAKING', payload: false })

      // 4) 对外：触发 onSpeechEnd（兜底也会触发，防止上层逻辑卡死）
      onSpeechEnd?.()

      // 5) 可选：你要调试兜底触发时机，可以留一个 warn
      if (reason === 'fallback') {
        console.warn(
          '[useVoiceInputListener] VAD 未触发 onSpeechEnd，已兜底结束',
        )
      }
    },
    [clearEndFallbackTimer, dispatch, onSpeechEnd],
  )

  /**
   * “刷新兜底计时器”：
   * - 每次检测到语音帧，就延后结束判断
   * - 这样只要用户还在说话（不断有语音帧），就不会触发兜底结束
   */
  const scheduleEndFallback = useCallback(() => {
    clearEndFallbackTimer()

    endFallbackTimerRef.current = window.setTimeout(() => {
      if (cancelledRef.current) return

      const last = lastSpeechFrameAtRef.current
      if (!last) return

      // 超过阈值仍无语音帧，认为结束
      const elapsed = Date.now() - last
      if (elapsed >= endFallbackDelayMsRef.current) {
        finalizeSpeechEnd('fallback')
      }
    }, endFallbackDelayMsRef.current)
  }, [clearEndFallbackTimer, finalizeSpeechEnd])

  /**
   * =========================
   * 主 effect：响应 VoiceInputToggle
   * =========================
   *
   * 规则：
   * - voiceInputEnabled=false：pause（保留实例），并清理 speaking + timer
   * - voiceInputEnabled=true：
   *   - 如果之前 pause 过：start 恢复
   *   - 否则：初始化 MicVAD 并 start
   */
  useEffect(() => {
    cancelledRef.current = false

    /**
     * 关闭语音输入：
     * - pause（保留实例）
     * - 立刻清理 speaking 状态（避免 UI 卡住）
     * - 清理兜底 timer
     */
    if (!voiceInputEnabled) {
      if (vadRef.current) {
        try {
          vadRef.current.pause()
          pausedRef.current = true
        } catch (e) {
          console.warn('[useVoiceInputListener] pause VAD 出错', e)
        }
      }

      // 关闭时强制复位 speaking
      speakingRef.current = false
      lastSpeechFrameAtRef.current = null
      clearEndFallbackTimer()

      dispatch({ type: 'SET_USER_SPEAKING', payload: false })

      // 标记取消，避免后续异步初始化回调影响状态
      cancelledRef.current = true
      return
    }

    /**
     * 打开语音输入：若是 pause 恢复，直接 start
     */
    if (pausedRef.current && vadRef.current) {
      try {
        vadRef.current.start()
        pausedRef.current = false
      } catch (e) {
        console.warn('[useVoiceInputListener] resume VAD 出错', e)
      }

      return () => {
        cancelledRef.current = true
      }
    }

    /**
     * 打开语音输入：首次初始化（或实例被 destroy 后重建）
     */
    const ensureVad = async () => {
      if (vadRef.current || initializingRef.current) return
      initializingRef.current = true

      try {
        // 合并配置：默认路径 + 快速预设 + 外部传入覆盖
        const mergedVadOptions: Partial<RealTimeVADOptions> = {
          ...DEFAULT_VAD_OPTIONS,
          ...FAST_VAD_PRESET,
          ...vadOptions,
        }

        /**
         * 兜底时间窗口：
         * - 基于 redemptionMs（静音判定结束时间）
         * - 加 buffer（避免短停顿造成过早结束）
         */
        const redemptionMs =
          mergedVadOptions.redemptionMs ?? FAST_VAD_PRESET.redemptionMs ?? 200
        endFallbackDelayMsRef.current = redemptionMs + 250

        /**
         * 用于“语音帧心跳”的阈值（只用于兜底刷新）
         */
        positiveSpeechThresholdRef.current =
          mergedVadOptions.positiveSpeechThreshold ??
          FAST_VAD_PRESET.positiveSpeechThreshold ??
          0.6

        /**
         * 如果外部传入了 onFrameProcessed，我们会透传它：
         * - 我们先做兜底心跳刷新
         * - 再调用用户自己的 onFrameProcessed（不改变你原本的使用方式）
         */
        const userOnFrameProcessed = mergedVadOptions.onFrameProcessed

        const instance = await MicVAD.new({
          ...mergedVadOptions,

          /**
           * onFrameProcessed：仅用于兜底“心跳”
           * - 不向外吐帧
           * - 不做推流
           * - 不做过滤/节流日志
           */
          onFrameProcessed: (probs, frame) => {
            const threshold = positiveSpeechThresholdRef.current

            // 只有当模型认为是语音帧时才刷新心跳
            if (probs.isSpeech >= threshold) {
              lastSpeechFrameAtRef.current = Date.now()

              // 只有在 speaking 周期中才需要延后结束判断
              if (speakingRef.current) {
                scheduleEndFallback()
              }
            }

            // 透传给外部（如果调用方需要）
            userOnFrameProcessed?.(probs, frame)
          },

          /**
           * onSpeechStart：进入说话周期
           * - 立刻设置 speaking=true
           * - 初始化心跳时间戳
           * - 启动兜底定时器
           * - 触发回调 + 更新全局状态
           */
          onSpeechStart: () => {
            if (cancelledRef.current) return

            speakingRef.current = true
            lastSpeechFrameAtRef.current = Date.now()
            scheduleEndFallback()

            onSpeechStart?.()
            dispatch({ type: 'SET_USER_SPEAKING', payload: true })
          },

          /**
           * onSpeechEnd：MicVAD 正常给出整段语音
           * - 先把这段 audio 吐给 onSpeechSegment
           * - 再走统一 finalizeSpeechEnd('vad')：
           *   这会触发 onSpeechEnd + speaking=false + 清理 timer
           */
          onSpeechEnd: (audio: Float32Array) => {
            if (cancelledRef.current) return

            onSpeechSegment?.(audio)
            finalizeSpeechEnd('vad')
          },
        })

        // 初始化完成但期间被关闭/卸载：立刻销毁，避免资源泄露
        if (cancelledRef.current) {
          instance.destroy()
          return
        }

        vadRef.current = instance
        instance.start()
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e))
        console.error('[useVoiceInputListener] 初始化 MicVAD 失败', err)
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
  }, [
    voiceInputEnabled,
    dispatch,
    onSpeechStart,
    onSpeechEnd,
    onSpeechSegment,
    onError,
    vadOptions,
    clearEndFallbackTimer,
    scheduleEndFallback,
    finalizeSpeechEnd,
  ])

  /**
   * =========================
   * 卸载 effect：彻底释放资源
   * =========================
   *
   * - destroy MicVAD（释放 AudioContext / Worklet / 模型等）
   * - 清理 timer / speaking 状态
   * - 全局 speaking=false
   */
  useEffect(() => {
    return () => {
      cancelledRef.current = true
      pausedRef.current = false

      speakingRef.current = false
      lastSpeechFrameAtRef.current = null
      clearEndFallbackTimer()

      dispatch({ type: 'SET_USER_SPEAKING', payload: false })

      if (vadRef.current) {
        try {
          vadRef.current.destroy()
        } catch (e) {
          console.warn('[useVoiceInputListener] destroy VAD 出错', e)
        }
        vadRef.current = null
      }
    }
  }, [dispatch, clearEndFallbackTimer])
}
