'use client'

import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react'
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
  voiceInputEnabled: false,
  isUserSpeaking: false,
  pendingUserSpeechQueue: [],
}

const reducer = (state: GlobalsState, action: GlobalsAction): GlobalsState => {
  switch (action.type) {
    case 'SET_DEVICE_TYPE':
      return state.deviceType === action.payload ? state : { ...state, deviceType: action.payload }
    case 'SET_VOICE_INPUT_ENABLED':
      return state.voiceInputEnabled === action.payload
        ? state
        : { ...state, voiceInputEnabled: action.payload }
    case 'SET_USER_SPEAKING':
      // 同步更新用户是否正在输入语音的状态
      return state.isUserSpeaking === action.payload
        ? state
        : { ...state, isUserSpeaking: action.payload }
    case 'ENQUEUE_USER_SPEECH':
      // 将新的用户语音内容追加到未处理队列末尾
      return {
        ...state,
        pendingUserSpeechQueue: [...state.pendingUserSpeechQueue, action.payload],
      }
    case 'DEQUEUE_USER_SPEECH':
      // 已处理的语音内容出队，确保队列不会在空时变更
      if (state.pendingUserSpeechQueue.length === 0) {
        return state
      }
      return {
        ...state,
        pendingUserSpeechQueue: state.pendingUserSpeechQueue.slice(1),
      }
    case 'CLEAR_USER_SPEECH_QUEUE':
      // 清空所有待处理的语音内容
      return state.pendingUserSpeechQueue.length === 0
        ? state
        : { ...state, pendingUserSpeechQueue: [] }
    default:
      return state
  }
}

export default function GlobalsProviders({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  // 顶层管理麦克风权限相关提示框状态，由 layout 统一展示对应提示
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false)

  useEffect(() => {
    const updateDeviceType = () => {
      const nextType = window.innerWidth < MOBILE_BREAKPOINT ? 'mobile' : 'desktop'
      dispatch({ type: 'SET_DEVICE_TYPE', payload: nextType })
    }

    updateDeviceType()
    window.addEventListener('resize', updateDeviceType)
    return () => window.removeEventListener('resize', updateDeviceType)
  }, [dispatch])

  const {
    deviceType,
    voiceInputEnabled,
    isUserSpeaking,
    pendingUserSpeechQueue,
  } = state

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
      // 权限被拒绝时通知 layout 展示说明框，避免在 Provider 里直接耦合 UI
      setPermissionDialogOpen(true)
      return false
    }

    try {
      const stream = await requestMicrophoneStream()
      stream.getTracks().forEach((track) => track.stop())
      return true
    } catch {
      return false
    }
  }, [setPermissionDialogOpen])

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
      isUserSpeaking,
      pendingUserSpeechQueue,
      dispatch: guardedDispatch,
      permissionDialogOpen,
      setPermissionDialogOpen,
    }),
    [
      deviceType,
      voiceInputEnabled,
      isUserSpeaking,
      pendingUserSpeechQueue,
      guardedDispatch,
      permissionDialogOpen,
      setPermissionDialogOpen,
    ]
  )

  return <GlobalsContext.Provider value={value}>{children}</GlobalsContext.Provider>
}
