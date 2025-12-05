'use client'

import React, { createContext, useEffect, useMemo, useState } from 'react'
import type { GlobalsContextValue, DeviceType } from './types'

export const GlobalsContext = createContext<GlobalsContextValue | undefined>(undefined)

const MOBILE_BREAKPOINT = 768

export default function GlobalsProviders({ children }: { children: React.ReactNode }) {
  const [deviceType, setDeviceType] = useState<DeviceType>('desktop')

  useEffect(() => {
    const updateDeviceType = () => {
      const nextType = window.innerWidth < MOBILE_BREAKPOINT ? 'mobile' : 'desktop'
      setDeviceType(nextType)
    }

    updateDeviceType()
    window.addEventListener('resize', updateDeviceType)
    return () => window.removeEventListener('resize', updateDeviceType)
  }, [])

  const value: GlobalsContextValue = useMemo(
    () => ({
      deviceType
    }),
    [deviceType],
  )

  return (
    <GlobalsContext.Provider value={value}>{children}</GlobalsContext.Provider>
  )
}
