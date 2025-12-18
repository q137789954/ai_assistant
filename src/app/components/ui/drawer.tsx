'use client'

import * as React from 'react'
import clsx from 'clsx'
import { Drawer as AntdDrawer } from 'antd'
import type { DrawerProps as AntdDrawerProps } from 'antd'

/**
 * 基于 Ant Design Drawer 的封装，统一关闭按钮、遮罩与面板样式。
 * - 默认取消自带 header/close icon，避免与自定义结构冲突。
 * - 通过 `styles` 自定义 wrapper/body 为透明，方便内部由业务层定义圆角/背景。
 */
export type DrawerProps = AntdDrawerProps

const Drawer = ({
  className,
  styles,
  closable = false,
  maskClosable = true,
  ...props
}: DrawerProps) => {
  const mergedStyles: AntdDrawerProps['styles'] = (info) => {
    const resolvedStyles =
      typeof styles === 'function' ? styles(info) : styles ?? {}
    return {
      ...resolvedStyles,
      wrapper: {
        backgroundColor: 'transparent',
        borderRadius: 0,
        ...(resolvedStyles?.wrapper ?? {}),
      },
      body: {
        padding: 0,
        backgroundColor: 'transparent',
        ...(resolvedStyles?.body ?? {}),
      },
    }
  }
  return (
    <AntdDrawer
      {...props}
      className={clsx('custom-drawer-root', className)}
      closable={closable}
      maskClosable={maskClosable}
      styles={mergedStyles}
    />
  )
}
Drawer.displayName = 'Drawer'

const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={clsx('flex flex-col gap-1.5 px-6 pt-6', className)}
    {...props}
  />
)
DrawerHeader.displayName = 'DrawerHeader'

const DrawerFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={clsx('flex flex-wrap-reverse items-center justify-between gap-3 px-6 py-4', className)}
    {...props}
  />
)
DrawerFooter.displayName = 'DrawerFooter'

const DrawerTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={clsx('text-lg font-semibold text-slate-900', className)} {...props} />
))
DrawerTitle.displayName = 'DrawerTitle'

const DrawerDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={clsx('text-sm text-slate-500', className)} {...props} />
))
DrawerDescription.displayName = 'DrawerDescription'

export { Drawer, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle }
