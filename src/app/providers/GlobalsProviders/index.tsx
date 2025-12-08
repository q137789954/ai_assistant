'use client'

import React, { createContext, useEffect, useMemo, useReducer } from 'react'
import type { GlobalsContextValue, GlobalsAction, GlobalsState } from './types'

export const GlobalsContext = createContext<GlobalsContextValue | undefined>(undefined)

const MOBILE_BREAKPOINT = 768

const initialState: GlobalsState = {
  deviceType: 'desktop',
  voiceInputEnabled: false
}

const reducer = (state: GlobalsState, action: GlobalsAction): GlobalsState => {
  switch (action.type) {
    case 'SET_DEVICE_TYPE':
      return state.deviceType === action.payload ? state : { ...state, deviceType: action.payload }
    case 'SET_VOICE_INPUT_ENABLED':
      return state.voiceInputEnabled === action.payload
        ? state
        : { ...state, voiceInputEnabled: action.payload }
    default:
      return state
  }
}

export default function GlobalsProviders({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  useEffect(() => {
    const updateDeviceType = () => {
      const nextType = window.innerWidth < MOBILE_BREAKPOINT ? 'mobile' : 'desktop'
      dispatch({ type: 'SET_DEVICE_TYPE', payload: nextType })
    }

    updateDeviceType()
    window.addEventListener('resize', updateDeviceType)
    return () => window.removeEventListener('resize', updateDeviceType)
  }, [dispatch])

  const { deviceType, voiceInputEnabled } = state

  const value: GlobalsContextValue = useMemo(
    () => ({
      deviceType,
      voiceInputEnabled,
      dispatch
    }),
    [deviceType, voiceInputEnabled, dispatch]
  )

  return (
    <GlobalsContext.Provider value={value}>{children}</GlobalsContext.Provider>
  )
}
