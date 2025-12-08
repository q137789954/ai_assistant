'use client'

import { useContext, useEffect, useRef } from 'react'
import { GlobalsContext } from '@/app/providers/GlobalsProviders'

type VoiceInputListenerOptions = {
  onAudioChunk?: (chunk: Blob) => void
  onAudioStart?: () => void
  onAudioStop?: () => void
  onError?: (error: Error) => void
  mediaConstraints?: MediaStreamConstraints
  recorderOptions?: MediaRecorderOptions
  recorderTimeslice?: number
}

// 封装对麦克风的访问请求，便于统一处理浏览器兼容性错误
const requestMicrophone = async (constraints?: MediaStreamConstraints) => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('浏览器不支持麦克风访问')
  }

  return await navigator.mediaDevices.getUserMedia(constraints ?? { audio: true })
}

/**
 * useVoiceInputListener
 *
 * 监听全局语音输入开关，一旦开启就请求麦克风权限，启动 MediaRecorder
 * 并通过回调把音频块（Blob）传给调用方，同时在关闭或组件卸载时停止录制。
 */
export default function useVoiceInputListener(options: VoiceInputListenerOptions = {}) {
  const globals = useContext(GlobalsContext)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const {
    onAudioChunk,
    onAudioStart,
    onAudioStop,
    onError,
    mediaConstraints,
    recorderOptions,
    recorderTimeslice = 1000,
  } = options

  // 通过 globals 上下文读取语音输入开关，false 时直接跳过录音逻辑
  const voiceInputEnabled = globals?.voiceInputEnabled ?? false

  useEffect(() => {
    if (!voiceInputEnabled) {
      return
    }

    let active = true
    let cleanup = () => {}

    const startRecorder = async () => {
      try {
        // 请求系统麦克风权限，成功后返回流
        const stream = await requestMicrophone(mediaConstraints)
        if (!active) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        mediaStreamRef.current = stream
        // 创建 MediaRecorder 并监听数据、开始、结束等事件
        const recorder = new MediaRecorder(stream, recorderOptions)
        mediaRecorderRef.current = recorder

        const handleData = (event: BlobEvent) => {
          if (event.data && event.data.size > 0) {
            onAudioChunk?.(event.data)
          }
        }

        const handleStart = () => onAudioStart?.()
        const handleStop = () => onAudioStop?.()

        recorder.addEventListener('dataavailable', handleData)
        recorder.addEventListener('start', handleStart)
        recorder.addEventListener('stop', handleStop)

        recorder.start(recorderTimeslice)

        cleanup = () => {
          // 清理事件监听，停止录音器和关闭流
          recorder.removeEventListener('dataavailable', handleData)
          recorder.removeEventListener('start', handleStart)
          recorder.removeEventListener('stop', handleStop)
          if (recorder.state !== 'inactive') {
            try {
              recorder.stop()
            } catch {
              // ignore stop errors
            }
          }
          stream.getTracks().forEach((track) => track.stop())
        }
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error('录音权限不足或启动失败'))
      }
    }

    void startRecorder()

    return () => {
      active = false
      cleanup()
    }
  }, [
    voiceInputEnabled,
    onAudioChunk,
    onAudioStart,
    onAudioStop,
    onError,
    mediaConstraints,
    recorderOptions,
    recorderTimeslice,
  ])
}
