'use client'

import { useContext, useEffect, useRef } from 'react'
import { GlobalsContext } from '@/app/providers/GlobalsProviders'

type VoiceInputListenerOptions = {
  onResult?: (transcript: string) => void
  onError?: (error: Error) => void
  onStart?: () => void
  onEnd?: () => void
}

const getSpeechRecognitionCtor = () => {
  if (typeof window === 'undefined') {
    return undefined
  }

  const browserWindow = window as typeof window & {
    SpeechRecognition?: new () => any
    webkitSpeechRecognition?: new () => any
  }

  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition
}

export default function useVoiceInputListener(options: VoiceInputListenerOptions = {}) {
  const globals = useContext(GlobalsContext)
  const recognitionRef = useRef<any>(null)
  const { onResult, onError, onStart, onEnd } = options

  useEffect(() => {
    if (!globals) {
      return
    }

    const { voiceInputEnabled } = globals
    const RecognitionCtor = getSpeechRecognitionCtor()

    if (!RecognitionCtor) {
      onError?.(new Error('当前浏览器不支持语音识别'))
      return
    }

    if (!recognitionRef.current) {
      recognitionRef.current = new RecognitionCtor()
      recognitionRef.current.lang = 'zh-CN'
      recognitionRef.current.interimResults = true
      recognitionRef.current.continuous = true
    }

    const recognition = recognitionRef.current

    const handleResult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? '')
        .join('')
        .trim()

      if (transcript) {
        onResult?.(transcript)
      }
    }

    const handleError = (event: any) => {
      onError?.(new Error(event.error))
    }

    const startHandler = () => onStart?.()
    const endHandler = () => onEnd?.()

    recognition.addEventListener('result', handleResult)
    recognition.addEventListener('error', handleError)
    recognition.addEventListener('start', startHandler)
    recognition.addEventListener('end', endHandler)

    if (voiceInputEnabled) {
      try {
        recognition.start()
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error('启动语音监听失败'))
      }
    } else {
      try {
        recognition.stop()
      } catch {
        // ignore stop errors when recognition is not active
      }
    }

    return () => {
      recognition.removeEventListener('result', handleResult)
      recognition.removeEventListener('error', handleError)
      recognition.removeEventListener('start', startHandler)
      recognition.removeEventListener('end', endHandler)
      try {
        recognition.stop()
      } catch {
        // ignore stop errors when recognition is not active
      }
    }
  }, [globals, onEnd, onError, onResult, onStart])
}
