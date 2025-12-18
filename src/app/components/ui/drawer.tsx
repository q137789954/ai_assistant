'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import clsx from 'clsx'

/**
 * 抽屉的基础容器与控制组件，统一暴露 Radix Dialog 的 root/trigger/close。
 */
export const Drawer = DialogPrimitive.Root
export const DrawerTrigger = DialogPrimitive.Trigger
export const DrawerClose = DialogPrimitive.Close

/**
 * 通过 Portal 保证抽屉内容在最上层渲染，避免被其他布局遮挡。
 */
const DrawerPortal = ({ children, ...props }: DialogPrimitive.DialogPortalProps) => (
  <DialogPrimitive.Portal {...props}>{children}</DialogPrimitive.Portal>
)
DrawerPortal.displayName = DialogPrimitive.Portal.displayName

/**
 * 抽屉的遮罩层，带有渐变透明与模糊效果，确保界面聚焦在抽屉内容。
 */
const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  DialogPrimitive.DialogOverlayProps
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={clsx(
      'fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm transition-opacity duration-200',
      'data-[state=open]:opacity-100',
      'data-[state=closed]:opacity-0',
      className
    )}
    {...props}
  />
))
DrawerOverlay.displayName = DialogPrimitive.Overlay.displayName

/**
 * 抽屉内容区域的样式变体，支持四个方向与多个尺寸。
 * 利用 Radix 的 data-state 和自定义 data-placement 控制动画与布局。
 */
const drawerVariants = cva(
  [
    'fixed z-50 flex flex-col gap-4 bg-white shadow-xl outline-none transition-transform duration-300 ease-in-out',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    'data-[state=closed]:opacity-0 data-[state=open]:opacity-100',
    'overflow-y-auto',
  ].join(' '),
  {
    variants: {
      placement: {
        right: 'inset-y-0 right-0 h-full translate-x-full border-l border-slate-200 data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full',
        left: 'inset-y-0 left-0 h-full -translate-x-full border-r border-slate-200 data-[state=open]:translate-x-0 data-[state=closed]:-translate-x-full',
        top: 'inset-x-0 top-0 w-full max-h-[90vh] -translate-y-full border-b border-slate-200 rounded-b-[20px] data-[state=open]:translate-y-0 data-[state=closed]:-translate-y-full',
        bottom: 'inset-x-0 bottom-0 w-full max-h-[90vh] translate-y-full border-t border-slate-200 rounded-t-[20px] data-[state=open]:translate-y-0 data-[state=closed]:translate-y-full',
      },
      size: {
        sm: [
          'data-[placement=right]:w-[min(100vw,320px)]',
          'data-[placement=left]:w-[min(100vw,320px)]',
          'data-[placement=top]:h-[min(100vh,240px)]',
          'data-[placement=bottom]:h-[min(100vh,240px)]',
        ].join(' '),
        md: [
          'data-[placement=right]:w-[min(100vw,420px)]',
          'data-[placement=left]:w-[min(100vw,420px)]',
          'data-[placement=top]:h-[min(100vh,320px)]',
          'data-[placement=bottom]:h-[min(100vh,320px)]',
        ].join(' '),
        lg: [
          'data-[placement=right]:w-[min(100vw,540px)]',
          'data-[placement=left]:w-[min(100vw,540px)]',
          'data-[placement=top]:h-[min(100vh,420px)]',
          'data-[placement=bottom]:h-[min(100vh,420px)]',
        ].join(' '),
      },
    },
    defaultVariants: {
      placement: 'right',
      size: 'md',
    },
  }
)

/**
 * 抽屉的内容（主视图）props，结合 Radix Dialog Content 与风格变体。
 */
export interface DrawerContentProps
  extends DialogPrimitive.DialogContentProps,
    VariantProps<typeof drawerVariants> {}

/**
 * 通用抽屉内容组件，内部已自动处理 Portal、Overlay 与基础动画。
 */
const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(({ className, children, placement = 'right', size = 'md', ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={clsx(drawerVariants({ placement, size }), className)}
      data-placement={placement}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DrawerPortal>
))
DrawerContent.displayName = 'DrawerContent'

/**
 * 抽屉头部容器，提供统一的间距与垂直堆叠关系。
 */
const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={clsx('flex flex-col gap-1.5 px-4 pt-4 sm:px-6', className)} {...props} />
)
DrawerHeader.displayName = 'DrawerHeader'

/**
 * 抽屉底部操作区，默认在桌面端横向排列并右对齐。
 */
const DrawerFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={clsx(
      'flex flex-wrap-reverse items-center justify-end gap-3 px-4 pb-4 sm:px-6 sm:flex-row',
      className
    )}
    {...props}
  />
)
DrawerFooter.displayName = 'DrawerFooter'

/**
 * 抽屉标题，继承 Radix Dialog 的语义结构。
 */
const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={clsx('text-lg font-semibold text-slate-900', className)}
    {...props}
  />
))
DrawerTitle.displayName = 'DrawerTitle'

/**
 * 抽屉描述文本，用于补充提示信息与细节说明。
 */
const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={clsx('text-sm text-slate-500', className)}
    {...props}
  />
))
DrawerDescription.displayName = 'DrawerDescription'

export {
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
}
