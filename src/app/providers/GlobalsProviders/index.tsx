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

// 初始化全局状态，包含设备类型、语音输入开关以及用户语音队列相关信息
const initialState: GlobalsState = {
  deviceType: 'desktop',
  voiceInputEnabled: false,
  isUserSpeaking: false,
  pendingUserSpeechQueue: [],
  pendingUserSpeech: null,
  chatbotVisible: false,
  personalCenterVisible: false,
  timestampWatermark: null
}

const reducer = (state: GlobalsState, action: GlobalsAction): GlobalsState => {
  switch (action.type) {
    case 'SET_DEVICE_TYPE':
      // 根据窗口尺寸更新设备类型，仅在变化时触发
      return state.deviceType === action.payload ? state : { ...state, deviceType: action.payload }
    case 'SET_VOICE_INPUT_ENABLED':
      // 语音输入开关切换，避免重复写入同一值
      return state.voiceInputEnabled === action.payload
        ? state
        : { ...state, voiceInputEnabled: action.payload }
    case 'SET_USER_SPEAKING':
      // 标记当前是否处于说话阶段用于 UI 或任务判断
      return state.isUserSpeaking === action.payload
        ? state
        : { ...state, isUserSpeaking: action.payload }
    case 'ENQUEUE_USER_SPEECH':
      // 将新语音内容追加队列，并同步设置当前正在处理的条目
      return {
        ...state,
        pendingUserSpeech: action.payload,
        pendingUserSpeechQueue: [...state.pendingUserSpeechQueue, action.payload],
      }
    case 'DEQUEUE_USER_SPEECH':
      // 当前语音处理完成后从队列移除并更新下一条
      if (state.pendingUserSpeechQueue.length === 0) {
        return state
      }
      const nextQueue = state.pendingUserSpeechQueue.slice(1)
      return {
        ...state,
        pendingUserSpeechQueue: nextQueue,
        pendingUserSpeech: nextQueue[0] ?? null,
      }
    case 'CLEAR_USER_SPEECH_QUEUE':
      // 重置队列相关状态，避免 lingering 的防御性写入
      return state.pendingUserSpeechQueue.length === 0
        ? state
        : { ...state, pendingUserSpeechQueue: [], pendingUserSpeech: null }
    case 'SET_CHATBOT_VISIBILITY':
      // 控制 Chatbot 组件显示状态，避免重复派发相同值
      return state.chatbotVisible === action.payload
        ? state
        : { ...state, chatbotVisible: action.payload }
    case 'SET_PERSONAL_CENTER_VISIBILITY':
      // 控制个人中心抽屉的开关状态，避免重复渲染
      return state.personalCenterVisible === action.payload
        ? state
        : { ...state, personalCenterVisible: action.payload }
    case 'SET_TIMESTAMP_WATERMARK':
        // 用户最后开口/发送聊天时间
        return { ...state, timestampWatermark: action.payload || null }
    default:
      return state
  }
}

export default function GlobalsProviders({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  // 顶层管理麦克风权限相关提示框状态，由 layout 统一展示对应提示
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false)

  /**
   * 监听窗口尺寸，在设备类型变化时更新 state，便于各处根据设备分支逻辑
   */
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
    pendingUserSpeech,
    pendingUserSpeechQueue,
    chatbotVisible,
    personalCenterVisible,
  } = state

  /**
   * 封装麦克风权限判断：先检查支持与已有权限，必要时发起请求
   * 成功返回 true，失败/拒绝时记录状态并通过 layout 提前告知用户
   */
  const ensureMicrophonePermission = useCallback(async (): Promise<boolean> => {
    if (!isMicrophoneSupported()) {
      return false
    }

    const permissionState = await queryMicrophonePermission()
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
   * 用来包裹 dispatch 的回调，处理在开启语音输入时的权限约束和异步逻辑
   */
  const guardedDispatch = useCallback(
    (action: GlobalsAction) => {
      if (
        action.type === 'SET_VOICE_INPUT_ENABLED' &&
        action.payload &&
        !voiceInputEnabled
      ) {
        void (async () => {
          const hasPermission = await ensureMicrophonePermission()
          dispatch({ type: 'SET_VOICE_INPUT_ENABLED', payload: hasPermission })
        })()
        return
      }

      dispatch(action)
    },
    [dispatch, ensureMicrophonePermission, voiceInputEnabled]
  )

  // useMemo 让 context 只在相关依赖变化时重新创建，防止不必要的 rerender
  const value: GlobalsContextValue = useMemo(
    () => ({
      deviceType,
      voiceInputEnabled,
      isUserSpeaking,
      pendingUserSpeech,
      pendingUserSpeechQueue,
      chatbotVisible,
      personalCenterVisible,
      dispatch: guardedDispatch,
      permissionDialogOpen,
      setPermissionDialogOpen,
    }),
    [
    deviceType,
    voiceInputEnabled,
    isUserSpeaking,
    pendingUserSpeech,
    pendingUserSpeechQueue,
    chatbotVisible,
    personalCenterVisible,
    guardedDispatch,
    permissionDialogOpen,
    setPermissionDialogOpen,
    ]
  )

  return <GlobalsContext.Provider value={value}>{children}</GlobalsContext.Provider>
}
