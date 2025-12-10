'use client'

import React, { createContext, useEffect, useMemo, useState } from 'react'
import type { DeviceType } from './types'

const MOBILE_BREAKPOINT = 768

// 公开 device 类型上下文，供外部 useDevice 钩子使用
export const DeviceContext = createContext<DeviceType>('desktop')

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [deviceType, setDeviceType] = useState<DeviceType>('desktop')

  useEffect(() => {
    // 根据当前窗口尺寸选出设备类型，并在 resize 时同步更新
    const updateDeviceType = () => {
      const nextType = window.innerWidth < MOBILE_BREAKPOINT ? 'mobile' : 'desktop'
      setDeviceType(nextType)
    }

    updateDeviceType()
    window.addEventListener('resize', updateDeviceType)
    return () => window.removeEventListener('resize', updateDeviceType)
  }, [])

  // useMemo 保证 context 值仅在 deviceType 变化时才更新，避免无意义 rerender
  const contextValue = useMemo(() => deviceType, [deviceType])

  return <DeviceContext.Provider value={contextValue}>{children}</DeviceContext.Provider>
}
