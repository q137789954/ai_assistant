'use client'

import { useCallback, useContext } from 'react'
import { GlobalsContext } from '@/app/providers/GlobalsProviders'

type VoiceInputToggleProps = {
  className?: string
}

export function VoiceInputToggle({ className = '' }: VoiceInputToggleProps) {
  const globals = useContext(GlobalsContext)

  if (!globals) {
    throw new Error('VoiceInputToggle must be rendered within GlobalsProviders')
  }

  const { voiceInputEnabled, dispatch } = globals

  const toggle = useCallback(() => {
    dispatch({ type: 'SET_VOICE_INPUT_ENABLED', payload: !voiceInputEnabled })
  }, [dispatch, voiceInputEnabled])

  const baseClasses = `flex items-center gap-2 rounded-full px-3 py-1 transition ${className}`
  const stateClasses = voiceInputEnabled
    ? 'bg-sky-200/80 text-sky-600 shadow-inner'
    : 'bg-white/60 text-slate-500'

  return (
    <button
      type="button"
      onClick={toggle}
      className={`${baseClasses} ${stateClasses}`}
      aria-pressed={voiceInputEnabled}
      aria-label="切换语音输入"
    >
      <span className="text-sm">{voiceInputEnabled ? '🎙️' : '🎤'}</span>
      <span className="text-xs font-semibold tracking-wide uppercase">语音输入</span>
    </button>
  )
}
