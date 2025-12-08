'use client'

import React, { createContext, useCallback, useEffect, useMemo, useReducer } from 'react'
import type { GlobalsContextValue, GlobalsAction, GlobalsState } from './types'
import {
  isMicrophoneSupported,
  queryMicrophonePermission,
  requestMicrophoneStream,
} from '@/app/utils/microphone'

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

  /**
   * 统一判断并请求麦克风权限，成功后返回 true，失败或不支持时返回 false
   */
  const ensureMicrophonePermission = useCallback(async (): Promise<boolean> => {
    console.log(isMicrophoneSupported());
    if (!isMicrophoneSupported()) {
      return false
    }

    const permissionState = await queryMicrophonePermission()
    console.log('permissionState:', permissionState);
    if (permissionState === 'granted') {
      return true
    }

    if (permissionState === 'denied') {
      return false
    }

    try {
      const stream = await requestMicrophoneStream()
      stream.getTracks().forEach((track) => track.stop())
      return true
    } catch {
      return false
    }
  }, [])

  /**
   * 在 SET_VOICE_INPUT_ENABLED 为 true 时先行检查权限，确保只有授权后才切换为开启
   */
  const guardedDispatch = useCallback(
    (action: GlobalsAction) => {
      console.log('Dispatching action:', action);
      console.log('Current voiceInputEnabled state:', voiceInputEnabled);
      if (
        action.type === 'SET_VOICE_INPUT_ENABLED' &&
        action.payload &&
        !voiceInputEnabled
      ) {
        void (async () => {
          console.log('Requesting microphone permission...');
          const hasPermission = await ensureMicrophonePermission()
          dispatch({ type: 'SET_VOICE_INPUT_ENABLED', payload: hasPermission })
        })()
        return
      }

      dispatch(action)
    },
    [dispatch, ensureMicrophonePermission, voiceInputEnabled]
  )

  const value: GlobalsContextValue = useMemo(
    () => ({
      deviceType,
      voiceInputEnabled,
      dispatch: guardedDispatch
    }),
    [deviceType, voiceInputEnabled, guardedDispatch]
  )

  return (
    <GlobalsContext.Provider value={value}>{children}</GlobalsContext.Provider>
  )
}
