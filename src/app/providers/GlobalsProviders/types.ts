import type { Dispatch, SetStateAction } from 'react'

export type DeviceType = 'desktop' | 'mobile'

export type GlobalsState = {
  deviceType: DeviceType
  voiceInputEnabled: boolean
}

export type GlobalsAction =
  | { type: 'SET_DEVICE_TYPE'; payload: DeviceType }
  | { type: 'SET_VOICE_INPUT_ENABLED'; payload: boolean }

export interface GlobalsContextValue extends GlobalsState {
  dispatch: Dispatch<GlobalsAction>
  permissionDialogOpen: boolean
  setPermissionDialogOpen: Dispatch<SetStateAction<boolean>>
}
