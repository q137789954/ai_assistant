import type { Dispatch, SetStateAction } from 'react'

export type DeviceType = 'desktop' | 'mobile'

export type GlobalsState = {
  deviceType: DeviceType
  voiceInputEnabled: boolean
  /**
   * 记录当前的语音输入是否处于用户正在说话的阶段
   */
  isUserSpeaking: boolean
  /**
   * 保存还未被处理的用户语音内容，按照录入顺序排入队列
   */
  pendingUserSpeechQueue: string[]
}

export type GlobalsAction =
  | { type: 'SET_DEVICE_TYPE'; payload: DeviceType }
  | { type: 'SET_VOICE_INPUT_ENABLED'; payload: boolean }
  | { type: 'SET_USER_SPEAKING'; payload: boolean }
  | { type: 'ENQUEUE_USER_SPEECH'; payload: string }
  | { type: 'DEQUEUE_USER_SPEECH' }
  | { type: 'CLEAR_USER_SPEECH_QUEUE' }

export interface GlobalsContextValue extends GlobalsState {
  dispatch: Dispatch<GlobalsAction>
  permissionDialogOpen: boolean
  setPermissionDialogOpen: Dispatch<SetStateAction<boolean>>
}
