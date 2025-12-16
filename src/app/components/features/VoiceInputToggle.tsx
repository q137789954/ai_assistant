'use client'

import { useCallback, useContext } from 'react'
import { GlobalsContext } from '@/app/providers/GlobalsProviders'
import { Mic, MicOff } from 'lucide-react'
import { Button } from '../ui'

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

  return (
    <div
      onClick={toggle}
      className={ `rounded-full p-2 ${className}`}
    >
      {
        voiceInputEnabled ? <Mic size={32} /> : <MicOff size={32} />
      }
    </div>
  )
}
