'use client'

import { useContext } from 'react'
import { DeviceContext } from './DeviceProvider'

export function useDevice() {
  const context = useContext(DeviceContext)
  if (!context) {
    throw new Error('useDevice must be used within DeviceProvider')
  }
  return context
}
