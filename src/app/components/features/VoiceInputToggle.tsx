'use client'

import { useCallback, useContext } from 'react'
import { GlobalsContext } from '@/app/providers/GlobalsProviders'
import { Mic, MicOff } from 'lucide-react'
import { AppButton } from "@/app/components/ui";
import clsx from 'clsx';

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
    <AppButton
      onClick={toggle}
      tone={voiceInputEnabled ? 'success' : 'danger'}
      className={clsx( `flex items-center justify-center h-12! w-12! rounded-full! p-0! shrink-0`, className, voiceInputEnabled?"" : "")}
    >
      {
        voiceInputEnabled ? <Mic size={24} /> : <MicOff size={24} />
      }
    </AppButton>
  )
}
