import type { Dispatch } from 'react'

export type DeviceType = 'desktop' | 'mobile'

export type GlobalsAction =
  | { type: 'SET_DEVICE_TYPE'; payload: DeviceType }
  | { type: 'SET_VOICE_INPUT_ENABLED'; payload: boolean }

export interface GlobalsContextValue {
  deviceType: DeviceType
  voiceInputEnabled: boolean
  dispatch: Dispatch<GlobalsAction>
}
