'use client'

import { useCallback, useContext } from 'react'
import { GlobalsContext } from '@/app/providers/GlobalsProviders'
import { Mic, MicOff } from 'lucide-react'
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
    console.log(!voiceInputEnabled)
    dispatch({ type: 'SET_VOICE_INPUT_ENABLED', payload: !voiceInputEnabled })
  }, [dispatch, voiceInputEnabled])

  return (
    <div
      onClick={toggle}
      className={clsx( `flex items-center justify-center h-10! w-10! rounded-full! p-0! shrink-0 cursor-pointer`, className, voiceInputEnabled?"bg-[rgb(82,196,26)] text-black/60" : "bg-[rgb(51,51,51)] text-white")}
    >
      {
        voiceInputEnabled ? <Mic size={14} /> : <MicOff size={14} />
      }
    </div>
  )
}
